// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import type { TraceReceipt } from '../model/types'
import { CITY_ORBIT } from './camera'
import {
  cityPixelRatio,
  cityProjectionAspect,
  cityViewOcclusion,
  hasTraceChanged,
} from './shell'

describe('city shell trace replay gate', () => {
  it('replays a new receipt object even when deterministic reset reused its id', () => {
    const first = { id: 'trace-1' } as TraceReceipt
    const afterReset = { id: 'trace-1' } as TraceReceipt

    expect(hasTraceChanged(first, afterReset)).toBe(true)
    expect(hasTraceChanged(afterReset, afterReset)).toBe(false)
    expect(hasTraceChanged(afterReset, null)).toBe(true)
  })

  it('reserves projection space for the desktop HUD only', () => {
    expect(cityViewOcclusion(1440)).toBe(420)
    expect(cityViewOcclusion(1000)).toBe(320)
    expect(cityViewOcclusion(900)).toBe(0)
    expect(cityViewOcclusion(390)).toBe(0)
    expect(cityViewOcclusion(1440, false)).toBe(0)
    expect(cityProjectionAspect(1440, 900)).toBeCloseTo((1440 + 420) / 900)
    expect(cityProjectionAspect(1440, 900, false)).toBeCloseTo(1440 / 900)
  })

  it('leaves useful orbit room beyond the establishing shot', () => {
    const dx = CITY_ORBIT.homePosition[0] - CITY_ORBIT.target[0]
    const dy = CITY_ORBIT.homePosition[1] - CITY_ORBIT.target[1]
    const dz = CITY_ORBIT.homePosition[2] - CITY_ORBIT.target[2]
    const homeDistance = Math.sqrt(dx * dx + dy * dy + dz * dz)

    expect(homeDistance).toBeCloseTo(600.25, 1)
    expect(homeDistance / CITY_ORBIT.maxDistance).toBeLessThanOrEqual(0.37)
    expect(CITY_ORBIT.maxDistance).toBeGreaterThanOrEqual(1_650)
  })

  it('caps fill rate more aggressively on compact displays', () => {
    expect(cityPixelRatio(1440, 2)).toBe(1.5)
    expect(cityPixelRatio(390, 3)).toBe(1.25)
    expect(cityPixelRatio(1440, 1)).toBe(1)
  })
})
