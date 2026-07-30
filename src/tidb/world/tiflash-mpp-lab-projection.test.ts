/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import type {
  TraceEvent,
  TraceTiFlashMppLabSnapshot,
  TraceTiFlashMppLearnerSnapshot,
  TraceTiFlashMppTaskSnapshot,
  TraceTiFlashMppTunnelSnapshot,
} from '../model/types'
import {
  TIFLASH_MPP_LAB_FRAGMENT_CAPACITY,
  TIFLASH_MPP_LAB_LEARNER_CAPACITY,
  TIFLASH_MPP_LAB_STORE_CAPACITY,
  TIFLASH_MPP_LAB_TASK_CAPACITY,
  TIFLASH_MPP_LAB_TUNNEL_CAPACITY,
} from './tiflash-mpp-lab'
import { projectTiFlashMppLab } from './tiflash-mpp-lab-projection'

function learner(
  regionId: number,
  learnerStoreId: 'tiflash-1' | 'tiflash-2',
  overrides: Partial<TraceTiFlashMppLearnerSnapshot> = {},
): TraceTiFlashMppLearnerSnapshot {
  return {
    regionId,
    leaderStoreId: regionId % 2 === 0 ? 'tikv-1' : 'tikv-2',
    learnerStoreId,
    role: 'learner',
    voter: false,
    replicationMode: 'raft_log',
    leaderCommitIndex: 130,
    learnerReceivedIndex: 130,
    learnerRaftCommandIndex: 130,
    deltaMergeFlushedIndex: 128,
    learnerAppliedIndex: 130,
    leaderSafeTs: 100,
    selfSafeTs: 98,
    safeTsLagBucket: 'about_2s',
    requiredReadIndex: null,
    readGate: 'unchecked',
    gateReason: null,
    readIndexSkipped: null,
    lockCount: null,
    postReadValidated: false,
    scheduled: true,
    ...overrides,
  }
}

function task(
  id: TraceTiFlashMppTaskSnapshot['id'],
  fragmentId: TraceTiFlashMppTaskSnapshot['fragmentId'],
  storeId: TraceTiFlashMppTaskSnapshot['storeId'],
  stage: TraceTiFlashMppTaskSnapshot['stage'],
): TraceTiFlashMppTaskSnapshot {
  return {
    id,
    fragmentId,
    storeId,
    regionIds: fragmentId === 'fragment-scan'
      ? storeId === 'tiflash-1' ? [24, 26] : [25]
      : [],
    stage,
    root: false,
    feedsTiDBRoot: fragmentId === 'fragment-final',
  }
}

function tunnel(
  id: TraceTiFlashMppTunnelSnapshot['id'],
  sourceTaskId: TraceTiFlashMppTunnelSnapshot['sourceTaskId'],
  targetTaskId: TraceTiFlashMppTunnelSnapshot['targetTaskId'],
  status: TraceTiFlashMppTunnelSnapshot['status'],
): TraceTiFlashMppTunnelSnapshot {
  return {
    id,
    exchangeType: targetTaskId === 'tidb-root'
      ? 'pass_through'
      : 'hash_partition',
    sourceTaskId,
    targetTaskId,
    locality: targetTaskId === 'tidb-root'
      ? 'root'
      : (
          sourceTaskId.endsWith('-1') === targetTaskId.endsWith('-1')
            ? 'local'
            : 'remote'
        ),
    persistence: 'ephemeral_query_blocks',
    status,
    packetCount: status === 'registered' ? 0 : 2,
    bytesBucket: status === 'registered' ? 'none' : 'small',
  }
}

function detailedSnapshot(): TraceTiFlashMppLabSnapshot {
  return {
    phase: 'snapshot_gating',
    pins: {
      tiflash: '6e12ba23c70f358f2ffbee837feac24118a3e988',
      tiflashProxy: 'b877a976997acb7c552db970c01546b4e82bce18',
      tidb: 'd13e52ed6e22cc5789bed7c64c861578cd2ed55b',
      tikv: 'a2c58c94f89cbb410e66d8f85c236308d6fc64f0',
      pd: 'd190c0e9082de46128b756f93b1291768dda645a',
      clientGo: '006dfb024c26859f2e3757172296d84ef36ff585',
    },
    configuration: {
      queryToken: 'query-mpp-1',
      tableToken: 'table-analytics',
      queryClass: 'grouped_aggregate',
      representation: 'aggregate_counts_only',
      optimizerChoice: 'declared_success_fixture',
      replicaCount: 2,
      provisioningAvailable: true,
      provisioningProgress: 1,
      provisioningMeaning: 'placement_only_not_snapshot_readiness',
      replicationPlane: 'persistent_region_raft',
      exchangePlane: 'ephemeral_query_blocks',
      readFailurePolicy: 'wait_or_error_never_stale',
      regionDispatchRetry: 'requires_recuttask_reschedule',
      exchangeRetryBoundary: 'before_first_packet_only',
      fallbackBoundary:
        'configured_timeout_before_client_side_effect_only',
      staleRead: false,
      initialSnapshotTransferModeled: false,
      failureRetryModeled: false,
      maxEventNodes: 57,
    },
    snapshotTs: 1_000_000_001,
    provisioningObserved: true,
    accessPathSelected: true,
    stores: [
      {
        storeId: 'tiflash-2',
        regionIds: [25],
        scanTaskId: 'task-scan-2',
        finalTaskId: 'task-final-2',
      },
      {
        storeId: 'tiflash-1',
        regionIds: [24, 26],
        scanTaskId: 'task-scan-1',
        finalTaskId: 'task-final-1',
      },
    ],
    learners: [
      learner(26, 'tiflash-1', {
        learnerAppliedIndex: 128,
        requiredReadIndex: 130,
        readGate: 'waiting_applied',
      }),
      learner(24, 'tiflash-1', {
        requiredReadIndex: 130,
        readGate: 'ready',
        gateReason: 'read_index_applied',
      }),
      learner(25, 'tiflash-2', {
        requiredReadIndex: null,
        readGate: 'read_index_requested',
      }),
    ],
    fragments: [
      {
        id: 'fragment-scan',
        kind: 'scan_partial_aggregate',
        operatorTokens: ['TableFullScan', 'HashAgg', 'ExchangeSender'],
        taskIds: ['task-scan-1', 'task-scan-2'],
      },
      {
        id: 'fragment-final',
        kind: 'final_aggregate',
        operatorTokens: ['ExchangeReceiver', 'HashAgg', 'ExchangeSender'],
        taskIds: ['task-final-1', 'task-final-2'],
      },
    ],
    tasks: [
      task('task-final-2', 'fragment-final', 'tiflash-2', 'prepared'),
      task('task-scan-1', 'fragment-scan', 'tiflash-1', 'snapshot_gating'),
      task('task-final-1', 'fragment-final', 'tiflash-1', 'prepared'),
      task('task-scan-2', 'fragment-scan', 'tiflash-2', 'snapshot_gating'),
    ],
    tunnels: [
      tunnel('tunnel-root-2', 'task-final-2', 'tidb-root', 'registered'),
      tunnel('tunnel-hash-4', 'task-scan-2', 'task-final-2', 'received'),
      tunnel('tunnel-hash-2', 'task-scan-1', 'task-final-2', 'sent'),
      tunnel('tunnel-hash-1', 'task-scan-1', 'task-final-1', 'registered'),
      tunnel('tunnel-root-1', 'task-final-1', 'tidb-root', 'registered'),
      tunnel('tunnel-hash-3', 'task-scan-2', 'task-final-1', 'sent'),
    ],
    result: {
      taskId: 'tidb-root',
      stage: 'idle',
      rootStreamCount: 0,
      chunksDecoded: 0,
      columnsSent: false,
      rowsBucket: 'none',
      clientComplete: false,
    },
    retry: {
      retryCount: 0,
      fallbackToTiKV: false,
      failureCode: null,
    },
  }
}

function event(snapshot?: TraceTiFlashMppLabSnapshot): TraceEvent {
  return {
    id: 'trace-1-event-35',
    atMs: 100,
    durationMs: 8,
    domain: 'tiflash',
    kind: 'tiflash_wait_index',
    label: 'TiFlash wait index',
    detail: 'Synthetic model event',
    status: 'warning',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-7',
      tsoLastAllocated: 1_000_000_001,
      transaction: null,
      regions: [],
      ...(snapshot ? { tiflashMppLab: snapshot } : {}),
    },
  }
}

describe('TiFlash MPP Lab model-to-world projection', () => {
  it('requires the exact snapshot.tiflashMppLab discriminator', () => {
    expect(projectTiFlashMppLab(null, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectTiFlashMppLab(event(), {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectTiFlashMppLab({
      ...event(),
      snapshot: undefined,
    }, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
  })

  it('maps fixed stores, learners, tasks, local/remote/root tunnels, and gates', () => {
    const source = event(detailedSnapshot())
    const before = JSON.stringify(source)
    const projection = projectTiFlashMppLab(source, {
      inspect: true,
      reducedMotion: true,
      pulse: 3,
    })!

    expect(projection).toMatchObject({
      mode: 'inspect',
      phase: 'snapshot_gating',
      reducedMotion: true,
      pulse: 1,
      overflow: {
        stores: 0,
        learners: 0,
        fragments: 0,
        tasks: 0,
        tunnels: 0,
        total: 0,
      },
    })
    expect(projection.stores.map((store) => store.storeId)).toEqual([
      'tiflash-1',
      'tiflash-2',
    ])
    expect(projection.learners.map((candidate) => ({
      regionId: candidate.regionId,
      storeSlot: candidate.storeSlot,
      gateState: candidate.gateState,
      gateReason: candidate.gateReason,
    }))).toEqual([
      {
        regionId: 24,
        storeSlot: 0,
        gateState: 'ready',
        gateReason: 'applied_index_ready',
      },
      {
        regionId: 25,
        storeSlot: 1,
        gateState: 'requesting',
        gateReason: 'read_index_pending',
      },
      {
        regionId: 26,
        storeSlot: 0,
        gateState: 'waiting',
        gateReason: 'applied_index_behind',
      },
    ])
    expect(projection.tasks.map((candidate) => candidate.id)).toEqual([
      'task-scan-1',
      'task-scan-2',
      'task-final-1',
      'task-final-2',
    ])
    expect(projection.tunnels.map((candidate) => ({
      id: candidate.id,
      locality: candidate.locality,
      state: candidate.state,
    }))).toEqual([
      { id: 'tunnel-hash-1', locality: 'local', state: 'registered' },
      { id: 'tunnel-hash-2', locality: 'remote', state: 'streaming' },
      { id: 'tunnel-hash-3', locality: 'remote', state: 'streaming' },
      { id: 'tunnel-hash-4', locality: 'local', state: 'finished' },
      { id: 'tunnel-root-1', locality: 'tidb_root', state: 'registered' },
      { id: 'tunnel-root-2', locality: 'tidb_root', state: 'registered' },
    ])
    expect(projection.root).toEqual({
      visible: true,
      taskId: 'tidb-root',
      state: 'idle',
    })
    expect(JSON.stringify(source)).toBe(before)
  })

  it('reports every fixed-capacity overflow without mutating malformed input', () => {
    const sourceSnapshot = detailedSnapshot()
    const malformed = {
      ...sourceSnapshot,
      stores: [
        ...sourceSnapshot.stores,
        sourceSnapshot.stores[0],
      ],
      learners: [
        ...sourceSnapshot.learners,
        learner(99, 'tiflash-2'),
      ],
      fragments: [
        ...sourceSnapshot.fragments,
        sourceSnapshot.fragments[0],
      ],
      tasks: [
        ...sourceSnapshot.tasks,
        sourceSnapshot.tasks[0],
      ],
      tunnels: [
        ...sourceSnapshot.tunnels,
        sourceSnapshot.tunnels[0],
      ],
    } as unknown as TraceTiFlashMppLabSnapshot
    const source = event(malformed)
    const before = JSON.stringify(source)
    const projection = projectTiFlashMppLab(source, {
      inspect: false,
      reducedMotion: false,
    })!

    expect(projection.mode).toBe('overview')
    expect(projection.stores).toHaveLength(TIFLASH_MPP_LAB_STORE_CAPACITY)
    expect(projection.learners).toHaveLength(
      TIFLASH_MPP_LAB_LEARNER_CAPACITY,
    )
    expect(projection.tasks).toHaveLength(TIFLASH_MPP_LAB_TASK_CAPACITY)
    expect(projection.tunnels).toHaveLength(TIFLASH_MPP_LAB_TUNNEL_CAPACITY)
    expect(projection.overflow).toEqual({
      stores: 1,
      learners: 1,
      fragments: 1,
      tasks: 1,
      tunnels: 1,
      total: 5,
    })
    expect(sourceSnapshot.fragments).toHaveLength(
      TIFLASH_MPP_LAB_FRAGMENT_CAPACITY,
    )
    expect(JSON.stringify(source)).toBe(before)
  })
})
