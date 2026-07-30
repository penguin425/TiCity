/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * A renderer-only, fixed-capacity cutaway for one TiKV Region Raft group.
 * The deterministic model owns every transition. This module only paints an
 * immutable event projection into geometry allocated once at construction.
 */

import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import type { CityTheme } from './palette'

export const RAFT_LAB_PEER_CAPACITY = 3 as const
export const RAFT_LAB_LOG_WINDOW_CAPACITY = 3 as const
export const RAFT_LAB_LOG_CELL_CAPACITY = 9 as const
export const RAFT_LAB_ELECTION_EDGE_CAPACITY = 6 as const
export const RAFT_LAB_CLIENT_ROUTE_CAPACITY = 2 as const

export type RaftLabMode = 'hidden' | 'overview' | 'inspect'
export type RaftLabPhase =
  | 'idle'
  | 'baseline'
  | 'store-failure'
  | 'heartbeat-timeout'
  | 'pre-vote'
  | 'election'
  | 'leader-elected'
  | 'client-retry'
  | 'log-replication'
  | 'quorum-commit'
  | 'apply'
  | 'complete'
  | 'unavailable'
export type RaftLabPeerRole =
  | 'follower'
  | 'pre-candidate'
  | 'candidate'
  | 'leader'
export type RaftLabPeerHealth = 'up' | 'down'
export type RaftLabPeerShape =
  | 'ring'
  | 'double-ring'
  | 'diamond'
  | 'crown'
  | 'offline'
export type RaftLabLogCellState =
  | 'absent'
  | 'persisted'
  | 'committed'
  | 'applied'
  | 'unavailable'
export type RaftLabElectionStage = 'prevote' | 'vote'
export type RaftLabElectionEdgeStatus =
  | 'request'
  | 'granted'
  | 'rejected'
  | 'unavailable'
export type RaftLabClientRetryStatus =
  | 'idle'
  | 'failed'
  | 'backoff'
  | 'rerouted'
  | 'succeeded'
export type RaftLabClientRetryReason =
  | 'none'
  | 'transport_error'
  | 'not_leader'
export type RaftLabPdObservationStatus = 'idle' | 'pending' | 'observed'
export type RaftLabPeerSlot = 0 | 1 | 2
export type RaftLabOptionalPeerSlot = -1 | RaftLabPeerSlot

export interface RaftLabLogCellProjection {
  readonly index: number
  readonly term: number
  readonly state: RaftLabLogCellState
}

export interface RaftLabPeerProjection {
  readonly visible: boolean
  readonly storeId: string
  readonly role: RaftLabPeerRole
  readonly health: RaftLabPeerHealth
  readonly shape: RaftLabPeerShape
  readonly term: number
  readonly matchIndex: number
  readonly commitIndex: number
  readonly appliedIndex: number
  readonly votedForStoreId: string | null
  readonly previousLeader: boolean
  readonly log: readonly [
    RaftLabLogCellProjection,
    RaftLabLogCellProjection,
    RaftLabLogCellProjection,
  ]
}

export interface RaftLabElectionEdgeProjection {
  readonly visible: boolean
  readonly id: string
  readonly stage: RaftLabElectionStage
  readonly status: RaftLabElectionEdgeStatus
  readonly fromPeer: RaftLabOptionalPeerSlot
  readonly toPeer: RaftLabOptionalPeerSlot
}

export interface RaftLabQuorumProjection {
  readonly acknowledgements: number
  readonly required: 2
  readonly available: boolean
  readonly committed: boolean
}

/**
 * This is an internal TiDB/TiKV-client request retry. It is deliberately not
 * the application retry represented by Lock Lab.
 */
export interface RaftLabClientRetryProjection {
  readonly visible: boolean
  readonly source: 'tidb_tikv_client'
  readonly internal: true
  readonly attempt: number
  readonly status: RaftLabClientRetryStatus
  readonly reason: RaftLabClientRetryReason
  readonly previousTargetPeer: RaftLabOptionalPeerSlot
  readonly targetPeer: RaftLabOptionalPeerSlot
}

/**
 * PD observes Region heartbeats and metadata; the Raft peers elect the leader.
 */
export interface RaftLabPdObservationProjection {
  readonly visible: boolean
  readonly status: RaftLabPdObservationStatus
  readonly leaderPeer: RaftLabOptionalPeerSlot
  readonly electionAuthority: false
}

export interface RaftLabProjection {
  readonly mode: RaftLabMode
  readonly phase: RaftLabPhase
  readonly reducedMotion: boolean
  /** Normalized 0..1 teaching-clock pulse. */
  readonly pulse: number
  readonly regionId: number
  readonly previousTerm: number
  readonly term: number
  readonly previousLeaderPeer: RaftLabOptionalPeerSlot
  readonly leaderPeer: RaftLabOptionalPeerSlot
  readonly candidatePeer: RaftLabOptionalPeerSlot
  readonly peers: readonly [
    RaftLabPeerProjection,
    RaftLabPeerProjection,
    RaftLabPeerProjection,
  ]
  readonly electionEdges: readonly [
    RaftLabElectionEdgeProjection,
    RaftLabElectionEdgeProjection,
    RaftLabElectionEdgeProjection,
    RaftLabElectionEdgeProjection,
    RaftLabElectionEdgeProjection,
    RaftLabElectionEdgeProjection,
  ]
  readonly quorum: RaftLabQuorumProjection
  readonly clientRetry: RaftLabClientRetryProjection
  readonly pdObservation: RaftLabPdObservationProjection
}

export interface RaftLabResourceCounts {
  readonly objectCount: number
  readonly drawableCount: number
  readonly geometryCount: number
  readonly materialCount: number
  readonly instancedMeshCount: number
  readonly instanceCapacity: number
  readonly peerCapacity: 3
  readonly logWindowCapacity: 3
  readonly logCellCapacity: 9
  readonly electionEdgeCapacity: 6
  readonly clientRouteCapacity: 2
  readonly quorumRequired: 2
  readonly pdObserverCapacity: 1
}

export interface RaftLabDebug {
  readonly resources: RaftLabResourceCounts
  readonly disposed: boolean
  readonly updateCount: number
}

export interface RaftLab {
  readonly object: THREE.Group
  readonly peerAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly clientAnchor: THREE.Object3D
  readonly pdAnchor: THREE.Object3D
  readonly debug: RaftLabDebug
  update(projection: RaftLabProjection): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface RaftLabOptions {
  readonly theme?: CityTheme
}

const PEER_X = [-35, 0, 35] as const
const PEER_Y = 10
const PEER_Z = 7
const LOG_Z = [20, 28, 36] as const
const GRAPH_Y = 25
const CLIENT_X = -45
const CLIENT_Z = -31
const PD_X = 45
const PD_Z = -31

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
const _offlineRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 0, 1),
  Math.PI / 3,
)

function emptyLogCell(): RaftLabLogCellProjection {
  return Object.freeze({
    index: -1,
    term: 0,
    state: 'absent' as const,
  })
}

function emptyPeer(): RaftLabPeerProjection {
  return Object.freeze({
    visible: false,
    storeId: '',
    role: 'follower' as const,
    health: 'up' as const,
    shape: 'ring' as const,
    term: 0,
    matchIndex: 0,
    commitIndex: 0,
    appliedIndex: 0,
    votedForStoreId: null,
    previousLeader: false,
    log: Object.freeze([
      emptyLogCell(),
      emptyLogCell(),
      emptyLogCell(),
    ] as const),
  })
}

function emptyElectionEdge(): RaftLabElectionEdgeProjection {
  return Object.freeze({
    visible: false,
    id: '',
    stage: 'prevote' as const,
    status: 'request' as const,
    fromPeer: -1,
    toPeer: -1,
  })
}

export const EMPTY_RAFT_LAB_PROJECTION: RaftLabProjection = Object.freeze({
  mode: 'hidden',
  phase: 'idle',
  reducedMotion: false,
  pulse: 0,
  regionId: -1,
  previousTerm: 0,
  term: 0,
  previousLeaderPeer: -1,
  leaderPeer: -1,
  candidatePeer: -1,
  peers: Object.freeze([
    emptyPeer(),
    emptyPeer(),
    emptyPeer(),
  ] as const),
  electionEdges: Object.freeze([
    emptyElectionEdge(),
    emptyElectionEdge(),
    emptyElectionEdge(),
    emptyElectionEdge(),
    emptyElectionEdge(),
    emptyElectionEdge(),
  ] as const),
  quorum: Object.freeze({
    acknowledgements: 0,
    required: 2 as const,
    available: false,
    committed: false,
  }),
  clientRetry: Object.freeze({
    visible: false,
    source: 'tidb_tikv_client' as const,
    internal: true as const,
    attempt: 0,
    status: 'idle' as const,
    reason: 'none' as const,
    previousTargetPeer: -1,
    targetPeer: -1,
  }),
  pdObservation: Object.freeze({
    visible: false,
    status: 'idle' as const,
    leaderPeer: -1,
    electionAuthority: false as const,
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

function peerPosition(slot: number, target: THREE.Vector3, y = GRAPH_Y): void {
  if (slot < 0 || slot >= RAFT_LAB_PEER_CAPACITY) {
    target.set(0, 0, 0)
    return
  }
  target.set(PEER_X[slot], y, PEER_Z)
}

function logStateCode(state: RaftLabLogCellState): number {
  switch (state) {
    case 'absent':
      return 0
    case 'persisted':
      return 1
    case 'committed':
      return 2
    case 'applied':
      return 3
    case 'unavailable':
      return 4
  }
}

function edgeStageCode(stage: RaftLabElectionStage): number {
  return stage === 'prevote' ? 1 : 2
}

function edgeStatusCode(status: RaftLabElectionEdgeStatus): number {
  switch (status) {
    case 'request':
      return 1
    case 'granted':
      return 2
    case 'rejected':
      return 3
    case 'unavailable':
      return 4
  }
}

function logStateColor(state: RaftLabLogCellState, theme: CityTheme): number {
  switch (state) {
    case 'persisted':
      return SEMANTIC_COLORS[theme].raft
    case 'committed':
      return SEMANTIC_COLORS[theme].tso
    case 'applied':
      return SEMANTIC_COLORS[theme].kv
    case 'unavailable':
      return SEMANTIC_COLORS[theme].fault
    case 'absent':
      return SEMANTIC_COLORS[theme].structure
  }
}

function logStateHeight(state: RaftLabLogCellState): number {
  switch (state) {
    case 'absent':
      return 0.45
    case 'persisted':
      return 1.15
    case 'committed':
      return 1.7
    case 'applied':
      return 2.25
    case 'unavailable':
      return 0.25
  }
}

function edgeColor(
  edge: RaftLabElectionEdgeProjection,
  theme: CityTheme,
): number {
  if (edge.status === 'rejected' || edge.status === 'unavailable') {
    return SEMANTIC_COLORS[theme].fault
  }
  return edge.stage === 'prevote'
    ? SEMANTIC_COLORS[theme].tso
    : SEMANTIC_COLORS[theme].raft
}

export function createRaftLab(options: RaftLabOptions = {}): RaftLab {
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
  const torusGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.18, 8, 24))
  const diamondGeometry = ownGeometry(new THREE.OctahedronGeometry(1, 0))
  const coneGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 6))

  const structureMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x334f68,
    roughness: 0.74,
    metalness: 0.18,
  }))
  structureMaterial.name = 'raft-lab:structure'
  const deckMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x1d3145,
    roughness: 0.9,
    metalness: 0.1,
  }))
  deckMaterial.name = 'raft-lab:deck'
  const semanticMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  }))
  semanticMaterial.name = 'raft-lab:semantic-instances'
  const edgeMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  }))
  edgeMaterial.name = 'raft-lab:election-edges'
  const raftMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.raft,
    emissive: SEMANTIC_COLORS.night.raft,
    emissiveIntensity: 0.56,
    roughness: 0.38,
    metalness: 0.3,
  }))
  raftMaterial.name = 'raft-lab:raft'
  const clientMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.client,
    emissive: SEMANTIC_COLORS.night.client,
    emissiveIntensity: 0.5,
    roughness: 0.44,
    metalness: 0.25,
  }))
  clientMaterial.name = 'raft-lab:tidb-client'
  const pdMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night.tso,
    emissive: SEMANTIC_COLORS.night.tso,
    emissiveIntensity: 0.46,
    roughness: 0.46,
    metalness: 0.28,
  }))
  pdMaterial.name = 'raft-lab:pd-observer'
  const root = new THREE.Group()
  root.name = 'raft-lab'
  root.userData.kind = 'raft-lab'
  root.userData.provenance = 'MODEL / SIMULATED'
  root.userData.boundary =
    'Region peers elect; PD only observes Region heartbeats and metadata.'
  root.userData.capacities = Object.freeze({
    peers: RAFT_LAB_PEER_CAPACITY,
    logWindow: RAFT_LAB_LOG_WINDOW_CAPACITY,
    logCells: RAFT_LAB_LOG_CELL_CAPACITY,
    electionEdges: RAFT_LAB_ELECTION_EDGE_CAPACITY,
    clientRoutes: RAFT_LAB_CLIENT_ROUTE_CAPACITY,
    quorumRequired: 2,
    pdObservers: 1,
  })

  const overviewRoot = new THREE.Group()
  overviewRoot.name = 'raft-lab:overview'
  const detailRoot = new THREE.Group()
  detailRoot.name = 'raft-lab:inspect'
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
    /*
     * Allocate instanceColor before the first render. Role meshes start
     * hidden and become active later; a late-created attribute can otherwise
     * retain a shader variant that does not consume per-instance colors.
     */
    _color.setHex(0xffffff)
    for (let index = 0; index < count; index++) {
      mesh.setColorAt(index, _color)
    }
    parent.add(mesh)
    return mesh
  }

  const base = new THREE.Mesh(boxGeometry, deckMaterial)
  base.name = 'raft-lab:base'
  base.position.set(0, 1, 3)
  base.scale.set(112, 2, 88)
  base.receiveShadow = true
  overviewRoot.add(base)

  const peerDecks = instances(
    overviewRoot,
    'raft-lab:peer-decks',
    boxGeometry,
    structureMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  const peerBodies = instances(
    overviewRoot,
    'raft-lab:peer-bodies',
    boxGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  const followerRings = instances(
    overviewRoot,
    'raft-lab:follower-rings',
    torusGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  followerRings.userData.shape = 'ring'
  const preCandidateRings = instances(
    overviewRoot,
    'raft-lab:pre-candidate-rings',
    torusGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY * 2,
    'raft',
  )
  preCandidateRings.userData.shape = 'double-ring'
  const candidateDiamonds = instances(
    overviewRoot,
    'raft-lab:candidate-diamonds',
    diamondGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  candidateDiamonds.userData.shape = 'diamond'
  const leaderCrowns = instances(
    overviewRoot,
    'raft-lab:leader-crowns',
    coneGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  leaderCrowns.userData.shape = 'crown'
  const offlineMarkers = instances(
    overviewRoot,
    'raft-lab:offline-markers',
    boxGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'fault',
  )
  offlineMarkers.userData.shape = 'offline'
  const termBeacons = instances(
    detailRoot,
    'raft-lab:term-beacons',
    cylinderGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  const logCells = instances(
    detailRoot,
    'raft-lab:log-cells',
    boxGeometry,
    semanticMaterial,
    RAFT_LAB_LOG_CELL_CAPACITY,
    'raft',
  )
  logCells.userData.columns = Object.freeze(['N-1', 'N', 'N+1'])
  const commitMarkers = instances(
    detailRoot,
    'raft-lab:commit-markers',
    torusGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  const applyPads = instances(
    detailRoot,
    'raft-lab:apply-pads',
    boxGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'kv',
  )
  const electionEdges = instances(
    detailRoot,
    'raft-lab:election-edges',
    cylinderGeometry,
    edgeMaterial,
    RAFT_LAB_ELECTION_EDGE_CAPACITY,
    'raft',
  )
  const electionArrowheads = instances(
    detailRoot,
    'raft-lab:election-arrowheads',
    coneGeometry,
    edgeMaterial,
    RAFT_LAB_ELECTION_EDGE_CAPACITY,
    'raft',
  )
  const quorumVotes = instances(
    detailRoot,
    'raft-lab:quorum-votes',
    boxGeometry,
    semanticMaterial,
    RAFT_LAB_PEER_CAPACITY,
    'raft',
  )
  quorumVotes.userData.required = 2

  const quorumRing = new THREE.Mesh(torusGeometry, raftMaterial)
  quorumRing.name = 'raft-lab:quorum-ring'
  quorumRing.position.set(0, 7, -9)
  quorumRing.quaternion.copy(_horizontalRotation)
  quorumRing.userData.required = 2
  detailRoot.add(quorumRing)

  const clientGateway = new THREE.Mesh(boxGeometry, clientMaterial)
  clientGateway.name = 'raft-lab:tidb-client'
  clientGateway.position.set(CLIENT_X, 8, CLIENT_Z)
  clientGateway.scale.set(18, 12, 13)
  clientGateway.userData.source = 'tidb_tikv_client'
  clientGateway.userData.internalRetry = true
  overviewRoot.add(clientGateway)

  const clientRoutes = instances(
    detailRoot,
    'raft-lab:client-retry-routes',
    cylinderGeometry,
    edgeMaterial,
    RAFT_LAB_CLIENT_ROUTE_CAPACITY,
    'client',
  )
  const clientRouteHeads = instances(
    detailRoot,
    'raft-lab:client-retry-arrowheads',
    coneGeometry,
    edgeMaterial,
    RAFT_LAB_CLIENT_ROUTE_CAPACITY,
    'client',
  )
  clientRoutes.userData.boundary = 'internal TiDB/TiKV-client retry'

  const pdObserver = new THREE.Mesh(cylinderGeometry, pdMaterial)
  pdObserver.name = 'raft-lab:pd-observer'
  pdObserver.position.set(PD_X, 8, PD_Z)
  pdObserver.scale.set(7, 10, 7)
  pdObserver.userData.electionAuthority = false
  pdObserver.userData.role = 'observes Region heartbeat and metadata'
  overviewRoot.add(pdObserver)
  const pdCrown = new THREE.Mesh(coneGeometry, pdMaterial)
  pdCrown.name = 'raft-lab:pd-observer-beacon'
  pdCrown.position.set(PD_X, 17, PD_Z)
  pdCrown.scale.set(4, 5, 4)
  pdCrown.userData.electionAuthority = false
  overviewRoot.add(pdCrown)
  const pdRoute = instances(
    detailRoot,
    'raft-lab:pd-observation-route',
    cylinderGeometry,
    edgeMaterial,
    1,
    'tso',
  )
  const pdRouteHead = instances(
    detailRoot,
    'raft-lab:pd-observation-arrowhead',
    coneGeometry,
    edgeMaterial,
    1,
    'tso',
  )
  pdRoute.userData.direction = 'region-leader-to-pd-observer'
  pdRoute.userData.electionAuthority = false

  const peerAnchorsMutable: [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ] = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()]
  const peerStoreIds = ['', '', '']
  const peerRoles: RaftLabPeerRole[] = [
    'follower',
    'follower',
    'follower',
  ]
  const peerHealth: RaftLabPeerHealth[] = ['up', 'up', 'up']
  const peerTerms = new Int32Array(RAFT_LAB_PEER_CAPACITY)
  const peerMatchIndices = new Int32Array(RAFT_LAB_PEER_CAPACITY)
  const peerCommitIndices = new Int32Array(RAFT_LAB_PEER_CAPACITY)
  const peerAppliedIndices = new Int32Array(RAFT_LAB_PEER_CAPACITY)
  for (let slot = 0; slot < RAFT_LAB_PEER_CAPACITY; slot++) {
    const anchor = peerAnchorsMutable[slot]
    anchor.name = `raft-lab:peer-anchor:${slot}`
    anchor.position.set(PEER_X[slot], 30, PEER_Z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    overviewRoot.add(anchor)
  }
  const peerAnchors = Object.freeze(peerAnchorsMutable)

  const clientAnchor = new THREE.Object3D()
  clientAnchor.name = 'raft-lab:client-anchor'
  clientAnchor.position.set(CLIENT_X, 22, CLIENT_Z)
  clientAnchor.userData.source = 'tidb_tikv_client'
  clientAnchor.userData.internalRetry = true
  overviewRoot.add(clientAnchor)

  const pdAnchor = new THREE.Object3D()
  pdAnchor.name = 'raft-lab:pd-anchor'
  pdAnchor.position.set(PD_X, 24, PD_Z)
  pdAnchor.userData.electionAuthority = false
  overviewRoot.add(pdAnchor)

  const logIndices = new Int32Array(RAFT_LAB_LOG_CELL_CAPACITY)
  const logTerms = new Int32Array(RAFT_LAB_LOG_CELL_CAPACITY)
  const logStates = new Uint8Array(RAFT_LAB_LOG_CELL_CAPACITY)
  const edgeStages = new Uint8Array(RAFT_LAB_ELECTION_EDGE_CAPACITY)
  const edgeStatuses = new Uint8Array(RAFT_LAB_ELECTION_EDGE_CAPACITY)
  const edgeIds = ['', '', '', '', '', '']
  const quorumAcknowledgements = new Uint8Array(1)

  peerBodies.userData.storeIds = peerStoreIds
  peerBodies.userData.roles = peerRoles
  peerBodies.userData.health = peerHealth
  peerBodies.userData.terms = peerTerms
  peerBodies.userData.matchIndices = peerMatchIndices
  peerBodies.userData.commitIndices = peerCommitIndices
  peerBodies.userData.appliedIndices = peerAppliedIndices
  logCells.userData.indices = logIndices
  logCells.userData.terms = logTerms
  logCells.userData.states = logStates
  electionEdges.userData.edgeIds = edgeIds
  electionEdges.userData.stages = edgeStages
  electionEdges.userData.statuses = edgeStatuses
  quorumRing.userData.acknowledgements = quorumAcknowledgements

  const instancedMeshes = [
    peerDecks,
    peerBodies,
    followerRings,
    preCandidateRings,
    candidateDiamonds,
    leaderCrowns,
    offlineMarkers,
    termBeacons,
    logCells,
    commitMarkers,
    applyPads,
    electionEdges,
    electionArrowheads,
    quorumVotes,
    clientRoutes,
    clientRouteHeads,
    pdRoute,
    pdRouteHead,
  ] as const

  let disposed = false
  let updateCount = 0
  let theme: CityTheme = options.theme ?? 'night'
  let latestProjection: RaftLabProjection = EMPTY_RAFT_LAB_PROJECTION

  function setStaticTheme(next: CityTheme): void {
    const night = next === 'night'
    structureMaterial.color.setHex(night ? 0x334f68 : 0xcbd7dd)
    structureMaterial.emissive.setHex(0x000000)
    deckMaterial.color.setHex(night ? 0x1d3145 : 0x8c9ca7)
    deckMaterial.emissive.setHex(0x000000)
    configureSemanticMaterial(
      raftMaterial,
      SEMANTIC_COLORS[next].raft,
      next,
      0.56,
    )
    configureSemanticMaterial(
      clientMaterial,
      SEMANTIC_COLORS[next].client,
      next,
      0.5,
    )
    configureSemanticMaterial(
      pdMaterial,
      SEMANTIC_COLORS[next].tso,
      next,
      0.46,
    )
  }

  function hideRoleShapes(slot: number): void {
    setInstanceTransform(followerRings, slot, 0, 0, 0, 0, 0, 0)
    setInstanceTransform(
      preCandidateRings,
      slot * 2,
      0,
      0,
      0,
      0,
      0,
      0,
    )
    setInstanceTransform(
      preCandidateRings,
      slot * 2 + 1,
      0,
      0,
      0,
      0,
      0,
      0,
    )
    setInstanceTransform(candidateDiamonds, slot, 0, 0, 0, 0, 0, 0)
    setInstanceTransform(leaderCrowns, slot, 0, 0, 0, 0, 0, 0)
    setInstanceTransform(offlineMarkers, slot, 0, 0, 0, 0, 0, 0)
  }

  function showRoleShape(peer: RaftLabPeerProjection, slot: number): void {
    hideRoleShapes(slot)
    if (!peer.visible) return
    const x = PEER_X[slot]
    const raft = SEMANTIC_COLORS[theme].raft
    const fault = SEMANTIC_COLORS[theme].fault
    if (peer.health === 'down' || peer.shape === 'offline') {
      setInstanceTransform(
        offlineMarkers,
        slot,
        x,
        PEER_Y + 4,
        PEER_Z,
        8,
        3,
        8,
        _offlineRotation,
      )
      setInstanceColor(offlineMarkers, slot, fault)
      return
    }
    if (peer.shape === 'double-ring' || peer.role === 'pre-candidate') {
      setInstanceTransform(
        preCandidateRings,
        slot * 2,
        x,
        PEER_Y + 8,
        PEER_Z,
        5.2,
        5.2,
        5.2,
        _horizontalRotation,
      )
      setInstanceTransform(
        preCandidateRings,
        slot * 2 + 1,
        x,
        PEER_Y + 10,
        PEER_Z,
        3.6,
        3.6,
        3.6,
        _horizontalRotation,
      )
      setInstanceColor(preCandidateRings, slot * 2, SEMANTIC_COLORS[theme].tso)
      setInstanceColor(
        preCandidateRings,
        slot * 2 + 1,
        SEMANTIC_COLORS[theme].tso,
      )
      return
    }
    if (peer.shape === 'diamond' || peer.role === 'candidate') {
      setInstanceTransform(
        candidateDiamonds,
        slot,
        x,
        PEER_Y + 9,
        PEER_Z,
        5.4,
        5.4,
        5.4,
      )
      setInstanceColor(candidateDiamonds, slot, raft)
      return
    }
    if (peer.shape === 'crown' || peer.role === 'leader') {
      setInstanceTransform(
        leaderCrowns,
        slot,
        x,
        PEER_Y + 10,
        PEER_Z,
        5.2,
        6.5,
        5.2,
      )
      setInstanceColor(leaderCrowns, slot, raft)
      return
    }
    setInstanceTransform(
      followerRings,
      slot,
      x,
      PEER_Y + 8,
      PEER_Z,
      4.6,
      4.6,
      4.6,
      _horizontalRotation,
    )
    setInstanceColor(followerRings, slot, SEMANTIC_COLORS[theme].kv, 0.78)
  }

  function hideDirectedEdge(
    shafts: THREE.InstancedMesh,
    heads: THREE.InstancedMesh,
    index: number,
  ): void {
    setInstanceTransform(shafts, index, 0, 0, 0, 0, 0, 0)
    setInstanceTransform(heads, index, 0, 0, 0, 0, 0, 0)
  }

  function setDirectedSegment(
    shafts: THREE.InstancedMesh,
    heads: THREE.InstancedMesh,
    index: number,
    start: THREE.Vector3,
    end: THREE.Vector3,
    color: number,
    thickness: number,
    offset: number,
  ): void {
    _edgeDirection.subVectors(end, start)
    const totalLength = _edgeDirection.length()
    if (totalLength <= 8) {
      hideDirectedEdge(shafts, heads, index)
      return
    }
    _edgeDirection.multiplyScalar(1 / totalLength)
    _edgeOffset.set(
      -_edgeDirection.z * offset,
      index * 0.12,
      _edgeDirection.x * offset,
    )
    start.addScaledVector(_edgeDirection, 5).add(_edgeOffset)
    end.addScaledVector(_edgeDirection, -5).add(_edgeOffset)
    _edgeMidpoint.addVectors(start, end).multiplyScalar(0.5)
    _edgeRotation.setFromUnitVectors(_up, _edgeDirection)
    const length = start.distanceTo(end)
    setInstanceTransform(
      shafts,
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
      heads,
      index,
      end.x,
      end.y,
      end.z,
      thickness * 3.2,
      thickness * 7,
      thickness * 3.2,
      _edgeRotation,
    )
    setInstanceColor(shafts, index, color)
    setInstanceColor(heads, index, color)
  }

  function showElectionEdge(
    edge: RaftLabElectionEdgeProjection,
    index: number,
  ): void {
    if (
      !edge.visible ||
      edge.fromPeer < 0 ||
      edge.toPeer < 0 ||
      edge.fromPeer === edge.toPeer
    ) {
      hideDirectedEdge(electionEdges, electionArrowheads, index)
      return
    }
    peerPosition(edge.fromPeer, _edgeStart)
    peerPosition(edge.toPeer, _edgeEnd)
    const response = edge.status !== 'request'
    if (response) {
      _edgeStart.y += 3
      _edgeEnd.y += 3
    }
    setDirectedSegment(
      electionEdges,
      electionArrowheads,
      index,
      _edgeStart,
      _edgeEnd,
      edgeColor(edge, theme),
      edge.status === 'granted' ? 0.68 : 0.46,
      response ? -2.4 : 2.4,
    )
  }

  function showClientRoute(
    projection: RaftLabProjection,
    route: number,
    target: number,
  ): void {
    if (!projection.clientRetry.visible || target < 0) {
      hideDirectedEdge(clientRoutes, clientRouteHeads, route)
      return
    }
    _edgeStart.set(CLIENT_X, 12 + route * 2.2, CLIENT_Z + 7)
    peerPosition(target, _edgeEnd, 12 + route * 2.2)
    const failed = route === 0 &&
      projection.clientRetry.reason !== 'none' &&
      projection.clientRetry.previousTargetPeer >= 0
    setDirectedSegment(
      clientRoutes,
      clientRouteHeads,
      route,
      _edgeStart,
      _edgeEnd,
      failed
        ? SEMANTIC_COLORS[theme].fault
        : SEMANTIC_COLORS[theme].client,
      failed ? 0.58 : 0.48,
      route === 0 ? -1.8 : 1.8,
    )
  }

  function project(projection: RaftLabProjection): void {
    root.visible = projection.mode !== 'hidden'
    overviewRoot.visible = projection.mode !== 'hidden'
    detailRoot.visible = projection.mode === 'inspect'
    root.userData.mode = projection.mode
    root.userData.phase = projection.phase
    root.userData.regionId = projection.regionId
    root.userData.previousTerm = projection.previousTerm
    root.userData.term = projection.term
    root.userData.previousLeaderPeer = projection.previousLeaderPeer
    root.userData.leaderPeer = projection.leaderPeer
    root.userData.candidatePeer = projection.candidatePeer
    root.userData.reducedMotion = projection.reducedMotion
    root.userData.clientRetry = projection.clientRetry
    root.userData.pdObservation = projection.pdObservation

    const pulse = clamp(projection.pulse, 0, 1)
    const activePulse = projection.reducedMotion ? 1 : 1 + pulse * 0.16
    const termBase = Math.max(0, projection.previousTerm)

    for (let slot = 0; slot < RAFT_LAB_PEER_CAPACITY; slot++) {
      const peer = projection.peers[slot]
      const visibleScale = peer.visible ? 1 : 0
      const down = peer.health === 'down'
      const peerColor = down
        ? SEMANTIC_COLORS[theme].fault
        : peer.role === 'leader'
          ? SEMANTIC_COLORS[theme].raft
          : SEMANTIC_COLORS[theme].kv
      setInstanceTransform(
        peerDecks,
        slot,
        PEER_X[slot],
        3,
        PEER_Z + 11,
        29 * visibleScale,
        4 * visibleScale,
        54 * visibleScale,
      )
      setInstanceTransform(
        peerBodies,
        slot,
        PEER_X[slot],
        PEER_Y,
        PEER_Z,
        13 * visibleScale,
        (down ? 4 : 10) * visibleScale,
        12 * visibleScale,
        down ? _offlineRotation : _identityRotation,
      )
      setInstanceColor(peerBodies, slot, peerColor, down ? 0.62 : 0.82)
      showRoleShape(peer, slot)

      const termHeight = peer.visible
        ? clamp(peer.term - termBase + 1, 1, 4) * 2.2
        : 0
      setInstanceTransform(
        termBeacons,
        slot,
        PEER_X[slot] - 9,
        6 + termHeight / 2,
        PEER_Z - 13,
        1.35 * visibleScale,
        termHeight,
        1.35 * visibleScale,
      )
      setInstanceColor(
        termBeacons,
        slot,
        peer.role === 'candidate'
          ? SEMANTIC_COLORS[theme].tso
          : peerColor,
      )

      const anchor = peerAnchorsMutable[slot]
      peerStoreIds[slot] = peer.storeId
      peerRoles[slot] = peer.role
      peerHealth[slot] = peer.health
      peerTerms[slot] = peer.term
      peerMatchIndices[slot] = peer.matchIndex
      peerCommitIndices[slot] = peer.commitIndex
      peerAppliedIndices[slot] = peer.appliedIndex
      anchor.visible = peer.visible
      anchor.userData.storeId = peer.storeId
      anchor.userData.role = peer.role
      anchor.userData.health = peer.health
      anchor.userData.shape = peer.shape
      anchor.userData.term = peer.term
      anchor.userData.matchIndex = peer.matchIndex
      anchor.userData.commitIndex = peer.commitIndex
      anchor.userData.appliedIndex = peer.appliedIndex
      anchor.userData.votedForStoreId = peer.votedForStoreId
      anchor.userData.previousLeader = peer.previousLeader

      for (let column = 0; column < RAFT_LAB_LOG_WINDOW_CAPACITY; column++) {
        const index = slot * RAFT_LAB_LOG_WINDOW_CAPACITY + column
        const cell = peer.log[column]
        const height = peer.visible ? logStateHeight(cell.state) : 0
        setInstanceTransform(
          logCells,
          index,
          PEER_X[slot],
          5 + height * 1.7,
          LOG_Z[column],
          11 * visibleScale,
          2.8 * height,
          5.5 * visibleScale,
          cell.state === 'unavailable'
            ? _offlineRotation
            : _identityRotation,
        )
        setInstanceColor(
          logCells,
          index,
          logStateColor(cell.state, theme),
          cell.state === 'absent' ? 0.48 : 0.92,
        )
        logIndices[index] = cell.index
        logTerms[index] = cell.term
        logStates[index] = logStateCode(cell.state)
      }

      const commitVisible =
        peer.visible && peer.commitIndex > 0 && peer.health === 'up'
      const applyVisible =
        commitVisible && peer.appliedIndex >= peer.commitIndex
      setInstanceTransform(
        commitMarkers,
        slot,
        PEER_X[slot],
        10,
        LOG_Z[1],
        commitVisible ? 7.5 : 0,
        commitVisible ? 7.5 : 0,
        commitVisible ? 7.5 : 0,
        _horizontalRotation,
      )
      setInstanceColor(
        commitMarkers,
        slot,
        SEMANTIC_COLORS[theme].tso,
      )
      setInstanceTransform(
        applyPads,
        slot,
        PEER_X[slot],
        3.4,
        LOG_Z[2] + 8,
        applyVisible ? 18 : 0,
        applyVisible ? 1.2 : 0,
        applyVisible ? 8 : 0,
      )
      setInstanceColor(applyPads, slot, SEMANTIC_COLORS[theme].kv)
    }

    for (let edge = 0; edge < RAFT_LAB_ELECTION_EDGE_CAPACITY; edge++) {
      const projected = projection.electionEdges[edge]
      edgeIds[edge] = projected.id
      edgeStages[edge] = edgeStageCode(projected.stage)
      edgeStatuses[edge] = edgeStatusCode(projected.status)
      showElectionEdge(projected, edge)
    }

    const acknowledgements = clamp(
      Math.trunc(projection.quorum.acknowledgements),
      0,
      RAFT_LAB_PEER_CAPACITY,
    )
    quorumAcknowledgements[0] = acknowledgements
    const quorumColor = projection.quorum.available
      ? projection.quorum.committed
        ? SEMANTIC_COLORS[theme].kv
        : SEMANTIC_COLORS[theme].raft
      : SEMANTIC_COLORS[theme].fault
    const quorumScale = projection.mode === 'hidden'
      ? 0
      : (projection.quorum.available ? 8.5 : 7) * activePulse
    quorumRing.visible = projection.mode !== 'hidden'
    quorumRing.scale.setScalar(quorumScale)
    configureSemanticMaterial(raftMaterial, quorumColor, theme, 0.56)
    quorumRing.userData.available = projection.quorum.available
    quorumRing.userData.committed = projection.quorum.committed
    for (let slot = 0; slot < RAFT_LAB_PEER_CAPACITY; slot++) {
      const acknowledged = slot < acknowledgements
      setInstanceTransform(
        quorumVotes,
        slot,
        -8 + slot * 8,
        acknowledged ? 8 : 5,
        -9,
        5,
        acknowledged ? 7 : 1.5,
        5,
      )
      setInstanceColor(
        quorumVotes,
        slot,
        acknowledged
          ? SEMANTIC_COLORS[theme].raft
          : SEMANTIC_COLORS[theme].structure,
        acknowledged ? 0.96 : 0.42,
      )
    }

    showClientRoute(
      projection,
      0,
      projection.clientRetry.previousTargetPeer,
    )
    showClientRoute(
      projection,
      1,
      projection.clientRetry.targetPeer,
    )
    clientGateway.userData.attempt = projection.clientRetry.attempt
    clientGateway.userData.status = projection.clientRetry.status
    clientGateway.userData.reason = projection.clientRetry.reason

    const pdVisible = projection.pdObservation.visible
    pdObserver.visible = projection.mode !== 'hidden'
    pdCrown.visible = pdVisible
    pdObserver.userData.status = projection.pdObservation.status
    pdObserver.userData.leaderPeer = projection.pdObservation.leaderPeer
    const pdPulse = projection.reducedMotion ? 1 : activePulse
    pdCrown.scale.set(
      4 * pdPulse,
      5 * pdPulse,
      4 * pdPulse,
    )
    if (
      pdVisible &&
      projection.pdObservation.leaderPeer >= 0
    ) {
      peerPosition(projection.pdObservation.leaderPeer, _edgeStart, 17)
      _edgeEnd.set(PD_X, 17, PD_Z)
      setDirectedSegment(
        pdRoute,
        pdRouteHead,
        0,
        _edgeStart,
        _edgeEnd,
        SEMANTIC_COLORS[theme].tso,
        0.42,
        -1.6,
      )
    } else {
      hideDirectedEdge(pdRoute, pdRouteHead, 0)
    }

    for (let index = 0; index < instancedMeshes.length; index++) {
      const mesh = instancedMeshes[index]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  setStaticTheme(theme)
  project(EMPTY_RAFT_LAB_PROJECTION)

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

  const resources: RaftLabResourceCounts = Object.freeze({
    objectCount,
    drawableCount,
    geometryCount: ownedGeometries.length,
    materialCount: ownedMaterials.length,
    instancedMeshCount,
    instanceCapacity,
    peerCapacity: RAFT_LAB_PEER_CAPACITY,
    logWindowCapacity: RAFT_LAB_LOG_WINDOW_CAPACITY,
    logCellCapacity: RAFT_LAB_LOG_CELL_CAPACITY,
    electionEdgeCapacity: RAFT_LAB_ELECTION_EDGE_CAPACITY,
    clientRouteCapacity: RAFT_LAB_CLIENT_ROUTE_CAPACITY,
    quorumRequired: 2,
    pdObserverCapacity: 1,
  })
  const debug: RaftLabDebug = Object.freeze({
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
    peerAnchors,
    clientAnchor,
    pdAnchor,
    debug,
    update(projection: RaftLabProjection): void {
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
