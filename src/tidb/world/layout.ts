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
  fog: { near: 360, far: 1100 },
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

export const TIKV_BOUNDS: readonly PlanBounds[] = [
  DISTRICT_BOUNDS.tikv0,
  DISTRICT_BOUNDS.tikv1,
  DISTRICT_BOUNDS.tikv2,
] as const

export const COMPONENT_ANCHORS = {
  'client.terminal': [0, 3, -288],
  'tiproxy.0': [-34, 7, -220],
  'tiproxy.1': [34, 7, -220],
  'tidb.0': [-74, 18, -132],
  'tidb.1': [0, 18, -132],
  'tidb.2': [74, 18, -132],
  'pd.0': [222, 8, -118],
  'pd.1': [254, 8, -102],
  'pd.2': [222, 8, -82],
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
  return [x, 4.1, z]
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
