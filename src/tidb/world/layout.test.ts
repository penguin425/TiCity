/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import {
  COMPONENT_ANCHORS,
  CONTROL_PATHS,
  DATA_PATHS,
  DISTRICT_BOUNDS,
  FOCUS_ANCHORS,
  GARDEN_BEDS,
  GC_STORAGE_LAB_ORIGIN,
  HTAP_PATHS,
  LAMP_POSITIONS,
  LOCK_LAB_ORIGIN,
  PROTOCOL_LAB_ORIGIN,
  RAFT_LAB_ORIGIN,
  ROAD_SEGMENTS,
  SKYLINE_BUILDING_COUNT,
  SKYLINE_PLACEMENTS,
  SKYLINE_ROOFTOP_LIGHT_COUNT,
  TIFLASH_MPP_LAB_ORIGIN,
  TRANSACTION_LAB_ORIGIN,
  TICITY_LAYOUT,
  TIKV_BOUNDS,
  TREE_POSITIONS,
  boundsContain,
  boundsOverlap,
  createLampPositions,
  createSkylinePlacements,
  createTreePositions,
  regionPeerPosition,
} from './layout'

describe('TiCity layout', () => {
  it('represents 36 Regions with one voter peer in each TiKV store', () => {
    const seen = new Set<string>()
    for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
      for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
        const point = regionPeerPosition(store, region)
        expect(boundsContain(TIKV_BOUNDS[store], point, 8)).toBe(true)
        seen.add(`${region}:${store}`)
      }
    }
    expect(seen.size).toBe(TICITY_LAYOUT.regionCount * TICITY_LAYOUT.peersPerRegion)
  })

  it('keeps every instructional district physically separate', () => {
    const entries = Object.entries(DISTRICT_BOUNDS)
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        expect(
          boundsOverlap(entries[i][1], entries[j][1], 4),
          `${entries[i][0]} overlaps ${entries[j][0]}`,
        ).toBe(false)
      }
    }
  })

  it('keeps authored scenery geography in the shared layout', () => {
    expect(ROAD_SEGMENTS).toEqual([
      { x: 0, z: -339, width: 28, depth: 40 },
      { x: 0, z: -251, width: 28, depth: 18 },
      { x: 0, z: -188, width: 28, depth: 28 },
      { x: 0, z: -25, width: 654, depth: 22 },
      { x: 0, z: 155, width: 654, depth: 20 },
      { x: 0, z: 286, width: 654, depth: 18 },
      { x: -318, z: -12, width: 18, depth: 614 },
      { x: 318, z: -12, width: 18, depth: 614 },
    ])
    expect(GARDEN_BEDS).toHaveLength(14)
    expect(GARDEN_BEDS[0]).toEqual([-222, -241, 132, 100])
    expect(GARDEN_BEDS.at(-1)).toEqual([102, 178, 96, 7])
    expect(TREE_POSITIONS).toHaveLength(45)
    expect(TREE_POSITIONS.slice(0, 3)).toEqual([
      [-278, 0, -54], [-232, 0, -54], [-186, 0, -54],
    ])
    expect(TREE_POSITIONS.at(-1)).toEqual([140, 0, 236])
    expect(LAMP_POSITIONS).toHaveLength(60)
    expect(LAMP_POSITIONS.slice(0, 2)).toEqual([
      [-280, 0, -39], [-280, 0, 167],
    ])
    expect(LAMP_POSITIONS.at(-1)).toEqual([304, 0, 260])
    expect(createTreePositions()).toEqual(TREE_POSITIONS)
    expect(createLampPositions()).toEqual(LAMP_POSITIONS)
  })

  it('keeps skyline placement and random consumption deterministic', () => {
    expect(SKYLINE_PLACEMENTS).toHaveLength(SKYLINE_BUILDING_COUNT)
    expect(SKYLINE_ROOFTOP_LIGHT_COUNT).toBe(8)
    expect(createSkylinePlacements()).toEqual(SKYLINE_PLACEMENTS)
    expect(SKYLINE_PLACEMENTS[0].x).toBeCloseTo(-43.53266315255314, 12)
    expect(SKYLINE_PLACEMENTS[0].z).toBeCloseTo(-341.69129344355315, 12)
    expect(SKYLINE_PLACEMENTS[18].x).toBeCloseTo(-341.4745255121961, 12)
    expect(SKYLINE_PLACEMENTS[18].z).toBeCloseTo(-296.47753985598683, 12)
    expect(SKYLINE_PLACEMENTS.at(-1)?.x).toBeCloseTo(344.0096170986071, 12)
    expect(SKYLINE_PLACEMENTS.at(-1)?.z).toBeCloseTo(306.84533091261983, 12)
  })

  it('keeps PD off the SQL row data path', () => {
    const ids = DATA_PATHS.flatMap((path) => path.flatMap((leg) => [leg.from, leg.to]))
    expect(ids.some((id) => id.startsWith('pd.'))).toBe(false)
    expect(CONTROL_PATHS.some((leg) => leg.to === 'pd.control')).toBe(true)
  })

  it('connects each TiKV store to TiFlash only over HTAP routes', () => {
    expect(HTAP_PATHS).toHaveLength(TICITY_LAYOUT.tikvCount)
    expect(new Set(HTAP_PATHS.map((leg) => leg.from))).toEqual(
      new Set(['tikv.0', 'tikv.1', 'tikv.2']),
    )
    expect(HTAP_PATHS.every((leg) => leg.to === 'tiflash.0')).toBe(true)
  })

  it('publishes anchors for every planned route endpoint', () => {
    const legs = [...DATA_PATHS.flat(), ...CONTROL_PATHS, ...HTAP_PATHS]
    for (const leg of legs) {
      expect(COMPONENT_ANCHORS[leg.from]).toBeDefined()
      expect(COMPONENT_ANCHORS[leg.to]).toBeDefined()
    }
  })

  it('rejects invalid peer coordinates instead of aliasing a real Region', () => {
    expect(() => regionPeerPosition(-1, 0)).toThrow(RangeError)
    expect(() => regionPeerPosition(0, TICITY_LAYOUT.regionCount)).toThrow(RangeError)
  })

  it('keeps every guided-tour focus on the authored city plate', () => {
    const half = TICITY_LAYOUT.groundSize / 2
    for (const point of Object.values(FOCUS_ANCHORS)) {
      expect(Math.abs(point[0])).toBeLessThan(half)
      expect(Math.abs(point[2])).toBeLessThan(half)
    }
  })

  it('publishes a shared, elevated cutaway stage for mutually exclusive labs', () => {
    expect(FOCUS_ANCHORS['transaction.lab']).toBe(TRANSACTION_LAB_ORIGIN)
    expect(FOCUS_ANCHORS['lock.lab']).toBe(LOCK_LAB_ORIGIN)
    expect(FOCUS_ANCHORS['raft.lab']).toBe(RAFT_LAB_ORIGIN)
    expect(FOCUS_ANCHORS['protocol.lab']).toBe(PROTOCOL_LAB_ORIGIN)
    expect(FOCUS_ANCHORS['gc.lab']).toBe(GC_STORAGE_LAB_ORIGIN)
    expect(FOCUS_ANCHORS['tiflash.lab']).toBe(TIFLASH_MPP_LAB_ORIGIN)
    expect(LOCK_LAB_ORIGIN).toEqual(TRANSACTION_LAB_ORIGIN)
    expect(RAFT_LAB_ORIGIN).toEqual(TRANSACTION_LAB_ORIGIN)
    expect(PROTOCOL_LAB_ORIGIN).toEqual(TRANSACTION_LAB_ORIGIN)
    expect(GC_STORAGE_LAB_ORIGIN).toEqual(TRANSACTION_LAB_ORIGIN)
    expect(TIFLASH_MPP_LAB_ORIGIN).toEqual(TRANSACTION_LAB_ORIGIN)
    expect(LOCK_LAB_ORIGIN[1]).toBeGreaterThan(0)
    expect(RAFT_LAB_ORIGIN[1]).toBeGreaterThan(0)
    expect(PROTOCOL_LAB_ORIGIN[1]).toBeGreaterThan(0)
    expect(GC_STORAGE_LAB_ORIGIN[1]).toBeGreaterThan(0)
    expect(TIFLASH_MPP_LAB_ORIGIN[1]).toBeGreaterThan(0)
  })
})
