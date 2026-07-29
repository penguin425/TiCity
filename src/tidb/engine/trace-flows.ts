/*
 * Copyright 2026 TiDB City contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * The public input is deliberately TraceReceipt, not an imperative `emit`.
 * This keeps the 3D city, machine view, and diagnostics on one event truth.
 */

import * as THREE from 'three'
import type { TraceDomain, TraceEvent, TraceReceipt } from '../model/types'
import type { TiDBSceneGraph } from '../world/city'
import { TIDB_CITY } from '../world/layout'
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
const MIN_LIFE_MS = 240
const MAX_LIFE_MS = 2200

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

export interface TraceFlowController {
  readonly object: THREE.Group
  readonly mesh: THREE.InstancedMesh
  readonly active: number
  readonly dropped: number
  /** Per-domain active counts in TRACE_DOMAIN_ORDER. Mutated in place. */
  readonly activity: Float32Array
  play(receipt: TraceReceipt): void
  update(deltaSeconds: number): void
  setPlaybackRate(rate: number): void
  setTheme(theme: CityTheme): void
  stop(): void
  dispose(): void
}

function normalizedRegion(event: TraceEvent): number {
  return Math.max(0, Math.min(TIDB_CITY.regionCount - 1, event.regionId ?? 0))
}

function regionPeerId(event: TraceEvent, follower = false): string {
  const region = normalizedRegion(event)
  const leaderStore = region % 3
  const store = follower ? (leaderStore + 1) % 3 : leaderStore
  if ((event.regionId ?? 0) >= TIDB_CITY.regionCount) return `tikv.${store}`
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
    if (event.regionId >= TIDB_CITY.regionCount) return tikv
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
  root.name = 'tidb-city:trace-flows'

  /* A freight pod reads as a transported unit, not a tracer round. */
  const geometry = new THREE.BoxGeometry(1.15, 0.8, 1.35)
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    toneMapped: false,
  })
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_PARTICLES)
  mesh.name = 'trace-flow:packets'
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  root.add(mesh)

  const free = new Int16Array(MAX_PARTICLES)
  const active = new Int16Array(MAX_PARTICLES)
  const particleEvent = new Int32Array(MAX_PARTICLES)
  const particleAge = new Float32Array(MAX_PARTICLES)
  const particleDomain = new Uint8Array(MAX_PARTICLES)
  const particleFailed = new Uint8Array(MAX_PARTICLES)
  const activity = new Float32Array(TRACE_DOMAIN_ORDER.length)

  let eventStarts = new Float32Array(0)
  let eventLife = new Float32Array(0)
  let eventDomain = new Uint8Array(0)
  let eventFailed = new Uint8Array(0)
  let eventRoutes = new Float32Array(0)
  let eventScheduled = new Uint8Array(0)
  let eventCount = 0
  let freeCount = MAX_PARTICLES
  let activeCount = 0
  let dropped = 0
  let clockMs = 0
  let playbackRate = 1
  let theme: CityTheme = 'night'

  for (let i = 0; i < MAX_PARTICLES; i++) {
    free[i] = MAX_PARTICLES - 1 - i
    _matrix.compose(_hidden, _rotation, _zero)
    mesh.setMatrixAt(i, _matrix)
  }
  mesh.instanceMatrix.needsUpdate = true

  function paintParticle(particle: number): void {
    const semantic = particleFailed[particle]
      ? 'fault'
      : DOMAIN_SEMANTIC[TRACE_DOMAIN_ORDER[particleDomain[particle]]]
    _color.setHex(SEMANTIC_COLORS[theme][semantic])
    mesh.setColorAt(particle, _color)
  }

  function hideParticle(particle: number): void {
    _matrix.compose(_hidden, _rotation, _zero)
    mesh.setMatrixAt(particle, _matrix)
  }

  function resetPool(): void {
    for (let i = 0; i < activeCount; i++) hideParticle(active[i])
    activeCount = 0
    freeCount = MAX_PARTICLES
    for (let i = 0; i < MAX_PARTICLES; i++) free[i] = MAX_PARTICLES - 1 - i
    mesh.instanceMatrix.needsUpdate = true
    activity.fill(0)
  }

  function spawn(eventIndex: number): void {
    eventScheduled[eventIndex] = 1
    if (freeCount === 0) {
      dropped++
      return
    }
    const particle = free[--freeCount]
    active[activeCount++] = particle
    particleEvent[particle] = eventIndex
    particleAge[particle] = 0
    particleDomain[particle] = eventDomain[eventIndex]
    particleFailed[particle] = eventFailed[eventIndex]
    paintParticle(particle)
  }

  function play(receipt: TraceReceipt): void {
    resetPool()
    clockMs = 0
    dropped = 0
    eventCount = receipt.events.length
    eventStarts = new Float32Array(eventCount)
    eventLife = new Float32Array(eventCount)
    eventDomain = new Uint8Array(eventCount)
    eventFailed = new Uint8Array(eventCount)
    eventRoutes = new Float32Array(eventCount * 7)
    eventScheduled = new Uint8Array(eventCount)

    for (let i = 0; i < eventCount; i++) {
      const event = receipt.events[i]
      eventStarts[i] = Math.max(0, event.atMs)
      eventLife[i] = Math.max(MIN_LIFE_MS, Math.min(MAX_LIFE_MS, event.durationMs))
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
      const dx = _to.x - _from.x
      const dz = _to.z - _from.z
      const distance = Math.sqrt(dx * dx + dz * dz)
      eventRoutes[route + 6] = Math.max(event.domain === 'raft' ? 5 : 9, distance * 0.07)
    }
  }

  function update(deltaSeconds: number): void {
    const deltaMs = Math.max(0, deltaSeconds) * 1000 * playbackRate
    clockMs += deltaMs
    for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
      if (!eventScheduled[eventIndex] && eventStarts[eventIndex] <= clockMs) spawn(eventIndex)
    }

    activity.fill(0)
    let index = 0
    while (index < activeCount) {
      const particle = active[index]
      const eventIndex = particleEvent[particle]
      const route = eventIndex * 7
      const age = particleAge[particle] + deltaMs
      particleAge[particle] = age
      const progress = age / eventLife[eventIndex]
      if (progress >= 1) {
        hideParticle(particle)
        free[freeCount++] = particle
        active[index] = active[--activeCount]
        continue
      }

      const t = Math.max(0, progress)
      const u = 1 - t
      const sx = eventRoutes[route]
      const sy = eventRoutes[route + 1]
      const sz = eventRoutes[route + 2]
      const ex = eventRoutes[route + 3]
      const ey = eventRoutes[route + 4]
      const ez = eventRoutes[route + 5]
      const cx = (sx + ex) * 0.5
      const cy = Math.max(sy, ey) + eventRoutes[route + 6]
      const cz = (sz + ez) * 0.5

      _position.set(
        u * u * sx + 2 * u * t * cx + t * t * ex,
        u * u * sy + 2 * u * t * cy + t * t * ey,
        u * u * sz + 2 * u * t * cz + t * t * ez,
      )
      _tangent
        .set(
          2 * u * (cx - sx) + 2 * t * (ex - cx),
          2 * u * (cy - sy) + 2 * t * (ey - cy),
          2 * u * (cz - sz) + 2 * t * (ez - cz),
        )
        .normalize()
      _rotation.setFromUnitVectors(_forward, _tangent)
      const domainScale = particleDomain[particle] === DOMAIN_INDEX.txn2pc ? 1.22 : 1
      _scale.set(domainScale, domainScale, domainScale)
      _matrix.compose(_position, _rotation, _scale)
      mesh.setMatrixAt(particle, _matrix)
      activity[particleDomain[particle]]++
      index++
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
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
    activity,
    play,
    update,
    setPlaybackRate(rate: number): void {
      playbackRate = Math.max(0, Math.min(16, rate))
    },
    setTheme(next: CityTheme): void {
      if (next === theme) return
      theme = next
      for (let i = 0; i < activeCount; i++) paintParticle(active[i])
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    },
    stop(): void {
      resetPool()
      eventCount = 0
      clockMs = 0
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
      root.remove(mesh)
    },
  }
}
