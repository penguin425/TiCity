/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type { Point3 } from './layout'

/** Dimensions and centre offsets, in metres, relative to a layout anchor. */
export interface SqlBuildingPart {
  readonly size: Point3
  readonly position: Point3
}

export interface SqlTowerTier extends SqlBuildingPart {
  /** Curtain-wall bays along the X and Z faces respectively. */
  readonly columns: readonly [number, number]
  readonly floors: number
}

export interface SqlTowerSpec {
  /** Highest equipment surface; also used to place the component label. */
  readonly height: number
  readonly podium: SqlBuildingPart
  readonly tiers: readonly SqlTowerTier[]
  readonly roofPlant: readonly SqlBuildingPart[]
  readonly entrance: {
    readonly x: number
    readonly z: number
    readonly width: number
  }
}

/**
 * Three independent, stateless SQL buildings share a construction vocabulary,
 * not a stacked-square silhouette. Broad entrance podiums support rectangular
 * working floors, offset upper wings and flat mechanical roofs. These are
 * architectural dimensions only: no optimizer, connection or query state is
 * represented by a tier or a floor. Geography remains in layout.ts.
 *
 * Main masses and instanced facade fittings both consume these dimensions so
 * that glazing, cornices and equipment stay attached when a block changes.
 */
export const SQL_TOWERS = [
  {
    height: 58,
    podium: { size: [43.5, 7, 34], position: [0, 4.2, 0] },
    tiers: [
      { size: [31, 39, 23], position: [-4, 27, -4], columns: [6, 4], floors: 9 },
      { size: [18, 8, 18], position: [-9, 51, -5], columns: [4, 4], floors: 2 },
    ],
    roofPlant: [
      { size: [5.5, 2.5, 10], position: [-12, 56.75, -7] },
      { size: [7, 2.8, 4], position: [5, 48.7, -8] },
    ],
    entrance: { x: 7, z: 17.1, width: 12 },
  },
  {
    height: 76,
    podium: { size: [40, 7, 38], position: [0, 4.2, 0] },
    tiers: [
      { size: [27, 52, 25], position: [2, 33.5, -3], columns: [5, 5], floors: 12 },
      { size: [19, 11, 18], position: [-2, 65.5, -5], columns: [4, 4], floors: 3 },
    ],
    roofPlant: [
      { size: [6, 4.5, 11], position: [-6, 73.75, -6] },
      { size: [4.5, 2.5, 8], position: [11, 61.45, -5] },
    ],
    entrance: { x: -8, z: 19.1, width: 11 },
  },
  {
    height: 64,
    podium: { size: [43.5, 7, 32], position: [0, 4.2, 0] },
    tiers: [
      { size: [34, 38, 20], position: [-1, 26.5, -4], columns: [7, 4], floors: 9 },
      { size: [24, 13, 16], position: [4, 52.5, -3], columns: [5, 3], floors: 3 },
    ],
    roofPlant: [
      { size: [9, 4.5, 5], position: [7, 61.75, -6] },
      { size: [4, 2.5, 10], position: [-13, 47.45, -4] },
    ],
    entrance: { x: -7, z: 16.1, width: 13 },
  },
] as const satisfies readonly [SqlTowerSpec, SqlTowerSpec, SqlTowerSpec]

/** Compatibility for callers that only need the three roof heights. */
export const SQL_TOWER_HEIGHTS = [
  SQL_TOWERS[0].height, SQL_TOWERS[1].height, SQL_TOWERS[2].height,
] as const
