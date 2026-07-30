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
  HTAP_PATHS,
  LOCK_LAB_ORIGIN,
  RAFT_LAB_ORIGIN,
  TRANSACTION_LAB_ORIGIN,
  TICITY_LAYOUT,
  TIKV_BOUNDS,
  boundsContain,
  boundsOverlap,
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
    expect(LOCK_LAB_ORIGIN).toEqual(TRANSACTION_LAB_ORIGIN)
    expect(RAFT_LAB_ORIGIN).toEqual(TRANSACTION_LAB_ORIGIN)
    expect(LOCK_LAB_ORIGIN[1]).toBeGreaterThan(0)
    expect(RAFT_LAB_ORIGIN[1]).toBeGreaterThan(0)
  })
})
