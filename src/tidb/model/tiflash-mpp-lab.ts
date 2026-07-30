/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure model-7 TiFlash learner replication and MPP state. The fixed fixture
 * uses synthetic identifiers, indexes, timestamps, and aggregate counters.
 */

import type {
  StoreId,
  TiFlashMppStoreId,
  TraceStateDelta,
  TraceTiFlashMppFragmentSnapshot,
  TraceTiFlashMppLabSnapshot,
  TraceTiFlashMppLearnerSnapshot,
  TraceTiFlashMppStoreSnapshot,
  TraceTiFlashMppTaskId,
  TraceTiFlashMppTaskSnapshot,
  TraceTiFlashMppTunnelId,
  TraceTiFlashMppTunnelSnapshot,
} from './types'

export type TiFlashMppLabDelta = Extract<
  TraceStateDelta,
  {
    kind:
      | 'tiflash_replica_raft_commit'
      | 'tiflash_replica_receive'
      | 'tiflash_replica_apply'
      | 'tiflash_replica_dm_flush'
      | 'tiflash_replica_applied_advance'
      | 'tiflash_mpp_query_received'
      | 'tiflash_mpp_snapshot_tso'
      | 'tiflash_mpp_safe_ts_update'
      | 'tiflash_mpp_provisioning_observed'
      | 'tiflash_mpp_access_path'
      | 'tiflash_mpp_fragments_build'
      | 'tiflash_mpp_regions_schedule'
      | 'tiflash_mpp_tasks_build'
      | 'tiflash_mpp_tunnels_build'
      | 'tiflash_mpp_task_stage'
      | 'tiflash_mpp_snapshot_gate'
      | 'tiflash_mpp_tunnel_data'
      | 'tiflash_mpp_result_stage'
  }
>

const PINNED_COMMITS = {
  tiflash: '6e12ba23c70f358f2ffbee837feac24118a3e988',
  tiflashProxy: 'b877a976997acb7c552db970c01546b4e82bce18',
  tidb: 'd13e52ed6e22cc5789bed7c64c861578cd2ed55b',
  tikv: 'a2c58c94f89cbb410e66d8f85c236308d6fc64f0',
  pd: 'd190c0e9082de46128b756f93b1291768dda645a',
  clientGo: '006dfb024c26859f2e3757172296d84ef36ff585',
} as const

const CONFIGURATION = {
  queryToken: 'query-mpp-1',
  tableToken: 'table-analytics',
  queryClass: 'grouped_aggregate',
  representation: 'aggregate_counts_only',
  optimizerChoice: 'declared_success_fixture',
  replicaCount: 2,
  learnerProjection: 'selected_query_replica_per_region',
  unselectedLearnersModeled: false,
  provisioningAvailable: true,
  provisioningProgress: 1,
  provisioningMeaning: 'placement_only_not_snapshot_readiness',
  replicationPlane: 'persistent_region_raft',
  exchangePlane: 'ephemeral_query_blocks',
  readFailurePolicy: 'wait_or_error_never_stale',
  regionDispatchRetry: 'requires_recuttask_reschedule',
  exchangeRetryBoundary: 'before_first_packet_only',
  fallbackBoundary: 'configured_timeout_before_client_side_effect_only',
  staleRead: false,
  initialSnapshotTransferModeled: false,
  failureRetryModeled: false,
  maxEventNodes: 57,
} as const

const STORES: readonly TraceTiFlashMppStoreSnapshot[] = [
  {
    storeId: 'tiflash-1',
    regionIds: [24, 26],
    scanTaskId: 'task-scan-1',
    finalTaskId: 'task-final-1',
  },
  {
    storeId: 'tiflash-2',
    regionIds: [25],
    scanTaskId: 'task-scan-2',
    finalTaskId: 'task-final-2',
  },
]

const LEARNER_DEFINITIONS: readonly Readonly<{
  regionId: number
  leaderStoreId: StoreId
  learnerStoreId: TiFlashMppStoreId
  baselineIndex: number
}>[] = [
  {
    regionId: 24,
    leaderStoreId: 'tikv-1',
    learnerStoreId: 'tiflash-1',
    baselineIndex: 240,
  },
  {
    regionId: 25,
    leaderStoreId: 'tikv-2',
    learnerStoreId: 'tiflash-2',
    baselineIndex: 250,
  },
  {
    regionId: 26,
    leaderStoreId: 'tikv-3',
    learnerStoreId: 'tiflash-1',
    baselineIndex: 260,
  },
]

const FRAGMENTS: readonly TraceTiFlashMppFragmentSnapshot[] = [
  {
    id: 'fragment-scan',
    kind: 'scan_partial_aggregate',
    operatorTokens: [
      'table_full_scan',
      'partial_hash_aggregate',
      'hash_partition_sender',
    ],
    taskIds: ['task-scan-1', 'task-scan-2'],
  },
  {
    id: 'fragment-final',
    kind: 'final_aggregate',
    operatorTokens: [
      'exchange_receiver',
      'final_hash_aggregate',
      'pass_through_sender',
    ],
    taskIds: ['task-final-1', 'task-final-2'],
  },
]

const TASKS: readonly TraceTiFlashMppTaskSnapshot[] = [
  {
    id: 'task-scan-1',
    fragmentId: 'fragment-scan',
    storeId: 'tiflash-1',
    regionIds: [24, 26],
    stage: 'built',
    root: false,
    feedsTiDBRoot: false,
  },
  {
    id: 'task-scan-2',
    fragmentId: 'fragment-scan',
    storeId: 'tiflash-2',
    regionIds: [25],
    stage: 'built',
    root: false,
    feedsTiDBRoot: false,
  },
  {
    id: 'task-final-1',
    fragmentId: 'fragment-final',
    storeId: 'tiflash-1',
    regionIds: [],
    stage: 'built',
    root: false,
    feedsTiDBRoot: true,
  },
  {
    id: 'task-final-2',
    fragmentId: 'fragment-final',
    storeId: 'tiflash-2',
    regionIds: [],
    stage: 'built',
    root: false,
    feedsTiDBRoot: true,
  },
]

const TUNNELS: readonly TraceTiFlashMppTunnelSnapshot[] = [
  {
    id: 'tunnel-hash-1',
    exchangeType: 'hash_partition',
    sourceTaskId: 'task-scan-1',
    targetTaskId: 'task-final-1',
    locality: 'local',
    persistence: 'ephemeral_query_blocks',
    status: 'registered',
    packetCount: 0,
    bytesBucket: 'none',
  },
  {
    id: 'tunnel-hash-2',
    exchangeType: 'hash_partition',
    sourceTaskId: 'task-scan-1',
    targetTaskId: 'task-final-2',
    locality: 'remote',
    persistence: 'ephemeral_query_blocks',
    status: 'registered',
    packetCount: 0,
    bytesBucket: 'none',
  },
  {
    id: 'tunnel-hash-3',
    exchangeType: 'hash_partition',
    sourceTaskId: 'task-scan-2',
    targetTaskId: 'task-final-1',
    locality: 'remote',
    persistence: 'ephemeral_query_blocks',
    status: 'registered',
    packetCount: 0,
    bytesBucket: 'none',
  },
  {
    id: 'tunnel-hash-4',
    exchangeType: 'hash_partition',
    sourceTaskId: 'task-scan-2',
    targetTaskId: 'task-final-2',
    locality: 'local',
    persistence: 'ephemeral_query_blocks',
    status: 'registered',
    packetCount: 0,
    bytesBucket: 'none',
  },
  {
    id: 'tunnel-root-1',
    exchangeType: 'pass_through',
    sourceTaskId: 'task-final-1',
    targetTaskId: 'tidb-root',
    locality: 'root',
    persistence: 'ephemeral_query_blocks',
    status: 'registered',
    packetCount: 0,
    bytesBucket: 'none',
  },
  {
    id: 'tunnel-root-2',
    exchangeType: 'pass_through',
    sourceTaskId: 'task-final-2',
    targetTaskId: 'tidb-root',
    locality: 'root',
    persistence: 'ephemeral_query_blocks',
    status: 'registered',
    packetCount: 0,
    bytesBucket: 'none',
  },
]

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`TiFlash/MPP Lab invariant: ${message}`)
}

function learnerByRegion(
  state: TraceTiFlashMppLabSnapshot,
  regionId: number,
): TraceTiFlashMppLearnerSnapshot {
  const learner = state.learners.find((candidate) =>
    candidate.regionId === regionId)
  invariant(learner, `unknown Region ${regionId}`)
  return learner
}

function taskById(
  state: TraceTiFlashMppLabSnapshot,
  taskId: TraceTiFlashMppTaskId,
): TraceTiFlashMppTaskSnapshot {
  const task = state.tasks.find((candidate) => candidate.id === taskId)
  invariant(task, `unknown task ${taskId}`)
  return task
}

function tunnelById(
  state: TraceTiFlashMppLabSnapshot,
  tunnelId: TraceTiFlashMppTunnelId,
): TraceTiFlashMppTunnelSnapshot {
  const tunnel = state.tunnels.find((candidate) => candidate.id === tunnelId)
  invariant(tunnel, `unknown tunnel ${tunnelId}`)
  return tunnel
}

function replaceLearner(
  learners: readonly TraceTiFlashMppLearnerSnapshot[],
  regionId: number,
  update: (
    learner: TraceTiFlashMppLearnerSnapshot,
  ) => TraceTiFlashMppLearnerSnapshot,
): readonly TraceTiFlashMppLearnerSnapshot[] {
  let found = false
  const next = learners.map((learner) => {
    if (learner.regionId !== regionId) return learner
    found = true
    return update(learner)
  })
  invariant(found, `unknown Region ${regionId}`)
  return next
}

function replaceTask(
  tasks: readonly TraceTiFlashMppTaskSnapshot[],
  taskId: TraceTiFlashMppTaskId,
  update: (
    task: TraceTiFlashMppTaskSnapshot,
  ) => TraceTiFlashMppTaskSnapshot,
): readonly TraceTiFlashMppTaskSnapshot[] {
  let found = false
  const next = tasks.map((task) => {
    if (task.id !== taskId) return task
    found = true
    return update(task)
  })
  invariant(found, `unknown task ${taskId}`)
  return next
}

function replaceTunnel(
  tunnels: readonly TraceTiFlashMppTunnelSnapshot[],
  tunnelId: TraceTiFlashMppTunnelId,
  update: (
    tunnel: TraceTiFlashMppTunnelSnapshot,
  ) => TraceTiFlashMppTunnelSnapshot,
): readonly TraceTiFlashMppTunnelSnapshot[] {
  let found = false
  const next = tunnels.map((tunnel) => {
    if (tunnel.id !== tunnelId) return tunnel
    found = true
    return update(tunnel)
  })
  invariant(found, `unknown tunnel ${tunnelId}`)
  return next
}

function validTaskTransition(
  task: TraceTiFlashMppTaskSnapshot,
  from: TraceTiFlashMppTaskSnapshot['stage'],
  to: TraceTiFlashMppTaskSnapshot['stage'],
): boolean {
  if (from === 'built') return to === 'dispatched'
  if (from === 'dispatched') return to === 'prepared'
  if (from === 'prepared') {
    return task.fragmentId === 'fragment-scan'
      ? to === 'snapshot_gating'
      : to === 'exchange_receiving'
  }
  if (from === 'snapshot_gating') return to === 'scanning'
  if (from === 'scanning') return to === 'partial_aggregated'
  if (from === 'partial_aggregated') return to === 'exchange_sending'
  if (from === 'exchange_sending') return to === 'complete'
  if (from === 'exchange_receiving') return to === 'final_aggregated'
  if (from === 'final_aggregated') return to === 'root_streaming'
  if (from === 'root_streaming') return to === 'complete'
  return false
}

function validResultTransition(
  from: TraceTiFlashMppLabSnapshot['result']['stage'],
  to: TraceTiFlashMppLabSnapshot['result']['stage'],
): boolean {
  return (
    (from === 'idle' && to === 'chunks_decoded') ||
    (from === 'chunks_decoded' && to === 'columns_sent') ||
    (from === 'columns_sent' && to === 'rows_streaming') ||
    (from === 'rows_streaming' && to === 'streams_eof') ||
    (from === 'streams_eof' && to === 'client_complete')
  )
}

function validateTiFlashMppLab(state: TraceTiFlashMppLabSnapshot): void {
  invariant(
    JSON.stringify(state.pins) === JSON.stringify(PINNED_COMMITS),
    'v8.5.0 source pins changed',
  )
  invariant(
    state.configuration.replicationPlane === 'persistent_region_raft' &&
      state.configuration.exchangePlane === 'ephemeral_query_blocks' &&
      state.configuration.learnerProjection ===
        'selected_query_replica_per_region' &&
      !state.configuration.unselectedLearnersModeled &&
      state.configuration.readFailurePolicy === 'wait_or_error_never_stale' &&
      state.configuration.regionDispatchRetry ===
        'requires_recuttask_reschedule' &&
      state.configuration.exchangeRetryBoundary ===
        'before_first_packet_only' &&
      state.configuration.fallbackBoundary ===
        'configured_timeout_before_client_side_effect_only' &&
      !state.configuration.staleRead &&
      !state.configuration.initialSnapshotTransferModeled &&
      !state.configuration.failureRetryModeled &&
      state.configuration.maxEventNodes === 57,
    'semantic boundary configuration changed',
  )
  invariant(
    state.retry.retryCount === 0 &&
      !state.retry.fallbackToTiKV &&
      state.retry.failureCode === null,
    'the success fixture cannot contain retry or fallback state',
  )
  invariant(state.stores.length === 2, 'the fixture requires two TiFlash stores')
  invariant(state.learners.length === 3, 'the fixture requires three learners')
  invariant(
    new Set(state.learners.map((learner) => learner.regionId)).size === 3,
    'learner Regions must be unique',
  )
  for (const learner of state.learners) {
    invariant(
      learner.role === 'learner' && !learner.voter,
      `Region ${learner.regionId} must remain a non-voting learner`,
    )
    invariant(
      learner.replicationMode === 'raft_log',
      `Region ${learner.regionId} cannot mix snapshot and log replication`,
    )
    invariant(
      learner.learnerAppliedIndex <= learner.deltaMergeFlushedIndex &&
        learner.deltaMergeFlushedIndex <= learner.learnerRaftCommandIndex &&
        learner.learnerRaftCommandIndex <= learner.learnerReceivedIndex &&
        learner.learnerReceivedIndex <= learner.leaderCommitIndex,
      `Region ${learner.regionId} replication indexes are out of order`,
    )
    invariant(
      learner.selfSafeTs <= learner.leaderSafeTs,
      `Region ${learner.regionId} self safe-ts exceeds leader safe-ts`,
    )
    invariant(
      learner.safeTsLagBucket ===
        (learner.selfSafeTs === learner.leaderSafeTs ? 'none' : 'about_2s'),
      `Region ${learner.regionId} safe-ts lag bucket is inconsistent`,
    )
    if (learner.requiredReadIndex !== null) {
      invariant(
        learner.requiredReadIndex <= learner.leaderCommitIndex,
        `Region ${learner.regionId} ReadIndex exceeds leader commit`,
      )
    }
    if (learner.gateReason === 'self_safe_ts') {
      invariant(
        learner.readIndexSkipped === true &&
          state.snapshotTs !== null &&
          state.snapshotTs <= learner.selfSafeTs,
        `Region ${learner.regionId} has an invalid safe-ts gate`,
      )
    }
    if (learner.gateReason === 'read_index_applied') {
      invariant(
        learner.readIndexSkipped === false &&
          learner.requiredReadIndex !== null &&
          learner.learnerAppliedIndex >= learner.requiredReadIndex,
        `Region ${learner.regionId} passed ReadIndex before apply`,
      )
    }
    if (learner.postReadValidated) {
      invariant(
        learner.readGate === 'validated' &&
          learner.lockCount === 0 &&
          learner.gateReason !== null,
        `Region ${learner.regionId} validation lacks a correct read gate`,
      )
    }
  }

  invariant(state.fragments.length <= 2, 'fragment capacity exceeded')
  invariant(state.tasks.length <= 4, 'task capacity exceeded')
  invariant(state.tunnels.length <= 6, 'tunnel capacity exceeded')
  if (state.fragments.length > 0) {
    invariant(state.fragments.length === 2, 'both fragments are built together')
  }
  if (state.tasks.length > 0) {
    invariant(
      state.fragments.length === 2 && state.tasks.length === 4,
      'four tasks require two fragments',
    )
    const scanRegions = state.tasks
      .filter((task) => task.fragmentId === 'fragment-scan')
      .flatMap((task) => task.regionIds)
      .sort((left, right) => left - right)
    invariant(
      JSON.stringify(scanRegions) === JSON.stringify([24, 25, 26]),
      'scan tasks must cover each Region exactly once',
    )
    invariant(
      state.tasks.every((task) => !task.root) &&
        state.tasks.filter((task) => task.feedsTiDBRoot).length === 2 &&
        state.tasks.filter((task) => task.feedsTiDBRoot).every((task) =>
          task.fragmentId === 'fragment-final'),
      'two final TiFlash tasks must feed the distinct TiDB root task',
    )
  }
  if (state.tunnels.length > 0) {
    invariant(
      state.tasks.length === 4 && state.tunnels.length === 6,
      'six tunnels require all four tasks',
    )
    invariant(
      state.tunnels.filter((tunnel) =>
        tunnel.exchangeType === 'hash_partition').length === 4 &&
      state.tunnels.filter((tunnel) =>
        tunnel.exchangeType === 'pass_through').length === 2,
      'the fixture requires four hash and two root tunnels',
    )
    for (const tunnel of state.tunnels) {
      invariant(
        tunnel.persistence === 'ephemeral_query_blocks',
        `${tunnel.id} cannot persist MPP data`,
      )
      taskById(state, tunnel.sourceTaskId)
      if (tunnel.targetTaskId !== 'tidb-root') {
        taskById(state, tunnel.targetTaskId)
      }
      if (tunnel.exchangeType === 'pass_through') {
        invariant(
          tunnel.targetTaskId === 'tidb-root' && tunnel.locality === 'root',
          `${tunnel.id} PassThrough must target TiDB`,
        )
      } else {
        const source = taskById(state, tunnel.sourceTaskId)
        const target = tunnel.targetTaskId === 'tidb-root'
          ? null
          : taskById(state, tunnel.targetTaskId)
        invariant(
          target !== null &&
            tunnel.locality ===
              (source.storeId === target.storeId ? 'local' : 'remote'),
          `${tunnel.id} HashPartition cannot target TiDB`,
        )
      }
      invariant(
        tunnel.packetCount >= 0 &&
          tunnel.bytesBucket ===
            (tunnel.packetCount === 0 ? 'none' : 'small'),
        `${tunnel.id} aggregate packet projection is inconsistent`,
      )
    }
  }
  invariant(
    state.result.taskId === 'tidb-root' &&
      state.result.rootStreamCount >= 0 &&
      state.result.rootStreamCount <= 2,
    'root stream capacity exceeded',
  )
  if (state.result.clientComplete) {
    invariant(
      state.phase === 'complete' &&
        state.result.stage === 'client_complete' &&
        state.result.rootStreamCount === 2 &&
        state.learners.every((learner) => learner.postReadValidated) &&
        state.tasks.every((task) => task.stage === 'complete') &&
        state.tunnels.every((tunnel) => tunnel.status === 'received'),
      'client completion requires validated Regions and drained tasks/tunnels',
    )
  }
}

export function isTiFlashMppLabDelta(
  delta: TraceStateDelta,
): delta is TiFlashMppLabDelta {
  return delta.kind.startsWith('tiflash_replica_') ||
    delta.kind.startsWith('tiflash_mpp_')
}

export function freezeTiFlashMppLabSnapshot(
  snapshot: TraceTiFlashMppLabSnapshot,
): TraceTiFlashMppLabSnapshot {
  return Object.freeze({
    ...snapshot,
    pins: Object.freeze({ ...snapshot.pins }),
    configuration: Object.freeze({ ...snapshot.configuration }),
    stores: Object.freeze(snapshot.stores.map((store) => Object.freeze({
      ...store,
      regionIds: Object.freeze([...store.regionIds]),
    }))),
    learners: Object.freeze(snapshot.learners.map((learner) =>
      Object.freeze({ ...learner }))),
    fragments: Object.freeze(snapshot.fragments.map((fragment) => Object.freeze({
      ...fragment,
      operatorTokens: Object.freeze([...fragment.operatorTokens]),
      taskIds: Object.freeze([...fragment.taskIds]),
    }))),
    tasks: Object.freeze(snapshot.tasks.map((task) => Object.freeze({
      ...task,
      regionIds: Object.freeze([...task.regionIds]),
    }))),
    tunnels: Object.freeze(snapshot.tunnels.map((tunnel) =>
      Object.freeze({ ...tunnel }))),
    result: Object.freeze({ ...snapshot.result }),
    retry: Object.freeze({ ...snapshot.retry }),
  })
}

export function createTiFlashMppLabState(): TraceTiFlashMppLabSnapshot {
  const snapshot = freezeTiFlashMppLabSnapshot({
    phase: 'replicating',
    pins: PINNED_COMMITS,
    configuration: CONFIGURATION,
    snapshotTs: null,
    provisioningObserved: false,
    accessPathSelected: false,
    stores: STORES,
    learners: LEARNER_DEFINITIONS.map((definition) => ({
      regionId: definition.regionId,
      leaderStoreId: definition.leaderStoreId,
      learnerStoreId: definition.learnerStoreId,
      role: 'learner',
      voter: false,
      replicationMode: 'raft_log',
      leaderCommitIndex: definition.baselineIndex,
      learnerReceivedIndex: definition.baselineIndex,
      learnerRaftCommandIndex: definition.baselineIndex,
      deltaMergeFlushedIndex: definition.baselineIndex,
      learnerAppliedIndex: definition.baselineIndex,
      leaderSafeTs: 999_998_000,
      selfSafeTs: 999_998_000,
      safeTsLagBucket: 'none',
      requiredReadIndex: null,
      readGate: 'unchecked',
      gateReason: null,
      readIndexSkipped: null,
      lockCount: null,
      postReadValidated: false,
      scheduled: false,
    })),
    fragments: [],
    tasks: [],
    tunnels: [],
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
  })
  validateTiFlashMppLab(snapshot)
  return snapshot
}

export function reduceTiFlashMppLabState(
  state: TraceTiFlashMppLabSnapshot,
  delta: TiFlashMppLabDelta,
): TraceTiFlashMppLabSnapshot {
  let phase = state.phase
  let snapshotTs = state.snapshotTs
  let provisioningObserved = state.provisioningObserved
  let accessPathSelected = state.accessPathSelected
  let learners = state.learners
  let fragments = state.fragments
  let tasks = state.tasks
  let tunnels = state.tunnels
  let result = state.result

  if (delta.kind === 'tiflash_replica_raft_commit') {
    const learner = learnerByRegion(state, delta.regionId)
    invariant(
      delta.index === learner.leaderCommitIndex + 1,
      'leader commit index must advance by one',
    )
    learners = replaceLearner(learners, delta.regionId, (candidate) => ({
      ...candidate,
      leaderCommitIndex: delta.index,
    }))
  } else if (delta.kind === 'tiflash_replica_receive') {
    const learner = learnerByRegion(state, delta.regionId)
    invariant(delta.replicationMode === 'raft_log', 'baseline models Raft log replication')
    invariant(
      delta.index > learner.learnerReceivedIndex &&
        delta.index <= learner.leaderCommitIndex,
      'learner receive must follow leader commit',
    )
    learners = replaceLearner(learners, delta.regionId, (candidate) => ({
      ...candidate,
      learnerReceivedIndex: delta.index,
    }))
  } else if (delta.kind === 'tiflash_replica_apply') {
    const learner = learnerByRegion(state, delta.regionId)
    invariant(
      delta.index > learner.learnerRaftCommandIndex &&
        delta.index <= learner.learnerReceivedIndex,
      'Raft command apply must follow learner receive',
    )
    learners = replaceLearner(learners, delta.regionId, (candidate) => ({
      ...candidate,
      learnerRaftCommandIndex: delta.index,
    }))
  } else if (delta.kind === 'tiflash_replica_dm_flush') {
    const learner = learnerByRegion(state, delta.regionId)
    invariant(
      delta.aggregateVersionCount > 0 &&
        delta.index > learner.deltaMergeFlushedIndex &&
        delta.index <= learner.learnerRaftCommandIndex,
      'DeltaMerge flush must follow command apply',
    )
    learners = replaceLearner(learners, delta.regionId, (candidate) => ({
      ...candidate,
      deltaMergeFlushedIndex: delta.index,
    }))
  } else if (delta.kind === 'tiflash_replica_applied_advance') {
    const learner = learnerByRegion(state, delta.regionId)
    invariant(
      delta.from === learner.learnerAppliedIndex &&
        delta.to > delta.from &&
        delta.to <= learner.deltaMergeFlushedIndex,
      'learner applied index must advance after the DeltaMerge flush',
    )
    learners = replaceLearner(learners, delta.regionId, (candidate) => ({
      ...candidate,
      learnerAppliedIndex: delta.to,
    }))
  } else if (delta.kind === 'tiflash_mpp_query_received') {
    invariant(state.phase === 'replicating', 'query may be received once')
    invariant(
      delta.queryToken === state.configuration.queryToken &&
        delta.queryClass === state.configuration.queryClass,
      'query fixture changed',
    )
    phase = 'planning'
  } else if (delta.kind === 'tiflash_mpp_snapshot_tso') {
    invariant(snapshotTs === null && delta.timestamp > 0, 'snapshot TSO may be allocated once')
    snapshotTs = delta.timestamp
  } else if (delta.kind === 'tiflash_mpp_safe_ts_update') {
    const learner = learnerByRegion(state, delta.regionId)
    invariant(
      delta.leaderSafeTs >= learner.leaderSafeTs &&
        delta.selfSafeTs >= learner.selfSafeTs &&
        delta.selfSafeTs <= delta.leaderSafeTs,
      'safe-ts updates must be monotonic and ordered',
    )
    invariant(
      delta.lagBucket ===
        (delta.selfSafeTs === delta.leaderSafeTs ? 'none' : 'about_2s'),
      'safe-ts lag bucket disagrees with timestamps',
    )
    if (delta.selfSafeTs > learner.selfSafeTs) {
      invariant(
        learner.learnerAppliedIndex === learner.leaderCommitIndex,
        'self safe-ts cannot advance before its associated data is applied',
      )
    }
    learners = replaceLearner(learners, delta.regionId, (candidate) => ({
      ...candidate,
      leaderSafeTs: delta.leaderSafeTs,
      selfSafeTs: delta.selfSafeTs,
      safeTsLagBucket: delta.lagBucket,
    }))
  } else if (delta.kind === 'tiflash_mpp_provisioning_observed') {
    invariant(
      !provisioningObserved &&
        delta.available &&
        delta.progress === 1 &&
        delta.meaning === state.configuration.provisioningMeaning,
      'provisioning observation changed semantics',
    )
    provisioningObserved = true
  } else if (delta.kind === 'tiflash_mpp_access_path') {
    invariant(
      provisioningObserved &&
        snapshotTs !== null &&
        !accessPathSelected &&
        delta.selected &&
        delta.optimizerMode === 'allow_mpp_costed',
      'MPP access path requires the declared successful optimizer fixture',
    )
    accessPathSelected = true
  } else if (delta.kind === 'tiflash_mpp_fragments_build') {
    invariant(
      accessPathSelected && fragments.length === 0 && delta.fragmentCount === 2,
      'exactly two fragments may be built once',
    )
    fragments = FRAGMENTS
  } else if (delta.kind === 'tiflash_mpp_regions_schedule') {
    invariant(
      fragments.length === 2 &&
        delta.regionCount === 3 &&
        delta.storeCount === 2 &&
        delta.policy === 'group_regions_by_tiflash_address',
      'Region scheduling fixture changed',
    )
    learners = learners.map((learner) => ({ ...learner, scheduled: true }))
  } else if (delta.kind === 'tiflash_mpp_tasks_build') {
    invariant(
      learners.every((learner) => learner.scheduled) &&
        tasks.length === 0 &&
        delta.taskCount === 4,
      'exactly four tasks may be built after scheduling',
    )
    tasks = TASKS
  } else if (delta.kind === 'tiflash_mpp_tunnels_build') {
    invariant(
      tasks.length === 4 &&
        tunnels.length === 0 &&
        delta.hashTunnelCount === 4 &&
        delta.rootTunnelCount === 2,
      'exactly six tunnels may be built once',
    )
    tunnels = TUNNELS
  } else if (delta.kind === 'tiflash_mpp_task_stage') {
    const task = taskById(state, delta.taskId)
    invariant(task.stage === delta.from, `${delta.taskId} stage changed unexpectedly`)
    invariant(
      validTaskTransition(task, delta.from, delta.to),
      `${delta.taskId} has an invalid ${delta.from} -> ${delta.to} transition`,
    )
    tasks = replaceTask(tasks, delta.taskId, (candidate) => ({
      ...candidate,
      stage: delta.to,
    }))
    if (delta.to === 'dispatched' || delta.to === 'prepared') {
      phase = 'dispatching'
    } else if (delta.to === 'snapshot_gating') {
      phase = 'snapshot_gating'
    } else if (delta.to === 'scanning' || delta.to === 'partial_aggregated') {
      phase = 'scanning'
    } else if (
      delta.to === 'exchange_sending' ||
      delta.to === 'exchange_receiving' ||
      delta.to === 'final_aggregated'
    ) {
      phase = 'exchanging'
    } else if (delta.to === 'root_streaming') {
      phase = 'streaming'
    }
  } else if (delta.kind === 'tiflash_mpp_snapshot_gate') {
    const learner = learnerByRegion(state, delta.regionId)
    invariant(snapshotTs !== null, 'snapshot gate requires a TSO')
    const scanTask = state.tasks.find((task) =>
      task.fragmentId === 'fragment-scan' &&
      task.regionIds.includes(delta.regionId))
    invariant(
      scanTask?.stage ===
        (delta.action === 'post_read_validate'
          ? 'scanning'
          : 'snapshot_gating'),
      `Region ${delta.regionId} gate action requires its scan task stage`,
    )
    if (delta.action === 'check_safe_ts') {
      invariant(learner.readGate === 'unchecked', 'safe-ts may be checked once')
      const readIndexSkipped = snapshotTs <= learner.selfSafeTs
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        readGate: 'safe_ts_checked',
        readIndexSkipped,
      }))
    } else if (delta.action === 'ready_safe_ts') {
      invariant(
        learner.readGate === 'safe_ts_checked' &&
          learner.readIndexSkipped === true &&
          snapshotTs <= learner.selfSafeTs,
        'safe-ts gate is not eligible',
      )
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        readGate: 'ready',
        gateReason: 'self_safe_ts',
      }))
    } else if (delta.action === 'request_read_index') {
      invariant(
        learner.readGate === 'safe_ts_checked' &&
          learner.readIndexSkipped === false,
        'ReadIndex is only requested when self safe-ts is behind',
      )
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        readGate: 'read_index_requested',
      }))
    } else if (delta.action === 'return_read_index') {
      invariant(
        learner.readGate === 'read_index_requested' &&
          delta.requiredReadIndex === learner.leaderCommitIndex,
        'ReadIndex response must return the leader commit fixture index',
      )
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        requiredReadIndex: delta.requiredReadIndex ?? null,
        readGate: 'read_index_returned',
      }))
    } else if (delta.action === 'wait_applied') {
      invariant(
        learner.readGate === 'read_index_returned' &&
          learner.requiredReadIndex !== null &&
          learner.learnerAppliedIndex < learner.requiredReadIndex,
        'wait-applied requires an actual learner index gap',
      )
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        readGate: 'waiting_applied',
      }))
    } else if (delta.action === 'ready_read_index') {
      invariant(
        learner.readGate === 'waiting_applied' &&
          learner.requiredReadIndex !== null &&
          learner.learnerAppliedIndex >= learner.requiredReadIndex,
        'ReadIndex gate cannot release before learner apply',
      )
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        readGate: 'ready',
        gateReason: 'read_index_applied',
      }))
    } else if (delta.action === 'lock_check') {
      invariant(
        learner.readGate === 'ready' && delta.lockCount === 0,
        'success fixture lock check must find zero locks',
      )
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        readGate: 'mvcc_checked',
        lockCount: 0,
      }))
    } else {
      invariant(
        learner.readGate === 'mvcc_checked' && learner.lockCount === 0,
        'post-read validation requires a completed MVCC check',
      )
      learners = replaceLearner(learners, delta.regionId, (candidate) => ({
        ...candidate,
        readGate: 'validated',
        postReadValidated: true,
      }))
    }
    phase = delta.action === 'post_read_validate' ? phase : 'snapshot_gating'
  } else if (delta.kind === 'tiflash_mpp_tunnel_data') {
    const tunnel = tunnelById(state, delta.tunnelId)
    const sourceTask = taskById(state, tunnel.sourceTaskId)
    invariant(
      delta.packetCount > 0 && delta.bytesBucket === 'small',
      'Exchange data must use positive aggregate packet counts',
    )
    if (delta.action === 'send') {
      invariant(tunnel.status === 'registered', `${tunnel.id} was already sent`)
      invariant(
        sourceTask.stage ===
          (tunnel.exchangeType === 'hash_partition'
            ? 'exchange_sending'
            : 'root_streaming'),
        `${tunnel.id} source task is not ready to send`,
      )
      tunnels = replaceTunnel(tunnels, delta.tunnelId, (candidate) => ({
        ...candidate,
        status: 'sent',
        packetCount: delta.packetCount,
        bytesBucket: delta.bytesBucket,
      }))
    } else {
      invariant(
        tunnel.status === 'sent' &&
          tunnel.packetCount === delta.packetCount,
        `${tunnel.id} receive does not match its send`,
      )
      if (tunnel.targetTaskId !== 'tidb-root') {
        invariant(
          taskById(state, tunnel.targetTaskId).stage === 'exchange_receiving',
          `${tunnel.id} target task is not receiving`,
        )
      }
      tunnels = replaceTunnel(tunnels, delta.tunnelId, (candidate) => ({
        ...candidate,
        status: 'received',
      }))
    }
    phase = tunnel.exchangeType === 'pass_through'
      ? 'streaming'
      : 'exchanging'
  } else if (delta.kind === 'tiflash_mpp_result_stage') {
    invariant(result.stage === delta.from, 'result stage changed unexpectedly')
    invariant(
      validResultTransition(delta.from, delta.to),
      `invalid result ${delta.from} -> ${delta.to} transition`,
    )
    if (delta.to === 'chunks_decoded') {
      invariant(
        state.tunnels
          .filter((tunnel) => tunnel.exchangeType === 'pass_through')
          .every((tunnel) => tunnel.status === 'received'),
        'MPP gather cannot decode before both root streams are received',
      )
    }
    invariant(
      delta.rootStreamCount >= result.rootStreamCount &&
        delta.rootStreamCount <= 2 &&
        delta.chunksDecoded >= result.chunksDecoded,
      'result aggregate counters must be monotonic and bounded',
    )
    const columnsSent = result.columnsSent || delta.to === 'columns_sent' ||
      delta.to === 'rows_streaming' ||
      delta.to === 'streams_eof' ||
      delta.to === 'client_complete'
    const clientComplete = delta.to === 'client_complete'
    result = {
      taskId: 'tidb-root',
      stage: delta.to,
      rootStreamCount: delta.rootStreamCount,
      chunksDecoded: delta.chunksDecoded,
      columnsSent,
      rowsBucket: delta.rowsBucket,
      clientComplete,
    }
    phase = clientComplete ? 'complete' : 'streaming'
  }

  const next = freezeTiFlashMppLabSnapshot({
    ...state,
    phase,
    snapshotTs,
    provisioningObserved,
    accessPathSelected,
    learners,
    fragments,
    tasks,
    tunnels,
    result,
  })
  validateTiFlashMppLab(next)
  return next
}
