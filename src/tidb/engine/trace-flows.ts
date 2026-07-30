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
const SCHEDULE_EPSILON_MS = 1e-3
export const TRACE_LOOP_HOLD_MS = 1_800
const FAILED_TRACE_LOOP_HOLD_MS = 2_600
const TIFLASH_MPP_TASK_ENDPOINTS = Object.freeze([
  'task-scan-1',
  'task-scan-2',
  'task-final-1',
  'task-final-2',
] as const)

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
  /** Current position on the renderer-only teaching clock. */
  readonly cursorMs?: number
  /**
   * Stable arrays, mutated in place, in presentation order. Parallel events
   * may therefore expose more than one active id.
   */
  readonly activeEventIds?: readonly string[]
  readonly completedEventIds?: readonly string[]
}

export interface TracePresentationSchedule {
  readonly starts: Float32Array
  readonly lives: Float32Array
  /** Event indexes sorted by presentation start, then receipt order. */
  readonly order: Int32Array
  readonly durationMs: number
}

export interface TraceFlowController {
  readonly object: THREE.Group
  readonly mesh: THREE.InstancedMesh
  readonly active: number
  readonly dropped: number
  readonly playback: TraceFlowPlayback
  /** Stable presentation-state views for parallel-aware integrations. */
  readonly cursorMs: number
  readonly activeEventIds: readonly string[]
  readonly completedEventIds: readonly string[]
  /** Per-domain active counts in TRACE_DOMAIN_ORDER. Mutated in place. */
  readonly activity: Float32Array
  play(receipt: TraceReceipt): void
  update(deltaSeconds: number): void
  setPlaybackRate(rate: number): void
  setPaused(paused: boolean): void
  setLooping(enabled: boolean): void
  step(direction: -1 | 1): void
  /** Selects and pauses on an exact receipt event id, including a parallel sibling. */
  seek(eventId: string): boolean
  replay(): void
  setTheme(theme: CityTheme): void
  stop(): void
  dispose(): void
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function modelStart(event: TraceEvent): number {
  return Number.isFinite(event.atMs) ? Math.max(0, event.atMs) : 0
}

function modelDuration(event: TraceEvent): number {
  return Number.isFinite(event.durationMs) ? Math.max(0, event.durationMs) : 0
}

function dependenciesFor(event: TraceEvent): readonly string[] {
  const dependencies = event.dependsOn
  return Array.isArray(dependencies) ? dependencies : []
}

/**
 * Build a renderer-only teaching clock. Receipt timestamps remain untouched:
 * Machine and Diagnose still show the deterministic model time, while City
 * gives each causal hop enough wall time to be read. Overlapping model
 * intervals remain overlapping presentation intervals. A declared dependency
 * is stronger than timestamps and starts only after all known parents finish.
 */
export function buildTracePresentationSchedule(
  events: readonly TraceEvent[],
  routeDistances: ArrayLike<number> = [],
): TracePresentationSchedule {
  const starts = new Float32Array(events.length)
  const lives = new Float32Array(events.length)

  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    const distance = Math.max(0, routeDistances[index] ?? 0)
    const failedHold = event.status === 'failed' ? 140 : event.status === 'warning' ? 70 : 0
    const life = clamp(
      455 + Math.sqrt(distance) * 20 +
        Math.min(500, modelDuration(event)) * 0.1 +
        failedHold,
      MIN_LIFE_MS,
      MAX_LIFE_MS,
    )
    lives[index] = life
  }

  if (events.length === 0) {
    return {
      starts,
      lives,
      order: new Int32Array(0),
      durationMs: 0,
    }
  }

  /*
   * Work in chronological order without changing receipt order. Events are
   * partitioned into connected interval groups. Inside a group one scale maps
   * model offsets onto the teaching clock; choosing the smallest life/duration
   * ratio guarantees that every model overlap remains a visual overlap.
   * Disjoint groups retain the previous readable dwell and bounded gap.
   */
  const ordered = events.map((_event, index) => index)
  ordered.sort((a, b) => modelStart(events[a]) - modelStart(events[b]) || a - b)

  let cursor = 0
  let orderedIndex = 0
  while (orderedIndex < ordered.length) {
    const groupBegin = orderedIndex
    const firstIndex = ordered[groupBegin]
    const groupModelStart = modelStart(events[firstIndex])
    let groupModelEnd = groupModelStart + modelDuration(events[firstIndex])
    orderedIndex++

    while (orderedIndex < ordered.length) {
      const nextIndex = ordered[orderedIndex]
      const nextStart = modelStart(events[nextIndex])
      const sameStart = Math.abs(nextStart - groupModelStart) <= SCHEDULE_EPSILON_MS
      if (!sameStart && nextStart >= groupModelEnd - SCHEDULE_EPSILON_MS) break
      groupModelEnd = Math.max(
        groupModelEnd,
        nextStart + modelDuration(events[nextIndex]),
      )
      orderedIndex++
    }

    let modelScale = Number.POSITIVE_INFINITY
    for (let position = groupBegin; position < orderedIndex; position++) {
      const eventIndex = ordered[position]
      const duration = modelDuration(events[eventIndex])
      if (duration > SCHEDULE_EPSILON_MS) {
        modelScale = Math.min(modelScale, lives[eventIndex] / duration)
      }
    }
    if (!Number.isFinite(modelScale)) modelScale = 0

    let groupVisualEnd = cursor
    for (let position = groupBegin; position < orderedIndex; position++) {
      const eventIndex = ordered[position]
      starts[eventIndex] =
        cursor + (modelStart(events[eventIndex]) - groupModelStart) * modelScale
      groupVisualEnd = Math.max(
        groupVisualEnd,
        starts[eventIndex] + lives[eventIndex],
      )
    }
    cursor = groupVisualEnd

    if (orderedIndex < ordered.length) {
      const nextStart = modelStart(events[ordered[orderedIndex]])
      const modelGap = Math.max(0, nextStart - groupModelEnd)
      cursor += EVENT_DWELL_MS + Math.min(MAX_MODEL_GAP_BONUS_MS, modelGap * 0.28)
    }
  }

  /*
   * Dependencies are optional for legacy receipts. Resolve them recursively so
   * a child may appear before its parent in receipt order. Cyclic edges are
   * ignored at the back-edge rather than making the presentation diverge.
   */
  const eventById = new Map<string, number>()
  for (let index = 0; index < events.length; index++) {
    if (!eventById.has(events[index].id)) eventById.set(events[index].id, index)
  }
  const dependencyState = new Uint8Array(events.length)
  const resolveDependencies = (eventIndex: number): void => {
    if (dependencyState[eventIndex] === 2) return
    if (dependencyState[eventIndex] === 1) return
    dependencyState[eventIndex] = 1
    for (const dependencyId of dependenciesFor(events[eventIndex])) {
      const dependencyIndex = eventById.get(dependencyId)
      if (
        dependencyIndex === undefined ||
        dependencyIndex === eventIndex ||
        dependencyState[dependencyIndex] === 1
      ) {
        continue
      }
      resolveDependencies(dependencyIndex)
      starts[eventIndex] = Math.max(
        starts[eventIndex],
        starts[dependencyIndex] + lives[dependencyIndex] + EVENT_DWELL_MS,
      )
    }
    dependencyState[eventIndex] = 2
  }
  for (let index = 0; index < events.length; index++) resolveDependencies(index)

  ordered.sort((a, b) => starts[a] - starts[b] || a - b)
  let durationMs = 0
  for (let index = 0; index < events.length; index++) {
    durationMs = Math.max(durationMs, starts[index] + lives[index])
  }
  return {
    starts,
    lives,
    order: Int32Array.from(ordered),
    durationMs,
  }
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

function isLockDetectorEndpoint(
  raw: string,
  event: TraceEvent,
  side: 'source' | 'target',
): boolean {
  const detectorStore = event.snapshot?.lockLab?.detectorLeaderStoreId
    .trim()
    .toLowerCase()
  if (!detectorStore || raw !== detectorStore) return false
  switch (event.kind) {
    case 'lock_wait_enqueued':
    case 'deadlock_detected':
      return side === 'target'
    case 'deadlock_victim_selected':
    case 'deadlock_resolved':
      return side === 'source'
    default:
      return false
  }
}

function componentIdFor(rawValue: string, event: TraceEvent, side: 'source' | 'target'): string | null {
  const raw = rawValue.trim().toLowerCase()
  if (!raw) return null
  if (event.snapshot?.tiflashMppLab) {
    if (raw === 'tiflash-1') return 'tiflash.lab.store.0'
    if (raw === 'tiflash-2') return 'tiflash.lab.store.1'
    if (
      raw === 'tiflash-proxy' ||
      raw === 'tiflash-learners'
    ) {
      const regionId = event.regionId
      const learners = event.snapshot.tiflashMppLab.learners
      const index = regionId === undefined
        ? 0
        : learners.findIndex((learner) => learner.regionId === regionId)
      return `tiflash.lab.learner.${Math.max(0, Math.min(2, index))}`
    }
    if (raw === 'tiflash-placement' || raw === 'tiflash-storage') {
      return side === 'source'
        ? 'tiflash.lab.store.0'
        : 'tiflash.lab.store.1'
    }
    if (raw === 'tiflash-scheduler' || raw === 'fragment-scan') {
      return 'tiflash.lab.fragment.scan'
    }
    if (raw === 'tiflash-mpp' || raw === 'fragment-final') {
      return 'tiflash.lab.fragment.final'
    }
    const taskSlot = TIFLASH_MPP_TASK_ENDPOINTS.indexOf(
      raw as typeof TIFLASH_MPP_TASK_ENDPOINTS[number],
    )
    if (taskSlot >= 0) return `tiflash.lab.task.${taskSlot}`
    if (raw === 'tidb-root') return 'tiflash.lab.root'
    if (/^tikv-region-?(\d+)$/.test(raw)) {
      return regionPeerId(event, side === 'target' && event.domain === 'raft')
    }
  }
  if (
    raw === 'client' ||
    raw === 'clients' ||
    raw === 'client-a' ||
    raw === 'client-b' ||
    raw === 'application' ||
    raw === 'client-terminal'
  ) {
    return 'client.terminal'
  }
  if (raw === 'pd' || raw === 'tso' || raw === 'pd-leader' || raw === 'pd-control') {
    return 'pd.control'
  }
  if (raw === 'gc' || raw === 'gc-worker' || raw === 'safe-point') return 'gc.yard'
  if (
    raw === 'tiflash' ||
    raw === 'mpp' ||
    raw === 'tiflash-1' ||
    raw === 'tiflash-2'
  ) {
    return 'tiflash.0'
  }
  if (raw === 'tikv-raft') return regionPeerId(event, side === 'target')
  if (raw.startsWith('region')) return regionPeerId(event, side === 'target' && event.domain === 'raft')

  const proxy = numberedComponent('tiproxy', raw, 2)
  if (proxy) return proxy
  const tidb = numberedComponent('tidb', raw, 3)
  if (tidb) return tidb
  const tikv = numberedComponent('tikv', raw, 3)
  if (tikv) {
    /*
     * The cluster-wide deadlock detector belongs to a TiKV store, not to one
     * Region peer. Other TiKV endpoints with a Region discriminator continue
     * to resolve to the appropriate leader/follower cell.
     */
    if (isLockDetectorEndpoint(raw, event, side)) return tikv
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
   * One large freight pod carries each active event. Parallel branches share
   * this bounded pool. The old two-world-unit pod was only a few pixels wide
   * from the overview camera and disappeared against the network lines.
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
  let eventOrder: Int32Array<ArrayBufferLike> = new Int32Array(0)
  let events: readonly TraceEvent[] = []
  let eventCount = 0
  let durationMs = 0
  let terminalEventIndex = -1
  let freeCount = MAX_PARTICLES
  let activeCount = 0
  let dropped = 0
  let clockMs = 0
  let playbackRate = 1
  let presentationPaused = false
  let loopHoldMs = 0
  let iteration = 0
  let selectedEventIndex: number | null = null
  let theme: CityTheme = 'night'
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let looping = !reducedMotion
  const activeEventIds: string[] = []
  const completedEventIds: string[] = []
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
    cursorMs: 0,
    activeEventIds,
    completedEventIds,
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
    let result = -1
    for (let position = 0; position < eventOrder.length; position++) {
      const eventIndex = eventOrder[position]
      if (eventStarts[eventIndex] > clockMs + SCHEDULE_EPSILON_MS) break
      result = eventIndex
    }
    return result
  }

  function syncPlaybackState(): void {
    const scheduledIndex = currentIndex()
    const index = selectedEventIndex !== null &&
      eventStarts[selectedEventIndex] <= clockMs + SCHEDULE_EPSILON_MS &&
      clockMs < eventStarts[selectedEventIndex] + eventLife[selectedEventIndex]
      ? selectedEventIndex
      : scheduledIndex
    const atEnd = eventCount > 0 && clockMs >= durationMs
    const holdDuration = events[terminalEventIndex]?.status === 'failed'
      ? FAILED_TRACE_LOOP_HOLD_MS
      : TRACE_LOOP_HOLD_MS
    activeEventIds.length = 0
    completedEventIds.length = 0
    for (let position = 0; position < eventOrder.length; position++) {
      const eventIndex = eventOrder[position]
      const start = eventStarts[eventIndex]
      if (start > clockMs + SCHEDULE_EPSILON_MS) break
      if (clockMs + SCHEDULE_EPSILON_MS >= start + eventLife[eventIndex]) {
        completedEventIds.push(events[eventIndex].id)
      } else {
        activeEventIds.push(events[eventIndex].id)
      }
    }
    playbackState.currentIndex = index
    playbackState.total = eventCount
    playbackState.event = index >= 0 ? events[index] : null
    playbackState.eventProgress = index < 0
      ? 0
      : clamp((clockMs - eventStarts[index]) / eventLife[index], 0, 1)
    playbackState.overallProgress = durationMs <= 0
      ? 0
      : clamp(clockMs / durationMs, 0, 1)
    playbackState.elapsedMs = Math.min(clockMs, durationMs)
    playbackState.durationMs = durationMs
    playbackState.atEnd = atEnd
    playbackState.looping = looping
    playbackState.iteration = iteration
    playbackState.holdProgress = atEnd && looping
      ? clamp(loopHoldMs / holdDuration, 0, 1)
      : 0
    playbackState.cursorMs = clockMs
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
    selectedEventIndex = null
    activeEventIds.length = 0
    completedEventIds.length = 0
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
    selectedEventIndex = null
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
    eventOrder = schedule.order
    durationMs = schedule.durationMs
    terminalEventIndex = -1
    let terminalEnd = -1
    for (let position = 0; position < eventOrder.length; position++) {
      const eventIndex = eventOrder[position]
      const end = eventStarts[eventIndex] + eventLife[eventIndex]
      if (end >= terminalEnd) {
        terminalEnd = end
        terminalEventIndex = eventIndex
      }
    }
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
      const holdDuration = events[terminalEventIndex]?.status === 'failed'
        ? FAILED_TRACE_LOOP_HOLD_MS
        : TRACE_LOOP_HOLD_MS
      if (loopHoldMs >= holdDuration) restartIteration(true)
    }
    for (let position = 0; position < eventOrder.length; position++) {
      const eventIndex = eventOrder[position]
      if (eventStarts[eventIndex] > clockMs + SCHEDULE_EPSILON_MS) break
      if (
        !eventScheduled[eventIndex] &&
        eventStarts[eventIndex] <= clockMs + SCHEDULE_EPSILON_MS
      ) {
        spawn(eventIndex)
      }
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
    get cursorMs(): number {
      return clockMs
    },
    activeEventIds,
    completedEventIds,
    activity,
    play,
    update,
    setPlaybackRate(rate: number): void {
      playbackRate = clamp(rate, 0, 16)
      syncPlaybackState()
    },
    setPaused(paused: boolean): void {
      presentationPaused = paused
      if (!paused) selectedEventIndex = null
      syncPlaybackState()
    },
    setLooping(enabled: boolean): void {
      looping = enabled
      if (!enabled) loopHoldMs = 0
      syncPlaybackState()
    },
    step(direction: -1 | 1): void {
      if (eventCount === 0) return
      const current = playbackState.currentIndex
      const currentStart = current < 0 ? -Infinity : eventStarts[current]
      let target = current < 0 ? eventOrder[0] : current
      if (direction > 0) {
        for (let position = 0; position < eventOrder.length; position++) {
          const candidate = eventOrder[position]
          if (eventStarts[candidate] > currentStart + SCHEDULE_EPSILON_MS) {
            target = candidate
            /*
             * One step selects a complete parallel start group. Use its final
             * receipt-ordered member as the primary event; activeEventIds
             * exposes every sibling in that group.
             */
            while (
              position + 1 < eventOrder.length &&
              Math.abs(eventStarts[eventOrder[position + 1]] - eventStarts[target]) <=
                SCHEDULE_EPSILON_MS
            ) {
              target = eventOrder[++position]
            }
            break
          }
        }
      } else {
        for (let position = eventOrder.length - 1; position >= 0; position--) {
          const candidate = eventOrder[position]
          if (eventStarts[candidate] < currentStart - SCHEDULE_EPSILON_MS) {
            target = candidate
            break
          }
        }
      }
      const targetStart = eventStarts[target]
      let targetGroupLife = eventLife[target]
      for (let position = 0; position < eventOrder.length; position++) {
        const candidate = eventOrder[position]
        if (
          Math.abs(eventStarts[candidate] - targetStart) <=
          SCHEDULE_EPSILON_MS
        ) {
          targetGroupLife = Math.min(targetGroupLife, eventLife[candidate])
        }
      }
      presentationPaused = true
      restartIteration(false)
      clockMs = targetStart + targetGroupLife * 0.55
      update(0)
    },
    seek(eventId: string): boolean {
      const target = events.findIndex((event) => event.id === eventId)
      if (target < 0) return false
      presentationPaused = true
      restartIteration(false)
      const targetStart = eventStarts[target]
      clockMs = targetStart + eventLife[target] * 0.55
      selectedEventIndex = target
      update(0)
      return true
    },
    replay(): void {
      if (eventCount === 0) return
      restartIteration(false)
      presentationPaused = false
      selectedEventIndex = null
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
      terminalEventIndex = -1
      eventOrder = new Int32Array(0)
      clockMs = 0
      loopHoldMs = 0
      iteration = 0
      presentationPaused = false
      selectedEventIndex = null
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
