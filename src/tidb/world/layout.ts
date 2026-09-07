/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * TiCity geography. This module deliberately has no three.js dependency so
 * the simulation, diagnostics, and geometry tests can share one exact plan.
 */

export type Point3 = readonly [x: number, y: number, z: number]

export interface PlanBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

export interface RouteLeg {
  readonly from: ComponentAnchorId
  readonly to: ComponentAnchorId
}

export const TICITY_LAYOUT = {
  groundSize: 720,
  regionCount: 36,
  peersPerRegion: 3,
  proxyCount: 2,
  tidbCount: 3,
  pdCount: 3,
  tikvCount: 3,
  regionGrid: { columns: 6, rows: 6, pitchX: 13, pitchZ: 12 },
  fog: {
    day: { near: 1060, far: 3500 },
    night: { near: 920, far: 3100 },
  },
} as const

export const DISTRICT_BOUNDS = {
  clients: { minX: -74, maxX: 74, minZ: -318, maxZ: -260 },
  tiproxy: { minX: -72, maxX: 72, minZ: -242, maxZ: -202 },
  tidb: { minX: -116, maxX: 116, minZ: -174, maxZ: -88 },
  pd: { minX: 190, maxX: 282, minZ: -152, maxZ: -54 },
  tikv0: { minX: -207, maxX: -93, minZ: 28, maxZ: 140 },
  tikv1: { minX: -57, maxX: 57, minZ: 28, maxZ: 140 },
  tikv2: { minX: 93, maxX: 207, minZ: 28, maxZ: 140 },
  gc: { minX: -280, maxX: -182, minZ: 170, maxZ: 260 },
  tiflash: { minX: 174, maxX: 286, minZ: 170, maxZ: 266 },
} as const satisfies Record<string, PlanBounds>

export type DistrictId = keyof typeof DISTRICT_BOUNDS

export interface RoadSegment {
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
}

/** Authored campus roads. Keep all street geography in this module. */
export const ROAD_SEGMENTS = [
  { x: 0, z: -339, width: 28, depth: 40 },
  { x: 0, z: -251, width: 28, depth: 18 },
  { x: 0, z: -188, width: 28, depth: 28 },
  { x: 0, z: -25, width: 654, depth: 22 },
  { x: 0, z: 155, width: 654, depth: 20 },
  { x: 0, z: 286, width: 654, depth: 18 },
  { x: -318, z: -12, width: 18, depth: 614 },
  { x: 318, z: -12, width: 18, depth: 614 },
] as const satisfies readonly RoadSegment[]

export type GardenBed = readonly [x: number, z: number, width: number, depth: number]

/** Empty campus planting blocks, authored alongside the other world bounds. */
export const GARDEN_BEDS = [
  [-222, -241, 132, 100], [-222, -109, 132, 86],
  [224, -248, 132, 108], [139, -245, 20, 110],
  [-106, 223, 94, 62], [106, 223, 94, 62],
  [-75, 83, 12, 104], [75, 83, 12, 104],
  [-269, 72, 43, 106], [269, 72, 43, 106],
  [-158, -54, 204, 8], [117, -54, 132, 8],
  [-104, 178, 88, 7], [102, 178, 96, 7],
] as const satisfies readonly GardenBed[]

function isClearOfDistrict(x: number, z: number, margin: number): boolean {
  return !Object.values(DISTRICT_BOUNDS).some((bounds) =>
    x >= bounds.minX - margin && x <= bounds.maxX + margin &&
    z >= bounds.minZ - margin && z <= bounds.maxZ + margin,
  )
}

/** Generate the fixed tree sites without coupling scenery to Three.js. */
export function createTreePositions(): readonly Point3[] {
  const trees: Point3[] = []
  for (let x = -278; x <= 278; x += 46) {
    if (Math.abs(x) > 32 && isClearOfDistrict(x, -54, 8)) trees.push([x, 0, -54])
    if (Math.abs(x) > 32 && isClearOfDistrict(x + 8, 178, 8)) trees.push([x + 8, 0, 178])
  }
  // Small asymmetrical groves frame the approach, leaving its sightline open.
  for (const [x, z] of [
    [-268, -269], [-244, -269], [-257, -253], [-268, -238], [-175, -273], [-177, -207],
    [-263, -130], [-244, -100], [-268, -82], [-176, -124],
    [185, -283], [210, -282], [198, -269], [263, -282], [270, -244], [263, -213],
    [-271, 35], [-271, 74], [-271, 112], [271, 36], [271, 77], [271, 114],
    [-139, 237], [-127, 226], [-116, 237], [-73, 238], [74, 235], [85, 228], [110, 237], [140, 236],
  ] as const) {
    if (isClearOfDistrict(x, z, 8)) trees.push([x, 0, z])
  }
  return trees
}

export const TREE_POSITIONS = createTreePositions()

/** Fixed lamp sites around the authored road perimeter. */
export function createLampPositions(): readonly Point3[] {
  const lamps: Point3[] = []
  for (let x = -280; x <= 280; x += 40) lamps.push([x, 0, -39], [x, 0, 167])
  for (let z = -300; z <= 260; z += 40) lamps.push([-304, 0, z], [304, 0, z])
  return lamps
}

export const LAMP_POSITIONS = createLampPositions()

export interface SkylinePlacement {
  readonly x: number
  readonly z: number
  readonly rear: boolean
  readonly sideIndex: number
  /** Random samples retained here so the renderer keeps the historical stream exactly. */
  readonly widthJitter: number
  readonly depthJitter: number
  readonly heightJitter: number
  readonly valueJitter: number
  readonly lowerFacadeJitter: number
  readonly upperFacadeJitter: number
}

export const SKYLINE_RANDOM_SEED = 4_250
export const SKYLINE_BUILDING_COUNT = 52
export const SKYLINE_ROOFTOP_LIGHT_COUNT = 8

/**
 * Generate deterministic perimeter tower sites and their legacy random
 * samples. Position formulas live here; architectural dimensions stay in the
 * skyline renderer. Consuming every sample in the authored order keeps the
 * existing silhouette and material variation bit-for-bit stable.
 */
export function createSkylinePlacements(seed = SKYLINE_RANDOM_SEED): readonly SkylinePlacement[] {
  let value = seed >>> 0
  const random = (): number => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
  const placements: SkylinePlacement[] = []
  for (let index = 0; index < SKYLINE_BUILDING_COUNT; index++) {
    const rear = index < 18
    const sideIndex = index - 18
    const xJitter = random()
    const zJitter = random()
    const x = rear
      ? (index < 9 ? -1 : 1) * (40 + (index % 9) * 34 + xJitter * 4)
      : (sideIndex < 17 ? -1 : 1) * (341 + xJitter * 4)
    const z = rear
      ? -344 + zJitter * 3
      : -297 + (sideIndex % 17) * 37.5 + zJitter * 4
    const widthJitter = random()
    const depthJitter = random()
    const heightJitter = random()
    const valueJitter = random()
    const lowerFacadeJitter = random()
    const upperFacadeJitter = random()
    placements.push({
      x, z, rear, sideIndex,
      widthJitter, depthJitter, heightJitter, valueJitter,
      lowerFacadeJitter, upperFacadeJitter,
    })
  }
  return placements
}

export const SKYLINE_PLACEMENTS = createSkylinePlacements()

export const TIKV_BOUNDS: readonly PlanBounds[] = [
  DISTRICT_BOUNDS.tikv0,
  DISTRICT_BOUNDS.tikv1,
  DISTRICT_BOUNDS.tikv2,
] as const

/** Shared construction datums for the storage decks and their mounted racks. */
export const TIKV_ARCHITECTURE = {
  deckWidth: 100,
  deckHeight: 5,
  deckCenterY: 2.9,
  deckTop: 5.4,
  peerWidth: 8.4,
  peerHeight: 7.2,
  peerDepth: 7.2,
  peerFootY: 5.55,
  raftPortY: 6.3,
} as const

/** Elevated overlay origin for the selected two-Region internal cutaway. */
export const TRANSACTION_LAB_ORIGIN: Point3 = [0, 48, 18]

/**
 * Lock Lab occupies the same authored cutaway stage as Transaction Lab. The
 * shell discriminator guarantees that the two fixed-capacity projections are
 * never visible together.
 */
export const LOCK_LAB_ORIGIN: Point3 = [0, 48, 18]

/**
 * Raft Lab reuses the authored cutaway stage. The shell's event-owned
 * discriminator keeps Transaction, Lock, and Raft geometry mutually exclusive.
 */
export const RAFT_LAB_ORIGIN: Point3 = [0, 48, 18]

/**
 * Protocol Lab shares the authored cutaway stage. The event discriminator
 * keeps its three comparison lanes exclusive with the other detailed labs.
 */
export const PROTOCOL_LAB_ORIGIN: Point3 = [0, 48, 18]

/**
 * GC/Storage Lab shares the authored cutaway stage. Its model-6 discriminator
 * keeps it mutually exclusive with the transaction, lock, Raft, and protocol
 * projections.
 */
export const GC_STORAGE_LAB_ORIGIN: Point3 = [0, 48, 18]

/**
 * TiFlash MPP Lab reuses the detailed cutaway stage. Its model-7 event
 * discriminator keeps learner replication and per-query exchange geometry
 * exclusive with all earlier Labs.
 */
export const TIFLASH_MPP_LAB_ORIGIN: Point3 = [0, 48, 18]

export const COMPONENT_ANCHORS = {
  'client.terminal': [0, 3, -288],
  'tiproxy.0': [-34, 7, -220],
  'tiproxy.1': [34, 7, -220],
  'tidb.0': [-74, 18, -132],
  'tidb.1': [0, 18, -132],
  'tidb.2': [74, 18, -132],
  'pd.0': [206, 8, -128],
  'pd.1': [267, 8, -107],
  'pd.2': [228, 8, -64],
  'pd.control': [232, 4, -102],
  'tikv.0': [-150, 5, 84],
  'tikv.1': [0, 5, 84],
  'tikv.2': [150, 5, 84],
  'gc.yard': [-231, 5, 215],
  'tiflash.0': [230, 14, 216],
} as const satisfies Record<string, Point3>

export type ComponentAnchorId = keyof typeof COMPONENT_ANCHORS

export const FOCUS_ANCHORS = {
  'city.overview': [0, 16, 26],
  'tiproxy.gate': [0, 7, -220],
  'pd.tso': COMPONENT_ANCHORS['pd.control'],
  'tikv.regions': COMPONENT_ANCHORS['tikv.1'],
  'tikv.mvcc': COMPONENT_ANCHORS['tikv.0'],
  'txn.2pc': [0, 10, -20],
  'transaction.lab': TRANSACTION_LAB_ORIGIN,
  'lock.lab': LOCK_LAB_ORIGIN,
  'raft.lab': RAFT_LAB_ORIGIN,
  'protocol.lab': PROTOCOL_LAB_ORIGIN,
  'gc.lab': GC_STORAGE_LAB_ORIGIN,
  'tiflash.lab': TIFLASH_MPP_LAB_ORIGIN,
  'tikv.raft': COMPONENT_ANCHORS['tikv.1'],
  'pd.scheduler': COMPONENT_ANCHORS['pd.control'],
  'gc.yard': COMPONENT_ANCHORS['gc.yard'],
  'tiflash.mpp': COMPONENT_ANCHORS['tiflash.0'],
} as const satisfies Record<string, Point3>

export const FOCUS_COMPONENT_TARGETS: Readonly<Record<string, string>> = {
  'tiproxy.gate': 'tiproxy.0',
  'pd.tso': 'pd.control',
  'tikv.regions': 'tikv.1',
  'tikv.mvcc': 'tikv.0',
  'tikv.raft': 'tikv.1',
  'pd.scheduler': 'pd.control',
  'gc.yard': 'gc.yard',
  'tiflash.mpp': 'tiflash.0',
}

/**
 * The only user-data route. PD is intentionally absent: it provides TSO and
 * scheduling control, but SQL rows do not pass through it.
 */
export const DATA_PATHS: readonly (readonly RouteLeg[])[] = [
  [
    { from: 'client.terminal', to: 'tiproxy.0' },
    { from: 'tiproxy.0', to: 'tidb.0' },
    { from: 'tidb.0', to: 'tikv.0' },
  ],
  [
    { from: 'client.terminal', to: 'tiproxy.1' },
    { from: 'tiproxy.1', to: 'tidb.2' },
    { from: 'tidb.2', to: 'tikv.2' },
  ],
  [
    { from: 'client.terminal', to: 'tiproxy.0' },
    { from: 'tiproxy.0', to: 'tidb.1' },
    { from: 'tidb.1', to: 'tikv.1' },
  ],
] as const

export const CONTROL_PATHS: readonly RouteLeg[] = [
  { from: 'tidb.0', to: 'pd.control' },
  { from: 'tidb.1', to: 'pd.control' },
  { from: 'tidb.2', to: 'pd.control' },
  { from: 'pd.control', to: 'tikv.0' },
  { from: 'pd.control', to: 'tikv.1' },
  { from: 'pd.control', to: 'tikv.2' },
  { from: 'pd.control', to: 'gc.yard' },
] as const

export const HTAP_PATHS: readonly RouteLeg[] = [
  { from: 'tikv.0', to: 'tiflash.0' },
  { from: 'tikv.1', to: 'tiflash.0' },
  { from: 'tikv.2', to: 'tiflash.0' },
] as const

export const TIKV_CENTERS: readonly Point3[] = [
  COMPONENT_ANCHORS['tikv.0'],
  COMPONENT_ANCHORS['tikv.1'],
  COMPONENT_ANCHORS['tikv.2'],
] as const

export function regionPeerPosition(storeIndex: number, regionIndex: number): Point3 {
  if (!Number.isInteger(storeIndex) || storeIndex < 0 || storeIndex >= TICITY_LAYOUT.tikvCount) {
    throw new RangeError(`storeIndex must be 0..${TICITY_LAYOUT.tikvCount - 1}`)
  }
  if (!Number.isInteger(regionIndex) || regionIndex < 0 || regionIndex >= TICITY_LAYOUT.regionCount) {
    throw new RangeError(`regionIndex must be 0..${TICITY_LAYOUT.regionCount - 1}`)
  }
  const center = TIKV_CENTERS[storeIndex]
  const column = regionIndex % TICITY_LAYOUT.regionGrid.columns
  const row = Math.floor(regionIndex / TICITY_LAYOUT.regionGrid.columns)
  const x = center[0] + (column - (TICITY_LAYOUT.regionGrid.columns - 1) / 2) * TICITY_LAYOUT.regionGrid.pitchX
  const z = center[2] + (row - (TICITY_LAYOUT.regionGrid.rows - 1) / 2) * TICITY_LAYOUT.regionGrid.pitchZ
  return [x, TIKV_ARCHITECTURE.peerFootY + TIKV_ARCHITECTURE.peerHeight / 2, z]
}

export function boundsContain(bounds: PlanBounds, point: Point3, margin = 0): boolean {
  return (
    point[0] >= bounds.minX + margin &&
    point[0] <= bounds.maxX - margin &&
    point[2] >= bounds.minZ + margin &&
    point[2] <= bounds.maxZ - margin
  )
}

export function boundsOverlap(a: PlanBounds, b: PlanBounds, gap = 0): boolean {
  return !(
    a.maxX + gap <= b.minX ||
    b.maxX + gap <= a.minX ||
    a.maxZ + gap <= b.minZ ||
    b.maxZ + gap <= a.minZ
  )
}
