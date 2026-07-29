// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import type { TraceReceipt } from '../model/types'
import { cityViewOcclusion, hasTraceChanged } from './shell'

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
  })
})
