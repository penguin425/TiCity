/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Renderer-only, fixed-capacity view of the model-7 TiFlash replication and
 * MPP Lab. Immutable event snapshots own all transitions. This module paints
 * stable slots into geometry and materials allocated once at construction.
 */

import * as THREE from 'three'
import type {
  TraceTiFlashMppPhase,
  TraceTiFlashMppTaskStage,
} from '../model/types'
import { SEMANTIC_COLORS } from './palette'
import type { CityTheme } from './palette'

export const TIFLASH_MPP_LAB_STORE_CAPACITY = 2 as const
export const TIFLASH_MPP_LAB_LEARNER_CAPACITY = 3 as const
export const TIFLASH_MPP_LAB_FRAGMENT_CAPACITY = 2 as const
export const TIFLASH_MPP_LAB_TASK_CAPACITY = 4 as const
export const TIFLASH_MPP_LAB_TUNNEL_CAPACITY = 6 as const
export const TIFLASH_MPP_LAB_PACKET_CAPACITY = 6 as const

export type TiFlashMppLabMode = 'hidden' | 'overview' | 'inspect'
export type TiFlashMppLabFragment = 'scan_partial' | 'final_aggregate'
export type TiFlashMppLabGateState =
  | 'idle'
  | 'requesting'
  | 'waiting'
  | 'ready'
  | 'unavailable'
export type TiFlashMppLabGateReason =
  | 'not_requested'
  | 'replica_unavailable'
  | 'read_index_pending'
  | 'applied_index_behind'
  | 'applied_index_ready'
export type TiFlashMppLabTunnelLocality =
  | 'local'
  | 'remote'
  | 'tidb_root'
export type TiFlashMppLabTunnelState =
  | 'idle'
  | 'registered'
  | 'connected'
  | 'streaming'
  | 'finished'

export interface TiFlashMppLabStoreProjection {
  readonly visible: boolean
  readonly storeId: string
  readonly active: boolean
}

export interface TiFlashMppLabLearnerProjection {
  readonly visible: boolean
  readonly regionId: number
  readonly leaderStoreId: string
  readonly tiflashStoreId: string
  readonly storeSlot: -1 | 0 | 1
  readonly replicaAvailable: boolean
  readonly leaderCommitIndex: number
  readonly replicatedIndex: number
  readonly appliedIndex: number
  readonly requestedReadIndex: number | null
  readonly gateState: TiFlashMppLabGateState
  readonly gateReason: TiFlashMppLabGateReason
}

export interface TiFlashMppLabTaskProjection {
  readonly visible: boolean
  readonly id: string
  readonly taskId: string
  readonly storeId: string
  readonly storeSlot: -1 | 0 | 1
  readonly fragment: TiFlashMppLabFragment
  readonly stage: TraceTiFlashMppTaskStage | 'idle'
  readonly regionIds: readonly number[]
}

export interface TiFlashMppLabTunnelProjection {
  readonly visible: boolean
  readonly id: string
  readonly senderTaskId: string
  readonly receiverTaskId: string
  readonly senderTaskSlot: -1 | 0 | 1 | 2 | 3
  readonly receiverTaskSlot: -1 | 0 | 1 | 2 | 3
  readonly locality: TiFlashMppLabTunnelLocality
  readonly state: TiFlashMppLabTunnelState
}

export interface TiFlashMppLabRootProjection {
  readonly visible: boolean
  readonly taskId: 'tidb-root'
  readonly state: string
}

export interface TiFlashMppLabOverflowProjection {
  readonly stores: number
  readonly learners: number
  readonly fragments: number
  readonly tasks: number
  readonly tunnels: number
  readonly total: number
}

export interface TiFlashMppLabProjection {
  readonly mode: TiFlashMppLabMode
  readonly phase: TraceTiFlashMppPhase | 'idle'
  readonly reducedMotion: boolean
  /** Normalized 0..1 position supplied by the renderer-only teaching clock. */
  readonly pulse: number
  readonly stores: readonly [
    TiFlashMppLabStoreProjection,
    TiFlashMppLabStoreProjection,
  ]
  readonly learners: readonly [
    TiFlashMppLabLearnerProjection,
    TiFlashMppLabLearnerProjection,
    TiFlashMppLabLearnerProjection,
  ]
  readonly tasks: readonly [
    TiFlashMppLabTaskProjection,
    TiFlashMppLabTaskProjection,
    TiFlashMppLabTaskProjection,
    TiFlashMppLabTaskProjection,
  ]
  readonly tunnels: readonly [
    TiFlashMppLabTunnelProjection,
    TiFlashMppLabTunnelProjection,
    TiFlashMppLabTunnelProjection,
    TiFlashMppLabTunnelProjection,
    TiFlashMppLabTunnelProjection,
    TiFlashMppLabTunnelProjection,
  ]
  readonly root: TiFlashMppLabRootProjection
  readonly overflow: TiFlashMppLabOverflowProjection
}

export interface TiFlashMppLabResourceCounts {
  readonly objectCount: number
  readonly drawableCount: number
  readonly geometryCount: number
  readonly materialCount: number
  readonly instancedMeshCount: number
  readonly instanceCapacity: number
  readonly storeCapacity: 2
  readonly learnerCapacity: 3
  readonly fragmentCapacity: 2
  readonly taskCapacity: 4
  readonly tunnelCapacity: 6
  readonly packetCapacity: 6
  readonly shadowCount: 0
}

export interface TiFlashMppLabDebug {
  readonly resources: TiFlashMppLabResourceCounts
  readonly disposed: boolean
  readonly updateCount: number
}

export interface TiFlashMppLab {
  readonly object: THREE.Group
  readonly storeAnchors: readonly [THREE.Object3D, THREE.Object3D]
  readonly learnerAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly fragmentAnchors: readonly [THREE.Object3D, THREE.Object3D]
  readonly taskAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly rootAnchor: THREE.Object3D
  readonly debug: TiFlashMppLabDebug
  update(projection: TiFlashMppLabProjection): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface TiFlashMppLabOptions {
  readonly theme?: CityTheme
}

const STORE_X = [-42, 42] as const
const STORE_Z = -27
const LEARNER_X = [-55, -30, 42] as const
const LEARNER_Z = -13
const TASK_POSITIONS = [
  [-42, 12],
  [42, 12],
  [-42, 45],
  [42, 45],
] as const
const FRAGMENT_Z = [12, 45] as const
const ROOT_POSITION = [0, 74] as const
const RAIL_Y = 4.2
const TASK_Y = 8
const GATE_Y = 18

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _color = new THREE.Color()
const _railStart = new THREE.Vector3()
const _railEnd = new THREE.Vector3()
const _railDirection = new THREE.Vector3()
const _railMidpoint = new THREE.Vector3()
const _identityRotation = new THREE.Quaternion()
const _railRotation = new THREE.Quaternion()
const _forward = new THREE.Vector3(0, 0, 1)
const _horizontalRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
)

function hiddenStore(): TiFlashMppLabStoreProjection {
  return Object.freeze({
    visible: false,
    storeId: '',
    active: false,
  })
}

function hiddenLearner(): TiFlashMppLabLearnerProjection {
  return Object.freeze({
    visible: false,
    regionId: -1,
    leaderStoreId: '',
    tiflashStoreId: '',
    storeSlot: -1 as const,
    replicaAvailable: false,
    leaderCommitIndex: 0,
    replicatedIndex: 0,
    appliedIndex: 0,
    requestedReadIndex: null,
    gateState: 'idle' as const,
    gateReason: 'not_requested' as const,
  })
}

function hiddenTask(): TiFlashMppLabTaskProjection {
  return Object.freeze({
    visible: false,
    id: '',
    taskId: '',
    storeId: '',
    storeSlot: -1 as const,
    fragment: 'scan_partial' as const,
    stage: 'idle',
    regionIds: Object.freeze([]),
  })
}

function hiddenTunnel(): TiFlashMppLabTunnelProjection {
  return Object.freeze({
    visible: false,
    id: '',
    senderTaskId: '',
    receiverTaskId: '',
    senderTaskSlot: -1 as const,
    receiverTaskSlot: -1 as const,
    locality: 'local' as const,
    state: 'idle' as const,
  })
}

export const EMPTY_TIFLASH_MPP_LAB_PROJECTION: TiFlashMppLabProjection =
  Object.freeze({
    mode: 'hidden',
    phase: 'idle',
    reducedMotion: false,
    pulse: 0,
    stores: Object.freeze([hiddenStore(), hiddenStore()] as const),
    learners: Object.freeze([
      hiddenLearner(),
      hiddenLearner(),
      hiddenLearner(),
    ] as const),
    tasks: Object.freeze([
      hiddenTask(),
      hiddenTask(),
      hiddenTask(),
      hiddenTask(),
    ] as const),
    tunnels: Object.freeze([
      hiddenTunnel(),
      hiddenTunnel(),
      hiddenTunnel(),
      hiddenTunnel(),
      hiddenTunnel(),
      hiddenTunnel(),
    ] as const),
    root: Object.freeze({
      visible: false,
      taskId: 'tidb-root' as const,
      state: 'idle',
    }),
    overflow: Object.freeze({
      stores: 0,
      learners: 0,
      fragments: 0,
      tasks: 0,
      tunnels: 0,
      total: 0,
    }),
  })

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function setInstanceTransform(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rotation: THREE.Quaternion = _identityRotation,
): void {
  _position.set(x, y, z)
  _scale.set(sx, sy, sz)
  _matrix.compose(_position, rotation, _scale)
  mesh.setMatrixAt(index, _matrix)
}

function setInstanceColor(
  mesh: THREE.InstancedMesh,
  index: number,
  hex: number,
  brightness = 1,
): void {
  _color.setHex(hex)
  if (brightness !== 1) _color.multiplyScalar(brightness)
  mesh.setColorAt(index, _color)
}

function setRailTransform(
  mesh: THREE.InstancedMesh,
  index: number,
  startX: number,
  startY: number,
  startZ: number,
  endX: number,
  endY: number,
  endZ: number,
  width: number,
  visible: boolean,
): void {
  if (!visible) {
    setInstanceTransform(mesh, index, 0, -1_000, 0, 0, 0, 0)
    return
  }
  _railStart.set(startX, startY, startZ)
  _railEnd.set(endX, endY, endZ)
  _railDirection.subVectors(_railEnd, _railStart)
  const length = _railDirection.length()
  if (length <= 0.001) {
    setInstanceTransform(mesh, index, startX, startY, startZ, 0, 0, 0)
    return
  }
  _railDirection.multiplyScalar(1 / length)
  _railRotation.setFromUnitVectors(_forward, _railDirection)
  _railMidpoint.addVectors(_railStart, _railEnd).multiplyScalar(0.5)
  setInstanceTransform(
    mesh,
    index,
    _railMidpoint.x,
    _railMidpoint.y,
    _railMidpoint.z,
    width,
    width,
    length,
    _railRotation,
  )
}

function gateColor(
  state: TiFlashMppLabGateState,
  theme: CityTheme,
): number {
  switch (state) {
    case 'ready':
      return SEMANTIC_COLORS[theme].return
    case 'waiting':
    case 'requesting':
      return SEMANTIC_COLORS[theme].tso
    case 'unavailable':
      return SEMANTIC_COLORS[theme].fault
    case 'idle':
      return theme === 'night' ? 0x526679 : 0x82939f
  }
}

function tunnelColor(
  locality: TiFlashMppLabTunnelLocality,
  theme: CityTheme,
): number {
  switch (locality) {
    case 'local':
      return SEMANTIC_COLORS[theme].kv
    case 'remote':
      return SEMANTIC_COLORS[theme].tiflash
    case 'tidb_root':
      return SEMANTIC_COLORS[theme].return
  }
}

function taskBrightness(stage: string): number {
  switch (stage) {
    case 'snapshot_gating':
    case 'scanning':
    case 'partial_aggregated':
    case 'exchange_sending':
    case 'exchange_receiving':
    case 'final_aggregated':
    case 'root_streaming':
      return 1
    case 'finished':
    case 'complete':
      return 0.82
    case 'idle':
      return 0.36
    default:
      return 0.62
  }
}

function tunnelBrightness(state: TiFlashMppLabTunnelState): number {
  switch (state) {
    case 'streaming':
      return 1
    case 'finished':
      return 0.68
    case 'connected':
      return 0.82
    case 'registered':
      return 0.54
    case 'idle':
      return 0.28
  }
}

function countScene(root: THREE.Object3D): {
  objects: number
  drawables: number
  geometries: Set<THREE.BufferGeometry>
  materials: Set<THREE.Material>
  instances: number
  capacity: number
  shadows: number
} {
  let objects = 0
  let drawables = 0
  let instances = 0
  let capacity = 0
  let shadows = 0
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    objects++
    const drawable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
      castShadow?: boolean
      receiveShadow?: boolean
    }
    if (drawable.geometry) {
      drawables++
      geometries.add(drawable.geometry)
    }
    if (drawable.material) {
      const bound = Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]
      for (const material of bound) materials.add(material)
    }
    if (object instanceof THREE.InstancedMesh) {
      instances++
      capacity += object.count
    }
    if (drawable.castShadow || drawable.receiveShadow) shadows++
  })
  return {
    objects,
    drawables,
    geometries,
    materials,
    instances,
    capacity,
    shadows,
  }
}

export function createTiFlashMppLab(
  options: TiFlashMppLabOptions = {},
): TiFlashMppLab {
  const ownedGeometries: THREE.BufferGeometry[] = []
  const ownedMaterials: THREE.Material[] = []

  function ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    ownedGeometries.push(geometry)
    return geometry
  }

  function ownMaterial<T extends THREE.Material>(material: T): T {
    ownedMaterials.push(material)
    return material
  }

  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1))
  const cylinderGeometry = ownGeometry(
    new THREE.CylinderGeometry(1, 1, 1, 16),
  )
  const gateGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.16, 8, 18))
  const packetGeometry = ownGeometry(new THREE.OctahedronGeometry(1, 0))
  const rootGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 3))

  const semanticMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.28,
  }))
  semanticMaterial.name = 'tiflash-mpp-lab:semantic'
  const deckMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x172b3f,
    transparent: true,
    opacity: 0.75,
    roughness: 0.88,
    metalness: 0.06,
  }))
  deckMaterial.name = 'tiflash-mpp-lab:deck'
  const signalMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.94,
    toneMapped: false,
  }))
  signalMaterial.name = 'tiflash-mpp-lab:signal'

  const root = new THREE.Group()
  root.name = 'tiflash-mpp-lab'
  root.userData.kind = 'tiflash-mpp-lab'
  root.userData.provenance = 'MODEL / SIMULATED'
  root.userData.boundary =
    'TiFlash learner replication is distinct from per-query MPP exchange; learners are non-voters'
  root.userData.privacy =
    'Synthetic identifiers, indexes, states, and aggregate counts only'

  const overviewRoot = new THREE.Group()
  overviewRoot.name = 'tiflash-mpp-lab:overview'
  const inspectRoot = new THREE.Group()
  inspectRoot.name = 'tiflash-mpp-lab:inspect'
  root.add(overviewRoot, inspectRoot)

  function instances(
    parent: THREE.Object3D,
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    domain: string,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.name = name
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.userData.domain = domain
    parent.add(mesh)
    return mesh
  }

  const deck = instances(
    overviewRoot,
    'tiflash-mpp-lab:deck',
    boxGeometry,
    deckMaterial,
    1,
    'structure',
  )
  const stores = instances(
    inspectRoot,
    'tiflash-mpp-lab:stores',
    boxGeometry,
    semanticMaterial,
    TIFLASH_MPP_LAB_STORE_CAPACITY,
    'tiflash',
  )
  stores.userData.capacity = TIFLASH_MPP_LAB_STORE_CAPACITY
  const learners = instances(
    inspectRoot,
    'tiflash-mpp-lab:learners',
    cylinderGeometry,
    semanticMaterial,
    TIFLASH_MPP_LAB_LEARNER_CAPACITY,
    'raft',
  )
  learners.userData.role = 'learner'
  learners.userData.voter = false
  const learnerRails = instances(
    inspectRoot,
    'tiflash-mpp-lab:learner-replication-rails',
    boxGeometry,
    semanticMaterial,
    TIFLASH_MPP_LAB_LEARNER_CAPACITY,
    'raft',
  )
  learnerRails.userData.persistence = 'persistent'
  learnerRails.userData.meaning = 'steady-state learner replication'
  const gates = instances(
    inspectRoot,
    'tiflash-mpp-lab:snapshot-gates',
    gateGeometry,
    signalMaterial,
    TIFLASH_MPP_LAB_LEARNER_CAPACITY,
    'tiflash',
  )
  gates.userData.gate = 'read-index/applied-index'
  const fragmentDecks = instances(
    inspectRoot,
    'tiflash-mpp-lab:fragment-decks',
    boxGeometry,
    deckMaterial,
    TIFLASH_MPP_LAB_FRAGMENT_CAPACITY,
    'sql',
  )
  fragmentDecks.userData.fragments = Object.freeze([
    'scan_partial',
    'final_aggregate',
  ])
  const tasks = instances(
    inspectRoot,
    'tiflash-mpp-lab:tasks',
    boxGeometry,
    semanticMaterial,
    TIFLASH_MPP_LAB_TASK_CAPACITY,
    'tiflash',
  )
  tasks.userData.capacity = TIFLASH_MPP_LAB_TASK_CAPACITY
  const exchangeRails = instances(
    inspectRoot,
    'tiflash-mpp-lab:mpp-exchange-rails',
    boxGeometry,
    semanticMaterial,
    TIFLASH_MPP_LAB_TUNNEL_CAPACITY,
    'tiflash',
  )
  exchangeRails.userData.persistence = 'ephemeral'
  exchangeRails.userData.meaning = 'per-query MPP exchange'
  const packets = instances(
    inspectRoot,
    'tiflash-mpp-lab:mpp-packets',
    packetGeometry,
    signalMaterial,
    TIFLASH_MPP_LAB_PACKET_CAPACITY,
    'tiflash',
  )
  packets.userData.capacity = TIFLASH_MPP_LAB_PACKET_CAPACITY
  packets.userData.reducedMotion = 'static-midpoint'
  const rootGather = instances(
    inspectRoot,
    'tiflash-mpp-lab:root-gather',
    rootGeometry,
    semanticMaterial,
    1,
    'return',
  )
  rootGather.userData.taskId = -1
  rootGather.userData.snapshotTargetId = 'tidb-root'
  rootGather.userData.owner = 'tidb'

  const storeAnchorsMutable: [THREE.Object3D, THREE.Object3D] = [
    new THREE.Object3D(),
    new THREE.Object3D(),
  ]
  for (let index = 0; index < storeAnchorsMutable.length; index++) {
    const anchor = storeAnchorsMutable[index]
    anchor.name = `tiflash-mpp-lab:store-anchor:${index}`
    anchor.position.set(STORE_X[index], 12, STORE_Z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    inspectRoot.add(anchor)
  }
  const storeAnchors = Object.freeze(storeAnchorsMutable)

  const learnerAnchorsMutable = Array.from(
    { length: TIFLASH_MPP_LAB_LEARNER_CAPACITY },
    (_, index) => {
      const anchor = new THREE.Object3D()
      anchor.name = `tiflash-mpp-lab:learner-anchor:${index}`
      anchor.position.set(LEARNER_X[index], 10, LEARNER_Z)
      anchor.userData.provenance = 'MODEL / SIMULATED'
      anchor.userData.role = 'learner'
      anchor.userData.voter = false
      inspectRoot.add(anchor)
      return anchor
    },
  ) as unknown as [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  const learnerAnchors = Object.freeze(learnerAnchorsMutable)

  const fragmentAnchorsMutable: [THREE.Object3D, THREE.Object3D] = [
    new THREE.Object3D(),
    new THREE.Object3D(),
  ]
  for (let index = 0; index < fragmentAnchorsMutable.length; index++) {
    const anchor = fragmentAnchorsMutable[index]
    anchor.name = `tiflash-mpp-lab:fragment-anchor:${index}`
    anchor.position.set(0, 8, FRAGMENT_Z[index])
    anchor.userData.provenance = 'MODEL / SIMULATED'
    anchor.userData.fragment =
      index === 0 ? 'scan_partial' : 'final_aggregate'
    inspectRoot.add(anchor)
  }
  const fragmentAnchors = Object.freeze(fragmentAnchorsMutable)

  const taskAnchorsMutable = Array.from(
    { length: TIFLASH_MPP_LAB_TASK_CAPACITY },
    (_, index) => {
      const anchor = new THREE.Object3D()
      anchor.name = `tiflash-mpp-lab:task-anchor:${index}`
      anchor.position.set(
        TASK_POSITIONS[index][0],
        TASK_Y,
        TASK_POSITIONS[index][1],
      )
      anchor.userData.provenance = 'MODEL / SIMULATED'
      inspectRoot.add(anchor)
      return anchor
    },
  ) as unknown as [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  const taskAnchors = Object.freeze(taskAnchorsMutable)

  const rootAnchor = new THREE.Object3D()
  rootAnchor.name = 'tiflash-mpp-lab:root-anchor'
  rootAnchor.position.set(ROOT_POSITION[0], 14, ROOT_POSITION[1])
  rootAnchor.userData.provenance = 'MODEL / SIMULATED'
  rootAnchor.userData.taskId = -1
  inspectRoot.add(rootAnchor)

  const allInstances = [
    deck,
    stores,
    learners,
    learnerRails,
    gates,
    fragmentDecks,
    tasks,
    exchangeRails,
    packets,
    rootGather,
  ] as const

  let disposed = false
  let updateCount = 0
  let theme: CityTheme = options.theme ?? 'night'
  let latestProjection = EMPTY_TIFLASH_MPP_LAB_PROJECTION

  function setStaticTheme(next: CityTheme): void {
    deckMaterial.color.setHex(next === 'night' ? 0x172b3f : 0xc8d5dd)
    deckMaterial.opacity = next === 'night' ? 0.75 : 0.84
  }

  function taskPoint(
    slot: TiFlashMppLabTunnelProjection['senderTaskSlot'],
    target: THREE.Vector3,
  ): void {
    switch (slot) {
      case 0:
      case 1:
      case 2:
      case 3:
        target.set(
          TASK_POSITIONS[slot][0],
          TASK_Y,
          TASK_POSITIONS[slot][1],
        )
        return
      case -1:
        target.set(ROOT_POSITION[0], TASK_Y, ROOT_POSITION[1])
    }
  }

  function project(projection: TiFlashMppLabProjection): void {
    latestProjection = projection
    root.visible = projection.mode !== 'hidden'
    overviewRoot.visible = projection.mode !== 'hidden'
    inspectRoot.visible = projection.mode === 'inspect'
    root.userData.mode = projection.mode
    root.userData.phase = projection.phase
    root.userData.reducedMotion = projection.reducedMotion
    root.userData.overflow = projection.overflow.total

    const deckVisible = projection.mode === 'hidden' ? 0 : 1
    setInstanceTransform(
      deck,
      0,
      0,
      -0.8,
      24,
      132 * deckVisible,
      1.6 * deckVisible,
      124 * deckVisible,
    )
    setInstanceColor(
      deck,
      0,
      theme === 'night' ? 0x172b3f : 0xc8d5dd,
    )

    for (let index = 0; index < TIFLASH_MPP_LAB_STORE_CAPACITY; index++) {
      const store = projection.stores[index]
      const visible = store.visible ? 1 : 0
      setInstanceTransform(
        stores,
        index,
        STORE_X[index],
        5,
        STORE_Z,
        50 * visible,
        10 * visible,
        25 * visible,
      )
      setInstanceColor(
        stores,
        index,
        SEMANTIC_COLORS[theme].tiflash,
        store.active ? 1 : 0.62,
      )
      const anchor = storeAnchorsMutable[index]
      anchor.visible = store.visible
      anchor.userData.storeId = store.storeId
      anchor.userData.active = store.active
    }

    for (let index = 0;
      index < TIFLASH_MPP_LAB_LEARNER_CAPACITY;
      index++
    ) {
      const learner = projection.learners[index]
      const visible = learner.visible ? 1 : 0
      const behind = learner.replicatedIndex > learner.appliedIndex
      setInstanceTransform(
        learners,
        index,
        LEARNER_X[index],
        7,
        LEARNER_Z,
        7 * visible,
        12 * visible,
        7 * visible,
      )
      setInstanceColor(
        learners,
        index,
        SEMANTIC_COLORS[theme].raft,
        learner.replicaAvailable ? behind ? 0.76 : 1 : 0.38,
      )
      setRailTransform(
        learnerRails,
        index,
        LEARNER_X[index],
        RAIL_Y,
        -43,
        LEARNER_X[index],
        RAIL_Y,
        LEARNER_Z - 6,
        1.2,
        learner.visible,
      )
      setInstanceColor(
        learnerRails,
        index,
        SEMANTIC_COLORS[theme].raft,
        behind ? 1 : 0.64,
      )
      const gateScale = learner.visible ? 5.2 : 0
      setInstanceTransform(
        gates,
        index,
        LEARNER_X[index],
        GATE_Y,
        LEARNER_Z,
        gateScale,
        gateScale,
        gateScale,
        _horizontalRotation,
      )
      setInstanceColor(
        gates,
        index,
        gateColor(learner.gateState, theme),
      )
      const anchor = learnerAnchorsMutable[index]
      anchor.visible = learner.visible
      anchor.userData.regionId = learner.regionId
      anchor.userData.leaderStoreId = learner.leaderStoreId
      anchor.userData.tiflashStoreId = learner.tiflashStoreId
      anchor.userData.storeSlot = learner.storeSlot
      anchor.userData.role = 'learner'
      anchor.userData.voter = false
      anchor.userData.replicaAvailable = learner.replicaAvailable
      anchor.userData.leaderCommitIndex = learner.leaderCommitIndex
      anchor.userData.replicatedIndex = learner.replicatedIndex
      anchor.userData.appliedIndex = learner.appliedIndex
      anchor.userData.requestedReadIndex = learner.requestedReadIndex
      anchor.userData.gateState = learner.gateState
      anchor.userData.gateReason = learner.gateReason
    }

    const anyTask = projection.tasks.some((task) => task.visible)
    for (let fragment = 0;
      fragment < TIFLASH_MPP_LAB_FRAGMENT_CAPACITY;
      fragment++
    ) {
      const visible = anyTask ? 1 : 0
      setInstanceTransform(
        fragmentDecks,
        fragment,
        0,
        2.1,
        FRAGMENT_Z[fragment],
        110 * visible,
        1.4 * visible,
        24 * visible,
      )
      setInstanceColor(
        fragmentDecks,
        fragment,
        fragment === 0
          ? SEMANTIC_COLORS[theme].sql
          : SEMANTIC_COLORS[theme].tiflash,
        0.46,
      )
    }

    for (let index = 0; index < TIFLASH_MPP_LAB_TASK_CAPACITY; index++) {
      const task = projection.tasks[index]
      const visible = task.visible ? 1 : 0
      const position = TASK_POSITIONS[index]
      const running =
        task.stage === 'snapshot_gating' ||
        task.stage === 'scanning' ||
        task.stage === 'exchange_sending' ||
        task.stage === 'exchange_receiving' ||
        task.stage === 'root_streaming'
      const pulseScale =
        running && !projection.reducedMotion
          ? 1 + clamp(projection.pulse, 0, 1) * 0.12
          : 1
      setInstanceTransform(
        tasks,
        index,
        position[0],
        TASK_Y,
        position[1],
        24 * visible * pulseScale,
        11 * visible * pulseScale,
        15 * visible * pulseScale,
      )
      setInstanceColor(
        tasks,
        index,
        task.fragment === 'scan_partial'
          ? SEMANTIC_COLORS[theme].sql
          : SEMANTIC_COLORS[theme].tiflash,
        taskBrightness(task.stage),
      )
      const anchor = taskAnchorsMutable[index]
      anchor.visible = task.visible
      anchor.userData.id = task.id
      anchor.userData.taskId = task.taskId
      anchor.userData.storeId = task.storeId
      anchor.userData.storeSlot = task.storeSlot
      anchor.userData.fragment = task.fragment
      anchor.userData.stage = task.stage
      anchor.userData.regionIds = task.regionIds
    }

    for (let index = 0;
      index < TIFLASH_MPP_LAB_TUNNEL_CAPACITY;
      index++
    ) {
      const tunnel = projection.tunnels[index]
      const railVisible =
        tunnel.visible &&
        tunnel.state !== 'idle' &&
        tunnel.senderTaskSlot >= 0
      taskPoint(tunnel.senderTaskSlot, _railStart)
      taskPoint(tunnel.receiverTaskSlot, _railEnd)
      setRailTransform(
        exchangeRails,
        index,
        _railStart.x,
        RAIL_Y + 7,
        _railStart.z,
        _railEnd.x,
        RAIL_Y + 7,
        _railEnd.z,
        tunnel.locality === 'local' ? 1.05 : 1.35,
        railVisible,
      )
      const color = tunnelColor(tunnel.locality, theme)
      setInstanceColor(
        exchangeRails,
        index,
        color,
        tunnelBrightness(tunnel.state),
      )

      const packetVisible = railVisible && tunnel.state === 'streaming'
      let packetProgress = 0.5
      if (!projection.reducedMotion) {
        packetProgress =
          (clamp(projection.pulse, 0, 1) + index * 0.173) % 1
      }
      _position.lerpVectors(_railStart, _railEnd, packetProgress)
      const packetScale = packetVisible ? 2.2 : 0
      setInstanceTransform(
        packets,
        index,
        _position.x,
        RAIL_Y + 7,
        _position.z,
        packetScale,
        packetScale,
        packetScale,
      )
      setInstanceColor(packets, index, color)
    }

    const rootVisible = projection.root.visible ? 1 : 0
    setInstanceTransform(
      rootGather,
      0,
      ROOT_POSITION[0],
      10,
      ROOT_POSITION[1],
      11 * rootVisible,
      16 * rootVisible,
      11 * rootVisible,
    )
    setInstanceColor(
      rootGather,
      0,
      SEMANTIC_COLORS[theme].return,
      projection.root.state === 'complete' ? 1 : 0.72,
    )
    rootAnchor.visible = projection.root.visible
    rootAnchor.userData.taskId = -1
    rootAnchor.userData.snapshotTargetId = projection.root.taskId
    rootAnchor.userData.state = projection.root.state

    for (const mesh of allInstances) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  setStaticTheme(theme)
  project(EMPTY_TIFLASH_MPP_LAB_PROJECTION)

  const counted = countScene(root)
  if (
    counted.drawables > 10 ||
    counted.geometries.size > 5 ||
    counted.materials.size > 3 ||
    counted.shadows !== 0
  ) {
    throw new Error('TiFlash MPP Lab exceeded its renderer resource budget')
  }
  const resources = Object.freeze({
    objectCount: counted.objects,
    drawableCount: counted.drawables,
    geometryCount: counted.geometries.size,
    materialCount: counted.materials.size,
    instancedMeshCount: counted.instances,
    instanceCapacity: counted.capacity,
    storeCapacity: 2 as const,
    learnerCapacity: 3 as const,
    fragmentCapacity: 2 as const,
    taskCapacity: 4 as const,
    tunnelCapacity: 6 as const,
    packetCapacity: 6 as const,
    shadowCount: 0 as const,
  })

  return {
    object: root,
    storeAnchors,
    learnerAnchors,
    fragmentAnchors,
    taskAnchors,
    rootAnchor,
    get debug(): TiFlashMppLabDebug {
      return Object.freeze({
        resources,
        disposed,
        updateCount,
      })
    },
    update(projection): void {
      if (disposed) return
      updateCount++
      project(projection)
    },
    setTheme(next): void {
      if (disposed || theme === next) return
      theme = next
      setStaticTheme(next)
      project(latestProjection)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      root.removeFromParent()
      for (const geometry of ownedGeometries) geometry.dispose()
      for (const material of ownedMaterials) material.dispose()
    },
  }
}
