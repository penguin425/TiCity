/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Renderer-only fixed-capacity comparison of 1PC, Async Commit, and regular
 * 2PC. The immutable model owns all transaction and Region Raft transitions.
 */

import * as THREE from 'three'
import type {
  ResolvedCommitProtocol,
  TraceProtocolLaneId,
  TraceProtocolLaneStage,
  TraceProtocolRaftOperation,
  TraceProtocolRaftStage,
} from '../model/types'
import { SEMANTIC_COLORS } from './palette'
import type { CityTheme } from './palette'

export const PROTOCOL_LAB_LANE_CAPACITY = 3 as const
export const PROTOCOL_LAB_REGION_CAPACITY_PER_LANE = 2 as const
export const PROTOCOL_LAB_REGION_CAPACITY = 6 as const
export const PROTOCOL_LAB_VOTERS_PER_REGION = 3 as const
export const PROTOCOL_LAB_VOTER_CAPACITY = 18 as const
export const PROTOCOL_LAB_MVCC_CELL_CAPACITY = 18 as const
export const PROTOCOL_LAB_INDICATOR_CAPACITY = 9 as const

export type ProtocolLabMode = 'hidden' | 'overview' | 'inspect'
export type ProtocolLabLaneShape = 'triangle' | 'diamond' | 'cylinder'
export type ProtocolLabLanePath =
  | 'idle'
  | 'critical'
  | 'client-boundary'
  | 'background'
  | 'complete'
export type ProtocolLabTimestampStage = 'none' | 'start' | 'latest' | 'commit'
export type ProtocolLabPeerLogState =
  | 'idle'
  | 'proposed'
  | 'persisted'
  | 'committed'
export type ProtocolLabOptionalPeerSlot = -1 | 0 | 1 | 2

export interface ProtocolLabPeerProjection {
  readonly storeId: string
  readonly leader: boolean
  readonly log: ProtocolLabPeerLogState
}

export interface ProtocolLabRegionProjection {
  readonly visible: boolean
  readonly regionId: number
  readonly role: 'primary' | 'secondary'
  readonly leaderPeer: ProtocolLabOptionalPeerSlot
  readonly operation: TraceProtocolRaftOperation | null
  readonly raftStage: TraceProtocolRaftStage
  readonly peers: readonly [
    ProtocolLabPeerProjection,
    ProtocolLabPeerProjection,
    ProtocolLabPeerProjection,
  ]
  readonly quorum: Readonly<{
    readonly acknowledgements: number
    readonly required: 2
    readonly reached: boolean
  }>
  readonly applied: boolean
  readonly mvcc: Readonly<{
    readonly default: 'empty' | 'value'
    readonly lock: 'empty' | 'prewrite'
    readonly write: 'empty' | 'commit'
    readonly asyncCommit: boolean
    readonly secondaryCount: number
  }>
  readonly returnedMinCommitTs: boolean
}

export interface ProtocolLabLaneProjection {
  readonly visible: boolean
  readonly id: TraceProtocolLaneId
  readonly protocol: ResolvedCommitProtocol
  readonly shape: ProtocolLabLaneShape
  readonly focused: boolean
  readonly stage: TraceProtocolLaneStage
  readonly path: ProtocolLabLanePath
  readonly timestampStage: ProtocolLabTimestampStage
  readonly clientResponded: boolean
  readonly backgroundComplete: boolean
  readonly regions: readonly [
    ProtocolLabRegionProjection,
    ProtocolLabRegionProjection,
  ]
  readonly overflowRegions: number
}

export interface ProtocolLabProjection {
  readonly mode: ProtocolLabMode
  readonly phase: 'idle' | 'running' | 'complete'
  readonly reducedMotion: boolean
  /** Normalized 0..1 teaching-clock pulse. */
  readonly pulse: number
  readonly focusLaneId: TraceProtocolLaneId | null
  readonly lanes: readonly [
    ProtocolLabLaneProjection,
    ProtocolLabLaneProjection,
    ProtocolLabLaneProjection,
  ]
  readonly capacities: Readonly<{
    readonly lanes: 3
    readonly regionsPerLane: 2
    readonly votersPerRegion: 3
  }>
  readonly overflowRegions: number
}

export interface ProtocolLabResourceCounts {
  readonly objectCount: number
  readonly drawableCount: number
  readonly geometryCount: number
  readonly materialCount: number
  readonly instancedMeshCount: number
  readonly instanceCapacity: number
  readonly laneCapacity: 3
  readonly regionCapacityPerLane: 2
  readonly regionCapacity: 6
  readonly votersPerRegion: 3
  readonly voterCapacity: 18
  readonly mvccCellCapacity: 18
  readonly indicatorCapacity: 9
  readonly shadowCount: 0
}

export interface ProtocolLabDebug {
  readonly resources: ProtocolLabResourceCounts
  readonly disposed: boolean
  readonly updateCount: number
}

export interface ProtocolLab {
  readonly object: THREE.Group
  readonly laneAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly regionAnchors: readonly [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  readonly debug: ProtocolLabDebug
  update(projection: ProtocolLabProjection): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface ProtocolLabOptions {
  readonly theme?: CityTheme
}

const LANE_X = [-52, 0, 52] as const
const REGION_Z = [5, 37] as const
const PEER_X = [-10, 0, 10] as const
const MVCC_X = [-7, 0, 7] as const
const PROTOCOL_Z = -35
const REGION_Y = 2
const VOTER_Z_OFFSET = -5
const MVCC_Z_OFFSET = 8

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _color = new THREE.Color()
const _identityRotation = new THREE.Quaternion()
const _horizontalRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
)
const _verticalRotation = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 0, 1),
  Math.PI / 2,
)

function emptyPeer(): ProtocolLabPeerProjection {
  return Object.freeze({
    storeId: '',
    leader: false,
    log: 'idle' as const,
  })
}

function emptyRegion(): ProtocolLabRegionProjection {
  return Object.freeze({
    visible: false,
    regionId: -1,
    role: 'secondary' as const,
    leaderPeer: -1 as const,
    operation: null,
    raftStage: 'idle' as const,
    peers: Object.freeze([emptyPeer(), emptyPeer(), emptyPeer()] as const),
    quorum: Object.freeze({
      acknowledgements: 0,
      required: 2 as const,
      reached: false,
    }),
    applied: false,
    mvcc: Object.freeze({
      default: 'empty' as const,
      lock: 'empty' as const,
      write: 'empty' as const,
      asyncCommit: false,
      secondaryCount: 0,
    }),
    returnedMinCommitTs: false,
  })
}

function emptyLane(
  id: TraceProtocolLaneId,
  protocol: ResolvedCommitProtocol,
  shape: ProtocolLabLaneShape,
): ProtocolLabLaneProjection {
  return Object.freeze({
    visible: false,
    id,
    protocol,
    shape,
    focused: false,
    stage: 'idle' as const,
    path: 'idle' as const,
    timestampStage: 'none' as const,
    clientResponded: false,
    backgroundComplete: false,
    regions: Object.freeze([emptyRegion(), emptyRegion()] as const),
    overflowRegions: 0,
  })
}

export const EMPTY_PROTOCOL_LAB_PROJECTION: ProtocolLabProjection =
  Object.freeze({
    mode: 'hidden',
    phase: 'idle',
    reducedMotion: false,
    pulse: 0,
    focusLaneId: null,
    lanes: Object.freeze([
      emptyLane('one_pc', '1pc', 'triangle'),
      emptyLane('async_commit', 'async_commit', 'diamond'),
      emptyLane('two_pc', '2pc', 'cylinder'),
    ] as const),
    capacities: Object.freeze({
      lanes: 3 as const,
      regionsPerLane: 2 as const,
      votersPerRegion: 3 as const,
    }),
    overflowRegions: 0,
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

function laneColor(
  protocol: ResolvedCommitProtocol,
  theme: CityTheme,
): number {
  switch (protocol) {
    case '1pc':
      return SEMANTIC_COLORS[theme].kv
    case 'async_commit':
      return SEMANTIC_COLORS[theme].tso
    case '2pc':
      return SEMANTIC_COLORS[theme].txn2pc
  }
}

function pathColor(path: ProtocolLabLanePath, theme: CityTheme): number {
  switch (path) {
    case 'critical':
      return SEMANTIC_COLORS[theme].txn2pc
    case 'client-boundary':
      return SEMANTIC_COLORS[theme].return
    case 'background':
      return SEMANTIC_COLORS[theme].tso
    case 'complete':
      return SEMANTIC_COLORS[theme].kv
    case 'idle':
      return theme === 'night' ? 0x526679 : 0x82939f
  }
}

function peerColor(state: ProtocolLabPeerLogState, theme: CityTheme): number {
  switch (state) {
    case 'proposed':
      return SEMANTIC_COLORS[theme].txn2pc
    case 'persisted':
      return SEMANTIC_COLORS[theme].raft
    case 'committed':
      return SEMANTIC_COLORS[theme].kv
    case 'idle':
      return theme === 'night' ? 0x405466 : 0x91a0aa
  }
}

function mvccColor(
  column: 0 | 1 | 2,
  region: ProtocolLabRegionProjection,
  theme: CityTheme,
): number {
  if (column === 0 && region.mvcc.lock === 'prewrite') {
    return region.mvcc.asyncCommit
      ? SEMANTIC_COLORS[theme].tso
      : SEMANTIC_COLORS[theme].txn2pc
  }
  if (column === 1 && region.mvcc.default === 'value') {
    return SEMANTIC_COLORS[theme].sql
  }
  if (column === 2 && region.mvcc.write === 'commit') {
    return SEMANTIC_COLORS[theme].kv
  }
  return theme === 'night' ? 0x314454 : 0xa7b2b9
}

function peerHeight(state: ProtocolLabPeerLogState, leader: boolean): number {
  const base = state === 'idle' ? 3
    : state === 'proposed' ? 5
      : state === 'persisted' ? 7
        : 9
  return base + (leader ? 2 : 0)
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

export function createProtocolLab(
  options: ProtocolLabOptions = {},
): ProtocolLab {
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
  const triangleGeometry = ownGeometry(new THREE.ConeGeometry(1, 1, 3))
  const diamondGeometry = ownGeometry(new THREE.OctahedronGeometry(1, 0))
  const cylinderGeometry = ownGeometry(
    new THREE.CylinderGeometry(1, 1, 1, 18),
  )
  const torusGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.16, 8, 18))

  const semanticMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.56,
    metalness: 0.22,
  }))
  semanticMaterial.name = 'protocol-lab:semantic'
  const deckMaterial = ownMaterial(new THREE.MeshStandardMaterial({
    color: 0x1d3145,
    transparent: true,
    opacity: 0.74,
    roughness: 0.86,
    metalness: 0.08,
  }))
  deckMaterial.name = 'protocol-lab:deck'
  const indicatorMaterial = ownMaterial(new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    toneMapped: false,
  }))
  indicatorMaterial.name = 'protocol-lab:indicators'

  const root = new THREE.Group()
  root.name = 'protocol-lab'
  root.userData.kind = 'protocol-lab'
  root.userData.provenance = 'MODEL / SIMULATED'
  root.userData.boundary =
    'TiDB transaction commit lanes are separate from per-Region Raft quorum'

  const overviewRoot = new THREE.Group()
  overviewRoot.name = 'protocol-lab:overview'
  const inspectRoot = new THREE.Group()
  inspectRoot.name = 'protocol-lab:inspect'
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

  const laneDecks = instances(
    overviewRoot,
    'protocol-lab:lane-decks',
    boxGeometry,
    deckMaterial,
    PROTOCOL_LAB_LANE_CAPACITY,
    'txn2pc',
  )
  laneDecks.userData.capacity = PROTOCOL_LAB_LANE_CAPACITY

  const onePcMarker = instances(
    overviewRoot,
    'protocol-lab:one-pc-marker',
    triangleGeometry,
    semanticMaterial,
    1,
    'kv',
  )
  onePcMarker.userData.shape = 'triangle'
  const asyncMarker = instances(
    overviewRoot,
    'protocol-lab:async-commit-marker',
    diamondGeometry,
    semanticMaterial,
    1,
    'tso',
  )
  asyncMarker.userData.shape = 'diamond'
  const twoPcMarker = instances(
    overviewRoot,
    'protocol-lab:two-pc-marker',
    cylinderGeometry,
    semanticMaterial,
    1,
    'txn2pc',
  )
  twoPcMarker.userData.shape = 'cylinder'

  const regionBodies = instances(
    inspectRoot,
    'protocol-lab:region-bodies',
    boxGeometry,
    semanticMaterial,
    PROTOCOL_LAB_REGION_CAPACITY,
    'kv',
  )
  regionBodies.userData.capacityPerLane =
    PROTOCOL_LAB_REGION_CAPACITY_PER_LANE
  const voters = instances(
    inspectRoot,
    'protocol-lab:raft-voters',
    boxGeometry,
    semanticMaterial,
    PROTOCOL_LAB_VOTER_CAPACITY,
    'raft',
  )
  voters.userData.votersPerRegion = PROTOCOL_LAB_VOTERS_PER_REGION
  const mvccCells = instances(
    inspectRoot,
    'protocol-lab:mvcc-cells',
    boxGeometry,
    semanticMaterial,
    PROTOCOL_LAB_MVCC_CELL_CAPACITY,
    'kv',
  )
  mvccCells.userData.columns = Object.freeze(['LOCK', 'DEFAULT', 'WRITE'])
  mvccCells.userData.cellsPerRegion = 3
  const laneIndicators = instances(
    overviewRoot,
    'protocol-lab:lane-path-indicators',
    torusGeometry,
    indicatorMaterial,
    PROTOCOL_LAB_LANE_CAPACITY,
    'txn2pc',
  )
  laneIndicators.userData.states = Object.freeze([
    'critical',
    'client-boundary',
    'background',
    'complete',
  ])
  const quorumIndicators = instances(
    inspectRoot,
    'protocol-lab:region-quorum-indicators',
    torusGeometry,
    indicatorMaterial,
    PROTOCOL_LAB_REGION_CAPACITY,
    'raft',
  )
  quorumIndicators.userData.required = 2
  quorumIndicators.userData.votersPerRegion =
    PROTOCOL_LAB_VOTERS_PER_REGION

  const laneAnchorsMutable: [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ] = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()]
  for (let lane = 0; lane < PROTOCOL_LAB_LANE_CAPACITY; lane++) {
    const anchor = laneAnchorsMutable[lane]
    anchor.name = `protocol-lab:lane-anchor:${lane}`
    anchor.position.set(LANE_X[lane], 22, PROTOCOL_Z)
    anchor.userData.provenance = 'MODEL / SIMULATED'
    root.add(anchor)
  }
  const laneAnchors = Object.freeze(laneAnchorsMutable)

  const regionAnchorsMutable = Array.from(
    { length: PROTOCOL_LAB_REGION_CAPACITY },
    (_, index) => {
      const lane = Math.floor(
        index / PROTOCOL_LAB_REGION_CAPACITY_PER_LANE,
      )
      const slot = index % PROTOCOL_LAB_REGION_CAPACITY_PER_LANE
      const anchor = new THREE.Object3D()
      anchor.name = `protocol-lab:region-anchor:${index}`
      anchor.position.set(LANE_X[lane], 20, REGION_Z[slot])
      anchor.userData.provenance = 'MODEL / SIMULATED'
      inspectRoot.add(anchor)
      return anchor
    },
  ) as unknown as [
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
    THREE.Object3D,
  ]
  const regionAnchors = Object.freeze(regionAnchorsMutable)

  const allInstances = [
    laneDecks,
    onePcMarker,
    asyncMarker,
    twoPcMarker,
    regionBodies,
    voters,
    mvccCells,
    laneIndicators,
    quorumIndicators,
  ] as const

  let disposed = false
  let updateCount = 0
  let theme: CityTheme = options.theme ?? 'night'
  let latestProjection = EMPTY_PROTOCOL_LAB_PROJECTION

  function setStaticTheme(next: CityTheme): void {
    deckMaterial.color.setHex(next === 'night' ? 0x1d3145 : 0xc5d0d7)
    deckMaterial.opacity = next === 'night' ? 0.74 : 0.82
  }

  function updateMarker(
    mesh: THREE.InstancedMesh,
    lane: ProtocolLabLaneProjection,
    laneIndex: number,
    pulse: number,
  ): void {
    const visibleScale = lane.visible ? 1 : 0
    const focusScale = lane.focused && !latestProjection.reducedMotion
      ? 1 + pulse * 0.16
      : 1
    const timestampHeight =
      lane.timestampStage === 'commit' ? 15
        : lane.timestampStage === 'latest' ? 13
          : lane.timestampStage === 'start' ? 11
            : 9
    setInstanceTransform(
      mesh,
      0,
      LANE_X[laneIndex],
      6 + timestampHeight / 2,
      PROTOCOL_Z,
      8 * visibleScale * focusScale,
      timestampHeight * visibleScale * focusScale,
      8 * visibleScale * focusScale,
    )
    setInstanceColor(
      mesh,
      0,
      laneColor(lane.protocol, theme),
      lane.focused ? 1 : 0.76,
    )
  }

  function project(projection: ProtocolLabProjection): void {
    latestProjection = projection
    root.visible = projection.mode !== 'hidden'
    overviewRoot.visible = projection.mode !== 'hidden'
    inspectRoot.visible = projection.mode === 'inspect'
    root.userData.mode = projection.mode
    root.userData.phase = projection.phase
    root.userData.focusLaneId = projection.focusLaneId
    root.userData.reducedMotion = projection.reducedMotion
    root.userData.overflowRegions = projection.overflowRegions

    const pulse = clamp(projection.pulse, 0, 1)
    for (let laneIndex = 0;
      laneIndex < PROTOCOL_LAB_LANE_CAPACITY;
      laneIndex++
    ) {
      const lane = projection.lanes[laneIndex]
      const laneX = LANE_X[laneIndex]
      const deckHeight = lane.focused ? 2.4 : 1.6
      setInstanceTransform(
        laneDecks,
        laneIndex,
        laneX,
        deckHeight / 2,
        3,
        lane.visible ? 43 : 0,
        deckHeight,
        94,
      )
      setInstanceColor(
        laneDecks,
        laneIndex,
        laneColor(lane.protocol, theme),
        lane.focused ? 0.78 : 0.5,
      )

      const marker = laneIndex === 0
        ? onePcMarker
        : laneIndex === 1 ? asyncMarker : twoPcMarker
      updateMarker(marker, lane, laneIndex, pulse)

      const laneAnchor = laneAnchorsMutable[laneIndex]
      laneAnchor.visible = lane.visible
      laneAnchor.userData.laneId = lane.id
      laneAnchor.userData.protocol = lane.protocol
      laneAnchor.userData.shape = lane.shape
      laneAnchor.userData.stage = lane.stage
      laneAnchor.userData.path = lane.path
      laneAnchor.userData.focused = lane.focused
      laneAnchor.userData.clientResponded = lane.clientResponded
      laneAnchor.userData.backgroundComplete = lane.backgroundComplete

      const laneIndicatorScale = lane.visible
        ? lane.path === 'idle' ? 3.4 : 5
        : 0
      const laneIndicatorPulse = lane.focused &&
        !projection.reducedMotion &&
        lane.path === 'critical'
        ? 1 + pulse * 0.22
        : 1
      const laneIndicatorRotation =
        lane.path === 'background' ? _verticalRotation : _horizontalRotation
      setInstanceTransform(
        laneIndicators,
        laneIndex,
        laneX,
        20,
        PROTOCOL_Z,
        laneIndicatorScale * laneIndicatorPulse,
        laneIndicatorScale * laneIndicatorPulse,
        laneIndicatorScale * laneIndicatorPulse,
        laneIndicatorRotation,
      )
      setInstanceColor(
        laneIndicators,
        laneIndex,
        pathColor(lane.path, theme),
      )

      for (let regionSlot = 0;
        regionSlot < PROTOCOL_LAB_REGION_CAPACITY_PER_LANE;
        regionSlot++
      ) {
        const region = lane.regions[regionSlot]
        const regionIndex =
          laneIndex * PROTOCOL_LAB_REGION_CAPACITY_PER_LANE + regionSlot
        const regionZ = REGION_Z[regionSlot]
        const regionScale = region.visible ? 1 : 0
        const roleWidth = region.role === 'primary' ? 25 : 21
        setInstanceTransform(
          regionBodies,
          regionIndex,
          laneX,
          REGION_Y,
          regionZ,
          roleWidth * regionScale,
          3 * regionScale,
          23 * regionScale,
        )
        setInstanceColor(
          regionBodies,
          regionIndex,
          region.role === 'primary'
            ? SEMANTIC_COLORS[theme].txn2pc
            : SEMANTIC_COLORS[theme].sql,
          region.applied ? 0.95 : 0.58,
        )

        const regionAnchor = regionAnchorsMutable[regionIndex]
        regionAnchor.visible = region.visible
        regionAnchor.userData.regionId = region.regionId
        regionAnchor.userData.role = region.role
        regionAnchor.userData.operation = region.operation
        regionAnchor.userData.raftStage = region.raftStage
        regionAnchor.userData.acknowledgements =
          region.quorum.acknowledgements
        regionAnchor.userData.quorum = region.quorum.required
        regionAnchor.userData.applied = region.applied
        regionAnchor.userData.returnedMinCommitTs =
          region.returnedMinCommitTs

        for (let peer = 0;
          peer < PROTOCOL_LAB_VOTERS_PER_REGION;
          peer++
        ) {
          const voterIndex =
            regionIndex * PROTOCOL_LAB_VOTERS_PER_REGION + peer
          const voter = region.peers[peer]
          const height = peerHeight(voter.log, voter.leader)
          const voterScale = region.visible ? 1 : 0
          setInstanceTransform(
            voters,
            voterIndex,
            laneX + PEER_X[peer],
            4 + height / 2,
            regionZ + VOTER_Z_OFFSET,
            6 * voterScale,
            height * voterScale,
            6 * voterScale,
          )
          setInstanceColor(
            voters,
            voterIndex,
            peerColor(voter.log, theme),
            voter.leader ? 1 : 0.74,
          )
        }

        for (let column = 0; column < 3; column++) {
          const cellIndex = regionIndex * 3 + column
          const active =
            column === 0 ? region.mvcc.lock !== 'empty'
              : column === 1 ? region.mvcc.default !== 'empty'
                : region.mvcc.write !== 'empty'
          const cellHeight = active ? 3.6 : 1.2
          setInstanceTransform(
            mvccCells,
            cellIndex,
            laneX + MVCC_X[column],
            4 + cellHeight / 2,
            regionZ + MVCC_Z_OFFSET,
            5.2 * regionScale,
            cellHeight * regionScale,
            5.2 * regionScale,
          )
          setInstanceColor(
            mvccCells,
            cellIndex,
            mvccColor(column as 0 | 1 | 2, region, theme),
            active ? 1 : 0.62,
          )
        }

        const quorumScale = region.visible ? 4.2 : 0
        setInstanceTransform(
          quorumIndicators,
          regionIndex,
          laneX,
          13,
          regionZ + VOTER_Z_OFFSET,
          quorumScale,
          quorumScale,
          quorumScale,
          _horizontalRotation,
        )
        setInstanceColor(
          quorumIndicators,
          regionIndex,
          region.quorum.reached
            ? SEMANTIC_COLORS[theme].raft
            : region.quorum.acknowledgements > 0
              ? SEMANTIC_COLORS[theme].fault
              : theme === 'night' ? 0x526679 : 0x82939f,
        )
      }
    }

    for (const mesh of allInstances) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  setStaticTheme(theme)
  project(EMPTY_PROTOCOL_LAB_PROJECTION)

  const counted = countScene(root)
  if (
    counted.drawables > 10 ||
    counted.geometries.size > 5 ||
    counted.materials.size > 3 ||
    counted.shadows !== 0
  ) {
    throw new Error('Protocol Lab exceeded its renderer resource budget')
  }
  const resources = Object.freeze({
    objectCount: counted.objects,
    drawableCount: counted.drawables,
    geometryCount: counted.geometries.size,
    materialCount: counted.materials.size,
    instancedMeshCount: counted.instances,
    instanceCapacity: counted.capacity,
    laneCapacity: 3 as const,
    regionCapacityPerLane: 2 as const,
    regionCapacity: 6 as const,
    votersPerRegion: 3 as const,
    voterCapacity: 18 as const,
    mvccCellCapacity: 18 as const,
    indicatorCapacity: 9 as const,
    shadowCount: 0 as const,
  })

  return {
    object: root,
    laneAnchors,
    regionAnchors,
    get debug(): ProtocolLabDebug {
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
