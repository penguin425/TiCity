import { describe, expect, it } from 'vitest'

import { TIDB_SCENARIOS } from './scenarios'
import { createTiDBSimulation } from './simulation'
import type { RegionState, ScenarioId } from './types'

function expectRegionInvariants(regions: readonly RegionState[]): void {
  const ordered = [...regions].sort((a, b) => a.startKey - b.startKey)
  expect(ordered[0]?.startKey).toBe(0)
  for (let index = 0; index < ordered.length; index++) {
    const region = ordered[index]
    expect(region.endKey).toBeGreaterThan(region.startKey)
    expect(region.peers).toHaveLength(3)
    expect(new Set(region.peers.map((peer) => peer.storeId)).size).toBe(3)
    expect(region.peers.filter((peer) => peer.raftRole === 'leader')).toHaveLength(1)
    expect(region.peers.find((peer) => peer.raftRole === 'leader')?.storeId)
      .toBe(region.leaderStoreId)
    expect(region.appliedIndex).toBeLessThanOrEqual(region.commitIndex)
    for (const peer of region.peers) {
      expect(peer.appliedIndex).toBeLessThanOrEqual(region.commitIndex)
    }
    if (index > 0) expect(ordered[index - 1].endKey).toBe(region.startKey)
  }
}

describe('TiDB topology and deterministic clock', () => {
  it('starts with the documented v8.5 teaching topology', () => {
    const state = createTiDBSimulation().state

    expect(state.topology.tiproxy).toHaveLength(2)
    expect(state.topology.tidb).toHaveLength(3)
    expect(state.topology.pd).toHaveLength(3)
    expect(state.topology.pd.filter((node) => node.leader)).toHaveLength(1)
    expect(state.topology.tikv).toHaveLength(3)
    expect(state.topology.tiflash).toHaveLength(1)
    expect(state.regions).toHaveLength(36)
    expectRegionInvariants(state.regions)
  })

  it('produces the same state for the same seed and elapsed fixed steps', () => {
    const chunked = createTiDBSimulation({ seed: 425 })
    const framed = createTiDBSimulation({ seed: 425 })
    chunked.setControl('qps', 73)
    framed.setControl('qps', 73)

    chunked.update(2)
    for (let index = 0; index < 120; index++) framed.update(1 / 60)

    expect(chunked.state).toEqual(framed.state)
  })

  it('is reproducible after reset', () => {
    const sim = createTiDBSimulation({ seed: 99 })
    sim.update(3)
    const first = structuredClone(sim.state)

    sim.reset()
    sim.update(3)

    expect(sim.state).toEqual(first)
  })

  it('gives step, slow, and live playback modes observable behavior', () => {
    const sim = createTiDBSimulation()
    const tick = sim.state.tick

    sim.setPlayback('step')
    expect(sim.state.tick).toBe(tick + 1)
    expect(sim.state.controls.paused).toBe(true)

    sim.setPlayback('slow')
    expect(sim.state.controls.paused).toBe(false)
    expect(sim.state.controls.playbackSpeed).toBe(1)

    sim.setPlayback('live')
    expect(sim.state.controls.playbackSpeed).toBe(4)
  })
})

describe('transactions, Raft, GC, and TiFlash', () => {
  it('keeps transaction phases separate from per-Region Raft quorum', () => {
    const sim = createTiDBSimulation({ seed: 7 })
    const analysis = sim.submitSql(
      'UPDATE accounts SET balance = balance + 1 WHERE id = 7',
    ).analysis
    const receipt = sim.requestTrace({
      analysis,
      regionIds: [0, 12, 24],
      forceProtocol: '2pc',
    })

    expect(receipt?.committed).toBe(true)
    expect(receipt?.protocol).toBe('2pc')
    expect(receipt?.events.some((event) => event.domain === 'txn2pc' && event.kind === 'prewrite'))
      .toBe(true)
    expect(receipt?.events.some((event) => event.domain === 'raft' && event.kind === 'quorum_commit'))
      .toBe(true)
    expect(receipt?.events.find((event) => event.domain === 'txn2pc' && event.kind === 'prewrite')?.id)
      .not.toBe(receipt?.events.find((event) => event.domain === 'raft' && event.kind === 'quorum_commit')?.id)
    expect(receipt?.commitTs).toBeGreaterThan(receipt?.startTs ?? Number.MAX_SAFE_INTEGER)
    expectRegionInvariants(sim.state.regions)
  })

  it.each([
    [[0], 'auto', '1pc'],
    [[0, 1], 'auto', 'async_commit'],
    [[0, 1, 2], 'auto', 'async_commit'],
    [[0, 1, 2], '2pc', '2pc'],
  ] as const)('resolves eligible Regions %j in %s mode to %s', (regionIds, forced, expected) => {
    const sim = createTiDBSimulation()
    const analysis = sim.submitSql('INSERT INTO events (id) VALUES (1)').analysis
    const receipt = sim.requestTrace({ analysis, regionIds, forceProtocol: forced })

    expect(receipt?.protocol).toBe(expected)
    expect(receipt?.committed).toBe(true)
  })

  it('keeps reads and model-only EXPLAIN separate from transaction commit', () => {
    const sim = createTiDBSimulation()
    const read = sim.submitSql('SELECT * FROM accounts WHERE id = 7').receipt
    const explain = sim.submitSql('EXPLAIN SELECT * FROM accounts WHERE id = 7').receipt

    for (const receipt of [read, explain]) {
      expect(receipt?.succeeded).toBe(true)
      expect(receipt?.committed).toBe(false)
      expect(receipt?.outcome).toBe('succeeded')
      expect(receipt?.protocol).toBeNull()
      expect(receipt?.replay.commitProtocol).toBeNull()
    }
  })

  it('does not retain SQL literals and deep-freezes the published receipt model', () => {
    const sim = createTiDBSimulation()
    const secret = 'customer-secret-425'
    const receipt = sim.submitSql(
      `SELECT * FROM accounts WHERE note = '${secret}' AND id = 7`,
    ).receipt!

    expect(JSON.stringify(receipt)).not.toContain(secret)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.analysis)).toBe(true)
    expect(Object.isFrozen(receipt.analysis.plan)).toBe(true)
    expect(Object.isFrozen(receipt.analysis.plan[0]?.children)).toBe(true)
  })

  it('returns Async Commit after prewrite and resolves commit records in the background', () => {
    const sim = createTiDBSimulation()
    const analysis = sim.submitSql(
      'INSERT INTO events (id, account_id) VALUES (1, 7)',
    ).analysis
    const receipt = sim.requestTrace({
      analysis,
      regionIds: [0, 1, 2],
      forceProtocol: 'async_commit',
    })!
    const kinds = receipt.events.map((event) => event.kind)

    expect(receipt.committed).toBe(true)
    expect(kinds).toContain('min_commit_ts')
    expect(kinds).not.toContain('commit_ts')
    expect(kinds).not.toContain('commit_primary')
    expect(kinds.indexOf('complete')).toBeLessThan(kinds.indexOf('commit_background'))
    expect(receipt.events.filter((event) => event.kind === 'commit_background'))
      .toHaveLength(3)
  })

  it('does not elect or serve a Region after two of three voters are lost', () => {
    const sim = createTiDBSimulation()
    const region = sim.state.regions[0]
    for (const peer of region.peers.slice(1)) peer.healthy = false
    const analysis = sim.submitSql('SELECT * FROM accounts WHERE id = 7').analysis
    const receipt = sim.requestTrace({ analysis, regionIds: [region.id] })!

    expect(receipt.succeeded).toBe(false)
    expect(receipt.outcome).toBe('failed')
    expect(receipt.events.some((event) => event.kind === 'leader_election')).toBe(false)
    expect(receipt.events.some((event) => event.kind === 'point_get')).toBe(false)
  })

  it('holds the GC safe point behind an active old transaction', () => {
    const sim = createTiDBSimulation()
    sim.runScenario('gc-safe-point')
    const blocked = sim.state.gc.safePoint
    expect(sim.state.gc.blockedByStartTs).not.toBeNull()
    expect(sim.state.gc.backlog).toBeGreaterThan(0)
    expect(sim.state.lastTrace?.events.some((event) =>
      event.kind === 'gc_safe_point_blocked' &&
      event.metadata.gcMaxWaitSeconds === 86_400,
    )).toBe(true)

    sim.update(sim.state.controls.gcLifetimeSeconds + 2)

    expect(sim.state.gc.safePoint).toBe(blocked)
  })

  it('makes TiFlash visibility lag deterministic and never models direct TiFlash writes', () => {
    const sim = createTiDBSimulation()
    sim.setControl('qps', 0)
    sim.setControl('tiflashLagSeconds', 2)
    const write = sim.submitSql('INSERT INTO events (id) VALUES (1)').receipt

    expect(write?.events.some((event) =>
      event.domain === 'tiflash' && event.kind === 'direct_write',
    )).toBe(false)
    expect(sim.state.tiflash.targetTs).toBeGreaterThan(sim.state.tiflash.resolvedTs)
    sim.update(1)
    expect(sim.state.tiflash.resolvedTs).toBeLessThan(sim.state.tiflash.targetTs)
    sim.update(1.1)
    expect(sim.state.tiflash.resolvedTs).toBe(sim.state.tiflash.targetTs)
  })

  it('queues TiFlash replication only for the demo table with a replica', () => {
    const sim = createTiDBSimulation()
    sim.setControl('qps', 0)
    const targetBefore = sim.state.tiflash.targetTs

    sim.submitSql('UPDATE accounts SET balance = 1 WHERE id = 7')
    expect(sim.state.tiflash.targetTs).toBe(targetBefore)

    sim.submitSql('INSERT INTO events (id, account_id) VALUES (1, 7)')
    expect(sim.state.tiflash.targetTs).toBeGreaterThan(targetBefore)

    const tikvAggregate = sim.submitSql('SELECT count(*) FROM accounts').receipt!
    expect(tikvAggregate.events.some((event) => event.domain === 'tiflash')).toBe(false)
  })

  it('clears modeled TiFlash pending lag after an MPP snapshot catches up', () => {
    const sim = createTiDBSimulation()
    sim.setControl('qps', 0)
    sim.setControl('tiflashLagSeconds', 2)
    sim.submitSql('INSERT INTO events (id, account_id) VALUES (1, 7)')

    const receipt = sim.submitSql('SELECT count(*) FROM events').receipt!

    expect(receipt.succeeded).toBe(true)
    expect(sim.state.tiflash.resolvedTs).toBe(sim.state.tiflash.targetTs)
    expect(sim.state.tiflash.pendingVersions).toBe(0)
    expect(sim.state.tiflash.lagSeconds).toBe(0)
  })
})

describe('guided scenarios', () => {
  it('ships all eight decision-complete scenario receipts', () => {
    const expected: ScenarioId[] = [
      'point-read',
      'cross-region-transaction',
      'optimistic-conflict',
      'commit-protocols',
      'hotspot-split',
      'tikv-failover',
      'gc-safe-point',
      'tiflash-mpp',
    ]
    expect(TIDB_SCENARIOS.map((scenario) => scenario.id)).toEqual(expected)

    for (const id of expected) {
      const sim = createTiDBSimulation({ seed: 2026 })
      const receipt = sim.runScenario(id)
      expect(receipt.scenarioId).toBe(id)
      expect(receipt.events.length, id).toBeGreaterThan(2)
      expect(receipt.replay.scenarioId).toBe(id)
      expectRegionInvariants(sim.state.regions)
    }
  })

  it('splits a hot sequential Region without gaps or overlaps', () => {
    const sim = createTiDBSimulation()
    const receipt = sim.runScenario('hotspot-split')

    expect(sim.state.regions).toHaveLength(37)
    expect(sim.state.metrics.regionSplits).toBe(1)
    expect(receipt.events.findIndex((event) => event.kind === 'submit'))
      .toBeLessThan(receipt.events.findIndex((event) => event.kind === 'region_split'))
    expect(sim.state.transactions.at(-1)?.regionIds).toContain(35)
    expect(sim.state.regions.find((region) => region.id === 35)?.endKey)
      .toBe(Math.max(...sim.state.regions.map((region) => region.endKey)))
    expectRegionInvariants(sim.state.regions)
  })

  it('compares 1PC, Async Commit, and 2PC in the commit protocol scenario', () => {
    const sim = createTiDBSimulation()
    const receipt = sim.runScenario('commit-protocols')
    const selected = receipt.events
      .filter((event) => event.kind === 'protocol_selection')
      .map((event) => event.metadata.selected)

    expect(selected).toEqual(['1pc', 'async_commit', '2pc'])
    expect(sim.state.transactions.map((transaction) => transaction.protocol))
      .toEqual(['1pc', 'async_commit', '2pc'])
    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.protocol).toBeNull()
  })

  it('elects a live voter after the TiKV leader fails', () => {
    const sim = createTiDBSimulation()
    const receipt = sim.runScenario('tikv-failover')
    const region = sim.state.regions[0]

    expect(sim.state.metrics.leaderElections).toBe(1)
    expect(region.term).toBeGreaterThan(1)
    expect(region.peers.find((peer) => peer.raftRole === 'leader')?.healthy).toBe(true)
    expect(receipt.events.some((event) => event.kind === 'leader_election')).toBe(true)
  })

  it('creates distinct receipt objects across deterministic scenario resets', () => {
    const sim = createTiDBSimulation()
    const first = sim.runScenario('point-read')
    const second = sim.runScenario('tikv-failover')

    expect(first.id).toBe('trace-1')
    expect(second.id).toBe('trace-1')
    expect(second).not.toBe(first)
    expect(second.events).not.toEqual(first.events)
  })
})
