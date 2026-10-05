/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from './simulation'
import { analyzeSql } from './sql'

const pointRead = analyzeSql('SELECT * FROM accounts WHERE id = 425')
const write = analyzeSql('UPDATE accounts SET balance = balance + 1 WHERE id = 425')

function survivingLeaderWithLaggingFollower() {
  const simulation = createTiDBSimulation({ seed: 425 })
  simulation.runScenario('cross-region-transaction')
  simulation.requestTrace({
    analysis: pointRead,
    scenarioId: 'tikv-failover',
    regionIds: [0],
  })
  const region = simulation.state.regions.find((candidate) => candidate.id === 19)!
  return { simulation, region }
}

describe('Raft voting, routing, and recovery boundaries', () => {
  it('retains a healthy leader when a different live voter is behind', () => {
    const { simulation, region } = survivingLeaderWithLaggingFollower()
    expect(region.leaderStoreId).toBe('tikv-2')
    expect(region.peers.find((peer) => peer.storeId === 'tikv-1'))
      .toMatchObject({ healthy: false, matchIndex: 2 })
    expect(region.peers.find((peer) => peer.storeId === 'tikv-3'))
      .toMatchObject({ healthy: true, matchIndex: 0 })

    const receipt = simulation.requestTrace({
      analysis: pointRead,
      scenarioId: 'point-read',
      regionIds: [19],
    })!

    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.events.find((event) => event.kind === 'point_get'))
      .toMatchObject({ regionId: 19, target: 'tikv-2' })
    expect(receipt.events.some((event) => event.kind === 'leader_election')).toBe(false)
    expect(region.peers.find((peer) => peer.storeId === 'tikv-3')?.matchIndex).toBe(0)
  })

  it('catches up the lagging live voter before counting its new-entry acknowledgement', () => {
    const { simulation, region } = survivingLeaderWithLaggingFollower()
    const receipt = simulation.requestTrace({
      analysis: write,
      scenarioId: 'point-read',
      regionIds: [19],
      forceProtocol: '2pc',
    })!

    expect(receipt.outcome).toBe('committed')
    expect(receipt.events.find((event) => event.kind === 'append_entry')?.metadata)
      .toMatchObject({ catchUpVoters: 1, catchUpThroughIndex: 2, catchUpCollapsed: true })
    expect(region.commitIndex).toBe(4)
    expect(region.peers.find((peer) => peer.storeId === 'tikv-3'))
      .toMatchObject({ matchIndex: 4, appliedIndex: 4 })
    expect(region.peers.find((peer) => peer.storeId === 'tikv-1'))
      .toMatchObject({ healthy: false, matchIndex: 2, appliedIndex: 2 })
    expect(receipt.events.filter((event) => event.kind === 'quorum_commit'))
      .toEqual([
        expect.objectContaining({ metadata: expect.objectContaining({ acknowledgements: 2 }) }),
        expect.objectContaining({ metadata: expect.objectContaining({ acknowledgements: 2 }) }),
      ])
  })

  it('allows a behind voter to support compact leader election without creating a voting quorum from one live voter', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const region = simulation.state.regions[0]
    region.commitIndex = 42
    region.appliedIndex = 42
    for (const peer of region.peers) {
      peer.matchIndex = peer.storeId === 'tikv-3' ? 41 : 42
      peer.appliedIndex = peer.matchIndex
    }
    region.peers[0].healthy = false

    const receipt = simulation.requestTrace({
      analysis: pointRead,
      scenarioId: 'point-read',
      regionIds: [0],
    })!
    expect(receipt.outcome).toBe('succeeded')
    expect(region.leaderStoreId).toBe('tikv-2')
    expect(region.term).toBe(2)
    expect(region.commitIndex).toBe(43)
    expect(region.appliedIndex).toBe(43)
    expect(region.peers.find((peer) => peer.storeId === 'tikv-2')?.appliedIndex).toBe(43)
    expect(region.peers.find((peer) => peer.storeId === 'tikv-3'))
      .toMatchObject({ matchIndex: 43, appliedIndex: 41 })
    expect(receipt.events.find((event) => event.kind === 'compact_leader_noop_apply')?.metadata)
      .toMatchObject({ term: 2, index: 43, persistedVoters: 2, currentTermConfirmed: true, userDataMutation: false })

    region.peers.find((peer) => peer.storeId === 'tikv-3')!.healthy = false
    const failed = simulation.requestTrace({
      analysis: write,
      scenarioId: 'point-read',
      regionIds: [0],
      forceProtocol: '2pc',
    })!
    expect(failed.outcome).toBe('rolled_back')
    expect(region.commitIndex).toBe(43)
  })

  it('attributes automatic size splitting to TiKV and declares the collapsed control steps', () => {
    const receipt = createTiDBSimulation().runScenario('hotspot-split')
    const split = receipt.events.find((event) => event.kind === 'region_split')!
    expect(split.source).toBe(split.target)
    expect(split.source).toMatch(/^tikv-/)
    expect(split.domain).toBe('kv')
    expect(split.metadata).toMatchObject({
      initiator: 'tikv_size_split_checker',
      pdRole: 'allocate_ids_and_observe_metadata',
      raftApplyCollapsed: true,
    })
  })

  it('makes PD observation depend on election and gates recovered reads on current-term apply', () => {
    const receipt = createTiDBSimulation().runScenario('tikv-failover')
    const elected = receipt.events.find((event) => event.kind === 'raft_leader_elected')!
    const applied = receipt.events.find((event) => event.kind === 'raft_leader_noop_apply')!
    const observed = receipt.events.find((event) => event.kind === 'pd_observes_region_leader')!
    const served = receipt.events.find((event) => event.kind === 'point_get_recovered')!
    expect(observed.dependsOn).toEqual([elected.id])
    expect(observed.domain).toBe('tso')
    expect(observed.metadata.leaderApplyRequired).toBe(false)
    expect(observed.atMs).toBeGreaterThanOrEqual(applied.atMs + applied.durationMs)
    expect(served.dependsOn).toContain(applied.id)
  })
})
