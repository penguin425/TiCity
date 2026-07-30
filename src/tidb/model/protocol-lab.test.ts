/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import {
  createProtocolLabState,
  reduceProtocolLabState,
} from './protocol-lab'
import type {
  ProtocolLabDelta,
  ProtocolLabLaneDefinition,
} from './protocol-lab'
import { createTiDBSimulation } from './simulation'
import type {
  TraceEvent,
  TraceProtocolLabSnapshot,
  TraceProtocolLaneId,
  TraceProtocolLaneSnapshot,
  TraceReceipt,
  TraceStateDelta,
} from './types'

type TimestampDelta = Extract<
  TraceStateDelta,
  { kind: 'protocol_timestamp' }
>
type RaftDelta = Extract<
  TraceStateDelta,
  { kind: 'protocol_region_raft' }
>

function runProtocolLab(seed = 2026) {
  const simulation = createTiDBSimulation({ seed })
  return {
    simulation,
    receipt: simulation.runScenario('commit-protocols'),
  }
}

function eventAt(receipt: TraceReceipt, number: number): TraceEvent {
  const event = receipt.events[number - 1]
  if (!event) throw new Error(`Missing Protocol Lab event ${number}`)
  return event
}

function labAt(
  receipt: TraceReceipt,
  number: number,
): TraceProtocolLabSnapshot {
  const lab = eventAt(receipt, number).snapshot?.protocolLab
  if (!lab) throw new Error(`Event ${number} has no Protocol Lab snapshot`)
  return lab
}

function lane(
  lab: TraceProtocolLabSnapshot,
  laneId: TraceProtocolLaneId,
): TraceProtocolLaneSnapshot {
  const lane = lab.lanes.find((candidate) => candidate.id === laneId)
  if (!lane) throw new Error(`Missing Protocol Lab lane ${laneId}`)
  return lane
}

function timestampDeltas(
  receipt: TraceReceipt,
  laneId: TraceProtocolLaneId,
): TimestampDelta[] {
  return receipt.events.flatMap((event) =>
    (event.deltas ?? []).filter(
      (delta): delta is TimestampDelta =>
        delta.kind === 'protocol_timestamp' && delta.laneId === laneId,
    ))
}

const EXPECTED_KINDS = [
  'protocol_comparison_start',
  'protocol_client_request',
  'protocol_start_ts',
  'protocol_eligibility_check',
  'protocol_latest_ts_floor',
  'one_pc_prewrite_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_one_pc_mvcc',
  'one_pc_result',
  'protocol_client_response',
  'protocol_branch_complete',
  'protocol_client_request',
  'protocol_start_ts',
  'protocol_eligibility_check',
  'protocol_selection',
  'protocol_latest_ts_floor',
  'async_prewrite_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_prewrite_mvcc',
  'async_prewrite_result',
  'async_prewrite_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_prewrite_mvcc',
  'async_prewrite_result',
  'async_commit_decision',
  'protocol_client_response',
  'async_commit_background_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_commit_mvcc',
  'async_commit_background_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_commit_mvcc',
  'protocol_branch_complete',
  'protocol_client_request',
  'protocol_start_ts',
  'protocol_eligibility_check',
  'protocol_selection',
  'two_pc_prewrite_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_prewrite_mvcc',
  'two_pc_prewrite_result',
  'two_pc_prewrite_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_prewrite_mvcc',
  'two_pc_prewrite_result',
  'two_pc_all_prewritten',
  'two_pc_commit_ts',
  'two_pc_primary_commit_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_commit_mvcc',
  'protocol_client_response',
  'two_pc_secondary_commit_dispatch',
  'protocol_raft_propose',
  'protocol_raft_persist_quorum',
  'protocol_raft_commit',
  'raft_apply_commit_mvcc',
  'protocol_branch_complete',
  'protocol_lab_complete',
] as const

describe('model-5 Protocol Lab trace', () => {
  it('publishes the exact deterministic 74-event comparison DAG', () => {
    const first = runProtocolLab()
    const second = runProtocolLab()
    const { receipt } = first

    expect(receipt).toEqual(second.receipt)
    expect(first.simulation.state).toEqual(second.simulation.state)
    expect(receipt.id).toBe('trace-1')
    expect(receipt.events).toHaveLength(74)
    expect(receipt.events.map((event) => event.kind)).toEqual(EXPECTED_KINDS)
    expect(receipt.events.map((event) => event.id)).toEqual(
      EXPECTED_KINDS.map((_, index) => `trace-1-event-${index + 1}`),
    )

    const backgroundIds = new Set([
      ...Array.from({ length: 11 }, (_, index) => index + 33),
      ...Array.from({ length: 7 }, (_, index) => index + 68),
    ])
    for (let number = 1; number <= 74; number++) {
      expect(eventAt(receipt, number).path, `event ${number}`).toBe(
        backgroundIds.has(number) ? 'background' : 'critical',
      )
    }

    const byId = new Map(receipt.events.map((event) => [event.id, event]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (event: TraceEvent): void => {
      expect(visiting.has(event.id), `cycle at ${event.id}`).toBe(false)
      if (visited.has(event.id)) return
      visiting.add(event.id)
      for (const dependencyId of event.dependsOn ?? []) {
        const dependency = byId.get(dependencyId)
        expect(dependency, `${event.id} -> ${dependencyId}`).toBeDefined()
        if (!dependency) continue
        expect(dependency.atMs + dependency.durationMs)
          .toBeLessThanOrEqual(event.atMs)
        visit(dependency)
      }
      visiting.delete(event.id)
      visited.add(event.id)
    }
    for (const event of receipt.events) visit(event)
    expect(visited.size).toBe(74)
    expect(eventAt(receipt, 1).dependsOn).toEqual([])
    expect(eventAt(receipt, 19).dependsOn).toEqual(['trace-1-event-18'])
    expect(eventAt(receipt, 25).dependsOn).toEqual(['trace-1-event-18'])
    expect(eventAt(receipt, 19).atMs).toBe(eventAt(receipt, 25).atMs)
    expect(eventAt(receipt, 31).dependsOn).toEqual([
      'trace-1-event-24',
      'trace-1-event-30',
    ])
    expect(eventAt(receipt, 33).atMs).toBe(eventAt(receipt, 38).atMs)
    expect(eventAt(receipt, 43).dependsOn).toEqual([
      'trace-1-event-37',
      'trace-1-event-42',
    ])
    expect(eventAt(receipt, 48).atMs).toBe(eventAt(receipt, 54).atMs)
    expect(eventAt(receipt, 60).dependsOn).toEqual([
      'trace-1-event-53',
      'trace-1-event-59',
    ])
    expect(eventAt(receipt, 74).dependsOn).toEqual([
      'trace-1-event-13',
      'trace-1-event-43',
      'trace-1-event-73',
    ])
  })

  it('keeps every Region mutation behind its own 2-of-3 Raft chain', () => {
    const { receipt, simulation } = runProtocolLab()
    const raftSteps = receipt.events.flatMap((event) =>
      (event.deltas ?? []).flatMap((delta) =>
        delta.kind === 'protocol_region_raft'
          ? [{ event, delta: delta as RaftDelta }]
          : []))
    const groups = new Map<string, typeof raftSteps>()
    for (const step of raftSteps) {
      const key = [
        step.delta.laneId,
        step.delta.regionId,
        step.delta.operation,
        step.delta.index,
      ].join(':')
      groups.set(key, [...(groups.get(key) ?? []), step])
    }

    expect(groups.size).toBe(9)
    expect(raftSteps).toHaveLength(36)
    expect(simulation.state.metrics.raftEntries).toBe(9)
    for (const steps of groups.values()) {
      expect(steps.map(({ delta }) => delta.action)).toEqual([
        'propose',
        'persist_quorum',
        'commit',
        'apply',
      ])
      expect(steps.map(({ event }) => event.kind)).toEqual([
        'protocol_raft_propose',
        'protocol_raft_persist_quorum',
        'protocol_raft_commit',
        expect.stringMatching(/^raft_apply_/),
      ])
      expect(steps[1].delta.storeIds).toHaveLength(2)
      expect(new Set(steps[1].delta.storeIds).size).toBe(2)
      expect(steps[1].event.metadata).toMatchObject({
        acknowledgements: 2,
        quorum: 2,
        voterCount: 3,
      })
      expect(steps[2].event.metadata).toMatchObject({
        transactionLayer: 'tidb_transaction_commit',
        raftLayer: 'per_region_consensus',
      })
    }
  })

  it('records exact eligibility decisions and timestamp authorities', () => {
    const { receipt, simulation } = runProtocolLab()
    const final = labAt(receipt, 74)
    const [one, async, two] = final.lanes

    expect(final).toMatchObject({
      consistency: 'linearizable',
      transactionMode: 'optimistic',
      transactionScope: 'global',
      representation: 'aggregate_counts_only',
      safeWindowMs: 2000,
      coordinatorLayer: 'tidb_transaction_commit',
      raftLayer: 'per_region_consensus',
      tikvAsyncApplyPrewrite: false,
    })
    expect(one.eligibility).toMatchObject({
      mutationCount: 2,
      totalKeyBytes: 16,
      regionCount: 1,
      onePcEligible: true,
      asyncCommitEligible: true,
      selected: '1pc',
      tryOnePcSent: true,
      runtimeFallback: false,
    })
    expect(async.eligibility).toMatchObject({
      mutationCount: 2,
      totalKeyBytes: 16,
      regionCount: 2,
      onePcEligible: false,
      onePcRejectedBeforeRpc: true,
      asyncCommitEligible: true,
      selected: 'async_commit',
      tryOnePcSent: false,
      runtimeFallback: false,
    })
    expect(two.eligibility).toMatchObject({
      mutationCount: 257,
      totalKeyBytes: 2056,
      regionCount: 2,
      onePcEligible: false,
      asyncCommitEligible: false,
      asyncRejectedAtClientPrecheck: true,
      asyncKeyCountLimit: 256,
      asyncTotalKeyBytesLimit: 4096,
      selected: '2pc',
      runtimeFallback: false,
    })

    expect(timestampDeltas(receipt, 'one_pc').map((delta) => [
      delta.purpose,
      delta.source,
    ])).toEqual([
      ['start_ts', 'pd'],
      ['latest_ts', 'pd'],
      ['request_min_commit_ts', 'tidb_model_bound'],
      ['max_commit_ts', 'tidb_model_bound'],
      ['one_pc_commit_ts', 'tikv'],
    ])
    expect(timestampDeltas(receipt, 'async_commit').map((delta) => [
      delta.purpose,
      delta.source,
    ])).toEqual([
      ['start_ts', 'pd'],
      ['latest_ts', 'pd'],
      ['request_min_commit_ts', 'tidb_model_bound'],
      ['max_commit_ts', 'tidb_model_bound'],
      ['returned_min_commit_ts', 'tikv'],
      ['returned_min_commit_ts', 'tikv'],
      ['async_commit_ts', 'tikv'],
    ])
    expect(timestampDeltas(receipt, 'two_pc').map((delta) => [
      delta.purpose,
      delta.source,
    ])).toEqual([
      ['start_ts', 'pd'],
      ['commit_ts', 'pd'],
    ])
    expect(one.requestMinCommitTs).toBe((one.latestTs ?? 0) + 1)
    expect(async.requestMinCommitTs).toBe((async.latestTs ?? 0) + 1)
    expect(async.commitTs).toBe(Math.max(
      ...async.regions.map((region) => region.returnedMinCommitTs ?? 0),
    ))
    expect([one.commitTsSource, async.commitTsSource, two.commitTsSource])
      .toEqual([
        'tikv_one_pc_result',
        'max_prewrite_min_commit_ts',
        'pd_tso_after_prewrite',
      ])
    expect(two.latestTs).toBeNull()
    expect(two.requestMinCommitTs).toBeNull()
    expect(two.maxCommitTs).toBeNull()
    expect(eventAt(receipt, 61).atMs).toBeGreaterThanOrEqual(
      eventAt(receipt, 60).atMs + eventAt(receipt, 60).durationMs,
    )
    expect(simulation.state.tso.allocations).toBe(6)
  })

  it('places the 1PC, Async Commit, and regular 2PC client boundaries correctly', () => {
    const { receipt } = runProtocolLab()

    const oneApplied = lane(labAt(receipt, 10), 'one_pc')
    expect(oneApplied.regions[0].mvcc).toEqual({
      defaultCf: 'value',
      lockCf: 'empty',
      writeCf: 'commit',
      asyncCommit: false,
      secondaryCount: 0,
    })
    expect(receipt.events.some((event) =>
      event.branchId?.startsWith('one_pc') &&
      event.path === 'background')).toBe(false)
    expect(lane(labAt(receipt, 12), 'one_pc')).toMatchObject({
      clientResponded: true,
      backgroundComplete: false,
      commitTsSource: 'tikv_one_pc_result',
    })

    const asyncAtResponse = lane(labAt(receipt, 32), 'async_commit')
    expect(asyncAtResponse.clientResponded).toBe(true)
    expect(asyncAtResponse.backgroundComplete).toBe(false)
    expect(asyncAtResponse.regions.map((region) => region.mvcc)).toEqual([
      {
        defaultCf: 'value',
        lockCf: 'prewrite',
        writeCf: 'empty',
        asyncCommit: true,
        secondaryCount: 1,
      },
      {
        defaultCf: 'value',
        lockCf: 'prewrite',
        writeCf: 'empty',
        asyncCommit: true,
        secondaryCount: 0,
      },
    ])
    const asyncFinal = lane(labAt(receipt, 43), 'async_commit')
    expect(asyncFinal.backgroundComplete).toBe(true)
    expect(asyncFinal.regions.every((region) =>
      region.mvcc.lockCf === 'empty' &&
      region.mvcc.writeCf === 'commit')).toBe(true)

    const twoPrewritten = lane(labAt(receipt, 60), 'two_pc')
    expect(twoPrewritten.regions.every((region) =>
      region.mvcc.lockCf === 'prewrite' &&
      region.mvcc.writeCf === 'empty' &&
      !region.mvcc.asyncCommit)).toBe(true)
    const twoAtResponse = lane(labAt(receipt, 67), 'two_pc')
    expect(twoAtResponse.clientResponded).toBe(true)
    expect(twoAtResponse.regions.find((region) => region.role === 'primary')
      ?.mvcc).toMatchObject({ lockCf: 'empty', writeCf: 'commit' })
    expect(twoAtResponse.regions.find((region) => region.role === 'secondary')
      ?.mvcc).toMatchObject({ lockCf: 'prewrite', writeCf: 'empty' })
    const twoFinal = lane(labAt(receipt, 73), 'two_pc')
    expect(twoFinal.backgroundComplete).toBe(true)
    expect(twoFinal.regions.every((region) =>
      region.mvcc.lockCf === 'empty' &&
      region.mvcc.writeCf === 'commit')).toBe(true)
  })

  it('deep-freezes snapshots/deltas, preserves privacy, and ends cleanly', () => {
    const { receipt, simulation } = runProtocolLab()

    for (const event of receipt.events) {
      const lab = event.snapshot?.protocolLab
      expect(lab, event.id).toBeDefined()
      expect(event.deltas, event.id).toBeDefined()
      expect(Object.isFrozen(event)).toBe(true)
      expect(Object.isFrozen(event.dependsOn)).toBe(true)
      expect(Object.isFrozen(event.metadata)).toBe(true)
      expect(Object.isFrozen(event.deltas)).toBe(true)
      expect(Object.isFrozen(event.snapshot)).toBe(true)
      expect(Object.isFrozen(lab)).toBe(true)
      expect(Object.isFrozen(lab?.lanes)).toBe(true)
      for (const candidate of lab?.lanes ?? []) {
        expect(Object.isFrozen(candidate)).toBe(true)
        expect(Object.isFrozen(candidate.eligibility)).toBe(true)
        expect(Object.isFrozen(candidate.regions)).toBe(true)
        for (const region of candidate.regions) {
          expect(Object.isFrozen(region)).toBe(true)
          expect(Object.isFrozen(region.voterStoreIds)).toBe(true)
          expect(Object.isFrozen(region.raft)).toBe(true)
          expect(Object.isFrozen(region.raft.persistedStoreIds)).toBe(true)
          expect(Object.isFrozen(region.mvcc)).toBe(true)
        }
      }
    }

    const serialized = JSON.stringify({
      events: receipt.events,
      replay: receipt.replay,
    })
    expect(serialized).not.toMatch(
      /INSERT\s+INTO|VALUES\s*\(|account_id|\b425\b|result row|sqlText|secondaryKeys/i,
    )
    const final = labAt(receipt, 74)
    expect(final.phase).toBe('complete')
    expect(final.focusLaneId).toBeNull()
    expect(final.lanes.map((candidate) => candidate.stage))
      .toEqual(['complete', 'complete', 'complete'])
    expect(final.lanes.every((candidate) => candidate.clientResponded)).toBe(true)
    expect(final.lanes.flatMap((candidate) => candidate.regions).every(
      (region) =>
        region.mvcc.lockCf === 'empty' &&
        region.mvcc.writeCf === 'commit',
    )).toBe(true)
    expect(receipt).toMatchObject({
      succeeded: true,
      committed: false,
      outcome: 'succeeded',
      protocol: null,
      startTs: null,
      commitTs: null,
    })
    expect(simulation.state.transactions.map((transaction) => ({
      id: transaction.id,
      protocol: transaction.protocol,
      phase: transaction.phase,
    }))).toEqual([
      { id: 'txn-1pc', protocol: '1pc', phase: 'committed' },
      { id: 'txn-async', protocol: 'async_commit', phase: 'committed' },
      { id: 'txn-2pc', protocol: '2pc', phase: 'committed' },
    ])
    expect(simulation.state.metrics).toMatchObject({
      statements: 3,
      writes: 3,
      commits: 3,
      raftEntries: 9,
    })
  })
})

function validDefinitions(): readonly [
  ProtocolLabLaneDefinition,
  ProtocolLabLaneDefinition,
  ProtocolLabLaneDefinition,
] {
  const voters = ['tikv-1', 'tikv-2', 'tikv-3'] as const
  return [
    {
      id: 'one_pc',
      protocol: '1pc',
      requestId: 'request-one',
      transactionId: 'transaction-one',
      eligibility: {
        enable1Pc: true,
        enableAsyncCommit: true,
        consistency: 'linearizable',
        mutationCount: 2,
        totalKeyBytes: 16,
        regionCount: 1,
        onePcEligible: true,
        asyncCommitEligible: true,
        selected: '1pc',
        selectionReason: 'single_region_one_pc_model_case',
        onePcRejectedBeforeRpc: false,
        asyncRejectedAtClientPrecheck: false,
        onePcDecisionPoint: 'tikv_prewrite',
        asyncDecisionPoint: 'tikv_prewrite',
        runtimeFallback: false,
        tryOnePcSent: true,
        asyncKeyCountLimit: 256,
        asyncTotalKeyBytesLimit: 4096,
      },
      regions: [{
        regionId: 101,
        role: 'primary',
        leaderStoreId: 'tikv-1',
        voterStoreIds: voters,
        mutationCount: 2,
      }],
    },
    {
      id: 'async_commit',
      protocol: 'async_commit',
      requestId: 'request-async',
      transactionId: 'transaction-async',
      eligibility: {
        enable1Pc: true,
        enableAsyncCommit: true,
        consistency: 'linearizable',
        mutationCount: 2,
        totalKeyBytes: 16,
        regionCount: 2,
        onePcEligible: false,
        asyncCommitEligible: true,
        selected: 'async_commit',
        selectionReason: 'multi_region_async_commit_model_case',
        onePcRejectedBeforeRpc: true,
        asyncRejectedAtClientPrecheck: false,
        onePcDecisionPoint: 'region_batching',
        asyncDecisionPoint: 'tikv_prewrite',
        runtimeFallback: false,
        tryOnePcSent: false,
        asyncKeyCountLimit: 256,
        asyncTotalKeyBytesLimit: 4096,
      },
      regions: [
        {
          regionId: 102,
          role: 'primary',
          leaderStoreId: 'tikv-2',
          voterStoreIds: voters,
          mutationCount: 1,
        },
        {
          regionId: 103,
          role: 'secondary',
          leaderStoreId: 'tikv-3',
          voterStoreIds: voters,
          mutationCount: 1,
        },
      ],
    },
    {
      id: 'two_pc',
      protocol: '2pc',
      requestId: 'request-two',
      transactionId: 'transaction-two',
      eligibility: {
        enable1Pc: true,
        enableAsyncCommit: true,
        consistency: 'linearizable',
        mutationCount: 257,
        totalKeyBytes: 2056,
        regionCount: 2,
        onePcEligible: false,
        asyncCommitEligible: false,
        selected: '2pc',
        selectionReason: 'async_key_count_limit_model_case',
        onePcRejectedBeforeRpc: true,
        asyncRejectedAtClientPrecheck: true,
        onePcDecisionPoint: 'region_batching',
        asyncDecisionPoint: 'client_precheck',
        runtimeFallback: false,
        tryOnePcSent: false,
        asyncKeyCountLimit: 256,
        asyncTotalKeyBytesLimit: 4096,
      },
      regions: [
        {
          regionId: 104,
          role: 'primary',
          leaderStoreId: 'tikv-1',
          voterStoreIds: voters,
          mutationCount: 129,
        },
        {
          regionId: 105,
          role: 'secondary',
          leaderStoreId: 'tikv-2',
          voterStoreIds: voters,
          mutationCount: 128,
        },
      ],
    },
  ]
}

describe('Protocol Lab reducer invariants', () => {
  it('reduces a 1PC lane immutably to an atomic committed projection', () => {
    const initial = createProtocolLabState(validDefinitions())
    let state = initial
    const apply = (delta: ProtocolLabDelta): void => {
      const previous = state
      state = reduceProtocolLabState(state, delta)
      expect(state).not.toBe(previous)
      expect(Object.isFrozen(state)).toBe(true)
      expect(Object.isFrozen(state.lanes)).toBe(true)
    }

    apply({ kind: 'protocol_lab_focus', laneId: 'one_pc', phase: 'running' })
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'idle',
      to: 'requested',
    })
    apply({
      kind: 'protocol_timestamp',
      laneId: 'one_pc',
      purpose: 'start_ts',
      source: 'pd',
      timestamp: 100,
    })
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'requested',
      to: 'started',
    })
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'started',
      to: 'selected',
    })
    for (const delta of [
      {
        kind: 'protocol_timestamp',
        laneId: 'one_pc',
        purpose: 'latest_ts',
        source: 'pd',
        timestamp: 200,
      },
      {
        kind: 'protocol_timestamp',
        laneId: 'one_pc',
        purpose: 'request_min_commit_ts',
        source: 'tidb_model_bound',
        timestamp: 201,
      },
      {
        kind: 'protocol_timestamp',
        laneId: 'one_pc',
        purpose: 'max_commit_ts',
        source: 'tidb_model_bound',
        timestamp: 280,
      },
    ] as const) apply(delta)
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'selected',
      to: 'latest_ts',
    })
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'latest_ts',
      to: 'prewriting',
    })
    for (const delta of [
      {
        kind: 'protocol_region_raft',
        laneId: 'one_pc',
        regionId: 101,
        operation: 'one_pc_prewrite',
        action: 'propose',
        index: 1,
      },
      {
        kind: 'protocol_region_raft',
        laneId: 'one_pc',
        regionId: 101,
        operation: 'one_pc_prewrite',
        action: 'persist_quorum',
        index: 1,
        storeIds: ['tikv-1', 'tikv-2'],
      },
      {
        kind: 'protocol_region_raft',
        laneId: 'one_pc',
        regionId: 101,
        operation: 'one_pc_prewrite',
        action: 'commit',
        index: 1,
      },
      {
        kind: 'protocol_region_raft',
        laneId: 'one_pc',
        regionId: 101,
        operation: 'one_pc_prewrite',
        action: 'apply',
        index: 1,
      },
    ] as const) apply(delta)
    apply({
      kind: 'protocol_timestamp',
      laneId: 'one_pc',
      purpose: 'one_pc_commit_ts',
      source: 'tikv',
      timestamp: 202,
    })
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'prewriting',
      to: 'committing',
    })
    apply({
      kind: 'protocol_client_response',
      laneId: 'one_pc',
      commitTs: 202,
    })
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'committing',
      to: 'client_acknowledged',
    })
    apply({
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'client_acknowledged',
      to: 'complete',
    })

    expect(lane(initial, 'one_pc')).toMatchObject({
      stage: 'idle',
      startTs: null,
      clientResponded: false,
    })
    expect(lane(state, 'one_pc')).toMatchObject({
      stage: 'complete',
      startTs: 100,
      latestTs: 200,
      requestMinCommitTs: 201,
      maxCommitTs: 280,
      commitTs: 202,
      commitTsSource: 'tikv_one_pc_result',
      clientResponded: true,
      backgroundComplete: false,
    })
    expect(lane(state, 'one_pc').regions[0].mvcc).toMatchObject({
      defaultCf: 'value',
      lockCf: 'empty',
      writeCf: 'commit',
    })
    expect(Object.isFrozen(
      lane(state, 'one_pc').regions[0].raft.persistedStoreIds,
    )).toBe(true)
  })

  it('rejects malformed definitions and illegal state transitions', () => {
    const definitions = validDefinitions()
    expect(() => createProtocolLabState([
      definitions[0],
      { ...definitions[1], transactionId: definitions[0].transactionId },
      definitions[2],
    ])).toThrow(/transaction ids must be unique/)
    expect(() => createProtocolLabState([
      {
        ...definitions[0],
        regions: [{
          ...definitions[0].regions[0],
          voterStoreIds: ['tikv-1', 'tikv-1', 'tikv-3'],
        }],
      },
      definitions[1],
      definitions[2],
    ])).toThrow(/three distinct voters/)

    const initial = createProtocolLabState(definitions)
    expect(() => reduceProtocolLabState(initial, {
      kind: 'protocol_lane_stage',
      laneId: 'one_pc',
      from: 'selected',
      to: 'prewriting',
    })).toThrow(/stage is idle/)
    expect(() => reduceProtocolLabState(initial, {
      kind: 'protocol_timestamp',
      laneId: 'one_pc',
      purpose: 'start_ts',
      source: 'tikv',
      timestamp: 100,
    })).toThrow(/start_ts must come from PD/)
    expect(() => reduceProtocolLabState(initial, {
      kind: 'protocol_timestamp',
      laneId: 'async_commit',
      purpose: 'returned_min_commit_ts',
      source: 'tikv',
      timestamp: 201,
      regionId: 102,
    })).toThrow(/before prewrite apply/)
    expect(() => reduceProtocolLabState(initial, {
      kind: 'protocol_client_response',
      laneId: 'one_pc',
      commitTs: 202,
    })).toThrow(/response commit_ts disagrees/)
    expect(() => reduceProtocolLabState(initial, {
      kind: 'protocol_background_complete',
      laneId: 'async_commit',
    })).toThrow(/background completion/)
    expect(() => reduceProtocolLabState(initial, {
      kind: 'protocol_lab_focus',
      laneId: null,
      phase: 'complete',
    })).toThrow(/comparison completion/)

    const proposed = reduceProtocolLabState(initial, {
      kind: 'protocol_region_raft',
      laneId: 'one_pc',
      regionId: 101,
      operation: 'one_pc_prewrite',
      action: 'propose',
      index: 1,
    })
    expect(() => reduceProtocolLabState(proposed, {
      kind: 'protocol_region_raft',
      laneId: 'one_pc',
      regionId: 101,
      operation: 'one_pc_prewrite',
      action: 'persist_quorum',
      index: 1,
      storeIds: ['tikv-1'],
    })).toThrow(/at least two voters/)
    expect(() => reduceProtocolLabState(proposed, {
      kind: 'protocol_region_raft',
      laneId: 'one_pc',
      regionId: 101,
      operation: 'one_pc_prewrite',
      action: 'persist_quorum',
      index: 1,
      storeIds: ['tikv-1', 'tikv-1'],
    })).toThrow(/persisted voters must be unique/)
    expect(() => reduceProtocolLabState(proposed, {
      kind: 'protocol_region_raft',
      laneId: 'one_pc',
      regionId: 101,
      operation: 'one_pc_prewrite',
      action: 'apply',
      index: 1,
    })).toThrow(/must commit before apply/)

    const twoStarted = reduceProtocolLabState(initial, {
      kind: 'protocol_timestamp',
      laneId: 'two_pc',
      purpose: 'start_ts',
      source: 'pd',
      timestamp: 100,
    })
    expect(() => reduceProtocolLabState(twoStarted, {
      kind: 'protocol_timestamp',
      laneId: 'two_pc',
      purpose: 'commit_ts',
      source: 'tikv',
      timestamp: 200,
    })).toThrow(/regular 2PC commit_ts must come from PD/)
    expect(() => reduceProtocolLabState(initial, {
      kind: 'protocol_lane_stage',
      laneId: 'missing' as TraceProtocolLaneId,
      from: 'idle',
      to: 'requested',
    })).toThrow(/unknown lane missing/)
  })
})
