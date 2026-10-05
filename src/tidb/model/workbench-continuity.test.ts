// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

import { describe, expect, it } from 'vitest'
import { createTiDBSimulation } from './simulation'
import { analyzeSql } from './sql'
import type { ScenarioId } from './types'

const mechanisms: ScenarioId[] = ['tikv-failover', 'cross-region-transaction', 'lock-deadlock', 'commit-protocols', 'gc-safe-point', 'tiflash-mpp']

describe('workbench requests preserve the live model after a teaching fixture', () => {
  it.each(mechanisms)('does not silently replay %s on a subsequent SQL read', (scenario) => {
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.runScenario(scenario)
    const unavailable = simulation.state.topology.tikv.filter((store) => store.status === 'down').map((store) => store.id)
    const indexes = new Map(simulation.state.regions.map((region) => [region.id, region.commitIndex]))
    const { receipt } = simulation.submitSql('SELECT * FROM accounts WHERE id = 425')
    expect(receipt).not.toBeNull()
    expect(receipt!.scenarioId).toBeNull()
    expect(receipt!.events.every((event) => !event.snapshot?.raftLab && !event.snapshot?.lockLab && !event.snapshot?.protocolLab && !event.snapshot?.gcLab && !event.snapshot?.tiflashMppLab)).toBe(true)
    expect(receipt!.events.some((event) => event.kind === 'point_get')).toBe(true)
    for (const id of unavailable) expect(simulation.state.topology.tikv.find((store) => store.id === id)?.status).toBe('down')
    for (const region of simulation.state.regions) expect(region.commitIndex).toBeGreaterThanOrEqual(indexes.get(region.id)!)
  })

  it('does not replace a bounded write with a prior comparison or GC fixture', () => {
    for (const scenario of ['commit-protocols', 'gc-safe-point', 'lock-deadlock'] as const) {
      const simulation = createTiDBSimulation({ seed: 425 })
      simulation.runScenario(scenario)
      const { receipt } = simulation.submitSql('UPDATE accounts SET balance = balance + 1 WHERE id = 425')
      expect(receipt?.scenarioId).toBeNull()
      expect(receipt?.events.some((event) => event.kind === 'protocol_comparison_start' || event.kind === 'gc_lab_start' || event.kind === 'lock_lab_start')).toBe(false)
      expect(receipt?.outcome).toBe('committed')
    }
  })

  it('fails after a second live voter outage without reviving an old Store or restoring a log fixture', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const analysis = analyzeSql('SELECT * FROM accounts WHERE id = 425')
    const first = simulation.requestTrace({ analysis, scenarioId: 'tikv-failover', regionIds: [0] })!
    expect(first.outcome).toBe('succeeded')
    const failedStores = simulation.state.topology.tikv.filter((store) => store.status === 'down').map((store) => store.id)
    const second = simulation.requestTrace({ analysis, scenarioId: 'tikv-failover', regionIds: [0] })!
    expect(second.outcome).toBe('failed')
    expect(second.events.some((event) => event.snapshot?.raftLab)).toBe(false)
    const region = simulation.state.regions.find((region) => region.id === 0)!
    expect(region.peers.filter((peer) => peer.healthy)).toHaveLength(1)
    for (const id of failedStores) expect(region.peers.find((peer) => peer.storeId === id)?.healthy).toBe(false)
    expect(region.commitIndex).toBeLessThan(42)
  })

  it('allows an intentional guided rerun to reset into the same independent fixture', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const before = simulation.runScenario('tikv-failover')
    simulation.submitSql('SELECT * FROM accounts WHERE id = 425')
    expect(simulation.runScenario('tikv-failover')).toEqual(before)
  })
})
