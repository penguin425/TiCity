// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import type { TraceReceipt } from '../model/types'
import { createTiDBSimulation } from '../model/simulation'
import { CITY_ORBIT } from './camera'
import {
  cityPixelRatio,
  cityProjectionAspect,
  cityViewOcclusion,
  hasTraceChanged,
  projectCityLabs,
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

  it('uses model discriminators to keep Transaction, Lock, and Raft labs exclusive', () => {
    const simulation = createTiDBSimulation()
    const transactionTrace = simulation.runScenario('cross-region-transaction')
    const transactionEvent = transactionTrace.events.find(
      (event) => event.snapshot?.transaction !== null &&
        event.snapshot?.transaction !== undefined &&
        event.snapshot.regions.length === 2,
    )
    const lockTrace = simulation.runScenario('lock-deadlock')
    const lockEvent = lockTrace.events.find((event) => event.snapshot?.lockLab)
    const raftTrace = simulation.runScenario('tikv-failover')
    const raftEvent = raftTrace.events.find((event) => event.snapshot?.raftLab)

    expect(transactionEvent).toBeDefined()
    expect(lockEvent).toBeDefined()
    expect(raftEvent).toBeDefined()

    const transaction = projectCityLabs(transactionEvent!, true, false, 0.5)
    expect(transaction.transaction.mode).toBe('inspect')
    expect(transaction.lock.mode).toBe('hidden')
    expect(transaction.raft.mode).toBe('hidden')

    const lock = projectCityLabs(lockEvent!, true, true, 0.5)
    expect(lock.transaction.mode).toBe('hidden')
    expect(lock.lock.mode).toBe('inspect')
    expect(lock.raft.mode).toBe('hidden')
    expect(lock.lock.reducedMotion).toBe(true)

    const raft = projectCityLabs(raftEvent!, true, true, 0.5)
    expect(raft.transaction.mode).toBe('hidden')
    expect(raft.lock.mode).toBe('hidden')
    expect(raft.raft.mode).toBe('inspect')
    expect(raft.raft.reducedMotion).toBe(true)

    const closed = projectCityLabs(raftEvent!, false, true, 0.5)
    expect(closed.transaction.mode).toBe('hidden')
    expect(closed.lock.mode).toBe('hidden')
    expect(closed.raft.mode).toBe('hidden')
    expect(closed.transaction.reducedMotion).toBe(true)
    expect(closed.lock.reducedMotion).toBe(true)
    expect(closed.raft.reducedMotion).toBe(true)
  })
})
