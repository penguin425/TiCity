// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

import { describe, expect, it } from 'vitest'
import { createTiDBSimulation } from './simulation'
import { analyzeSql } from './sql'

describe('consistent compact follower reads', () => {
  function runLaggingRead() {
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.runScenario('cross-region-transaction')
    const analysis = analyzeSql('SELECT * FROM accounts WHERE id = 425')
    simulation.requestTrace({ analysis, scenarioId: 'tikv-failover', regionIds: [0] })
    const region = simulation.state.regions.find((candidate) => candidate.id === 19)!
    const follower = region.peers.find((peer) => peer.storeId === 'tikv-3')!
    const before = { matched: follower.matchIndex, applied: follower.appliedIndex, committed: region.commitIndex }
    simulation.setControl('readPolicy', 'follower')
    const receipt = simulation.requestTrace({ analysis, scenarioId: 'point-read', regionIds: [19] })!
    return { before, receipt, follower }
  }

  it('obtains ReadIndex and applies a naturally lagging voter before serving its snapshot', () => {
    const { before, receipt, follower } = runLaggingRead()
    expect(before).toEqual({ matched: 0, applied: 0, committed: 2 })
    expect(receipt.outcome).toBe('succeeded')
    const index = receipt.events.find((event) => event.kind === 'follower_read_index')!
    const applied = receipt.events.find((event) => event.kind === 'follower_apply_wait')!
    const read = receipt.events.find((event) => event.kind === 'point_get')!
    expect(index.metadata.readIndex).toBe(2)
    expect(applied.dependsOn).toEqual([index.id])
    expect(applied.metadata).toMatchObject({ readIndex: 2, appliedBefore: 0, appliedIndex: 2, waited: true })
    expect(read.dependsOn).toEqual([applied.id])
    expect(read.target).toBe('tikv-3')
    expect(follower.appliedIndex).toBeGreaterThanOrEqual(Number(index.metadata.readIndex))
    expect(runLaggingRead().receipt).toEqual(receipt)
  })

  it('keeps the leader read path free of follower-only gates', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('point-read')
    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.events.some((event) => event.kind.startsWith('follower_'))).toBe(false)
  })

  it('commits the new-term no-op before ReadIndex after a compact election', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.runScenario('tikv-failover')
    simulation.setControl('readPolicy', 'follower')
    const receipt = simulation.requestTrace({
      analysis: analyzeSql('SELECT * FROM accounts WHERE id = 425'),
      scenarioId: 'point-read', regionIds: [3],
    })!
    const noop = receipt.events.find((event) => event.kind === 'compact_leader_noop_apply')!
    const readIndex = receipt.events.find((event) => event.kind === 'follower_read_index')!
    expect(receipt.outcome).toBe('succeeded')
    expect(noop.metadata).toMatchObject({ currentTermConfirmed: true, userDataMutation: false, index: 1 })
    expect(readIndex.dependsOn).toEqual([noop.id])
    expect(readIndex.metadata.readIndex).toBe(1)
  })
})
