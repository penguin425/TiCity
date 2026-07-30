/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * A renderer-only, fixed-capacity view of the synthetic Lock Lab model.
 * The model remains authoritative; this module only paints immutable
 * projections into geometry that is allocated once.
 */

import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import type { CityTheme } from './palette'

export const LOCK_LAB_TRANSACTION_CAPACITY = 3 as const
export const LOCK_LAB_RESOURCE_CAPACITY = 2 as const
export const LOCK_LAB_WAITERS_PER_RESOURCE = 2 as const
export const LOCK_LAB_EDGE_CAPACITY = 6 as const

const TOKEN_PLACEMENT_CAPACITY = 7

export type LockLabMode = 'hidden' | 'overview' | 'inspect'
export type LockLabPhase =
  | 'idle'
  | 'acquiring'
  | 'waiting'
  | 'cycle'
  | 'victim'
  | 'rollback'
  | 'resolved'
  | 'retry'
  | 'complete'
export type LockLabTransactionStatus =
  | 'active'
  | 'waiting'
  | 'victim'
  | 'rolled_back'
  | 'commit_handoff'
  | 'completed'
export type LockLabTransactionShape = 'cylinder' | 'diamond' | 'double-ring'
export type LockLabDetectorState =
  | 'idle'
  | 'detecting'
  | 'victim-selected'
  | 'resolved'
export type LockLabDeadlockResolution =
  | 'none'
  | 'detected'
  | 'rolling_back'
  | 'resolved'
export type LockLabTransactionSlot = 0 | 1 | 2
export type LockLabResourceSlot = 0 | 1
export type LockLabOptionalTransactionSlot = -1 | LockLabTransactionSlot
export type LockLabOptionalResourceSlot = -1 | LockLabResourceSlot

export interface LockLabTransactionProjection {
  readonly visible: boolean
  readonly id: string
  readonly clientId: string
  readonly attempt: number
  readonly retryOfTransactionId: string | null
  readonly startTs: number
  readonly commitTs: number | null
  readonly status: LockLabTransactionStatus
  readonly shape: LockLabTransactionShape
}

export interface LockLabResourceProjection {
  readonly visible: boolean
  readonly id: string
  readonly regionId: number
  readonly leaderStoreId: string
  readonly holderSlot: LockLabOptionalTransactionSlot
  readonly waiterSlots: readonly [
    LockLabOptionalTransactionSlot,
    LockLabOptionalTransactionSlot,
  ]
}

export interface LockLabWaitForEdgeProjection {
  readonly visible: boolean
  readonly id: string
  readonly waiterSlot: LockLabOptionalTransactionSlot
  readonly holderSlot: LockLabOptionalTransactionSlot
  readonly resourceSlot: LockLabOptionalResourceSlot
  readonly cycle: boolean
}

export interface LockLabDetectorProjection {
  readonly active: boolean
  readonly scope: 'cluster_wide'
  readonly leaderStoreId: string
  readonly state: LockLabDetectorState
  /** Normalized 0..1 pulse supplied by the teaching clock. */
  readonly pulse: number
}

export interface LockLabDeadlockProjection {
  readonly visible: boolean
  readonly id: string
  readonly victimSlot: LockLabOptionalTransactionSlot
  readonly selectionPolicy: 'cycle_closing_waiter_model_policy'
  readonly retryable: false
  readonly resolution: LockLabDeadlockResolution
}

export interface LockLabApplicationRetryProjection {
  readonly visible: boolean
  readonly source: 'application'
  readonly clientId: string
  readonly retryOfTransactionId: string
  readonly fixedBackoffMs: number
  readonly status: 'none' | 'backoff' | 'started' | 'completed'
  readonly newTransactionSlot: LockLabOptionalTransactionSlot
}

export interface LockLabOverflowProjection {
  readonly transactions: number
  readonly resources: number
  readonly waiters: number
  readonly edges: number
  readonly total: number
}

/**
 * A fixed-size, renderer-local contract. Slot identity is stable within one
 * projection and unknown or over-capacity model items are never fabricated.
 */
export interface LockLabProjection {
  readonly mode: LockLabMode
  readonly phase: LockLabPhase
  readonly reducedMotion: boolean
  readonly transactions: readonly [
    LockLabTransactionProjection,
    LockLabTransactionProjection,
    LockLabTransactionProjection,
  ]
  readonly resources: readonly [
    LockLabResourceProjection,
    LockLabResourceProjection,
  ]
  readonly edges: readonly [
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
  ]
  readonly detector: LockLabDetectorProjection
  readonly deadlock: LockLabDeadlockProjection
  readonly applicationRetry: LockLabApplicationRetryProjection
  readonly overflow: LockLabOverflowProjection
}

export interface LockLabResourceCounts {
  readonly objectCount: number
  readonly drawableCount: number
  readonly geometryCount: number
  readonly materialCount: number
  readonly instancedMeshCount: number
  readonly instanceCapacity: number
  readonly transactionCapacity: 3
  readonly resourceCapacity: 2
  readonly holderCapacity: 2
  readonly waitersPerResource: 2
  readonly edgeCapacity: 6
  readonly detectorCapacity: 1
  readonly deadlockHistoryCapacity: 1
}

export interface LockLabDebug {
  readonly resources: LockLabResourceCounts
  readonly disposed: boolean
  readonly updateCount: number
}

export interface LockLab {
  readonly object: THREE.Group
  readonly transactionAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly resourceAnchors: readonly [THREE.Object3D, THREE.Object3D]
  readonly detectorAnchor: THREE.Object3D
  readonly debug: LockLabDebug
  update(projection: LockLabProjection): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface LockLabOptions {
  readonly theme?: CityTheme
}

const TRANSACTION_X = [-34, 34, 0] as const
const TRANSACTION_Z = [-31, -31, -45] as const
const RESOURCE_X = [-31, 31] as const
const WAITER_Z = [31, 42] as const
const GRAPH_Y = 13
const RESOURCE_Z = 20
const TOKEN_Y = 14
const LABEL_Y = 25

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _color = new THREE.Color()
const _edgeStart = new THREE.Vector3()
const _edgeEnd = new THREE.Vector3()
const _edgeDirection = new THREE.Vector3()
const _edgeOffset = new THREE.Vector3()
const _edgeMidpoint = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _identityRotation = new THREE.Quaternion()
const _edgeRotation = new THREE.Quaternion()
const _horizontalRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
)
const _victimRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI,
)

function emptyTransaction(
  shape: LockLabTransactionShape,
): LockLabTransactionProjection {
  return Object.freeze({
    visible: false,
    id: '',
    clientId: '',
    attempt: 0,
    retryOfTransactionId: null,
    startTs: 0,
    commitTs: null,
    status: 'active',
    shape,
  })
}

const EMPTY_RESOURCE: LockLabResourceProjection = Object.freeze({
  visible: false,
  id: '',
  regionId: -1,
  leaderStoreId: '',
  holderSlot: -1,
  waiterSlots: Object.freeze([-1, -1] as const),
})
const EMPTY_EDGE: LockLabWaitForEdgeProjection = Object.freeze({
  visible: false,
  id: '',
  waiterSlot: -1,
  holderSlot: -1,
  resourceSlot: -1,
  cycle: false,
})

export const EMPTY_LOCK_LAB_PROJECTION: LockLabProjection = Object.freeze({
  mode: 'hidden',
  phase: 'idle',
  reducedMotion: false,
  transactions: Object.freeze([
    emptyTransaction('cylinder'),
    emptyTransaction('diamond'),
    emptyTransaction('double-ring'),
  ] as const),
  resources: Object.freeze([EMPTY_RESOURCE, EMPTY_RESOURCE] as const),
  edges: Object.freeze([
    EMPTY_EDGE,
    EMPTY_EDGE,
    EMPTY_EDGE,
    EMPTY_EDGE,
    EMPTY_EDGE,
    EMPTY_EDGE,
  ] as const),
  detector: Object.freeze({
    active: false,
    scope: 'cluster_wide',
    leaderStoreId: '',
    state: 'idle',
    pulse: 0,
  }),
  deadlock: Object.freeze({
    visible: false,
    id: '',
    victimSlot: -1,
    selectionPolicy: 'cycle_closing_waiter_model_policy',
    retryable: false,
    resolution: 'none',
  }),
  applicationRetry: Object.freeze({
    visible: false,
    source: 'application',
    clientId: '',
    retryOfTransactionId: '',
    fixedBackoffMs: 0,
    status: 'none',
    newTransactionSlot: -1,
  }),
  overflow: Object.freeze({
    transactions: 0,
    resources: 0,
    waiters: 0,
    edges: 0,
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

function configureSemanticMaterial(
  material: THREE.MeshStandardMaterial,
  color: number,
  theme: CityTheme,
  emissiveIntensity: number,
): void {
  material.color.setHex(color)
  material.emissive.setHex(theme === 'night' ? color : 0x000000)
  material.emissiveIntensity = theme === 'night' ? emissiveIntensity : 0
}

function transactionColor(slot: number, theme: CityTheme): number {
  if (slot === 0) return SEMANTIC_COLORS[theme].client
  if (slot === 1) return SEMANTIC_COLORS[theme].txn2pc
  return SEMANTIC_COLORS[theme].kv
}

function statusBrightness(status: LockLabTransactionStatus): number {
  switch (status) {
    case 'waiting':
      return 1
    case 'victim':
      return 1
    case 'rolled_back':
      return 0.36
    case 'commit_handoff':
      return 0.88
    case 'completed':
      return 0.56
    case 'active':
      return 0.78
  }
}

function detectorX(storeId: string): number {
  if (storeId === 'tikv-1') return -13
  if (storeId === 'tikv-3') return 13
  return 0
}

function graphPosition(slot: number, target: THREE.Vector3): void {
  if (slot < 0 || slot >= LOCK_LAB_TRANSACTION_CAPACITY) {
    target.set(0, 0, 0)
    return
  }
  target.set(TRANSACTION_X[slot], GRAPH_Y, TRANSACTION_Z[slot])
}

export function createLockLab(options: LockLabOptions = {}): LockLab {
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
  const cylinderGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 16))
  const diamondGeometry = ownGeometry(new THREE.OctahedronGeometry(1, 0))
  const torusGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.2, 8, 24))
  const coneGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 12))

  const structureMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x334f68,
    roughness: 0.72,
    metalness: 0.18,
  }))
  structureMaterial.name = 'lock-lab:structure'
  const deckMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x1d3145,
    roughness: 0.88,
    metalness: 0.12,
  }))
  deckMaterial.name = 'lock-lab:deck'
  const slotMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x526679,
    roughness: 0.68,
    metalness: 0.2,
  }))
  slotMaterial.name = 'lock-lab:slots'
  const tokenMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: 0x162331,
    emissiveIntensity: 0.34,
    roughness: 0.44,
    metalness: 0.28,
  }))
  tokenMaterial.name = 'lock-lab:transaction-tokens'
  const edgeMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: 0x162331,
    emissiveIntensity: 0.48,
    roughness: 0.38,
    metalness: 0.2,
  }))
  edgeMaterial.name = 'lock-lab:wait-for-edges'
  const detectorMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.tso,
    emissive: SEMANTIC_COLORS.night.tso,
    emissiveIntensity: 0.5,
    roughness: 0.4,
    metalness: 0.32,
  }))
  detectorMaterial.name = 'lock-lab:detector'
  const faultMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.fault,
    emissive: SEMANTIC_COLORS.night.fault,
    emissiveIntensity: 0.7,
    roughness: 0.36,
    metalness: 0.22,
    transparent: true,
    opacity: 0.9,
  }))
  faultMaterial.name = 'lock-lab:deadlock'

  const root = new THREE.Group()
  root.name = 'lock-lab'
  root.userData.kind = 'lock-lab'
  root.userData.provenance = 'MODEL / SIMULATED'
  root.userData.capacities = Object.freeze({
    transactions: LOCK_LAB_TRANSACTION_CAPACITY,
    resources: LOCK_LAB_RESOURCE_CAPACITY,
    holders: LOCK_LAB_RESOURCE_CAPACITY,
    waitersPerResource: LOCK_LAB_WAITERS_PER_RESOURCE,
    edges: LOCK_LAB_EDGE_CAPACITY,
    detector: 1,
    deadlockHistory: 1,
  })

  const overviewRoot = new THREE.Group()
  overviewRoot.name = 'lock-lab:overview'
  const detailRoot = new THREE.Group()
  detailRoot.name = 'lock-lab:inspect'
  root.add(overviewRoot, detailRoot)

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
    mesh.userData.domain = domain
    mesh.userData.capacity = count
    parent.add(mesh)
    return mesh
  }

  const baseDeck = new THREE.Mesh(boxGeometry, deckMaterial)
  baseDeck.name = 'lock-lab:base'
  baseDeck.position.set(0, 1, 6)
  baseDeck.scale.set(104, 2, 94)
  baseDeck.receiveShadow = true
  overviewRoot.add(baseDeck)

  const resourceDecks = instances(
    overviewRoot,
    'lock-lab:resource-decks',
    boxGeometry,
    structureMaterial,
    LOCK_LAB_RESOURCE_CAPACITY,
    'kv',
  )
  const holderSockets = instances(
    detailRoot,
    'lock-lab:holder-sockets',
    torusGeometry,
    slotMaterial,
    LOCK_LAB_RESOURCE_CAPACITY,
    'txn2pc',
  )
  holderSockets.userData.storage = 'leader_memory'
  holderSockets.userData.holderCapacity = LOCK_LAB_RESOURCE_CAPACITY
  const waiterSlots = instances(
    detailRoot,
    'lock-lab:waiter-slots',
    boxGeometry,
    slotMaterial,
    LOCK_LAB_RESOURCE_CAPACITY * LOCK_LAB_WAITERS_PER_RESOURCE,
    'txn2pc',
  )
  waiterSlots.userData.waitersPerResource = LOCK_LAB_WAITERS_PER_RESOURCE
  waiterSlots.userData.wakePolicy = 'smallest_start_ts_model_policy'

  const transactionA = instances(
    detailRoot,
    'lock-lab:transaction-a',
    cylinderGeometry,
    tokenMaterial,
    TOKEN_PLACEMENT_CAPACITY,
    'txn2pc',
  )
  transactionA.userData.shape = 'cylinder'
  const transactionB = instances(
    detailRoot,
    'lock-lab:transaction-b',
    diamondGeometry,
    tokenMaterial,
    TOKEN_PLACEMENT_CAPACITY,
    'txn2pc',
  )
  transactionB.userData.shape = 'diamond'
  const transactionRetry = instances(
    detailRoot,
    'lock-lab:transaction-retry',
    torusGeometry,
    tokenMaterial,
    TOKEN_PLACEMENT_CAPACITY,
    'return',
  )
  transactionRetry.userData.shape = 'double-ring'
  const transactionRetryInner = instances(
    detailRoot,
    'lock-lab:transaction-retry-inner',
    torusGeometry,
    tokenMaterial,
    TOKEN_PLACEMENT_CAPACITY,
    'return',
  )
  transactionRetryInner.userData.shape = 'double-ring-inner'

  const waitEdges = instances(
    detailRoot,
    'lock-lab:wait-for-edges',
    cylinderGeometry,
    edgeMaterial,
    LOCK_LAB_EDGE_CAPACITY,
    'txn2pc',
  )
  waitEdges.userData.direction = 'waiter-to-holder'
  const waitArrowheads = instances(
    detailRoot,
    'lock-lab:wait-arrowheads',
    coneGeometry,
    edgeMaterial,
    LOCK_LAB_EDGE_CAPACITY,
    'txn2pc',
  )
  waitArrowheads.userData.direction = 'waiter-to-holder'

  const detector = new THREE.Mesh(cylinderGeometry, detectorMaterial)
  detector.name = 'lock-lab:detector'
  detector.userData.scope = 'cluster_wide'
  detector.userData.capacity = 1
  overviewRoot.add(detector)
  const detectorCrown = new THREE.Mesh(coneGeometry, detectorMaterial)
  detectorCrown.name = 'lock-lab:detector-crown'
  detectorCrown.userData.scope = 'cluster_wide'
  overviewRoot.add(detectorCrown)

  const deadlockHistory = new THREE.Mesh(torusGeometry, faultMaterial)
  deadlockHistory.name = 'lock-lab:deadlock-history'
  deadlockHistory.quaternion.copy(_horizontalRotation)
  deadlockHistory.userData.capacity = 1
  detailRoot.add(deadlockHistory)
  const victimMarker = new THREE.Mesh(coneGeometry, faultMaterial)
  victimMarker.name = 'lock-lab:victim-marker'
  victimMarker.quaternion.copy(_victimRotation)
  victimMarker.userData.retryable = false
  detailRoot.add(victimMarker)

  const transactionAnchorsMutable: [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ] = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()]
  const transactionIds = ['', '', '']
  const transactionStatuses: LockLabTransactionStatus[] = [
    'active',
    'active',
    'active',
  ]
  for (let slot = 0; slot < LOCK_LAB_TRANSACTION_CAPACITY; slot++) {
    const anchor = transactionAnchorsMutable[slot]
    anchor.name = `lock-lab:transaction-anchor:${slot}`
    anchor.position.set(TRANSACTION_X[slot], LABEL_Y, TRANSACTION_Z[slot])
    anchor.userData.provenance = 'MODEL / SIMULATED'
    detailRoot.add(anchor)
  }
  const transactionAnchors = Object.freeze(transactionAnchorsMutable)

  const resourceAnchorsMutable: [THREE.Object3D, THREE.Object3D] = [
    new THREE.Object3D(),
    new THREE.Object3D(),
  ]
  const resourceIds = ['', '']
  const resourceLeaderStoreIds = ['', '']
  for (let slot = 0; slot < LOCK_LAB_RESOURCE_CAPACITY; slot++) {
    const anchor = resourceAnchorsMutable[slot]
    anchor.name = `lock-lab:resource-anchor:${slot}`
    anchor.position.set(RESOURCE_X[slot], LABEL_Y, RESOURCE_Z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    detailRoot.add(anchor)
  }
  const resourceAnchors = Object.freeze(resourceAnchorsMutable)

  const detectorAnchor = new THREE.Object3D()
  detectorAnchor.name = 'lock-lab:detector-anchor'
  detectorAnchor.position.set(0, LABEL_Y, 0)
  detectorAnchor.userData.provenance = 'MODEL / SIMULATED'
  overviewRoot.add(detectorAnchor)

  const transactionMeshes = [
    transactionA,
    transactionB,
    transactionRetry,
  ] as const
  const instancedMeshes = [
    resourceDecks,
    holderSockets,
    waiterSlots,
    transactionA,
    transactionB,
    transactionRetry,
    transactionRetryInner,
    waitEdges,
    waitArrowheads,
  ] as const
  const edgeIds = ['', '', '', '', '', '']

  let disposed = false
  let updateCount = 0
  let theme: CityTheme = options.theme ?? 'night'
  let latestProjection: LockLabProjection = EMPTY_LOCK_LAB_PROJECTION

  function setStaticTheme(next: CityTheme): void {
    const night = next === 'night'
    structureMaterial.color.setHex(night ? 0x334f68 : 0xcbd7dd)
    structureMaterial.emissive.setHex(0x000000)
    deckMaterial.color.setHex(night ? 0x1d3145 : 0x8c9ca7)
    deckMaterial.emissive.setHex(0x000000)
    slotMaterial.color.setHex(night ? 0x526679 : 0x82939f)
    slotMaterial.emissive.setHex(0x000000)
    tokenMaterial.emissive.setHex(night ? 0x162331 : 0x000000)
    tokenMaterial.emissiveIntensity = night ? 0.34 : 0
    edgeMaterial.emissive.setHex(night ? 0x162331 : 0x000000)
    edgeMaterial.emissiveIntensity = night ? 0.48 : 0
    configureSemanticMaterial(
      detectorMaterial,
      SEMANTIC_COLORS[next].tso,
      next,
      0.5,
    )
    configureSemanticMaterial(
      faultMaterial,
      SEMANTIC_COLORS[next].fault,
      next,
      0.7,
    )
  }

  function hideTransactionPlacements(): void {
    for (let slot = 0; slot < LOCK_LAB_TRANSACTION_CAPACITY; slot++) {
      const mesh = transactionMeshes[slot]
      for (let placement = 0; placement < TOKEN_PLACEMENT_CAPACITY; placement++) {
        setInstanceTransform(
          mesh,
          placement,
          0,
          0,
          0,
          0,
          0,
          0,
          slot === 2 ? _horizontalRotation : _identityRotation,
        )
        if (slot === 2) {
          setInstanceTransform(
            transactionRetryInner,
            placement,
            0,
            0,
            0,
            0,
            0,
            0,
            _horizontalRotation,
          )
        }
      }
    }
  }

  function showTransaction(
    projection: LockLabProjection,
    slot: LockLabTransactionSlot,
    placement: number,
    x: number,
    y: number,
    z: number,
    size: number,
  ): void {
    const transaction = projection.transactions[slot]
    if (!transaction.visible) return
    const mesh = transactionMeshes[slot]
    const brightness = statusBrightness(transaction.status)
    const color = transactionColor(slot, theme)
    if (slot === 0) {
      setInstanceTransform(mesh, placement, x, y, z, size, size * 1.2, size)
    } else if (slot === 1) {
      setInstanceTransform(mesh, placement, x, y, z, size, size, size)
    } else {
      setInstanceTransform(
        mesh,
        placement,
        x,
        y,
        z,
        size,
        size,
        size,
        _horizontalRotation,
      )
      setInstanceTransform(
        transactionRetryInner,
        placement,
        x,
        y + 0.15,
        z,
        size * 0.57,
        size * 0.57,
        size * 0.57,
        _horizontalRotation,
      )
      setInstanceColor(transactionRetryInner, placement, color, brightness)
    }
    setInstanceColor(mesh, placement, color, brightness)
  }

  function hideDirectedEdge(index: number): void {
    setInstanceTransform(waitEdges, index, 0, 0, 0, 0, 0, 0)
    setInstanceTransform(waitArrowheads, index, 0, 0, 0, 0, 0, 0)
  }

  function showDirectedEdge(
    edge: LockLabWaitForEdgeProjection,
    index: number,
  ): void {
    if (
      !edge.visible ||
      edge.waiterSlot < 0 ||
      edge.holderSlot < 0 ||
      edge.waiterSlot === edge.holderSlot
    ) {
      hideDirectedEdge(index)
      return
    }
    graphPosition(edge.waiterSlot, _edgeStart)
    graphPosition(edge.holderSlot, _edgeEnd)
    _edgeDirection.subVectors(_edgeEnd, _edgeStart)
    const totalLength = _edgeDirection.length()
    if (totalLength <= 12) {
      hideDirectedEdge(index)
      return
    }
    _edgeDirection.multiplyScalar(1 / totalLength)
    _edgeOffset.set(
      -_edgeDirection.z * 2.5,
      index * 0.12,
      _edgeDirection.x * 2.5,
    )
    _edgeStart.addScaledVector(_edgeDirection, 6).add(_edgeOffset)
    _edgeEnd.addScaledVector(_edgeDirection, -6).add(_edgeOffset)
    _edgeMidpoint.addVectors(_edgeStart, _edgeEnd).multiplyScalar(0.5)
    _edgeRotation.setFromUnitVectors(_up, _edgeDirection)
    const length = _edgeStart.distanceTo(_edgeEnd)
    const thickness = edge.cycle ? 0.72 : 0.42
    setInstanceTransform(
      waitEdges,
      index,
      _edgeMidpoint.x,
      _edgeMidpoint.y,
      _edgeMidpoint.z,
      thickness,
      length,
      thickness,
      _edgeRotation,
    )
    setInstanceTransform(
      waitArrowheads,
      index,
      _edgeEnd.x,
      _edgeEnd.y,
      _edgeEnd.z,
      edge.cycle ? 2.2 : 1.6,
      edge.cycle ? 4.8 : 3.6,
      edge.cycle ? 2.2 : 1.6,
      _edgeRotation,
    )
    const color = edge.cycle
      ? SEMANTIC_COLORS[theme].fault
      : SEMANTIC_COLORS[theme].txn2pc
    setInstanceColor(waitEdges, index, color)
    setInstanceColor(waitArrowheads, index, color)
  }

  function project(projection: LockLabProjection): void {
    root.visible = projection.mode !== 'hidden'
    overviewRoot.visible = projection.mode !== 'hidden'
    detailRoot.visible = projection.mode === 'inspect'
    root.userData.mode = projection.mode
    root.userData.phase = projection.phase
    root.userData.reducedMotion = projection.reducedMotion
    root.userData.overflow = projection.overflow

    hideTransactionPlacements()
    for (let slot = 0; slot < LOCK_LAB_TRANSACTION_CAPACITY; slot++) {
      const transaction = projection.transactions[slot]
      const anchor = transactionAnchorsMutable[slot]
      if (
        transactionIds[slot] !== transaction.id ||
        transactionStatuses[slot] !== transaction.status
      ) {
        transactionIds[slot] = transaction.id
        transactionStatuses[slot] = transaction.status
        anchor.userData.transactionId = transaction.id
        anchor.userData.clientId = transaction.clientId
        anchor.userData.attempt = transaction.attempt
        anchor.userData.status = transaction.status
        anchor.userData.shape = transaction.shape
      }
      anchor.visible = transaction.visible
      if (transaction.visible) {
        showTransaction(
          projection,
          slot as LockLabTransactionSlot,
          0,
          TRANSACTION_X[slot],
          GRAPH_Y,
          TRANSACTION_Z[slot],
          4.8,
        )
      }
    }

    for (let resource = 0; resource < LOCK_LAB_RESOURCE_CAPACITY; resource++) {
      const projected = projection.resources[resource]
      const visible = projected.visible
      const scale = visible ? 1 : 0
      const x = RESOURCE_X[resource]
      setInstanceTransform(
        resourceDecks,
        resource,
        x,
        4,
        RESOURCE_Z + 9,
        46 * scale,
        5 * scale,
        31 * scale,
      )
      setInstanceTransform(
        holderSockets,
        resource,
        x,
        7,
        RESOURCE_Z,
        7 * scale,
        7 * scale,
        7 * scale,
        _horizontalRotation,
      )
      setInstanceColor(
        holderSockets,
        resource,
        SEMANTIC_COLORS[theme].txn2pc,
        projected.holderSlot < 0 ? 0.46 : 0.9,
      )
      for (let waiter = 0; waiter < LOCK_LAB_WAITERS_PER_RESOURCE; waiter++) {
        const instance = resource * LOCK_LAB_WAITERS_PER_RESOURCE + waiter
        setInstanceTransform(
          waiterSlots,
          instance,
          x,
          6,
          WAITER_Z[waiter],
          13 * scale,
          1.4 * scale,
          7 * scale,
        )
      }

      const anchor = resourceAnchorsMutable[resource]
      if (
        resourceIds[resource] !== projected.id ||
        resourceLeaderStoreIds[resource] !== projected.leaderStoreId
      ) {
        resourceIds[resource] = projected.id
        resourceLeaderStoreIds[resource] = projected.leaderStoreId
        anchor.userData.resourceId = projected.id
        anchor.userData.regionId = projected.regionId
        anchor.userData.leaderStoreId = projected.leaderStoreId
        anchor.userData.storage = 'leader_memory'
        anchor.userData.wakePolicy = 'smallest_start_ts_model_policy'
      }
      anchor.visible = visible
      if (!visible) continue

      if (projected.holderSlot >= 0) {
        const holderSlot = projected.holderSlot as LockLabTransactionSlot
        showTransaction(
          projection,
          holderSlot,
          1 + resource * 3,
          x,
          TOKEN_Y,
          RESOURCE_Z,
          4.2,
        )
      }
      for (let waiter = 0; waiter < LOCK_LAB_WAITERS_PER_RESOURCE; waiter++) {
        const transactionSlot = projected.waiterSlots[waiter]
        if (transactionSlot < 0) continue
        showTransaction(
          projection,
          transactionSlot as LockLabTransactionSlot,
          2 + resource * 3 + waiter,
          x,
          TOKEN_Y,
          WAITER_Z[waiter],
          3.7,
        )
      }
    }

    for (let edge = 0; edge < LOCK_LAB_EDGE_CAPACITY; edge++) {
      const projected = projection.edges[edge]
      edgeIds[edge] = projected.id
      showDirectedEdge(projected, edge)
    }
    waitEdges.userData.edgeIds = edgeIds
    waitEdges.userData.cycleResolution = projection.deadlock.resolution

    const pulse = clamp(projection.detector.pulse, 0, 1)
    const detectorScale = projection.reducedMotion ? 1 : 1 + pulse * 0.24
    const x = detectorX(projection.detector.leaderStoreId)
    detector.position.set(x, 10, -4)
    detector.scale.set(5.5 * detectorScale, 13, 5.5 * detectorScale)
    detectorCrown.position.set(x, 19, -4)
    detectorCrown.scale.set(
      3.2 * detectorScale,
      4.5 * detectorScale,
      3.2 * detectorScale,
    )
    detectorMaterial.emissiveIntensity = theme === 'night'
      ? projection.detector.active ? 0.62 + pulse * 0.38 : 0.22
      : 0
    detector.userData.active = projection.detector.active
    detector.userData.state = projection.detector.state
    detector.userData.leaderStoreId = projection.detector.leaderStoreId
    detectorAnchor.position.x = x
    detectorAnchor.userData.scope = projection.detector.scope
    detectorAnchor.userData.leaderStoreId = projection.detector.leaderStoreId
    detectorAnchor.userData.state = projection.detector.state

    const historyVisible = projection.deadlock.visible
    const historyPulse = projection.reducedMotion ? 1 : 1 + pulse * 0.24
    deadlockHistory.visible = historyVisible
    deadlockHistory.position.set(0, 8, -4)
    deadlockHistory.scale.setScalar(9 * historyPulse)
    deadlockHistory.userData.deadlockId = projection.deadlock.id
    deadlockHistory.userData.resolution = projection.deadlock.resolution
    deadlockHistory.userData.selectionPolicy =
      projection.deadlock.selectionPolicy
    victimMarker.visible =
      historyVisible && projection.deadlock.victimSlot >= 0
    if (projection.deadlock.victimSlot >= 0) {
      const victim =
        projection.deadlock.victimSlot as LockLabTransactionSlot
      victimMarker.position.set(
        TRANSACTION_X[victim],
        GRAPH_Y + 11,
        TRANSACTION_Z[victim],
      )
    }
    victimMarker.scale.set(3.6, 5.5, 3.6)
    victimMarker.userData.victimSlot = projection.deadlock.victimSlot
    victimMarker.userData.resolution = projection.deadlock.resolution

    root.userData.applicationRetry = projection.applicationRetry
    root.userData.detectorScope = projection.detector.scope
    root.userData.detectorLeaderStoreId =
      projection.detector.leaderStoreId

    for (let index = 0; index < instancedMeshes.length; index++) {
      const mesh = instancedMeshes[index]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  setStaticTheme(theme)
  project(EMPTY_LOCK_LAB_PROJECTION)

  let objectCount = 0
  let drawableCount = 0
  let instancedMeshCount = 0
  let instanceCapacity = 0
  root.traverse((object) => {
    objectCount++
    const drawable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    if (drawable.geometry && drawable.material) drawableCount++
    if (object instanceof THREE.InstancedMesh) {
      instancedMeshCount++
      instanceCapacity += object.count
    }
  })

  const resources: LockLabResourceCounts = Object.freeze({
    objectCount,
    drawableCount,
    geometryCount: ownedGeometries.length,
    materialCount: ownedMaterials.length,
    instancedMeshCount,
    instanceCapacity,
    transactionCapacity: LOCK_LAB_TRANSACTION_CAPACITY,
    resourceCapacity: LOCK_LAB_RESOURCE_CAPACITY,
    holderCapacity: LOCK_LAB_RESOURCE_CAPACITY,
    waitersPerResource: LOCK_LAB_WAITERS_PER_RESOURCE,
    edgeCapacity: LOCK_LAB_EDGE_CAPACITY,
    detectorCapacity: 1,
    deadlockHistoryCapacity: 1,
  })
  const debug: LockLabDebug = Object.freeze({
    resources,
    get disposed(): boolean {
      return disposed
    },
    get updateCount(): number {
      return updateCount
    },
  })

  return {
    object: root,
    transactionAnchors,
    resourceAnchors,
    detectorAnchor,
    debug,
    update(projection: LockLabProjection): void {
      if (disposed) return
      latestProjection = projection
      updateCount++
      project(projection)
    },
    setTheme(next: CityTheme): void {
      if (disposed || next === theme) return
      theme = next
      setStaticTheme(next)
      project(latestProjection)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (let index = 0; index < ownedGeometries.length; index++) {
        ownedGeometries[index].dispose()
      }
      for (let index = 0; index < ownedMaterials.length; index++) {
        ownedMaterials[index].dispose()
      }
      root.clear()
    },
  }
}
