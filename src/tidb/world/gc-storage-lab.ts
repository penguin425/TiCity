/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Renderer-only, fixed-capacity view of the synthetic model-6 GC/Storage Lab.
 * The immutable trace snapshot owns every state transition. This module only
 * paints a bounded projection into geometry allocated once.
 */

import * as THREE from 'three'
import type {
  TraceGcLabPhase,
  TraceGcVersionState,
  TraceGcVersionWriteType,
} from '../model/types'
import { SEMANTIC_COLORS } from './palette'
import type { CityTheme } from './palette'

export const GC_STORAGE_LAB_STORE_CAPACITY = 3 as const
export const GC_STORAGE_LAB_LOCK_CAPACITY = 3 as const
export const GC_STORAGE_LAB_DELETE_RANGE_CAPACITY = 2 as const
export const GC_STORAGE_LAB_CHAIN_CAPACITY = 4 as const
export const GC_STORAGE_LAB_VERSIONS_PER_CHAIN = 4 as const
export const GC_STORAGE_LAB_VERSION_CAPACITY = 16 as const
export const GC_STORAGE_LAB_FLOW_CAPACITY = 8 as const

export type GcStorageLabMode = 'hidden' | 'overview' | 'inspect'
export type GcStorageLabGateState =
  | 'idle'
  | 'candidate'
  | 'blocked'
  | 'staged'
  | 'visibility-saved'
  | 'published'
export type GcStorageLabFlowStep =
  | 'none'
  | 'candidate'
  | 'resolve-locks'
  | 'visibility-save'
  | 'delete-ranges'
  | 'publish-pd'
  | 'observe'
  | 'compact'
  | 'complete'

export interface GcStorageLabSafePointProjection {
  readonly previous: number
  readonly candidate: number | null
  readonly globalMinStartTs: number | null
  readonly activeTransactionBound: number | null
  readonly serviceSafePoint: number | null
  readonly staged: number
  readonly visibilitySaved: number
  readonly published: number
  readonly blocked: boolean
  readonly gateState: GcStorageLabGateState
}

export interface GcStorageLabBlockerProjection {
  readonly visible: boolean
  readonly transactionId: string
  readonly startTs: number
  readonly status: 'active' | 'completed'
}

export interface GcStorageLabLockProjection {
  readonly visible: boolean
  readonly id: string
  readonly regionId: number
  readonly startTs: number
  readonly primaryStatus: 'committed' | 'rolled_back'
  readonly status: 'pending' | 'resolved_commit' | 'resolved_rollback'
}

export interface GcStorageLabDeleteRangeProjection {
  readonly visible: boolean
  readonly id: string
  readonly dropTs: number
  readonly status: 'pending' | 'eligible' | 'deleted'
}

export interface GcStorageLabStoreProjection {
  readonly visible: boolean
  readonly storeId: string
  readonly detectedSafePoint: number
  readonly detectorCurrent: boolean
  readonly compaction: 'idle' | 'eligible' | 'running' | 'complete'
  readonly filterActive: boolean
}

export interface GcStorageLabVersionProjection {
  readonly visible: boolean
  readonly id: string
  readonly commitTs: number
  readonly writeType: TraceGcVersionWriteType
  readonly valueStorage:
    | 'write_cf_only'
    | 'write_cf_inline'
    | 'write_and_default_cf'
  readonly state: TraceGcVersionState
}

export interface GcStorageLabChainProjection {
  readonly visible: boolean
  readonly id: string
  readonly regionId: number
  readonly versions: readonly [
    GcStorageLabVersionProjection,
    GcStorageLabVersionProjection,
    GcStorageLabVersionProjection,
    GcStorageLabVersionProjection,
  ]
  readonly overflowVersions: number
}

export interface GcStorageLabOverflowProjection {
  readonly stores: number
  readonly locks: number
  readonly deleteRanges: number
  readonly chains: number
  readonly versions: number
  readonly total: number
}

export interface GcStorageLabProjection {
  readonly mode: GcStorageLabMode
  readonly phase: TraceGcLabPhase
  readonly round: 1 | 2
  readonly reducedMotion: boolean
  /** Normalized 0..1 position supplied by the looping teaching clock. */
  readonly pulse: number
  readonly flowStep: GcStorageLabFlowStep
  readonly safePoint: GcStorageLabSafePointProjection
  readonly blocker: GcStorageLabBlockerProjection
  readonly resolveLocks: Readonly<{
    readonly implementation: 'REGION_SCAN_LOCK'
    readonly scannedRegionIds: readonly number[]
    readonly locks: readonly [
      GcStorageLabLockProjection,
      GcStorageLabLockProjection,
      GcStorageLabLockProjection,
    ]
  }>
  readonly deleteRanges: readonly [
    GcStorageLabDeleteRangeProjection,
    GcStorageLabDeleteRangeProjection,
  ]
  readonly stores: readonly [
    GcStorageLabStoreProjection,
    GcStorageLabStoreProjection,
    GcStorageLabStoreProjection,
  ]
  readonly chains: readonly [
    GcStorageLabChainProjection,
    GcStorageLabChainProjection,
    GcStorageLabChainProjection,
    GcStorageLabChainProjection,
  ]
  readonly overflow: GcStorageLabOverflowProjection
}

export interface GcStorageLabResourceCounts {
  readonly objectCount: number
  readonly drawableCount: number
  readonly geometryCount: number
  readonly materialCount: number
  readonly instancedMeshCount: number
  readonly instanceCapacity: number
  readonly storeCapacity: 3
  readonly lockCapacity: 3
  readonly deleteRangeCapacity: 2
  readonly chainCapacity: 4
  readonly versionsPerChain: 4
  readonly versionCapacity: 16
  readonly flowCapacity: 8
  readonly shadowCount: 0
}

export interface GcStorageLabDebug {
  readonly resources: GcStorageLabResourceCounts
  readonly disposed: boolean
  readonly updateCount: number
}

export interface GcStorageLab {
  readonly object: THREE.Group
  readonly gateAnchor: THREE.Object3D
  readonly serviceAnchors: readonly [THREE.Object3D, THREE.Object3D]
  readonly storeAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly chainAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly debug: GcStorageLabDebug
  update(projection: GcStorageLabProjection): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface GcStorageLabOptions {
  readonly theme?: CityTheme
}

const STORE_X = [30, 50, 70] as const
const CHAIN_Z = [15, 29, 43, 57] as const
const VERSION_X = [-30, -10, 10, 30] as const
const STORE_Z = -18
const SERVICE_X = [-24, 4] as const
const GATE_X = -54
const PROCESS_Z = -18

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _color = new THREE.Color()
const _identityRotation = new THREE.Quaternion()
const _horizontalRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
)

function hiddenVersion(): GcStorageLabVersionProjection {
  return Object.freeze({
    visible: false,
    id: '',
    commitTs: 0,
    writeType: 'put' as const,
    valueStorage: 'write_cf_only' as const,
    state: 'present' as const,
  })
}

function hiddenChain(): GcStorageLabChainProjection {
  return Object.freeze({
    visible: false,
    id: '',
    regionId: -1,
    versions: Object.freeze([
      hiddenVersion(),
      hiddenVersion(),
      hiddenVersion(),
      hiddenVersion(),
    ] as const),
    overflowVersions: 0,
  })
}

const HIDDEN_LOCK: GcStorageLabLockProjection = Object.freeze({
  visible: false,
  id: '',
  regionId: -1,
  startTs: 0,
  primaryStatus: 'committed',
  status: 'pending',
})

const HIDDEN_DELETE_RANGE: GcStorageLabDeleteRangeProjection = Object.freeze({
  visible: false,
  id: '',
  dropTs: 0,
  status: 'pending',
})

const HIDDEN_STORE: GcStorageLabStoreProjection = Object.freeze({
  visible: false,
  storeId: '',
  detectedSafePoint: 0,
  detectorCurrent: false,
  compaction: 'idle',
  filterActive: false,
})

export const EMPTY_GC_STORAGE_LAB_PROJECTION: GcStorageLabProjection =
  Object.freeze({
    mode: 'hidden',
    phase: 'idle',
    round: 1,
    reducedMotion: false,
    pulse: 0,
    flowStep: 'none',
    safePoint: Object.freeze({
      previous: 0,
      candidate: null,
      globalMinStartTs: null,
      activeTransactionBound: null,
      serviceSafePoint: null,
      staged: 0,
      visibilitySaved: 0,
      published: 0,
      blocked: false,
      gateState: 'idle',
    }),
    blocker: Object.freeze({
      visible: false,
      transactionId: '',
      startTs: 0,
      status: 'completed',
    }),
    resolveLocks: Object.freeze({
      implementation: 'REGION_SCAN_LOCK',
      scannedRegionIds: Object.freeze([]),
      locks: Object.freeze([
        HIDDEN_LOCK,
        HIDDEN_LOCK,
        HIDDEN_LOCK,
      ] as const),
    }),
    deleteRanges: Object.freeze([
      HIDDEN_DELETE_RANGE,
      HIDDEN_DELETE_RANGE,
    ] as const),
    stores: Object.freeze([
      HIDDEN_STORE,
      HIDDEN_STORE,
      HIDDEN_STORE,
    ] as const),
    chains: Object.freeze([
      hiddenChain(),
      hiddenChain(),
      hiddenChain(),
      hiddenChain(),
    ] as const),
    overflow: Object.freeze({
      stores: 0,
      locks: 0,
      deleteRanges: 0,
      chains: 0,
      versions: 0,
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

function gateColor(
  state: GcStorageLabGateState,
  theme: CityTheme,
): number {
  switch (state) {
    case 'blocked':
      return SEMANTIC_COLORS[theme].fault
    case 'candidate':
      return SEMANTIC_COLORS[theme].tso
    case 'staged':
      return SEMANTIC_COLORS[theme].gc
    case 'visibility-saved':
      return SEMANTIC_COLORS[theme].client
    case 'published':
      return SEMANTIC_COLORS[theme].kv
    case 'idle':
      return theme === 'night' ? 0x526679 : 0x82939f
  }
}

function compactionColor(
  state: GcStorageLabStoreProjection['compaction'],
  theme: CityTheme,
): number {
  switch (state) {
    case 'eligible':
      return SEMANTIC_COLORS[theme].tso
    case 'running':
      return SEMANTIC_COLORS[theme].gc
    case 'complete':
      return SEMANTIC_COLORS[theme].kv
    case 'idle':
      return theme === 'night' ? 0x405466 : 0x91a0aa
  }
}

function flowColor(step: GcStorageLabFlowStep, theme: CityTheme): number {
  if (
    step === 'candidate' ||
    step === 'visibility-save' ||
    step === 'publish-pd'
  ) {
    return SEMANTIC_COLORS[theme].tso
  }
  if (step === 'resolve-locks' || step === 'delete-ranges') {
    return SEMANTIC_COLORS[theme].txn2pc
  }
  if (step === 'observe') return SEMANTIC_COLORS[theme].client
  if (step === 'compact' || step === 'complete') {
    return SEMANTIC_COLORS[theme].gc
  }
  return theme === 'night' ? 0x526679 : 0x82939f
}

function versionColor(
  state: TraceGcVersionState,
  theme: CityTheme,
): number {
  switch (state) {
    case 'retained_anchor':
      return SEMANTIC_COLORS[theme].tso
    case 'filtered':
      return SEMANTIC_COLORS[theme].gc
    case 'present':
      return SEMANTIC_COLORS[theme].sql
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

export function createGcStorageLab(
  options: GcStorageLabOptions = {},
): GcStorageLab {
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
  const torusGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.2, 8, 20))
  const blockerGeometry = ownGeometry(new THREE.OctahedronGeometry(1, 0))
  const cylinderGeometry = ownGeometry(
    new THREE.CylinderGeometry(1, 1, 1, 18),
  )

  const semanticMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.54,
    metalness: 0.24,
  }))
  semanticMaterial.name = 'gc-storage-lab:semantic'
  const deckMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x1d3145,
    transparent: true,
    opacity: 0.76,
    roughness: 0.88,
    metalness: 0.06,
  }))
  deckMaterial.name = 'gc-storage-lab:deck'
  const indicatorMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.94,
    toneMapped: false,
  }))
  indicatorMaterial.name = 'gc-storage-lab:indicator'

  const root = new THREE.Group()
  root.name = 'gc-storage-lab'
  root.userData.kind = 'gc-storage-lab'
  root.userData.provenance = 'MODEL / SIMULATED'
  root.userData.boundary =
    'MVCC GC and physical compaction are distinct; this lab does not model Raft log GC'
  root.userData.privacy =
    'Synthetic identifiers and aggregate counts only; no SQL, keys, or values'

  const overviewRoot = new THREE.Group()
  overviewRoot.name = 'gc-storage-lab:overview'
  const inspectRoot = new THREE.Group()
  inspectRoot.name = 'gc-storage-lab:inspect'
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

  const processDeck = instances(
    overviewRoot,
    'gc-storage-lab:process-deck',
    boxGeometry,
    deckMaterial,
    1,
    'gc',
  )
  const safePointGate = instances(
    overviewRoot,
    'gc-storage-lab:safe-point-gate',
    torusGeometry,
    indicatorMaterial,
    1,
    'tso',
  )
  safePointGate.userData.shape = 'gate-ring'
  const blocker = instances(
    overviewRoot,
    'gc-storage-lab:transaction-blocker',
    blockerGeometry,
    semanticMaterial,
    1,
    'fault',
  )
  blocker.userData.shape = 'octahedron'
  const services = instances(
    overviewRoot,
    'gc-storage-lab:services',
    boxGeometry,
    semanticMaterial,
    2,
    'gc',
  )
  services.userData.slots = Object.freeze(['resolve-locks', 'delete-range'])
  const storeDetectors = instances(
    overviewRoot,
    'gc-storage-lab:store-detectors',
    cylinderGeometry,
    semanticMaterial,
    GC_STORAGE_LAB_STORE_CAPACITY,
    'kv',
  )
  const compactionFilters = instances(
    overviewRoot,
    'gc-storage-lab:compaction-filters',
    torusGeometry,
    indicatorMaterial,
    GC_STORAGE_LAB_STORE_CAPACITY,
    'gc',
  )
  const chainDecks = instances(
    inspectRoot,
    'gc-storage-lab:mvcc-chain-decks',
    boxGeometry,
    deckMaterial,
    GC_STORAGE_LAB_CHAIN_CAPACITY,
    'kv',
  )
  const versionSlots = instances(
    inspectRoot,
    'gc-storage-lab:mvcc-version-slots',
    boxGeometry,
    semanticMaterial,
    GC_STORAGE_LAB_VERSION_CAPACITY,
    'kv',
  )
  versionSlots.userData.capacityPerChain =
    GC_STORAGE_LAB_VERSIONS_PER_CHAIN
  versionSlots.userData.stateShapes = Object.freeze({
    present: 'block',
    retained_anchor: 'tall-anchor',
    filtered: 'flat-filtered-marker',
  })
  const flowParticles = instances(
    overviewRoot,
    'gc-storage-lab:flow-particles',
    boxGeometry,
    indicatorMaterial,
    GC_STORAGE_LAB_FLOW_CAPACITY,
    'gc',
  )
  flowParticles.userData.looping = true

  const gateAnchor = new THREE.Object3D()
  gateAnchor.name = 'gc-storage-lab:gate-anchor'
  gateAnchor.position.set(GATE_X, 11, PROCESS_Z)
  gateAnchor.userData.provenance = 'MODEL / SIMULATED'
  overviewRoot.add(gateAnchor)

  const serviceAnchorsMutable: [THREE.Object3D, THREE.Object3D] = [
    new THREE.Object3D(),
    new THREE.Object3D(),
  ]
  for (let index = 0; index < serviceAnchorsMutable.length; index++) {
    const anchor = serviceAnchorsMutable[index]
    anchor.name = `gc-storage-lab:service-anchor:${index}`
    anchor.position.set(SERVICE_X[index], 13, PROCESS_Z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    overviewRoot.add(anchor)
  }
  const serviceAnchors = Object.freeze(serviceAnchorsMutable)

  const storeAnchorsMutable = STORE_X.map((x, index) => {
    const anchor = new THREE.Object3D()
    anchor.name = `gc-storage-lab:store-anchor:${index}`
    anchor.position.set(x, 17, STORE_Z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    overviewRoot.add(anchor)
    return anchor
  }) as unknown as [THREE.Object3D, THREE.Object3D, THREE.Object3D]
  const storeAnchors = Object.freeze(storeAnchorsMutable)

  const chainAnchorsMutable = CHAIN_Z.map((z, index) => {
    const anchor = new THREE.Object3D()
    anchor.name = `gc-storage-lab:chain-anchor:${index}`
    anchor.position.set(0, 11, z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    inspectRoot.add(anchor)
    return anchor
  }) as unknown as [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  const chainAnchors = Object.freeze(chainAnchorsMutable)

  const allInstances = [
    processDeck,
    safePointGate,
    blocker,
    services,
    storeDetectors,
    compactionFilters,
    chainDecks,
    versionSlots,
    flowParticles,
  ] as const

  let disposed = false
  let updateCount = 0
  let theme: CityTheme = options.theme ?? 'night'
  let latestProjection = EMPTY_GC_STORAGE_LAB_PROJECTION

  function setStaticTheme(next: CityTheme): void {
    deckMaterial.color.setHex(next === 'night' ? 0x1d3145 : 0xc5d0d7)
    deckMaterial.opacity = next === 'night' ? 0.76 : 0.84
  }

  function setFlowParticle(
    index: number,
    step: GcStorageLabFlowStep,
    pulse: number,
    reducedMotion: boolean,
  ): void {
    if (step === 'none') {
      setInstanceTransform(flowParticles, index, 0, 0, 0, 0, 0, 0)
      return
    }

    const endpoints: Readonly<
      Record<
        Exclude<GcStorageLabFlowStep, 'none'>,
        readonly [
          readonly [number, number, number],
          readonly [number, number, number],
        ]
      >
    > = {
      candidate: [[-75, 10, PROCESS_Z], [GATE_X, 10, PROCESS_Z]],
      'resolve-locks': [
        [GATE_X, 10, PROCESS_Z],
        [SERVICE_X[0], 10, PROCESS_Z],
      ],
      'visibility-save': [
        [SERVICE_X[0], 10, PROCESS_Z],
        [GATE_X, 10, PROCESS_Z],
      ],
      'delete-ranges': [
        [GATE_X, 10, PROCESS_Z],
        [SERVICE_X[1], 10, PROCESS_Z],
      ],
      'publish-pd': [
        [SERVICE_X[1], 10, PROCESS_Z],
        [GATE_X, 10, PROCESS_Z],
      ],
      observe: [
        [GATE_X, 10, PROCESS_Z],
        [STORE_X[2], 10, STORE_Z],
      ],
      compact: [[STORE_X[1], 10, STORE_Z], [0, 10, CHAIN_Z[1]]],
      complete: [[0, 10, CHAIN_Z[3]], [-75, 10, PROCESS_Z]],
    }
    const [start, end] = endpoints[step]
    const offset = (index + 0.5) / GC_STORAGE_LAB_FLOW_CAPACITY
    const progress = reducedMotion ? offset : (offset + pulse) % 1
    const x = start[0] + (end[0] - start[0]) * progress
    const y = start[1] + (end[1] - start[1]) * progress
    const z = start[2] + (end[2] - start[2]) * progress
    const emphasis = index % 2 === 0 ? 1 : 0.72
    setInstanceTransform(
      flowParticles,
      index,
      x,
      y,
      z,
      1.7 * emphasis,
      1.7 * emphasis,
      1.7 * emphasis,
    )
    setInstanceColor(flowParticles, index, flowColor(step, theme), emphasis)
  }

  function project(projection: GcStorageLabProjection): void {
    latestProjection = projection
    root.visible = projection.mode !== 'hidden'
    overviewRoot.visible = projection.mode !== 'hidden'
    inspectRoot.visible = projection.mode === 'inspect'
    root.userData.mode = projection.mode
    root.userData.phase = projection.phase
    root.userData.round = projection.round
    root.userData.flowStep = projection.flowStep
    root.userData.reducedMotion = projection.reducedMotion
    root.userData.overflow = projection.overflow

    const visible = projection.mode === 'hidden' ? 0 : 1
    setInstanceTransform(
      processDeck,
      0,
      0,
      1,
      1,
      154 * visible,
      2 * visible,
      98 * visible,
    )
    setInstanceColor(
      processDeck,
      0,
      theme === 'night' ? 0x263b4d : 0xb9c6ce,
    )

    const pulse = clamp(projection.pulse, 0, 1)
    const gatePulse =
      projection.safePoint.gateState !== 'idle' &&
      !projection.reducedMotion
        ? 1 + pulse * 0.18
        : 1
    setInstanceTransform(
      safePointGate,
      0,
      GATE_X,
      11,
      PROCESS_Z,
      8 * visible * gatePulse,
      8 * visible * gatePulse,
      8 * visible * gatePulse,
      _horizontalRotation,
    )
    setInstanceColor(
      safePointGate,
      0,
      gateColor(projection.safePoint.gateState, theme),
    )
    gateAnchor.visible = visible === 1
    gateAnchor.userData.gateState = projection.safePoint.gateState
    gateAnchor.userData.previous = projection.safePoint.previous
    gateAnchor.userData.candidate = projection.safePoint.candidate
    gateAnchor.userData.serviceSafePoint =
      projection.safePoint.serviceSafePoint
    gateAnchor.userData.staged = projection.safePoint.staged
    gateAnchor.userData.visibilitySaved =
      projection.safePoint.visibilitySaved
    gateAnchor.userData.published = projection.safePoint.published
    gateAnchor.userData.blocked = projection.safePoint.blocked

    const blockerVisible = projection.blocker.visible && visible === 1
    const blockerPulse =
      blockerVisible &&
      projection.blocker.status === 'active' &&
      projection.safePoint.blocked &&
      !projection.reducedMotion
        ? 1 + pulse * 0.24
        : 1
    setInstanceTransform(
      blocker,
      0,
      GATE_X,
      9,
      PROCESS_Z - 19,
      5.2 * (blockerVisible ? blockerPulse : 0),
      5.2 * (blockerVisible ? blockerPulse : 0),
      5.2 * (blockerVisible ? blockerPulse : 0),
    )
    setInstanceColor(
      blocker,
      0,
      projection.blocker.status === 'active'
        ? SEMANTIC_COLORS[theme].fault
        : SEMANTIC_COLORS[theme].kv,
      projection.safePoint.blocked ? 1 : 0.68,
    )
    blocker.userData.transactionId = projection.blocker.transactionId
    blocker.userData.startTs = projection.blocker.startTs
    blocker.userData.status = projection.blocker.status

    const pendingLocks = projection.resolveLocks.locks.filter(
      (lock) => lock.visible && lock.status === 'pending',
    ).length
    const resolvedLocks = projection.resolveLocks.locks.filter(
      (lock) => lock.visible && lock.status !== 'pending',
    ).length
    const deleteRangeActive = projection.deleteRanges.some(
      (range) => range.visible && range.status === 'eligible',
    )
    const deleteRangeComplete = projection.deleteRanges.some(
      (range) => range.visible && range.status === 'deleted',
    )
    for (let index = 0; index < 2; index++) {
      const x = SERVICE_X[index]
      const active = index === 0
        ? projection.flowStep === 'resolve-locks'
        : projection.flowStep === 'delete-ranges'
      const height = active ? 14 : 10
      setInstanceTransform(
        services,
        index,
        x,
        2 + height / 2,
        PROCESS_Z,
        18 * visible,
        height * visible,
        15 * visible,
      )
      const color = index === 0
        ? pendingLocks > 0
          ? SEMANTIC_COLORS[theme].txn2pc
          : resolvedLocks > 0
            ? SEMANTIC_COLORS[theme].kv
            : SEMANTIC_COLORS[theme].gc
        : deleteRangeActive
          ? SEMANTIC_COLORS[theme].tso
          : deleteRangeComplete
            ? SEMANTIC_COLORS[theme].kv
            : SEMANTIC_COLORS[theme].gc
      setInstanceColor(services, index, color, active ? 1 : 0.7)
    }
    serviceAnchorsMutable[0].userData.implementation =
      projection.resolveLocks.implementation
    serviceAnchorsMutable[0].userData.scannedRegionIds =
      Object.freeze([...projection.resolveLocks.scannedRegionIds])
    serviceAnchorsMutable[0].userData.pendingLocks = pendingLocks
    serviceAnchorsMutable[0].userData.resolvedLocks = resolvedLocks
    serviceAnchorsMutable[1].userData.eligible =
      projection.deleteRanges.filter((range) =>
        range.visible && range.status === 'eligible').length
    serviceAnchorsMutable[1].userData.deleted =
      projection.deleteRanges.filter((range) =>
        range.visible && range.status === 'deleted').length

    for (let index = 0; index < GC_STORAGE_LAB_STORE_CAPACITY; index++) {
      const store = projection.stores[index]
      const storeVisible = store.visible && visible === 1
      const height = store.compaction === 'running' ? 18
        : store.compaction === 'complete' ? 15
          : store.compaction === 'eligible' ? 13
            : 10
      setInstanceTransform(
        storeDetectors,
        index,
        STORE_X[index],
        2 + height / 2,
        STORE_Z,
        7 * (storeVisible ? 1 : 0),
        height * (storeVisible ? 1 : 0),
        7 * (storeVisible ? 1 : 0),
      )
      setInstanceColor(
        storeDetectors,
        index,
        compactionColor(store.compaction, theme),
        store.detectorCurrent ? 1 : 0.58,
      )
      const filterPulse =
        store.filterActive && !projection.reducedMotion
          ? 1 + pulse * 0.2
          : 1
      const ringScale = storeVisible ? 6.3 * filterPulse : 0
      setInstanceTransform(
        compactionFilters,
        index,
        STORE_X[index],
        15,
        STORE_Z,
        ringScale,
        ringScale,
        ringScale,
        _horizontalRotation,
      )
      setInstanceColor(
        compactionFilters,
        index,
        store.filterActive
          ? SEMANTIC_COLORS[theme].gc
          : store.detectorCurrent
            ? SEMANTIC_COLORS[theme].client
            : theme === 'night' ? 0x526679 : 0x82939f,
      )
      const anchor = storeAnchorsMutable[index]
      anchor.visible = storeVisible
      anchor.userData.storeId = store.storeId
      anchor.userData.detectedSafePoint = store.detectedSafePoint
      anchor.userData.detectorCurrent = store.detectorCurrent
      anchor.userData.compaction = store.compaction
      anchor.userData.filterActive = store.filterActive
    }

    for (let chainIndex = 0;
      chainIndex < GC_STORAGE_LAB_CHAIN_CAPACITY;
      chainIndex++
    ) {
      const chain = projection.chains[chainIndex]
      const chainVisible =
        chain.visible && projection.mode === 'inspect'
      const z = CHAIN_Z[chainIndex]
      setInstanceTransform(
        chainDecks,
        chainIndex,
        0,
        3,
        z,
        78 * (chainVisible ? 1 : 0),
        2.2 * (chainVisible ? 1 : 0),
        10 * (chainVisible ? 1 : 0),
      )
      setInstanceColor(
        chainDecks,
        chainIndex,
        SEMANTIC_COLORS[theme].kv,
        0.48,
      )
      const anchor = chainAnchorsMutable[chainIndex]
      anchor.visible = chainVisible
      anchor.userData.chainId = chain.id
      anchor.userData.regionId = chain.regionId
      anchor.userData.overflowVersions = chain.overflowVersions

      for (let versionIndex = 0;
        versionIndex < GC_STORAGE_LAB_VERSIONS_PER_CHAIN;
        versionIndex++
      ) {
        const version = chain.versions[versionIndex]
        const instance =
          chainIndex * GC_STORAGE_LAB_VERSIONS_PER_CHAIN + versionIndex
        const versionVisible = chainVisible && version.visible
        const stateHeight =
          version.state === 'retained_anchor' ? 10
            : version.state === 'filtered' ? 0.8
              : 4
        const width = version.state === 'retained_anchor' ? 5 : 8
        setInstanceTransform(
          versionSlots,
          instance,
          VERSION_X[versionIndex],
          4 + stateHeight / 2,
          z,
          width * (versionVisible ? 1 : 0),
          stateHeight * (versionVisible ? 1 : 0),
          (version.state === 'filtered' ? 9 : 7) *
            (versionVisible ? 1 : 0),
        )
        setInstanceColor(
          versionSlots,
          instance,
          versionColor(version.state, theme),
          version.state === 'filtered' ? 0.44 : 1,
        )
      }
    }

    versionSlots.userData.states = Object.freeze(
      projection.chains.flatMap((chain) =>
        chain.versions.map((version) => version.state)),
    )
    versionSlots.userData.ids = Object.freeze(
      projection.chains.flatMap((chain) =>
        chain.versions.map((version) => version.id)),
    )
    for (let index = 0; index < GC_STORAGE_LAB_FLOW_CAPACITY; index++) {
      setFlowParticle(
        index,
        projection.flowStep,
        pulse,
        projection.reducedMotion,
      )
    }

    for (const mesh of allInstances) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  setStaticTheme(theme)
  project(EMPTY_GC_STORAGE_LAB_PROJECTION)

  const counted = countScene(root)
  if (
    counted.drawables > 10 ||
    counted.geometries.size > 5 ||
    counted.materials.size > 3 ||
    counted.shadows !== 0
  ) {
    throw new Error('GC/Storage Lab exceeded its renderer resource budget')
  }
  const resources: GcStorageLabResourceCounts = Object.freeze({
    objectCount: counted.objects,
    drawableCount: counted.drawables,
    geometryCount: counted.geometries.size,
    materialCount: counted.materials.size,
    instancedMeshCount: counted.instances,
    instanceCapacity: counted.capacity,
    storeCapacity: 3,
    lockCapacity: 3,
    deleteRangeCapacity: 2,
    chainCapacity: 4,
    versionsPerChain: 4,
    versionCapacity: 16,
    flowCapacity: 8,
    shadowCount: 0,
  })

  return {
    object: root,
    gateAnchor,
    serviceAnchors,
    storeAnchors,
    chainAnchors,
    get debug(): GcStorageLabDebug {
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
