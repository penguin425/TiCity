/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from './simulation'
import { analyzeSql } from './sql'
import type { StoreId, TiDBSimulationApi, TraceReceipt } from './types'

const WRITE = 'UPDATE accounts SET balance = balance + 1 WHERE id = 7'
const READ = 'SELECT * FROM accounts WHERE id = 7'

function stopStore(simulation: TiDBSimulationApi, storeId: StoreId): void {
  const node = simulation.state.topology.tikv.find((candidate) => candidate.id === storeId)!
  node.status = 'down'
  for (const region of simulation.state.regions) {
    const peer = region.peers.find((candidate) => candidate.storeId === storeId)!
    peer.healthy = false
  }
}

function conflictTrace(simulation: TiDBSimulationApi): TraceReceipt {
  const receipt = simulation.requestTrace({
    analysis: analyzeSql(WRITE),
    regionIds: [0],
    forceProtocol: '2pc',
    forceConflict: true,
  })
  expect(receipt).not.toBeNull()
  return receipt!
}

describe('live transaction source invariants', () => {
  it.each([
    { mode: 'pessimistic', sql: WRITE },
    { mode: 'optimistic', sql: READ },
    { mode: 'optimistic', sql: `EXPLAIN ${READ}` },
  ] as const)('rejects an optimistic conflict injection on $mode / $sql without consuming state or receipt IDs', ({ mode, sql }) => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const control = createTiDBSimulation({ seed: 425 })
    simulation.setControl('transactionMode', mode)
    control.setControl('transactionMode', mode)
    const before = structuredClone(simulation.state)
    const analysis = analyzeSql(sql)
    expect(analysis.status).toBe('supported')

    expect(simulation.requestTrace({ analysis, regionIds: [0], forceConflict: true })).toBeNull()
    expect(simulation.state).toEqual(before)
    // Equality of the next successful trace checks the private receipt counter
    // as well as public TSO, transaction, metrics, and lastTrace projections.
    const next = simulation.submitSql(READ).receipt!
    expect(next.id).toBe('trace-1')
    expect(next).toEqual(control.submitSql(READ).receipt)
    expect(simulation.state).toEqual(control.state)
  })

  it('checks the optimistic MVCC conflict before proposing a user-data Raft entry', () => {
    // TiKV actions/prewrite.rs:500-510 compares commit_ts with optimistic
    // start_ts during snapshot processing, before producing a write batch.
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.setControl('transactionMode', 'optimistic')
    const before = structuredClone(simulation.state)
    const receipt = conflictTrace(simulation)
    const kinds = receipt.events.map((event) => event.kind)
    expect(receipt.outcome).toBe('rolled_back')
    expect(kinds.indexOf('optimistic_prewrite_check')).toBeGreaterThan(kinds.indexOf('start_ts'))
    expect(kinds.indexOf('write_conflict')).toBeGreaterThan(kinds.indexOf('optimistic_prewrite_check'))
    expect(kinds.indexOf('rollback')).toBeGreaterThan(kinds.indexOf('write_conflict'))
    expect(kinds).not.toContain('append_entry')
    expect(kinds).not.toContain('pessimistic_lock')
    expect(kinds).not.toContain('commit_ts')
    expect(simulation.state.tso.allocations - before.tso.allocations).toBe(1)
    expect(simulation.state.regions).toEqual(before.regions)
    expect(simulation.state.metrics.raftEntries).toBe(before.metrics.raftEntries)
    expect(simulation.state.metrics.conflicts).toBe(before.metrics.conflicts + 1)
    expect(simulation.state.transactions.at(-1)).toMatchObject({
      mode: 'optimistic', phase: 'rolled_back', conflict: true, commitTs: null,
    })
  })

  it('establishes a replacement leader before reaching an optimistic MVCC conflict', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.setControl('transactionMode', 'optimistic')
    const region = simulation.state.regions[0]
    const oldLeader = region.leaderStoreId
    const beforeIndex = region.commitIndex
    stopStore(simulation, oldLeader)

    const receipt = conflictTrace(simulation)
    const kinds = receipt.events.map((event) => event.kind)
    const dispatch = receipt.events.find((event) => event.kind === 'optimistic_prewrite_check')!
    expect(region.leaderStoreId).not.toBe(oldLeader)
    expect(kinds.indexOf('leader_election')).toBeLessThan(kinds.indexOf('optimistic_prewrite_check'))
    expect(kinds.indexOf('compact_leader_noop_apply')).toBeLessThan(kinds.indexOf('optimistic_prewrite_check'))
    expect(dispatch.target).toBe(region.leaderStoreId)
    expect(kinds.indexOf('optimistic_prewrite_check')).toBeLessThan(kinds.indexOf('write_conflict'))
    expect(kinds).not.toContain('append_entry')
    // The new term's empty entry is distinct from an optimistic mutation.
    expect(region.commitIndex).toBe(beforeIndex + 1)
    expect(simulation.state.metrics.conflicts).toBe(1)
  })

  it('uses a leader elected by background work without replaying the previous leader or election', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.setControl('transactionMode', 'optimistic')
    simulation.setControl('writeRatio', 1)
    simulation.setControl('qps', 5000)
    const region = simulation.state.regions[0]
    const oldLeader = region.leaderStoreId
    stopStore(simulation, oldLeader)
    simulation.update(0.1)
    expect(region.leaderStoreId).not.toBe(oldLeader)
    const before = structuredClone(region)
    const metricsBefore = { ...simulation.state.metrics }

    const receipt = conflictTrace(simulation)
    const dispatch = receipt.events.find((event) => event.kind === 'optimistic_prewrite_check')!
    expect(dispatch.target).toBe(before.leaderStoreId)
    expect(receipt.events.some((event) => event.kind === 'leader_election')).toBe(false)
    expect(receipt.events.some((event) => event.kind === 'write_conflict')).toBe(true)
    expect(region).toEqual(before)
    expect(simulation.state.metrics.leaderElections).toBe(metricsBefore.leaderElections)
    expect(simulation.state.metrics.raftEntries).toBe(metricsBefore.raftEntries)
  })

  it.each([false, true])('reports unavailable prewrite instead of a synthetic conflict after two failures (background=%s)', (background) => {
    // A scheduler snapshot error finishes the request before command handling:
    // TiKV scheduler.rs:740-778. There is no MVCC result to invent here.
    const simulation = createTiDBSimulation({ seed: 425 })
    simulation.setControl('transactionMode', 'optimistic')
    const region = simulation.state.regions[0]
    const followers = region.peers.filter((peer) => peer.storeId !== region.leaderStoreId)
    for (const follower of followers) stopStore(simulation, follower.storeId)
    if (background) {
      simulation.setControl('qps', 5000)
      simulation.setControl('writeRatio', 1)
      simulation.update(0.1)
    }
    const before = structuredClone(region)
    const metricsBefore = { ...simulation.state.metrics }
    const receipt = conflictTrace(simulation)
    const kinds = receipt.events.map((event) => event.kind)
    expect(receipt).toMatchObject({ outcome: 'rolled_back', committed: false, commitTs: null })
    expect(receipt.warnings.join(' ')).toMatch(/unavailable before optimistic prewrite/)
    expect(kinds).toContain('error')
    expect(kinds).not.toContain('optimistic_prewrite_check')
    expect(kinds).not.toContain('write_conflict')
    expect(kinds).not.toContain('leader_election')
    expect(kinds).not.toContain('append_entry')
    expect(region.commitIndex).toBe(before.commitIndex)
    expect(region.appliedIndex).toBe(before.appliedIndex)
    expect(region.term).toBe(before.term)
    expect(simulation.state.metrics.conflicts).toBe(metricsBefore.conflicts)
    expect(simulation.state.metrics.raftEntries).toBe(metricsBefore.raftEntries)
    expect(simulation.state.transactions.at(-1)).toMatchObject({ conflict: false, phase: 'rolled_back' })
  })
})

describe('Protocol Lab to live PD timestamp continuity', () => {
  it('keeps seven actual PD allocations separate from TiKV results and places the next read after every commit', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const initialPd = simulation.state.tso.lastAllocated
    const receipt = simulation.runScenario('commit-protocols')
    let lastPd = initialPd
    const pdTimestamps: number[] = []
    for (const event of receipt.events) {
      for (const delta of event.deltas ?? []) {
        if (delta.kind !== 'protocol_timestamp' || delta.source !== 'pd') continue
        expect(delta.timestamp).toBeGreaterThan(lastPd)
        lastPd = delta.timestamp
        pdTimestamps.push(delta.timestamp)
      }
      expect(event.snapshot!.tsoLastAllocated).toBe(lastPd)
    }
    const final = receipt.events.at(-1)!.snapshot!.protocolLab!
    const commitTimestamps = final.lanes.map((lane) => lane.commitTs!)
    const latestCommit = Math.max(...commitTimestamps)
    expect(pdTimestamps).toHaveLength(7)
    expect(simulation.state.tso).toEqual({ lastAllocated: lastPd, allocations: 7 })
    expect(lastPd).toBeGreaterThanOrEqual(latestCommit)
    expect(simulation.state.transactions.map((transaction) => transaction.commitTs))
      .toEqual(commitTimestamps)

    const read = simulation.submitSql(READ).receipt!
    expect(read.succeeded).toBe(true)
    expect(read.startTs).toBeGreaterThanOrEqual(latestCommit)
    expect(read.startTs).toBeGreaterThan(lastPd)
    expect(simulation.state.tso).toEqual({ lastAllocated: read.startTs, allocations: 8 })
    expect(read.events.some((event) => event.snapshot?.protocolLab !== undefined)).toBe(false)
    const secondRead = simulation.submitSql(READ).receipt!
    expect(secondRead.startTs).toBeGreaterThan(read.startTs!)
    expect(simulation.state.tso.allocations).toBe(9)
  })
})
