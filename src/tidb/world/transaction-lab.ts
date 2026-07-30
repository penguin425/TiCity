/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * A renderer-only, fixed-capacity cutaway for one detailed two-Region
 * transaction. This module deliberately owns no transaction state: callers
 * project an immutable teaching-model snapshot into the prebuilt geometry.
 */

import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import type { CityTheme } from './palette'

export type TransactionLabMode = 'hidden' | 'overview' | 'inspect'
export type TransactionLabPhase =
  | 'idle'
  | 'locking'
  | 'prewrite'
  | 'commit-primary'
  | 'secondary-cleanup'
  | 'complete'
  | 'failed'
export type TransactionLabKeyRole = 'primary' | 'secondary'
export type TransactionLabMutationState =
  | 'empty'
  | 'buffered'
  | 'prewriting'
  | 'committed'
export type TransactionLabPeerLogState =
  | 'idle'
  | 'appended'
  | 'committed'
  | 'applied'
  | 'unavailable'
export type TransactionLabLockState =
  | 'none'
  | 'pessimistic-memory'
  | 'prewrite'
export type TransactionLabApplyState = 'idle' | 'ready' | 'applied'
export type TransactionLabMvccCellState = 'empty' | 'pending' | 'committed'

export interface TransactionLabMutationProjection {
  readonly keyRole: TransactionLabKeyRole
  readonly state: TransactionLabMutationState
}

export interface TransactionLabPeerProjection {
  readonly storeId: string
  readonly log: TransactionLabPeerLogState
}

export interface TransactionLabMvccProjection {
  readonly lock: TransactionLabMvccCellState
  readonly default: TransactionLabMvccCellState
  readonly write: TransactionLabMvccCellState
}

export interface TransactionLabRegionProjection {
  readonly id: string
  readonly keyRole: TransactionLabKeyRole
  readonly leaderPeer: 0 | 1 | 2
  readonly peers: readonly [
    TransactionLabPeerProjection,
    TransactionLabPeerProjection,
    TransactionLabPeerProjection,
  ]
  /** Number of voter acknowledgements represented by the Region Raft group. */
  readonly quorumAcks: number
  readonly apply: TransactionLabApplyState
  /**
   * `pessimistic-memory` is rendered only above the Region leader. A
   * `prewrite` lock belongs in the conceptual MVCC LOCK cell instead.
   */
  readonly lock: TransactionLabLockState
  readonly mvcc: TransactionLabMvccProjection
}

/**
 * A local renderer contract, intentionally independent of TiCityState and
 * future detailed-transaction model types.
 */
export interface TransactionLabProjection {
  readonly mode: TransactionLabMode
  readonly phase: TransactionLabPhase
  readonly reducedMotion: boolean
  readonly coordinatorActive: boolean
  readonly tso: Readonly<{
    readonly active: boolean
    /** Normalized 0..1 pulse supplied by the renderer teaching clock. */
    readonly pulse: number
  }>
  readonly mutations: readonly [
    TransactionLabMutationProjection,
    TransactionLabMutationProjection,
  ]
  readonly regions: readonly [
    TransactionLabRegionProjection,
    TransactionLabRegionProjection,
  ]
}

export interface TransactionLabResourceCounts {
  readonly objectCount: number
  readonly drawableCount: number
  readonly geometryCount: number
  readonly materialCount: number
  readonly instancedMeshCount: number
  readonly instanceCapacity: number
  readonly regionCapacity: 2
  readonly votersPerRegion: 3
  readonly mutationSlots: 2
  readonly mvccCells: 6
}

export interface TransactionLabDebug {
  readonly resources: TransactionLabResourceCounts
  readonly disposed: boolean
  readonly updateCount: number
}

export interface TransactionLab {
  readonly object: THREE.Group
  /** Empty Object3D anchors; a later label system can attach DOM labels. */
  readonly labelAnchors: readonly [THREE.Object3D, THREE.Object3D]
  readonly debug: TransactionLabDebug
  update(projection: TransactionLabProjection): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface TransactionLabOptions {
  readonly theme?: CityTheme
}

const REGION_COUNT = 2
const VOTERS_PER_REGION = 3
const PEER_COUNT = REGION_COUNT * VOTERS_PER_REGION
const REGION_X = [-38, 38] as const
const PEER_X = [-15, 0, 15] as const
const MUTATION_X = [-51, -37] as const
const MVCC_X = [-12, 0, 12] as const
const REGION_Z = 24
const PEER_Z = 12
const MVCC_Z = 38
const LABEL_Z = 51
const TSO_RING_RADIUS = 7

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _color = new THREE.Color()
const _identityRotation = new THREE.Quaternion()
const _horizontalRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
)

const IDLE_PEERS = Object.freeze([
  Object.freeze({ storeId: 'tikv-1', log: 'idle' as const }),
  Object.freeze({ storeId: 'tikv-2', log: 'idle' as const }),
  Object.freeze({ storeId: 'tikv-3', log: 'idle' as const }),
] as const)
const EMPTY_MVCC = Object.freeze({
  lock: 'empty' as const,
  default: 'empty' as const,
  write: 'empty' as const,
})
export const EMPTY_TRANSACTION_LAB_PROJECTION: TransactionLabProjection = Object.freeze({
  mode: 'hidden',
  phase: 'idle',
  reducedMotion: false,
  coordinatorActive: false,
  tso: Object.freeze({ active: false, pulse: 0 }),
  mutations: Object.freeze([
    Object.freeze({ keyRole: 'primary' as const, state: 'empty' as const }),
    Object.freeze({ keyRole: 'secondary' as const, state: 'empty' as const }),
  ] as const),
  regions: Object.freeze([
    Object.freeze({
      id: 'region-a',
      keyRole: 'primary' as const,
      leaderPeer: 0 as const,
      peers: IDLE_PEERS,
      quorumAcks: 0,
      apply: 'idle' as const,
      lock: 'none' as const,
      mvcc: EMPTY_MVCC,
    }),
    Object.freeze({
      id: 'region-b',
      keyRole: 'secondary' as const,
      leaderPeer: 1 as const,
      peers: IDLE_PEERS,
      quorumAcks: 0,
      apply: 'idle' as const,
      lock: 'none' as const,
      mvcc: EMPTY_MVCC,
    }),
  ] as const),
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

function peerHeight(state: TransactionLabPeerLogState): number {
  switch (state) {
    case 'appended':
      return 7
    case 'committed':
      return 9
    case 'applied':
      return 11
    case 'unavailable':
      return 3
    case 'idle':
      return 5
  }
}

function peerColor(state: TransactionLabPeerLogState, theme: CityTheme): number {
  switch (state) {
    case 'appended':
    case 'committed':
      return SEMANTIC_COLORS[theme].raft
    case 'applied':
      return SEMANTIC_COLORS[theme].kv
    case 'unavailable':
      return SEMANTIC_COLORS[theme].fault
    case 'idle':
      return theme === 'night' ? 0x526679 : 0x82939f
  }
}

function mutationColor(state: TransactionLabMutationState, theme: CityTheme): number {
  switch (state) {
    case 'buffered':
      return SEMANTIC_COLORS[theme].sql
    case 'prewriting':
      return SEMANTIC_COLORS[theme].txn2pc
    case 'committed':
      return SEMANTIC_COLORS[theme].kv
    case 'empty':
      return theme === 'night' ? 0x405466 : 0x91a0aa
  }
}

function mvccColor(
  column: 0 | 1 | 2,
  state: TransactionLabMvccCellState,
  theme: CityTheme,
): number {
  if (state === 'empty') return theme === 'night' ? 0x3a4d5e : 0x9aa8b0
  if (column === 0) return SEMANTIC_COLORS[theme].txn2pc
  if (column === 1) return SEMANTIC_COLORS[theme].sql
  return SEMANTIC_COLORS[theme].kv
}

function applyColor(state: TransactionLabApplyState, theme: CityTheme): number {
  if (state === 'applied') return SEMANTIC_COLORS[theme].kv
  if (state === 'ready') return SEMANTIC_COLORS[theme].raft
  return theme === 'night' ? 0x415668 : 0x8a9aa5
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

function lineGeometry(positions: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  )
  return geometry
}

export function createTransactionLab(
  options: TransactionLabOptions = {},
): TransactionLab {
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
  const torusGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.16, 8, 24))
  const coneGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 3))
  const secondaryGeometry = ownGeometry(new THREE.OctahedronGeometry(1, 0))
  const twoPcGeometry = ownGeometry(lineGeometry([
    -44, 20, -24, 0, 23, -5,
    0, 23, -5, -38, 23, 5,
    0, 23, -5, 38, 23, 5,
  ]))
  const raftGeometry = ownGeometry(lineGeometry([
    -53, 12, PEER_Z, -38, 12, PEER_Z,
    -38, 12, PEER_Z, -23, 12, PEER_Z,
    23, 12, PEER_Z, 38, 12, PEER_Z,
    38, 12, PEER_Z, 53, 12, PEER_Z,
  ]))

  const structureMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x334f68,
    roughness: 0.76,
    metalness: 0.18,
  }))
  structureMaterial.name = 'transaction-lab:structure'
  const deckMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x1d3145,
    roughness: 0.88,
    metalness: 0.12,
  }))
  deckMaterial.name = 'transaction-lab:deck'
  const sqlMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.sql,
    emissive: SEMANTIC_COLORS.night.sql,
    emissiveIntensity: 0.38,
    roughness: 0.48,
    metalness: 0.28,
  }))
  sqlMaterial.name = 'transaction-lab:sql'
  const tsoMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.tso,
    emissive: SEMANTIC_COLORS.night.tso,
    emissiveIntensity: 0.5,
    roughness: 0.4,
    metalness: 0.32,
  }))
  tsoMaterial.name = 'transaction-lab:tso'
  const tsoPulseMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    color: SEMANTIC_COLORS.night.tso,
    transparent: true,
    opacity: 0.18,
    toneMapped: false,
  }))
  tsoPulseMaterial.name = 'transaction-lab:tso-pulse'
  const transactionMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.txn2pc,
    emissive: SEMANTIC_COLORS.night.txn2pc,
    emissiveIntensity: 0.42,
    roughness: 0.42,
    metalness: 0.28,
  }))
  transactionMaterial.name = 'transaction-lab:2pc'
  const semanticInstanceMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: 0x162331,
    emissiveIntensity: 0.35,
    roughness: 0.58,
    metalness: 0.22,
  }))
  semanticInstanceMaterial.name = 'transaction-lab:semantic-instances'
  const primaryMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.txn2pc,
    emissive: SEMANTIC_COLORS.night.txn2pc,
    emissiveIntensity: 0.55,
    roughness: 0.36,
    metalness: 0.34,
  }))
  primaryMaterial.name = 'transaction-lab:primary'
  const secondaryMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.sql,
    emissive: SEMANTIC_COLORS.night.sql,
    emissiveIntensity: 0.45,
    roughness: 0.5,
    metalness: 0.2,
  }))
  secondaryMaterial.name = 'transaction-lab:secondary'
  const twoPcMaterial = ownMaterial(new THREE.LineBasicMaterial({
    color: SEMANTIC_COLORS.night.txn2pc,
    transparent: true,
    opacity: 0.14,
    toneMapped: false,
  }))
  twoPcMaterial.name = 'transaction-lab:2pc-route'
  const raftMaterial = ownMaterial(new THREE.LineBasicMaterial({
    color: SEMANTIC_COLORS.night.raft,
    transparent: true,
    opacity: 0.18,
    toneMapped: false,
  }))
  raftMaterial.name = 'transaction-lab:raft-route'

  const root = new THREE.Group()
  root.name = 'transaction-lab'
  root.userData.kind = 'transaction-lab'
  root.userData.provenance = 'MODEL / SIMULATED'

  const overviewRoot = new THREE.Group()
  overviewRoot.name = 'transaction-lab:overview'
  const detailRoot = new THREE.Group()
  detailRoot.name = 'transaction-lab:inspect'
  root.add(overviewRoot, detailRoot)

  function fixedBox(
    parent: THREE.Object3D,
    name: string,
    position: readonly [number, number, number],
    size: readonly [number, number, number],
    material: THREE.Material,
    domain: string,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(boxGeometry, material)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    mesh.scale.set(size[0], size[1], size[2])
    mesh.userData.domain = domain
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  function fixedCylinder(
    parent: THREE.Object3D,
    name: string,
    position: readonly [number, number, number],
    scale: readonly [number, number, number],
    material: THREE.Material,
    domain: string,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(cylinderGeometry, material)
    mesh.name = name
    mesh.position.set(position[0], position[1], position[2])
    mesh.scale.set(scale[0], scale[1], scale[2])
    mesh.userData.domain = domain
    parent.add(mesh)
    return mesh
  }

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
    parent.add(mesh)
    return mesh
  }

  /* Overview silhouettes remain readable while the internal layers are off. */
  fixedBox(
    overviewRoot,
    'transaction-lab:coordinator-deck',
    [-44, 2, -36],
    [42, 4, 30],
    deckMaterial,
    'sql',
  )
  fixedBox(
    overviewRoot,
    'transaction-lab:coordinator',
    [-44, 11, -36],
    [28, 14, 20],
    structureMaterial,
    'sql',
  )
  fixedBox(
    overviewRoot,
    'transaction-lab:coordinator-buffer',
    [-44, 19, -36],
    [32, 2, 24],
    sqlMaterial,
    'sql',
  )
  fixedCylinder(
    overviewRoot,
    'transaction-lab:pd-base',
    [44, 3, -36],
    [13, 5, 13],
    deckMaterial,
    'tso',
  )
  fixedCylinder(
    overviewRoot,
    'transaction-lab:pd-tso',
    [44, 13, -36],
    [7, 16, 7],
    tsoMaterial,
    'tso',
  )
  const tsoRing = new THREE.Mesh(torusGeometry, tsoPulseMaterial)
  tsoRing.name = 'transaction-lab:tso-pulse'
  tsoRing.position.set(44, 22, -36)
  tsoRing.quaternion.copy(_horizontalRotation)
  tsoRing.userData.domain = 'tso'
  overviewRoot.add(tsoRing)

  for (let region = 0; region < REGION_COUNT; region++) {
    const deck = fixedBox(
      overviewRoot,
      `transaction-lab:region-deck:${region}`,
      [REGION_X[region], 2, REGION_Z],
      [66, 4, 50],
      deckMaterial,
      'kv',
    )
    deck.userData.regionSlot = region
  }

  const twoPcRoute = new THREE.LineSegments(twoPcGeometry, twoPcMaterial)
  twoPcRoute.name = 'transaction-lab:2pc-route'
  twoPcRoute.userData.domain = 'txn2pc'
  overviewRoot.add(twoPcRoute)

  const raftRoute = new THREE.LineSegments(raftGeometry, raftMaterial)
  raftRoute.name = 'transaction-lab:raft-route'
  raftRoute.userData.domain = 'raft'
  detailRoot.add(raftRoute)
  fixedBox(
    detailRoot,
    'transaction-lab:2pc-dispatch',
    [0, 23, -5],
    [14, 2, 8],
    transactionMaterial,
    'txn2pc',
  )

  const mutationSlots = instances(
    detailRoot,
    'transaction-lab:mutation-slots',
    boxGeometry,
    semanticInstanceMaterial,
    2,
    'sql',
  )
  mutationSlots.userData.capacity = 2

  const peerLogs = instances(
    detailRoot,
    'transaction-lab:raft-voters',
    boxGeometry,
    semanticInstanceMaterial,
    PEER_COUNT,
    'raft',
  )
  peerLogs.userData.regionCapacity = REGION_COUNT
  peerLogs.userData.votersPerRegion = VOTERS_PER_REGION

  const leaderCrowns = instances(
    detailRoot,
    'transaction-lab:raft-leaders',
    coneGeometry,
    semanticInstanceMaterial,
    PEER_COUNT,
    'raft',
  )
  const memoryLocks = instances(
    detailRoot,
    'transaction-lab:leader-memory-locks',
    torusGeometry,
    semanticInstanceMaterial,
    PEER_COUNT,
    'txn2pc',
  )
  memoryLocks.userData.leaderOnly = true

  const quorumIndicators = instances(
    detailRoot,
    'transaction-lab:quorum-indicators',
    torusGeometry,
    semanticInstanceMaterial,
    REGION_COUNT,
    'raft',
  )
  const quorumAcks = new Uint8Array(REGION_COUNT)
  quorumIndicators.userData.acknowledgements = quorumAcks
  quorumIndicators.userData.required = 2
  quorumIndicators.userData.votersPerRegion = VOTERS_PER_REGION

  const applyIndicators = instances(
    detailRoot,
    'transaction-lab:apply-indicators',
    cylinderGeometry,
    semanticInstanceMaterial,
    REGION_COUNT,
    'kv',
  )
  const applyStates = new Uint8Array(REGION_COUNT)
  applyIndicators.userData.states = applyStates

  const mvccCells = instances(
    detailRoot,
    'transaction-lab:mvcc-cells',
    boxGeometry,
    semanticInstanceMaterial,
    REGION_COUNT * 3,
    'kv',
  )
  mvccCells.userData.columns = Object.freeze(['LOCK', 'DEFAULT', 'WRITE'])
  mvccCells.userData.cellsPerRegion = 3

  const primaryMarkers = instances(
    detailRoot,
    'transaction-lab:primary-markers',
    coneGeometry,
    primaryMaterial,
    REGION_COUNT,
    'txn2pc',
  )
  primaryMarkers.userData.shape = 'triangular-crown'
  const secondaryMarkers = instances(
    detailRoot,
    'transaction-lab:secondary-markers',
    secondaryGeometry,
    secondaryMaterial,
    REGION_COUNT,
    'txn2pc',
  )
  secondaryMarkers.userData.shape = 'diamond'

  const labelAnchorsMutable: [THREE.Object3D, THREE.Object3D] = [
    new THREE.Object3D(),
    new THREE.Object3D(),
  ]
  const labelRegionIds = ['', '']
  const labelRoles: TransactionLabKeyRole[] = ['primary', 'secondary']
  for (let region = 0; region < REGION_COUNT; region++) {
    const anchor = labelAnchorsMutable[region]
    anchor.name = `transaction-lab:label-anchor:${region}`
    anchor.position.set(REGION_X[region], 27, LABEL_Z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    detailRoot.add(anchor)
  }
  const labelAnchors = Object.freeze(labelAnchorsMutable)

  const instancedMeshes = [
    mutationSlots,
    peerLogs,
    leaderCrowns,
    memoryLocks,
    quorumIndicators,
    applyIndicators,
    mvccCells,
    primaryMarkers,
    secondaryMarkers,
  ] as const

  let disposed = false
  let updateCount = 0
  let theme: CityTheme = options.theme ?? 'night'
  let latestProjection: TransactionLabProjection = EMPTY_TRANSACTION_LAB_PROJECTION

  function setStaticTheme(next: CityTheme): void {
    const night = next === 'night'
    structureMaterial.color.setHex(night ? 0x334f68 : 0xcbd7dd)
    structureMaterial.emissive.setHex(0x000000)
    deckMaterial.color.setHex(night ? 0x1d3145 : 0x8c9ca7)
    deckMaterial.emissive.setHex(0x000000)
    configureSemanticMaterial(
      sqlMaterial,
      SEMANTIC_COLORS[next].sql,
      next,
      0.38,
    )
    configureSemanticMaterial(
      tsoMaterial,
      SEMANTIC_COLORS[next].tso,
      next,
      0.5,
    )
    configureSemanticMaterial(
      transactionMaterial,
      SEMANTIC_COLORS[next].txn2pc,
      next,
      0.42,
    )
    configureSemanticMaterial(
      primaryMaterial,
      SEMANTIC_COLORS[next].txn2pc,
      next,
      0.55,
    )
    configureSemanticMaterial(
      secondaryMaterial,
      SEMANTIC_COLORS[next].sql,
      next,
      0.45,
    )
    semanticInstanceMaterial.emissive.setHex(night ? 0x162331 : 0x000000)
    semanticInstanceMaterial.emissiveIntensity = night ? 0.35 : 0
    tsoPulseMaterial.color.setHex(SEMANTIC_COLORS[next].tso)
    twoPcMaterial.color.setHex(SEMANTIC_COLORS[next].txn2pc)
    raftMaterial.color.setHex(SEMANTIC_COLORS[next].raft)
  }

  function project(projection: TransactionLabProjection): void {
    root.visible = projection.mode !== 'hidden'
    overviewRoot.visible = projection.mode !== 'hidden'
    detailRoot.visible = projection.mode === 'inspect'
    root.userData.mode = projection.mode
    root.userData.phase = projection.phase
    root.userData.reducedMotion = projection.reducedMotion

    sqlMaterial.emissiveIntensity = theme === 'night' && projection.coordinatorActive
      ? 0.75
      : theme === 'night' ? 0.22 : 0

    const pulse = clamp(projection.tso.pulse, 0, 1)
    const pulseScale = projection.reducedMotion ? 1 : 1 + pulse * 0.32
    tsoRing.scale.setScalar(TSO_RING_RADIUS * pulseScale)
    tsoPulseMaterial.opacity = projection.tso.active
      ? projection.reducedMotion ? 0.86 : 0.58 + pulse * 0.34
      : 0.16

    const transactionActive = projection.phase !== 'idle'
    twoPcMaterial.opacity = transactionActive
      ? projection.phase === 'failed' ? 0.62 : 0.9
      : 0.14

    for (let mutation = 0; mutation < 2; mutation++) {
      const state = projection.mutations[mutation]
      const height = state.state === 'empty'
        ? 1.2
        : state.state === 'buffered' ? 2.5
          : state.state === 'prewriting' ? 4
            : 3.2
      setInstanceTransform(
        mutationSlots,
        mutation,
        MUTATION_X[mutation],
        20 + height / 2,
        -36,
        5,
        height,
        7,
      )
      setInstanceColor(
        mutationSlots,
        mutation,
        mutationColor(state.state, theme),
        state.keyRole === 'primary' ? 1 : 0.82,
      )
    }

    let raftActive = false
    for (let region = 0; region < REGION_COUNT; region++) {
      const projected = projection.regions[region]
      const centerX = REGION_X[region]
      const acknowledgements = Math.round(clamp(projected.quorumAcks, 0, 3))
      quorumAcks[region] = acknowledgements
      applyStates[region] = projected.apply === 'applied'
        ? 2
        : projected.apply === 'ready' ? 1 : 0

      const anchor = labelAnchorsMutable[region]
      if (labelRegionIds[region] !== projected.id ||
          labelRoles[region] !== projected.keyRole) {
        labelRegionIds[region] = projected.id
        labelRoles[region] = projected.keyRole
        anchor.userData.regionId = projected.id
        anchor.userData.keyRole = projected.keyRole
        anchor.userData.label = projected.keyRole === 'primary'
          ? 'PRIMARY'
          : 'SECONDARY'
      }

      for (let peer = 0; peer < VOTERS_PER_REGION; peer++) {
        const instance = region * VOTERS_PER_REGION + peer
        const peerState = projected.peers[peer]
        const height = peerHeight(peerState.log)
        const peerX = centerX + PEER_X[peer]
        const healthy = peerState.log !== 'unavailable'
        const leader = peer === projected.leaderPeer
        if (peerState.log !== 'idle') raftActive = true

        setInstanceTransform(
          peerLogs,
          instance,
          peerX,
          4 + height / 2,
          PEER_Z,
          8,
          height,
          8,
        )
        setInstanceColor(
          peerLogs,
          instance,
          peerColor(peerState.log, theme),
          leader && healthy ? 1 : healthy ? 0.78 : 1,
        )

        const crownScale = leader && healthy ? 1 : 0
        setInstanceTransform(
          leaderCrowns,
          instance,
          peerX,
          6 + height + crownScale * 2.2,
          PEER_Z,
          3.4 * crownScale,
          4.2 * crownScale,
          3.4 * crownScale,
        )
        setInstanceColor(
          leaderCrowns,
          instance,
          SEMANTIC_COLORS[theme].raft,
        )

        const lockVisible = leader &&
          healthy &&
          projected.lock === 'pessimistic-memory'
        const lockScale = lockVisible ? 4.4 : 0
        setInstanceTransform(
          memoryLocks,
          instance,
          peerX,
          18,
          PEER_Z,
          lockScale,
          lockScale,
          lockScale,
          _horizontalRotation,
        )
        setInstanceColor(
          memoryLocks,
          instance,
          SEMANTIC_COLORS[theme].txn2pc,
        )
      }

      const quorumBrightness = acknowledgements === 0
        ? 0.62
        : acknowledgements >= 2 ? 1 : 0.9
      const quorumColor = acknowledgements === 0
        ? theme === 'night' ? 0x526679 : 0x82939f
        : acknowledgements >= 2
          ? SEMANTIC_COLORS[theme].raft
          : SEMANTIC_COLORS[theme].fault
      setInstanceTransform(
        quorumIndicators,
        region,
        centerX,
        15,
        26,
        5.5,
        5.5,
        5.5,
        _horizontalRotation,
      )
      setInstanceColor(
        quorumIndicators,
        region,
        quorumColor,
        quorumBrightness,
      )

      setInstanceTransform(
        applyIndicators,
        region,
        centerX,
        5.1,
        26,
        5.5,
        1.2,
        5.5,
      )
      setInstanceColor(
        applyIndicators,
        region,
        applyColor(projected.apply, theme),
        projected.apply === 'idle' ? 0.68 : 1,
      )

      for (let column = 0; column < 3; column++) {
        const instance = region * 3 + column
        const cellState = column === 0
          ? projected.mvcc.lock
          : column === 1 ? projected.mvcc.default : projected.mvcc.write
        const height = cellState === 'empty' ? 1.4 : cellState === 'pending' ? 3 : 4.5
        setInstanceTransform(
          mvccCells,
          instance,
          centerX + MVCC_X[column],
          4 + height / 2,
          MVCC_Z,
          9,
          height,
          8,
        )
        setInstanceColor(
          mvccCells,
          instance,
          mvccColor(column as 0 | 1 | 2, cellState, theme),
          cellState === 'empty' ? 0.68 : 1,
        )
      }

      const primaryVisible = projected.keyRole === 'primary' ? 1 : 0
      setInstanceTransform(
        primaryMarkers,
        region,
        centerX,
        11,
        50,
        4.5 * primaryVisible,
        7 * primaryVisible,
        4.5 * primaryVisible,
      )
      const secondaryVisible = projected.keyRole === 'secondary' ? 1 : 0
      setInstanceTransform(
        secondaryMarkers,
        region,
        centerX,
        11,
        50,
        4.2 * secondaryVisible,
        4.2 * secondaryVisible,
        4.2 * secondaryVisible,
      )
    }

    raftMaterial.opacity = raftActive ? 0.82 : 0.18
    for (let index = 0; index < instancedMeshes.length; index++) {
      const mesh = instancedMeshes[index]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  setStaticTheme(theme)
  project(EMPTY_TRANSACTION_LAB_PROJECTION)

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

  const resources: TransactionLabResourceCounts = Object.freeze({
    objectCount,
    drawableCount,
    geometryCount: ownedGeometries.length,
    materialCount: ownedMaterials.length,
    instancedMeshCount,
    instanceCapacity,
    regionCapacity: 2,
    votersPerRegion: 3,
    mutationSlots: 2,
    mvccCells: 6,
  })
  const debug: TransactionLabDebug = Object.freeze({
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
    labelAnchors,
    debug,
    update(projection: TransactionLabProjection): void {
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
