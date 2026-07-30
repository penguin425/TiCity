/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import type {
  ResolvedCommitProtocol,
  StoreId,
  TraceEvent,
  TraceProtocolEligibilitySnapshot,
  TraceProtocolLaneId,
  TraceProtocolLaneSnapshot,
  TraceProtocolRegionSnapshot,
  TraceProtocolLabSnapshot,
} from '../model/types'
import {
  PROTOCOL_LAB_LANE_CAPACITY,
  PROTOCOL_LAB_REGION_CAPACITY_PER_LANE,
  PROTOCOL_LAB_VOTERS_PER_REGION,
} from './protocol-lab'
import { projectProtocolLab } from './protocol-lab-projection'

function eligibility(
  id: TraceProtocolLaneId,
  protocol: ResolvedCommitProtocol,
  regionCount: number,
): TraceProtocolEligibilitySnapshot {
  const onePc = id === 'one_pc'
  const asyncCommit = id === 'async_commit'
  return {
    enable1Pc: true,
    enableAsyncCommit: true,
    consistency: 'linearizable',
    mutationCount: id === 'two_pc' ? 300 : regionCount,
    totalKeyBytes: id === 'two_pc' ? 4800 : regionCount * 16,
    regionCount,
    onePcEligible: onePc,
    asyncCommitEligible: onePc || asyncCommit,
    selected: protocol,
    selectionReason:
      onePc ? 'single_region_one_pc_model_case'
        : asyncCommit ? 'multi_region_async_commit_model_case'
          : 'async_key_count_limit_model_case',
    onePcRejectedBeforeRpc: !onePc,
    asyncRejectedAtClientPrecheck: id === 'two_pc',
    onePcDecisionPoint: 'region_batching',
    asyncDecisionPoint: 'client_precheck',
    runtimeFallback: false,
    tryOnePcSent: onePc,
    asyncKeyCountLimit: 256,
    asyncTotalKeyBytesLimit: 4096,
  }
}

function region(
  regionId: number,
  role: 'primary' | 'secondary',
  leaderStoreId: StoreId,
  stage: TraceProtocolRegionSnapshot['raft']['stage'],
  persistedStoreIds: readonly StoreId[],
  options: {
    readonly operation?: TraceProtocolRegionSnapshot['raft']['operation']
    readonly asyncCommit?: boolean
    readonly committed?: boolean
    readonly returnedMinCommitTs?: number | null
  } = {},
): TraceProtocolRegionSnapshot {
  const active = stage !== 'idle'
  const committed = options.committed ?? false
  return {
    regionId,
    role,
    leaderStoreId,
    /* Deliberately shuffled; renderer slots remain stable by store id. */
    voterStoreIds: ['tikv-3', 'tikv-1', 'tikv-2'],
    mutationCount: 1,
    raft: {
      operation: active ? options.operation ?? 'prewrite' : null,
      stage,
      index: active ? regionId + 40 : null,
      persistedStoreIds,
      acknowledgements: persistedStoreIds.length,
      quorum: 2,
    },
    mvcc: {
      defaultCf: active ? 'value' : 'empty',
      lockCf: active && !committed ? 'prewrite' : 'empty',
      writeCf: committed ? 'commit' : 'empty',
      asyncCommit: options.asyncCommit ?? false,
      secondaryCount:
        options.asyncCommit && role === 'primary' && !committed ? 1 : 0,
    },
    returnedMinCommitTs: options.returnedMinCommitTs ?? null,
  }
}

function lane(
  id: TraceProtocolLaneId,
  protocol: ResolvedCommitProtocol,
  regions: readonly TraceProtocolRegionSnapshot[],
  overrides: Partial<TraceProtocolLaneSnapshot> = {},
): TraceProtocolLaneSnapshot {
  return {
    id,
    protocol,
    requestId: `request-${id}`,
    transactionId: `txn-${id}`,
    stage: 'idle',
    eligibility: eligibility(id, protocol, regions.length),
    startTs: null,
    latestTs: null,
    requestMinCommitTs: null,
    maxCommitTs: null,
    commitTs: null,
    clientResponded: false,
    backgroundComplete: false,
    regions,
    ...overrides,
    commitTsSource: overrides.commitTsSource ?? null,
  }
}

function detailedSnapshot(): TraceProtocolLabSnapshot {
  return {
    phase: 'running',
    focusLaneId: 'async_commit',
    consistency: 'linearizable',
    transactionMode: 'optimistic',
    transactionScope: 'global',
    representation: 'aggregate_counts_only',
    safeWindowMs: 2000,
    coordinatorLayer: 'tidb_transaction_commit',
    raftLayer: 'per_region_consensus',
    tikvAsyncApplyPrewrite: false,
    clientBoundary: 'response_before_cleanup_completion',
    backgroundScheduling:
      'deterministic_after_client_boundary_model_policy',
    maxCommitTsPolicy: 'representative_safe_window_model_bound',
    lanes: [
      lane(
        'one_pc',
        '1pc',
        [region(
          11,
          'primary',
          'tikv-1',
          'applied',
          ['tikv-1', 'tikv-2'],
          {
            operation: 'one_pc_prewrite',
            committed: true,
          },
        )],
        {
          stage: 'complete',
          startTs: 101,
          latestTs: 102,
          requestMinCommitTs: 103,
          maxCommitTs: 140,
          commitTs: 104,
          clientResponded: true,
        },
      ),
      lane(
        'async_commit',
        'async_commit',
        [
          region(
            21,
            'primary',
            'tikv-2',
            'applied',
            ['tikv-1', 'tikv-2', 'tikv-3'],
            {
              asyncCommit: true,
              returnedMinCommitTs: 205,
            },
          ),
          region(
            22,
            'secondary',
            'tikv-3',
            'persisted_quorum',
            ['tikv-1', 'tikv-3'],
            { asyncCommit: true },
          ),
        ],
        {
          stage: 'background',
          startTs: 201,
          latestTs: 202,
          requestMinCommitTs: 203,
          maxCommitTs: 240,
          commitTs: 205,
          clientResponded: true,
        },
      ),
      lane(
        'two_pc',
        '2pc',
        [
          region(
            31,
            'primary',
            'tikv-1',
            'proposed',
            [],
          ),
          region(32, 'secondary', 'tikv-2', 'idle', []),
        ],
        {
          stage: 'prewriting',
          startTs: 301,
        },
      ),
    ],
  }
}

function event(protocolLab?: TraceProtocolLabSnapshot): TraceEvent {
  return {
    id: 'protocol-event',
    atMs: 10,
    durationMs: 3,
    domain: 'txn2pc',
    kind: 'protocol_region_raft',
    label: 'Protocol Lab',
    detail: '',
    status: 'success',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-5',
      tsoLastAllocated: 301,
      transaction: null,
      regions: [],
      ...(protocolLab ? { protocolLab } : {}),
    },
  }
}

describe('Protocol Lab model-to-world projection', () => {
  it('requires the snapshot.protocolLab discriminator', () => {
    expect(projectProtocolLab(null, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectProtocolLab(event(), {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectProtocolLab({
      ...event(),
      snapshot: undefined,
    }, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
  })

  it('maps three protocol shapes and the critical/client/background boundary', () => {
    const source = event(detailedSnapshot())
    const before = JSON.stringify(source)
    const projection = projectProtocolLab(source, {
      inspect: true,
      reducedMotion: false,
      pulse: 2,
    })!

    expect(projection).toMatchObject({
      mode: 'inspect',
      phase: 'running',
      pulse: 1,
      focusLaneId: 'async_commit',
      capacities: {
        lanes: 3,
        regionsPerLane: 2,
        votersPerRegion: 3,
      },
      overflowRegions: 0,
    })
    expect(projection.lanes.map((candidate) => ({
      id: candidate.id,
      shape: candidate.shape,
      path: candidate.path,
      timestampStage: candidate.timestampStage,
    }))).toEqual([
      {
        id: 'one_pc',
        shape: 'triangle',
        path: 'complete',
        timestampStage: 'commit',
      },
      {
        id: 'async_commit',
        shape: 'diamond',
        path: 'background',
        timestampStage: 'commit',
      },
      {
        id: 'two_pc',
        shape: 'cylinder',
        path: 'critical',
        timestampStage: 'start',
      },
    ])
    expect(projection.lanes[1].focused).toBe(true)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('keeps transaction coordination separate from bounded per-Region Raft and MVCC state', () => {
    const projection = projectProtocolLab(event(detailedSnapshot()), {
      inspect: false,
      reducedMotion: true,
    })!
    const primary = projection.lanes[1].regions[0]
    const secondary = projection.lanes[1].regions[1]

    expect(projection.mode).toBe('overview')
    expect(primary).toMatchObject({
      visible: true,
      regionId: 21,
      role: 'primary',
      leaderPeer: 1,
      operation: 'prewrite',
      raftStage: 'applied',
      quorum: {
        acknowledgements: 3,
        required: 2,
        reached: true,
      },
      applied: true,
      mvcc: {
        default: 'value',
        lock: 'prewrite',
        write: 'empty',
        asyncCommit: true,
        secondaryCount: 1,
      },
      returnedMinCommitTs: true,
    })
    expect(primary.peers.map((peer) => ({
      storeId: peer.storeId,
      leader: peer.leader,
      log: peer.log,
    }))).toEqual([
      { storeId: 'tikv-1', leader: false, log: 'committed' },
      { storeId: 'tikv-2', leader: true, log: 'committed' },
      { storeId: 'tikv-3', leader: false, log: 'committed' },
    ])
    expect(secondary.peers.map((peer) => peer.log)).toEqual([
      'persisted',
      'idle',
      'persisted',
    ])
  })

  it('caps malformed input without mutating the model snapshot', () => {
    const sourceSnapshot = detailedSnapshot()
    const extra = region(99, 'secondary', 'tikv-1', 'idle', [])
    const malformed = {
      ...sourceSnapshot,
      lanes: [
        {
          ...sourceSnapshot.lanes[0],
          regions: [
            ...sourceSnapshot.lanes[0].regions,
            extra,
            { ...extra, regionId: 100 },
          ],
        },
        sourceSnapshot.lanes[1],
        sourceSnapshot.lanes[2],
      ],
    } as unknown as TraceProtocolLabSnapshot
    const source = event(malformed)
    const before = JSON.stringify(source)
    const projection = projectProtocolLab(source, {
      inspect: true,
      reducedMotion: false,
    })!

    expect(projection.lanes).toHaveLength(PROTOCOL_LAB_LANE_CAPACITY)
    expect(projection.lanes[0].regions)
      .toHaveLength(PROTOCOL_LAB_REGION_CAPACITY_PER_LANE)
    expect(projection.lanes[0].regions.every((candidate) =>
      candidate.peers.length === PROTOCOL_LAB_VOTERS_PER_REGION,
    )).toBe(true)
    expect(projection.lanes[0].overflowRegions).toBe(1)
    expect(projection.overflowRegions).toBe(1)
    expect(JSON.stringify(source)).toBe(before)
  })
})
