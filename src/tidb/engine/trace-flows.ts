/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * The public input is deliberately TraceReceipt, not an imperative `emit`.
 * This keeps the 3D city, machine view, and diagnostics on one event truth.
 */

import * as THREE from 'three'
import type { TraceDomain, TraceEvent, TraceReceipt } from '../model/types'
import type { TiDBSceneGraph } from '../world/city'
import { TICITY_LAYOUT } from '../world/layout'
import { SEMANTIC_COLORS } from '../world/palette'
import type { CityTheme, SemanticDomain } from '../world/palette'

export const TRACE_DOMAIN_ORDER: readonly TraceDomain[] = [
  'client',
  'sql',
  'tso',
  'txn2pc',
  'raft',
  'kv',
  'tiflash',
  'return',
] as const

const DOMAIN_INDEX: Readonly<Record<TraceDomain, number>> = {
  client: 0,
  sql: 1,
  tso: 2,
  txn2pc: 3,
  raft: 4,
  kv: 5,
  tiflash: 6,
  return: 7,
}

const DOMAIN_SEMANTIC: Readonly<Record<TraceDomain, SemanticDomain>> = {
  client: 'client',
  sql: 'sql',
  tso: 'tso',
  txn2pc: 'txn2pc',
  raft: 'raft',
  kv: 'kv',
  tiflash: 'tiflash',
  return: 'return',
}

const MAX_PARTICLES = 256
const GUIDE_MARKERS = 28
const MIN_LIFE_MS = 520
const MAX_LIFE_MS = 1050
const EVENT_DWELL_MS = 110
const MAX_MODEL_GAP_BONUS_MS = 520
const STATIONARY_DISTANCE = 0.75
export const TRACE_LOOP_HOLD_MS = 1_800
const FAILED_TRACE_LOOP_HOLD_MS = 2_600

const _from = new THREE.Vector3()
const _to = new THREE.Vector3()
const _position = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _rotation = new THREE.Quaternion()
const _matrix = new THREE.Matrix4()
const _color = new THREE.Color()
const _forward = new THREE.Vector3(0, 0, 1)
const _hidden = new THREE.Vector3(0, -1000, 0)
const _zero = new THREE.Vector3(0, 0, 0)

export type TracePlaybackPhase =
  | 'idle'
  | 'playing'
  | 'holding'
  | 'paused'
  | 'complete'

export interface TraceFlowPlayback {
  readonly phase: TracePlaybackPhase
  readonly currentIndex: number
  readonly total: number
  readonly event: TraceEvent | null
  readonly eventProgress: number
  readonly overallProgress: number
  readonly elapsedMs: number
  readonly durationMs: number
  readonly motion: 'full' | 'reduced'
  readonly atEnd: boolean
  readonly looping: boolean
  readonly iteration: number
  readonly holdProgress: number
}

export interface TracePresentationSchedule {
  readonly starts: Float32Array
  readonly lives: Float32Array
  readonly durationMs: number
}

export interface TraceFlowController {
  readonly object: THREE.Group
  readonly mesh: THREE.InstancedMesh
  readonly active: number
  readonly dropped: number
  readonly playback: TraceFlowPlayback
  /** Per-domain active counts in TRACE_DOMAIN_ORDER. Mutated in place. */
  readonly activity: Float32Array
  play(receipt: TraceReceipt): void
  update(deltaSeconds: number): void
  setPlaybackRate(rate: number): void
  setPaused(paused: boolean): void
  setLooping(enabled: boolean): void
  step(direction: -1 | 1): void
  replay(): void
  setTheme(theme: CityTheme): void
  stop(): void
  dispose(): void
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

/**
 * Build a renderer-only teaching clock. Receipt timestamps remain untouched:
 * Machine and Diagnose still show the deterministic model time, while City
 * gives each causal hop enough wall time to be read.
 */
export function buildTracePresentationSchedule(
  events: readonly TraceEvent[],
  routeDistances: ArrayLike<number> = [],
): TracePresentationSchedule {
  const starts = new Float32Array(events.length)
  const lives = new Float32Array(events.length)
  let cursor = 0

  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    const distance = Math.max(0, routeDistances[index] ?? 0)
    const failedHold = event.status === 'failed' ? 140 : event.status === 'warning' ? 70 : 0
    const life = clamp(
      455 + Math.sqrt(distance) * 20 + Math.min(500, event.durationMs) * 0.1 + failedHold,
      MIN_LIFE_MS,
      MAX_LIFE_MS,
    )
    starts[index] = cursor
    lives[index] = life

    const next = events[index + 1]
    const modelGap = next
      ? Math.max(0, next.atMs - (event.atMs + event.durationMs))
      : 0
    const gapBonus = Math.min(MAX_MODEL_GAP_BONUS_MS, modelGap * 0.28)
    cursor += life + EVENT_DWELL_MS + gapBonus
  }

  const durationMs = events.length === 0
    ? 0
    : starts[events.length - 1] + lives[events.length - 1]
  return { starts, lives, durationMs }
}

function normalizedRegion(event: TraceEvent): number {
  return Math.max(0, Math.min(TICITY_LAYOUT.regionCount - 1, event.regionId ?? 0))
}

function regionPeerId(event: TraceEvent, follower = false): string {
  const region = normalizedRegion(event)
  const leaderStore = region % 3
  const store = follower ? (leaderStore + 1) % 3 : leaderStore
  if ((event.regionId ?? 0) >= TICITY_LAYOUT.regionCount) return `tikv.${store}`
  return `region.${region}.peer.${store}`
}

function numberedComponent(prefix: string, raw: string, count: number): string | null {
  const match = raw.match(new RegExp(`^${prefix}(?:[._-](\\d+))?$`))
  if (!match) return null
  const oneBased = match[1] ? Number(match[1]) : 1
  return `${prefix}.${Math.max(0, Math.min(count - 1, oneBased - 1))}`
}

function componentIdFor(rawValue: string, event: TraceEvent, side: 'source' | 'target'): string | null {
  const raw = rawValue.trim().toLowerCase()
  if (!raw) return null
  if (raw === 'client' || raw === 'application' || raw === 'client-terminal') {
    return 'client.terminal'
  }
  if (raw === 'pd' || raw === 'tso' || raw === 'pd-leader' || raw === 'pd-control') {
    return 'pd.control'
  }
  if (raw === 'gc' || raw === 'gc-worker' || raw === 'safe-point') return 'gc.yard'
  if (raw === 'tiflash' || raw === 'mpp' || raw === 'tiflash-1') return 'tiflash.0'
  if (raw === 'tikv-raft') return regionPeerId(event, side === 'target')
  if (raw.startsWith('region')) return regionPeerId(event, side === 'target' && event.domain === 'raft')

  const proxy = numberedComponent('tiproxy', raw, 2)
  if (proxy) return proxy
  const tidb = numberedComponent('tidb', raw, 3)
  if (tidb) return tidb
  const tikv = numberedComponent('tikv', raw, 3)
  if (tikv) {
    if (event.regionId === undefined) return tikv
    if (event.regionId >= TICITY_LAYOUT.regionCount) return tikv
    const store = tikv.charCodeAt(tikv.length - 1) - 48
    return `region.${normalizedRegion(event)}.peer.${store}`
  }
  const pd = numberedComponent('pd', raw, 3)
  if (pd) return pd
  return rawValue
}

function defaultEndpoint(event: TraceEvent, side: 'source' | 'target'): string {
  switch (event.domain) {
    case 'client':
      return side === 'source' ? 'client.terminal' : 'tiproxy.0'
    case 'sql':
      return side === 'source' ? 'tiproxy.0' : 'tidb.1'
    case 'tso':
      return side === 'source' ? 'tidb.1' : 'pd.control'
    case 'txn2pc':
      return side === 'source' ? 'tidb.1' : regionPeerId(event)
    case 'raft':
      return side === 'source' ? regionPeerId(event) : regionPeerId(event, true)
    case 'kv': {
      if (side === 'source') return regionPeerId(event)
      const region = normalizedRegion(event)
      return `tikv.${region % 3}`
    }
    case 'tiflash':
      return side === 'source' ? 'tikv.1' : 'tiflash.0'
    case 'return':
      return side === 'source' ? regionPeerId(event) : 'client.terminal'
  }
}

export function resolveTraceEndpoint(
  event: TraceEvent,
  side: 'source' | 'target',
  city: TiDBSceneGraph,
  out: THREE.Vector3,
): boolean {
  const raw = event[side]
  const id = raw ? componentIdFor(raw, event, side) : defaultEndpoint(event, side)
  return id ? city.getAnchor(id, out) : false
}

export function createTraceFlows(city: TiDBSceneGraph): TraceFlowController {
  const root = new THREE.Group()
  root.name = 'ticity:trace-flows'

  /*
   * One large freight pod carries the current event. The old two-world-unit
   * pod was only a few pixels wide from the overview camera and disappeared
   * against the architectural network lines.
   */
  const geometry = new THREE.BoxGeometry(4.2, 2.7, 6.4)
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES)
  mesh.name = 'trace-flow:packets'
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  mesh.renderOrder = 92
  mesh.count = 0

  /*
   * Moving chevrons make the whole route legible and communicate direction
   * even in a still frame. They are one instanced draw call, not one object per
   * event or per marker.
   */
  const guideGeometry = new THREE.ConeGeometry(1.95, 7.2, 4)
  guideGeometry.rotateX(Math.PI / 2)
  const guideMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.78,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const guide = new THREE.InstancedMesh(guideGeometry, guideMaterial, GUIDE_MARKERS)
  guide.name = 'trace-flow:route-guide'
  guide.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  guide.frustumCulled = false
  guide.renderOrder = 90
  guide.count = 0

  /* Source and target remain visible while paused or after the final event. */
  const endpointGeometry = new THREE.RingGeometry(5.8, 8.2, 32)
  endpointGeometry.rotateX(-Math.PI / 2)
  const endpointMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const endpoints = new THREE.InstancedMesh(endpointGeometry, endpointMaterial, 2)
  endpoints.name = 'trace-flow:endpoints'
  endpoints.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  endpoints.frustumCulled = false
  endpoints.renderOrder = 91
  endpoints.count = 0
  root.add(guide, endpoints, mesh)

  const free = new Int16Array(MAX_PARTICLES)
  const active = new Int16Array(MAX_PARTICLES)
  const particleEvent = new Int32Array(MAX_PARTICLES)
  const particleDomain = new Uint8Array(MAX_PARTICLES)
  const particleFailed = new Uint8Array(MAX_PARTICLES)
  const activity = new Float32Array(TRACE_DOMAIN_ORDER.length)

  let eventStarts: Float32Array<ArrayBufferLike> = new Float32Array(0)
  let eventLife: Float32Array<ArrayBufferLike> = new Float32Array(0)
  let eventDomain = new Uint8Array(0)
  let eventFailed = new Uint8Array(0)
  let eventRoutes = new Float32Array(0)
  let eventDistance = new Float32Array(0)
  let eventScheduled = new Uint8Array(0)
  let events: readonly TraceEvent[] = []
  let eventCount = 0
  let durationMs = 0
  let freeCount = MAX_PARTICLES
  let activeCount = 0
  let dropped = 0
  let clockMs = 0
  let playbackRate = 1
  let presentationPaused = false
  let loopHoldMs = 0
  let iteration = 0
  let theme: CityTheme = 'night'
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let looping = !reducedMotion
  const playbackState = {
    phase: 'idle' as TracePlaybackPhase,
    currentIndex: -1,
    total: 0,
    event: null as TraceEvent | null,
    eventProgress: 0,
    overallProgress: 0,
    elapsedMs: 0,
    durationMs: 0,
    motion: reducedMotion ? 'reduced' as const : 'full' as const,
    atEnd: false,
    looping,
    iteration: 0,
    holdProgress: 0,
  }

  for (let i = 0; i < MAX_PARTICLES; i++) {
    free[i] = MAX_PARTICLES - 1 - i
    _rotation.identity()
    _matrix.compose(_hidden, _rotation, _zero)
    mesh.setMatrixAt(i, _matrix)
  }
  mesh.instanceMatrix.needsUpdate = true

  function semanticForEvent(eventIndex: number): SemanticDomain {
    return eventFailed[eventIndex]
      ? 'fault'
      : DOMAIN_SEMANTIC[TRACE_DOMAIN_ORDER[eventDomain[eventIndex]]]
  }

  function displayColor(semantic: SemanticDomain): number {
    /*
     * Day architecture uses deliberately dark accessible ink. Foreground
     * packets instead keep the luminous palette so they remain visible at
     * overview scale without relying on night-only bloom.
     */
    return SEMANTIC_COLORS[theme === 'day' ? 'night' : theme][semantic]
  }

  function paintParticle(particle: number): void {
    const semantic = particleFailed[particle]
      ? 'fault'
      : DOMAIN_SEMANTIC[TRACE_DOMAIN_ORDER[particleDomain[particle]]]
    _color.setHex(displayColor(semantic))
    _color.multiplyScalar(theme === 'night' ? 2.1 : 1.45)
    mesh.setColorAt(particle, _color)
    if (mesh.instanceColor?.usage !== THREE.DynamicDrawUsage) {
      mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage)
    }
  }

  function hideParticle(particle: number): void {
    _rotation.identity()
    _matrix.compose(_hidden, _rotation, _zero)
    mesh.setMatrixAt(particle, _matrix)
  }

  function resetPool(): void {
    for (let i = 0; i < activeCount; i++) hideParticle(active[i])
    activeCount = 0
    freeCount = MAX_PARTICLES
    for (let i = 0; i < MAX_PARTICLES; i++) free[i] = MAX_PARTICLES - 1 - i
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = 0
    activity.fill(0)
    guide.count = 0
    endpoints.count = 0
  }

  function spawn(eventIndex: number): void {
    eventScheduled[eventIndex] = 1
    const age = Math.max(0, clockMs - eventStarts[eventIndex])
    if (age >= eventLife[eventIndex]) return
    if (freeCount === 0) {
      dropped++
      return
    }
    const particle = free[--freeCount]
    active[activeCount++] = particle
    particleEvent[particle] = eventIndex
    particleDomain[particle] = eventDomain[eventIndex]
    particleFailed[particle] = eventFailed[eventIndex]
    paintParticle(particle)
  }

  function syncDrawCount(): void {
    let highest = -1
    for (let index = 0; index < activeCount; index++) {
      highest = Math.max(highest, active[index])
    }
    mesh.count = highest + 1
  }

  function sampleRoute(
    eventIndex: number,
    progress: number,
    position: THREE.Vector3,
    tangent: THREE.Vector3,
  ): void {
    const route = eventIndex * 7
    const t = clamp(progress, 0, 1)
    const sx = eventRoutes[route]
    const sy = eventRoutes[route + 1]
    const sz = eventRoutes[route + 2]
    const ex = eventRoutes[route + 3]
    const ey = eventRoutes[route + 4]
    const ez = eventRoutes[route + 5]

    if (eventDistance[eventIndex] < STATIONARY_DISTANCE) {
      position.set(sx, sy + Math.sin(Math.PI * t) * 9, sz)
      tangent.set(0, t < 0.5 ? 1 : -1, 0)
      return
    }

    const u = 1 - t
    const cx = (sx + ex) * 0.5
    const cy = Math.max(sy, ey) + eventRoutes[route + 6]
    const cz = (sz + ez) * 0.5
    position.set(
      u * u * sx + 2 * u * t * cx + t * t * ex,
      u * u * sy + 2 * u * t * cy + t * t * ey,
      u * u * sz + 2 * u * t * cz + t * t * ez,
    )
    tangent.set(
      2 * u * (cx - sx) + 2 * t * (ex - cx),
      2 * u * (cy - sy) + 2 * t * (ey - cy),
      2 * u * (cz - sz) + 2 * t * (ez - cz),
    )
    if (tangent.lengthSq() < 1e-8) tangent.copy(_forward)
    else tangent.normalize()
  }

  function currentIndex(): number {
    if (eventCount === 0) return -1
    let result = 0
    while (result + 1 < eventCount && eventStarts[result + 1] <= clockMs) result++
    return result
  }

  function syncPlaybackState(): void {
    const index = currentIndex()
    const atEnd = eventCount > 0 && clockMs >= durationMs
    const holdDuration = events[eventCount - 1]?.status === 'failed'
      ? FAILED_TRACE_LOOP_HOLD_MS
      : TRACE_LOOP_HOLD_MS
    playbackState.currentIndex = index
    playbackState.total = eventCount
    playbackState.event = index >= 0 ? events[index] : null
    playbackState.eventProgress = index < 0
      ? 0
      : clamp((clockMs - eventStarts[index]) / eventLife[index], 0, 1)
    playbackState.overallProgress = eventCount === 0
      ? 0
      : clamp((index + playbackState.eventProgress) / eventCount, 0, 1)
    playbackState.elapsedMs = Math.min(clockMs, durationMs)
    playbackState.durationMs = durationMs
    playbackState.atEnd = atEnd
    playbackState.looping = looping
    playbackState.iteration = iteration
    playbackState.holdProgress = atEnd && looping
      ? clamp(loopHoldMs / holdDuration, 0, 1)
      : 0
    playbackState.phase = eventCount === 0
      ? 'idle'
      : presentationPaused || playbackRate === 0
        ? 'paused'
        : atEnd
          ? looping
            ? 'holding'
            : 'complete'
          : 'playing'
  }

  function restartIteration(automatic: boolean): void {
    resetPool()
    eventScheduled.fill(0)
    clockMs = 0
    loopHoldMs = 0
    iteration = automatic ? iteration + 1 : eventCount > 0 ? 1 : 0
  }

  function updateGuide(eventIndex: number, eventProgress: number): void {
    if (eventIndex < 0 || eventIndex >= eventCount) {
      guide.count = 0
      endpoints.count = 0
      return
    }

    const semantic = semanticForEvent(eventIndex)
    const stationary = eventDistance[eventIndex] < STATIONARY_DISTANCE
    const route = eventIndex * 7
    const motionOffset = reducedMotion ? 0 : (clockMs / 2300) % 1
    const pulse = reducedMotion ? 0 : Math.sin(clockMs * 0.012) * 0.12

    guide.count = stationary ? 0 : GUIDE_MARKERS
    for (let marker = 0; marker < guide.count; marker++) {
      const t = ((marker + 0.5) / GUIDE_MARKERS + motionOffset) % 1
      sampleRoute(eventIndex, t, _position, _tangent)
      _rotation.setFromUnitVectors(_forward, _tangent)
      const nearHead = reducedMotion
        ? 0
        : Math.max(0, 1 - Math.abs(t - eventProgress) * 7)
      const markerScale = 0.76 + nearHead * 0.58
      _scale.set(markerScale, markerScale, markerScale)
      _matrix.compose(_position, _rotation, _scale)
      guide.setMatrixAt(marker, _matrix)
      _color.setHex(displayColor(semantic))
      _color.multiplyScalar(
        theme === 'night'
          ? 1.05 + nearHead * 1.45
          : 1.12 + nearHead * 0.72,
      )
      guide.setColorAt(marker, _color)
      if (guide.instanceColor?.usage !== THREE.DynamicDrawUsage) {
        guide.instanceColor?.setUsage(THREE.DynamicDrawUsage)
      }
    }
    if (guide.count > 0) {
      guide.instanceMatrix.needsUpdate = true
      if (guide.instanceColor) guide.instanceColor.needsUpdate = true
    }

    const endpointCount = stationary ? 1 : 2
    endpoints.count = endpointCount
    for (let endpoint = 0; endpoint < endpointCount; endpoint++) {
      const offset = endpoint === 0 ? 0 : 3
      _position.set(
        eventRoutes[route + offset],
        eventRoutes[route + offset + 1] + 0.7,
        eventRoutes[route + offset + 2],
      )
      _rotation.identity()
      const endpointScale = endpoint === 0 ? 0.86 : 1.14 + pulse
      _scale.setScalar(endpointScale)
      _matrix.compose(_position, _rotation, _scale)
      endpoints.setMatrixAt(endpoint, _matrix)
      _color.setHex(displayColor(semantic))
      _color.multiplyScalar(
        theme === 'night'
          ? endpoint === 0 ? 1.15 : 2.05
          : endpoint === 0 ? 1.04 : 1.48,
      )
      endpoints.setColorAt(endpoint, _color)
      if (endpoints.instanceColor?.usage !== THREE.DynamicDrawUsage) {
        endpoints.instanceColor?.setUsage(THREE.DynamicDrawUsage)
      }
    }
    endpoints.instanceMatrix.needsUpdate = true
    if (endpoints.instanceColor) endpoints.instanceColor.needsUpdate = true
  }

  function play(receipt: TraceReceipt): void {
    resetPool()
    clockMs = 0
    loopHoldMs = 0
    dropped = 0
    presentationPaused = false
    events = receipt.events
    eventCount = events.length
    iteration = eventCount > 0 ? 1 : 0
    eventDomain = new Uint8Array(eventCount)
    eventFailed = new Uint8Array(eventCount)
    eventRoutes = new Float32Array(eventCount * 7)
    eventDistance = new Float32Array(eventCount)
    eventScheduled = new Uint8Array(eventCount)

    for (let i = 0; i < eventCount; i++) {
      const event = events[i]
      eventDomain[i] = DOMAIN_INDEX[event.domain]
      eventFailed[i] = event.status === 'failed' ? 1 : 0

      if (!resolveTraceEndpoint(event, 'source', city, _from)) _from.set(0, 5, 0)
      if (!resolveTraceEndpoint(event, 'target', city, _to)) _to.set(0, 5, 0)
      const route = i * 7
      eventRoutes[route] = _from.x
      eventRoutes[route + 1] = _from.y
      eventRoutes[route + 2] = _from.z
      eventRoutes[route + 3] = _to.x
      eventRoutes[route + 4] = _to.y
      eventRoutes[route + 5] = _to.z
      const distance = _from.distanceTo(_to)
      eventDistance[i] = distance
      eventRoutes[route + 6] = Math.max(
        event.domain === 'raft' ? 7 : 14,
        distance * (event.domain === 'raft' ? 0.075 : 0.11),
      )
    }

    const schedule = buildTracePresentationSchedule(events, eventDistance)
    eventStarts = schedule.starts
    eventLife = schedule.lives
    durationMs = schedule.durationMs
    syncPlaybackState()
    updateGuide(playbackState.currentIndex, playbackState.eventProgress)
  }

  function update(deltaSeconds: number): void {
    const effectiveRate = presentationPaused ? 0 : playbackRate
    const realDeltaMs = Math.max(0, deltaSeconds) * 1000
    const deltaMs = realDeltaMs * effectiveRate
    if (clockMs < durationMs) {
      clockMs = Math.min(durationMs, clockMs + deltaMs)
    } else if (eventCount > 0 && looping && effectiveRate > 0) {
      loopHoldMs += realDeltaMs
      const holdDuration = events[eventCount - 1]?.status === 'failed'
        ? FAILED_TRACE_LOOP_HOLD_MS
        : TRACE_LOOP_HOLD_MS
      if (loopHoldMs >= holdDuration) restartIteration(true)
    }
    for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
      if (!eventScheduled[eventIndex] && eventStarts[eventIndex] <= clockMs) spawn(eventIndex)
    }

    activity.fill(0)
    const hadActive = activeCount > 0
    let index = 0
    while (index < activeCount) {
      const particle = active[index]
      const eventIndex = particleEvent[particle]
      const age = Math.max(0, clockMs - eventStarts[eventIndex])
      const progress = age / eventLife[eventIndex]
      if (progress >= 1) {
        hideParticle(particle)
        free[freeCount++] = particle
        active[index] = active[--activeCount]
        continue
      }

      const t = reducedMotion ? 0.55 : Math.max(0, progress)
      sampleRoute(eventIndex, t, _position, _tangent)
      _rotation.setFromUnitVectors(_forward, _tangent)
      const domainScale = particleDomain[particle] === DOMAIN_INDEX.txn2pc ? 1.22 : 1
      const fade = reducedMotion
        ? 1
        : Math.min(1, progress / 0.08, (1 - progress) / 0.12)
      const stationaryPulse = eventDistance[eventIndex] < STATIONARY_DISTANCE
        ? 1 + Math.sin(progress * Math.PI) * 0.36
        : 1
      _scale.setScalar(domainScale * Math.max(0, fade) * stationaryPulse)
      _matrix.compose(_position, _rotation, _scale)
      mesh.setMatrixAt(particle, _matrix)
      activity[particleDomain[particle]]++
      index++
    }
    syncDrawCount()
    syncPlaybackState()
    updateGuide(playbackState.currentIndex, playbackState.eventProgress)
    if (hadActive || activeCount > 0) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  return {
    object: root,
    mesh,
    get active(): number {
      return activeCount
    },
    get dropped(): number {
      return dropped
    },
    playback: playbackState,
    activity,
    play,
    update,
    setPlaybackRate(rate: number): void {
      playbackRate = clamp(rate, 0, 16)
      syncPlaybackState()
    },
    setPaused(paused: boolean): void {
      presentationPaused = paused
      syncPlaybackState()
    },
    setLooping(enabled: boolean): void {
      looping = enabled
      if (!enabled) loopHoldMs = 0
      syncPlaybackState()
    },
    step(direction: -1 | 1): void {
      if (eventCount === 0) return
      const from = playbackState.currentIndex < 0 ? 0 : playbackState.currentIndex
      const target = clamp(from + direction, 0, eventCount - 1)
      presentationPaused = true
      restartIteration(false)
      clockMs = eventStarts[target] + eventLife[target] * 0.55
      update(0)
    },
    replay(): void {
      if (eventCount === 0) return
      restartIteration(false)
      presentationPaused = false
      syncPlaybackState()
      updateGuide(playbackState.currentIndex, playbackState.eventProgress)
    },
    setTheme(next: CityTheme): void {
      if (next === theme) return
      theme = next
      guideMaterial.opacity = next === 'night' ? 0.78 : 1
      endpointMaterial.opacity = next === 'night' ? 0.9 : 0.96
      for (let i = 0; i < activeCount; i++) paintParticle(active[i])
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      updateGuide(playbackState.currentIndex, playbackState.eventProgress)
    },
    stop(): void {
      resetPool()
      events = []
      eventCount = 0
      durationMs = 0
      clockMs = 0
      loopHoldMs = 0
      iteration = 0
      presentationPaused = false
      syncPlaybackState()
    },
    dispose(): void {
      mesh.dispose()
      guide.dispose()
      endpoints.dispose()
      geometry.dispose()
      material.dispose()
      guideGeometry.dispose()
      guideMaterial.dispose()
      endpointGeometry.dispose()
      endpointMaterial.dispose()
      root.remove(guide, endpoints, mesh)
    },
  }
}
