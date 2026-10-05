/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from './simulation'
import { analyzeSql } from './sql'

const pointRead = analyzeSql('SELECT * FROM accounts WHERE id = 425')
const insert = analyzeSql('INSERT INTO events (id, account_id) VALUES (999999, 7)')

describe('live compact Raft and split invariants', () => {
  it('applies the split admin command before changing ranges and preserves an unavailable peer', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.requestTrace({ analysis: pointRead, scenarioId: 'tikv-failover', regionIds: [0] })
    simulation.setControl('regionSplitThresholdMiB', 8)
    const before = structuredClone(simulation.state.regions.find((region) => region.id === 35)!)

    const receipt = simulation.requestTrace({
      analysis: insert,
      scenarioId: 'hotspot-split',
      regionIds: [35],
      forceProtocol: '2pc',
    })!

    expect(receipt.outcome).toBe('committed')
    const committed = receipt.events.find((event) =>
      event.kind === 'quorum_commit' && event.metadata.operation === 'region_split')!
    const split = receipt.events.find((event) => event.kind === 'region_split')!
    expect(committed.metadata).toMatchObject({ index: before.commitIndex + 1, acknowledgements: 2, quorum: 2 })
    expect(committed.transactionId).toBeUndefined()
    expect(receipt.events.indexOf(committed)).toBeLessThan(receipt.events.indexOf(split))
    expect(split.metadata).toMatchObject({ epoch: before.epoch + 1, raftApplyCollapsed: true })
    expect(split.atMs).toBeGreaterThanOrEqual(committed.atMs + committed.durationMs)

    const upper = simulation.state.regions.find((region) => region.id === 35)!
    const lower = simulation.state.regions.find((region) => region.id === split.metadata.newRegionId)!
    expect([lower.startKey, lower.endKey, upper.startKey, upper.endKey])
      .toEqual([before.startKey, split.metadata.splitKey, split.metadata.splitKey, before.endKey])
    expect(lower.epoch).toBe(upper.epoch)
    // Compact splitting copies the applied parent projection; a new group's
    // independent Raft bootstrap is outside this explicitly collapsed fixture.
    expect(lower.commitIndex).toBe(committed.metadata.index)
    expect(lower.appliedIndex).toBe(lower.commitIndex)
    expect(upper.commitIndex).toBe(lower.commitIndex + 2)
    for (const region of [lower, upper]) {
      expect(region.peers.filter((peer) => peer.healthy)).toHaveLength(2)
      expect(region.peers.find((peer) => peer.storeId === 'tikv-1'))
        .toMatchObject({ healthy: false, matchIndex: 0, appliedIndex: 0 })
    }
  })

  it('preserves every range, epoch and index when two public outages remove the split quorum', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    expect(simulation.requestTrace({ analysis: pointRead, scenarioId: 'tikv-failover', regionIds: [0] })?.outcome)
      .toBe('succeeded')
    expect(simulation.requestTrace({ analysis: pointRead, scenarioId: 'tikv-failover', regionIds: [0] })?.outcome)
      .toBe('failed')
    simulation.setControl('regionSplitThresholdMiB', 8)
    const regionsBefore = structuredClone(simulation.state.regions)
    const entriesBefore = simulation.state.metrics.raftEntries

    const receipt = simulation.requestTrace({
      analysis: insert,
      scenarioId: 'hotspot-split',
      regionIds: [35],
    })!

    expect(receipt.outcome).toBe('rolled_back')
    expect(receipt.events.some((event) => event.kind === 'quorum_unavailable')).toBe(true)
    expect(receipt.events.some((event) => event.kind === 'region_split' || event.kind === 'quorum_commit')).toBe(false)
    expect(simulation.state.regions).toEqual(regionsBefore)
    expect(simulation.state.metrics.regionSplits).toBe(0)
    expect(simulation.state.metrics.raftEntries).toBe(entriesBefore)
    expect(simulation.state.topology.tikv.filter((store) => store.status === 'down')).toHaveLength(2)
  })

  it('recovers a lost leader during deterministic background writes without another traced request', () => {
    const recover = () => {
      const simulation = createTiDBSimulation({ seed: 425 })
      simulation.requestTrace({ analysis: pointRead, scenarioId: 'tikv-failover', regionIds: [0] })
      const before = structuredClone(simulation.state.regions.find((region) => region.id === 3)!)
      expect(before.peers.find((peer) => peer.storeId === before.leaderStoreId)?.healthy).toBe(false)
      expect(before.peers.filter((peer) => peer.healthy)).toHaveLength(2)
      simulation.setControl('qps', 1_000)
      simulation.setControl('writeRatio', 1)
      simulation.setControl('keyDistribution', 'uniform')
      simulation.update(0.2)
      return { simulation, before }
    }

    const { simulation, before } = recover()
    const recovered = simulation.state.regions.find((region) => region.id === before.id)!
    expect(recovered.peers.find((peer) => peer.storeId === recovered.leaderStoreId)?.healthy).toBe(true)
    expect(recovered.leaderStoreId).not.toBe(before.leaderStoreId)
    expect(recovered.term).toBeGreaterThan(before.term)
    expect(recovered.commitIndex).toBeGreaterThan(before.commitIndex)
    expect(recovered.peers.find((peer) => peer.storeId === 'tikv-1'))
      .toMatchObject({ healthy: false, matchIndex: 0, appliedIndex: 0 })
    expect(simulation.state.metrics.commits).toBe(200)
    expect(simulation.state.metrics.rollbacks).toBe(0)
    expect(recover().simulation.state).toEqual(simulation.state)
  })
})
