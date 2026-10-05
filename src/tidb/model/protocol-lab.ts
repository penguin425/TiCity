/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure model-5 commit-protocol comparison state. The three lanes are separate
 * optimistic transactions. TiDB transaction coordination and each Region's
 * Raft state are intentionally represented as different layers.
 */

import type {
  ResolvedCommitProtocol,
  StoreId,
  TraceProtocolEligibilitySnapshot,
  TraceProtocolLabSnapshot,
  TraceProtocolLaneId,
  TraceProtocolLaneSnapshot,
  TraceProtocolRegionSnapshot,
  TraceStateDelta,
} from './types'

export type ProtocolLabDelta = Extract<
  TraceStateDelta,
  {
    kind:
      | 'protocol_lab_focus'
      | 'protocol_lane_stage'
      | 'protocol_timestamp'
      | 'protocol_region_raft'
      | 'protocol_client_response'
      | 'protocol_background_complete'
  }
>

export interface ProtocolLabRegionDefinition {
  regionId: number
  role: 'primary' | 'secondary'
  leaderStoreId: StoreId
  voterStoreIds: readonly [StoreId, StoreId, StoreId]
  mutationCount: number
}

export interface ProtocolLabLaneDefinition {
  id: TraceProtocolLaneId
  protocol: ResolvedCommitProtocol
  requestId: string
  transactionId: string
  eligibility: TraceProtocolEligibilitySnapshot
  regions: readonly ProtocolLabRegionDefinition[]
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Protocol Lab invariant: ${message}`)
}

function assertSuccessfulOptimizationTimestamp(
  lane: TraceProtocolLaneSnapshot,
  timestamp: number,
): void {
  // TiKV rejects final_min_commit_ts > max_commit_ts, not equality. A zero
  // optimization response and its normal-2PC fallback are outside these lanes.
  // tikv a2c58c94, storage/txn/actions/prewrite.rs:815-853.
  invariant(
    lane.requestMinCommitTs !== null && timestamp >= lane.requestMinCommitTs,
    `${lane.id} successful optimization timestamp is below its request floor`,
  )
  invariant(
    lane.maxCommitTs !== null && timestamp <= lane.maxCommitTs,
    `${lane.id} successful optimization timestamp exceeds max_commit_ts; fallback is not modeled in this fixture`,
  )
}

function validateLaneTransition(
  lane: TraceProtocolLaneSnapshot,
  next: TraceProtocolLaneSnapshot['stage'],
): void {
  const transitions: Partial<Record<TraceProtocolLaneSnapshot['stage'], readonly TraceProtocolLaneSnapshot['stage'][]>> = {
    idle: ['requested'],
    requested: ['started'],
    started: ['candidates_checked'],
    candidates_checked: ['latest_ts'],
    latest_ts: lane.protocol === '1pc' ? ['prewriting'] : ['selected'],
    selected: ['prewriting'],
    prewriting: lane.protocol === '1pc' ? ['committing'] : ['prewritten'],
    prewritten: lane.protocol === 'async_commit' ? ['client_acknowledged'] : ['commit_ts'],
    commit_ts: ['committing'],
    committing: ['client_acknowledged'],
    client_acknowledged: lane.protocol === '1pc' ? ['complete'] : ['background'],
    background: ['complete'],
  }
  invariant(
    transitions[lane.stage]?.includes(next),
    `${lane.id} cannot advance directly from ${lane.stage} to ${next}`,
  )
  if (next === 'started') {
    invariant(lane.startTs !== null, `${lane.id} cannot start without start_ts`)
  }
  if (next === 'latest_ts') {
    invariant(
      lane.latestTs !== null && lane.requestMinCommitTs !== null && lane.maxCommitTs !== null,
      `${lane.id} must prepare candidate timestamp bounds before batching`,
    )
  }
  if (next === 'prewriting') {
    invariant(
      lane.startTs !== null && lane.requestMinCommitTs !== null && lane.maxCommitTs !== null,
      `${lane.id} cannot prewrite before timestamp preparation`,
    )
  }
  if (next === 'prewritten') {
    invariant(
      lane.regions.every((region) => region.mvcc.lockCf === 'prewrite'),
      `${lane.id} cannot finish prewrite before every Region applies its lock`,
    )
  }
  if (next === 'committing' || next === 'commit_ts') {
    invariant(lane.commitTs !== null, `${lane.id} cannot commit without commit_ts`)
  }
  if (next === 'client_acknowledged') {
    invariant(lane.clientResponded, `${lane.id} cannot acknowledge a pending client`)
  }
}

function freezeRegion(
  region: TraceProtocolRegionSnapshot,
): TraceProtocolRegionSnapshot {
  return Object.freeze({
    ...region,
    voterStoreIds: Object.freeze([
      ...region.voterStoreIds,
    ]) as unknown as readonly [StoreId, StoreId, StoreId],
    raft: Object.freeze({
      ...region.raft,
      persistedStoreIds: Object.freeze([...region.raft.persistedStoreIds]),
    }),
    mvcc: Object.freeze({ ...region.mvcc }),
  })
}

function freezeLane(
  lane: TraceProtocolLaneSnapshot,
): TraceProtocolLaneSnapshot {
  return Object.freeze({
    ...lane,
    eligibility: Object.freeze({ ...lane.eligibility }),
    regions: Object.freeze(lane.regions.map(freezeRegion)),
  })
}

export function freezeProtocolLabSnapshot(
  snapshot: TraceProtocolLabSnapshot,
): TraceProtocolLabSnapshot {
  return Object.freeze({
    ...snapshot,
    lanes: Object.freeze(
      snapshot.lanes.map(freezeLane),
    ) as unknown as TraceProtocolLabSnapshot['lanes'],
  })
}

function laneById(
  state: TraceProtocolLabSnapshot,
  laneId: TraceProtocolLaneId,
): TraceProtocolLaneSnapshot {
  const lane = state.lanes.find((candidate) => candidate.id === laneId)
  invariant(lane, `unknown lane ${laneId}`)
  return lane
}

function regionById(
  lane: TraceProtocolLaneSnapshot,
  regionId: number,
): TraceProtocolRegionSnapshot {
  const region = lane.regions.find((candidate) => candidate.regionId === regionId)
  invariant(region, `unknown Region ${regionId} in ${lane.id}`)
  return region
}

function replaceLane(
  state: TraceProtocolLabSnapshot,
  laneId: TraceProtocolLaneId,
  update: (lane: TraceProtocolLaneSnapshot) => TraceProtocolLaneSnapshot,
): TraceProtocolLabSnapshot {
  let found = false
  const lanes = state.lanes.map((lane) => {
    if (lane.id !== laneId) return lane
    found = true
    return update(lane)
  })
  invariant(found, `unknown lane ${laneId}`)
  return {
    ...state,
    lanes: lanes as unknown as TraceProtocolLabSnapshot['lanes'],
  }
}

function replaceRegion(
  lane: TraceProtocolLaneSnapshot,
  regionId: number,
  update: (
    region: TraceProtocolRegionSnapshot,
  ) => TraceProtocolRegionSnapshot,
): TraceProtocolLaneSnapshot {
  let found = false
  const regions = lane.regions.map((region) => {
    if (region.regionId !== regionId) return region
    found = true
    return update(region)
  })
  invariant(found, `unknown Region ${regionId} in ${lane.id}`)
  return { ...lane, regions }
}

function validateEligibility(lane: TraceProtocolLaneSnapshot): void {
  const eligibility = lane.eligibility
  invariant(eligibility.enable1Pc, '1PC feature flag must be enabled')
  invariant(
    eligibility.enableAsyncCommit,
    'Async Commit feature flag must be enabled',
  )
  invariant(
    eligibility.consistency === 'linearizable',
    'the comparison keeps TiDB default linear consistency',
  )
  invariant(
    eligibility.selected === lane.protocol,
    `${lane.id} selection and protocol disagree`,
  )
  invariant(
    eligibility.regionCount === lane.regions.length,
    `${lane.id} Region count disagrees`,
  )
  invariant(
    eligibility.mutationCount ===
      lane.regions.reduce((total, region) => total + region.mutationCount, 0),
    `${lane.id} mutation count disagrees`,
  )
  invariant(
    Number.isSafeInteger(eligibility.totalKeyBytes) && eligibility.totalKeyBytes >= 0,
    `${lane.id} total key bytes must be a non-negative safe integer`,
  )
  invariant(
    eligibility.asyncKeyCountLimit === 256 &&
      eligibility.asyncTotalKeyBytesLimit === 4096,
    'the comparison is pinned to TiDB v8.5 client defaults',
  )
  invariant(!eligibility.runtimeFallback, 'the comparison has no runtime fallback')
  if (eligibility.asyncCommitEligible) {
    invariant(
      eligibility.mutationCount <= eligibility.asyncKeyCountLimit &&
        eligibility.totalKeyBytes <= eligibility.asyncTotalKeyBytesLimit,
      `${lane.id} Async Commit exceeds the client precheck limits`,
    )
  }
  invariant(
    lane.regions.filter((region) => region.role === 'primary').length === 1,
    `${lane.id} must have exactly one primary Region`,
  )

  if (lane.id === 'one_pc') {
    invariant(lane.protocol === '1pc', 'one_pc lane must select 1PC')
    invariant(lane.regions.length === 1, '1PC lane requires one Region')
    invariant(
      eligibility.onePcEligible &&
        eligibility.asyncCommitEligible &&
        eligibility.tryOnePcSent &&
        !eligibility.onePcRejectedBeforeRpc,
      '1PC eligibility contract is inconsistent',
    )
  } else if (lane.id === 'async_commit') {
    invariant(
      lane.protocol === 'async_commit',
      'async_commit lane must select Async Commit',
    )
    invariant(lane.regions.length === 2, 'Async lane requires two Regions')
    invariant(
      !eligibility.onePcEligible &&
        eligibility.asyncCommitEligible &&
        eligibility.onePcRejectedBeforeRpc &&
        !eligibility.tryOnePcSent,
      'Async eligibility contract is inconsistent',
    )
  } else {
    invariant(lane.protocol === '2pc', 'two_pc lane must select regular 2PC')
    invariant(lane.regions.length === 2, '2PC lane requires two Regions')
    invariant(
      !eligibility.onePcEligible &&
        !eligibility.asyncCommitEligible &&
        eligibility.onePcRejectedBeforeRpc &&
        eligibility.asyncRejectedAtClientPrecheck &&
        !eligibility.tryOnePcSent,
      '2PC eligibility contract is inconsistent',
    )
  }
}

function validateRegion(
  lane: TraceProtocolLaneSnapshot,
  region: TraceProtocolRegionSnapshot,
): void {
  invariant(
    Number.isSafeInteger(region.mutationCount) && region.mutationCount > 0,
    `Region ${region.regionId} mutation count must be a positive safe integer`,
  )
  invariant(
    new Set(region.voterStoreIds).size === 3,
    `Region ${region.regionId} requires three distinct voters`,
  )
  invariant(
    region.voterStoreIds.includes(region.leaderStoreId),
    `Region ${region.regionId} leader must be a voter`,
  )
  invariant(region.raft.quorum === 2, 'three voters require quorum 2')
  invariant(
    new Set(region.raft.persistedStoreIds).size ===
      region.raft.persistedStoreIds.length,
    `Region ${region.regionId} persisted voters must be unique`,
  )
  invariant(
    region.raft.persistedStoreIds.every((storeId) =>
      region.voterStoreIds.includes(storeId)),
    `Region ${region.regionId} persisted an unknown voter`,
  )
  invariant(
    region.raft.acknowledgements === region.raft.persistedStoreIds.length,
    `Region ${region.regionId} acknowledgement count disagrees`,
  )
  if (
    region.raft.stage === 'persisted_quorum' ||
    region.raft.stage === 'committed' ||
    region.raft.stage === 'applied'
  ) {
    invariant(
      region.raft.acknowledgements >= region.raft.quorum,
      `Region ${region.regionId} advanced without a quorum`,
    )
  }
  if (region.raft.stage === 'idle') {
    invariant(
      region.raft.operation === null &&
        region.raft.index === null &&
        region.raft.persistedStoreIds.length === 0,
      `Region ${region.regionId} idle Raft state carries progress`,
    )
  } else {
    invariant(
      region.raft.operation !== null && region.raft.index !== null,
      `Region ${region.regionId} active Raft state lacks an entry`,
    )
  }
  invariant(
    !(region.mvcc.lockCf === 'prewrite' && region.mvcc.writeCf === 'commit'),
    `Region ${region.regionId} cannot retain a lock after commit`,
  )
  if (region.mvcc.lockCf === 'prewrite' || region.mvcc.writeCf === 'commit') {
    invariant(
      region.mvcc.defaultCf === 'value',
      `Region ${region.regionId} MVCC metadata requires a tentative value`,
    )
  }
  if (region.mvcc.asyncCommit) {
    invariant(
      lane.protocol === 'async_commit' &&
        region.mvcc.lockCf === 'prewrite',
      `Region ${region.regionId} has invalid Async Commit lock metadata`,
    )
  }
  if (region.mvcc.secondaryCount > 0) {
    invariant(
      lane.protocol === 'async_commit' &&
        region.role === 'primary' &&
        region.mvcc.lockCf === 'prewrite',
      'secondary count belongs only to an Async Commit primary lock',
    )
  }
  if (region.returnedMinCommitTs !== null) {
    invariant(
      lane.protocol === 'async_commit' &&
        region.mvcc.defaultCf === 'value',
      `Region ${region.regionId} returned min_commit_ts before prewrite apply`,
    )
    assertSuccessfulOptimizationTimestamp(lane, region.returnedMinCommitTs)
  }
}

function validateProtocolLab(state: TraceProtocolLabSnapshot): void {
  invariant(
    state.lanes.map((lane) => lane.id).join(',') ===
      'one_pc,async_commit,two_pc',
    'lanes must stay in the fixed comparison order',
  )
  invariant(
    state.consistency === 'linearizable',
    'comparison consistency must remain linearizable',
  )
  invariant(
    state.transactionMode === 'optimistic' &&
      state.transactionScope === 'global' &&
      state.representation === 'aggregate_counts_only',
    'comparison fixtures must remain optimistic global aggregate profiles',
  )
  invariant(state.safeWindowMs === 2000, 'safe-window fixture must remain 2 seconds')
  invariant(
    state.coordinatorLayer === 'tidb_transaction_commit' &&
      state.raftLayer === 'per_region_consensus',
    'transaction commit and Region Raft layers must remain separate',
  )
  invariant(
    !state.tikvAsyncApplyPrewrite,
    'this slice assumes TiKV async apply prewrite is off',
  )
  if (state.focusLaneId !== null) laneById(state, state.focusLaneId)

  const transactionIds = new Set<string>()
  const regionIds = new Set<number>()
  for (const lane of state.lanes) {
    invariant(!transactionIds.has(lane.transactionId), 'transaction ids must be unique')
    transactionIds.add(lane.transactionId)
    validateEligibility(lane)
    invariant(
      lane.startTs === null || lane.startTs > 0,
      `${lane.id} start_ts must be positive`,
    )
    if (lane.latestTs !== null) {
      invariant(
        lane.startTs !== null && lane.latestTs > lane.startTs,
        `${lane.id} candidate latest_ts must follow start_ts`,
      )
    }
    if (lane.requestMinCommitTs !== null) {
      invariant(
        lane.latestTs !== null &&
          lane.requestMinCommitTs === lane.latestTs + 1,
        `${lane.id} request min_commit_ts must be latest_ts + 1`,
      )
    }
    if (lane.maxCommitTs !== null) {
      invariant(
        lane.requestMinCommitTs !== null &&
          lane.maxCommitTs >= lane.requestMinCommitTs,
        `${lane.id} max_commit_ts bound is invalid`,
      )
    }
    if (lane.commitTs !== null) {
      invariant(
        lane.startTs !== null && lane.commitTs > lane.startTs,
        `${lane.id} commit_ts must be greater than start_ts`,
      )
      invariant(lane.commitTsSource !== null, `${lane.id} commit_ts needs a source`)
      invariant(
        lane.requestMinCommitTs !== null && lane.commitTs >= lane.requestMinCommitTs,
        `${lane.id} commit_ts must respect its prepared request floor`,
      )
      invariant(
        lane.commitTsSource === (lane.protocol === '1pc'
          ? 'tikv_one_pc_result'
          : lane.protocol === 'async_commit'
            ? 'max_prewrite_min_commit_ts'
            : 'pd_tso_after_prewrite'),
        `${lane.id} commit timestamp authority disagrees with its protocol`,
      )
      if (lane.protocol !== '2pc') assertSuccessfulOptimizationTimestamp(lane, lane.commitTs)
    } else {
      invariant(lane.commitTsSource === null, `${lane.id} has a source without commit_ts`)
    }
    for (const region of lane.regions) {
      invariant(
        !regionIds.has(region.regionId),
        `Region ${region.regionId} is shared across comparison lanes`,
      )
      regionIds.add(region.regionId)
      validateRegion(lane, region)
    }
    if (lane.clientResponded) {
      invariant(lane.commitTs !== null, `${lane.id} responded without commit_ts`)
      if (lane.protocol === '1pc') {
        invariant(
          lane.regions.every((region) => region.mvcc.writeCf === 'commit'),
          '1PC response requires atomic commit apply',
        )
      } else if (lane.protocol === 'async_commit') {
        invariant(
          lane.regions.every((region) =>
            region.mvcc.lockCf === 'prewrite' ||
            region.mvcc.writeCf === 'commit'),
          'Async response requires every prewrite',
        )
      } else {
        invariant(
          lane.regions.find((region) => region.role === 'primary')
            ?.mvcc.writeCf === 'commit',
          '2PC response requires primary commit',
        )
      }
    }
    if (lane.backgroundComplete) {
      invariant(
        lane.protocol !== '1pc' &&
          lane.regions.every((region) =>
            region.mvcc.writeCf === 'commit' &&
            region.mvcc.lockCf === 'empty'),
        `${lane.id} background completion requires resolved locks`,
      )
    }
    if (lane.stage === 'complete') {
      invariant(lane.clientResponded, `${lane.id} completed before client response`)
      invariant(
        lane.regions.every((region) =>
          region.mvcc.writeCf === 'commit' &&
          region.mvcc.lockCf === 'empty'),
        `${lane.id} completed with unresolved MVCC state`,
      )
    }
  }
  if (state.phase === 'complete') {
    invariant(
      state.focusLaneId === null &&
        state.lanes.every((lane) => lane.stage === 'complete'),
      'comparison completion requires all lanes',
    )
  }
}

export function createProtocolLabState(
  definitions: readonly [
    ProtocolLabLaneDefinition,
    ProtocolLabLaneDefinition,
    ProtocolLabLaneDefinition,
  ],
): TraceProtocolLabSnapshot {
  const lanes = definitions.map((definition): TraceProtocolLaneSnapshot => ({
    id: definition.id,
    protocol: definition.protocol,
    requestId: definition.requestId,
    transactionId: definition.transactionId,
    stage: 'idle',
    eligibility: { ...definition.eligibility },
    startTs: null,
    latestTs: null,
    requestMinCommitTs: null,
    maxCommitTs: null,
    commitTs: null,
    commitTsSource: null,
    clientResponded: false,
    backgroundComplete: false,
    regions: definition.regions.map((region): TraceProtocolRegionSnapshot => ({
      ...region,
      voterStoreIds: [...region.voterStoreIds] as [
        StoreId,
        StoreId,
        StoreId,
      ],
      raft: {
        operation: null,
        stage: 'idle',
        index: null,
        persistedStoreIds: [],
        acknowledgements: 0,
        quorum: 2,
      },
      mvcc: {
        defaultCf: 'empty',
        lockCf: 'empty',
        writeCf: 'empty',
        asyncCommit: false,
        secondaryCount: 0,
      },
      returnedMinCommitTs: null,
    })),
  }))
  const state: TraceProtocolLabSnapshot = {
    phase: 'idle',
    focusLaneId: null,
    consistency: 'linearizable',
    transactionMode: 'optimistic',
    transactionScope: 'global',
    representation: 'aggregate_counts_only',
    safeWindowMs: 2000,
    coordinatorLayer: 'tidb_transaction_commit',
    raftLayer: 'per_region_consensus',
    tikvAsyncApplyPrewrite: false,
    clientBoundary: 'response_before_cleanup_completion',
    backgroundScheduling: 'deterministic_after_client_boundary_model_policy',
    maxCommitTsPolicy: 'representative_safe_window_model_bound',
    lanes: lanes as unknown as TraceProtocolLabSnapshot['lanes'],
  }
  validateProtocolLab(state)
  return freezeProtocolLabSnapshot(state)
}

export function isProtocolLabDelta(
  delta: TraceStateDelta,
): delta is ProtocolLabDelta {
  return delta.kind === 'protocol_lab_focus' ||
    delta.kind === 'protocol_lane_stage' ||
    delta.kind === 'protocol_timestamp' ||
    delta.kind === 'protocol_region_raft' ||
    delta.kind === 'protocol_client_response' ||
    delta.kind === 'protocol_background_complete'
}

export function reduceProtocolLabState(
  current: TraceProtocolLabSnapshot,
  delta: ProtocolLabDelta,
): TraceProtocolLabSnapshot {
  let next: TraceProtocolLabSnapshot

  if (delta.kind === 'protocol_lab_focus') {
    next = {
      ...current,
      focusLaneId: delta.laneId,
      phase: delta.phase,
    }
  } else if (delta.kind === 'protocol_lane_stage') {
    next = replaceLane(current, delta.laneId, (lane) => {
      invariant(
        lane.stage === delta.from,
        `${lane.id} stage is ${lane.stage}, expected ${delta.from}`,
      )
      validateLaneTransition(lane, delta.to)
      return { ...lane, stage: delta.to }
    })
  } else if (delta.kind === 'protocol_timestamp') {
    next = replaceLane(current, delta.laneId, (lane) => {
      invariant(
        Number.isSafeInteger(delta.timestamp) && delta.timestamp > 0,
        `${lane.id} timestamp must be a positive safe integer`,
      )
      if (delta.purpose === 'start_ts') {
        invariant(delta.source === 'pd', 'start_ts must come from PD')
        invariant(lane.startTs === null, `${lane.id} cannot replace start_ts`)
        return { ...lane, startTs: delta.timestamp }
      }
      if (delta.purpose === 'latest_ts') {
        invariant(delta.source === 'pd', 'latest_ts must come from PD')
        invariant(lane.latestTs === null, `${lane.id} cannot replace latest_ts`)
        return { ...lane, latestTs: delta.timestamp }
      }
      if (delta.purpose === 'request_min_commit_ts') {
        invariant(lane.requestMinCommitTs === null, `${lane.id} cannot replace its request floor`)
        invariant(
          delta.source === 'tidb_model_bound',
          'request min_commit_ts is a modeled TiDB floor',
        )
        return { ...lane, requestMinCommitTs: delta.timestamp }
      }
      if (delta.purpose === 'max_commit_ts') {
        invariant(lane.maxCommitTs === null, `${lane.id} cannot replace max_commit_ts`)
        invariant(
          delta.source === 'tidb_model_bound',
          'max_commit_ts is a modeled safe-window bound',
        )
        return { ...lane, maxCommitTs: delta.timestamp }
      }
      if (delta.purpose === 'returned_min_commit_ts') {
        invariant(delta.source === 'tikv', 'returned min_commit_ts comes from TiKV')
        invariant(delta.regionId !== undefined, 'returned min_commit_ts needs a Region')
        const region = regionById(lane, delta.regionId)
        invariant(region.returnedMinCommitTs === null, `Region ${region.regionId} cannot replace its prewrite result`)
        return replaceRegion(lane, delta.regionId, (region) => ({
          ...region,
          returnedMinCommitTs: delta.timestamp,
        }))
      }
      invariant(
        delta.purpose === 'commit_ts' ||
          delta.purpose === 'one_pc_commit_ts' ||
          delta.purpose === 'async_commit_ts',
        'unknown commit timestamp purpose',
      )
      if (delta.purpose === 'commit_ts') {
        invariant(delta.source === 'pd', 'regular 2PC commit_ts must come from PD')
        invariant(lane.protocol === '2pc', 'PD commit_ts belongs only to regular 2PC')
        invariant(
          lane.regions.every((region) => region.mvcc.lockCf === 'prewrite'),
          'regular 2PC must finish all prewrites before commit_ts allocation',
        )
      } else {
        invariant(delta.source === 'tikv', `${delta.purpose} must come from TiKV`)
        if (delta.purpose === 'one_pc_commit_ts') {
          invariant(lane.protocol === '1pc', 'one_pc_commit_ts belongs only to 1PC')
          invariant(
            lane.regions.every((region) => region.mvcc.writeCf === 'commit'),
            '1PC timestamp result requires atomic commit apply',
          )
        } else {
          invariant(lane.protocol === 'async_commit', 'async_commit_ts belongs only to Async Commit')
          invariant(
            lane.regions.every((region) => region.returnedMinCommitTs !== null),
            'Async commit decision requires every Region prewrite result',
          )
          invariant(
            delta.timestamp === Math.max(...lane.regions.map((region) => region.returnedMinCommitTs!)),
            'Async commit_ts must equal the maximum returned min_commit_ts',
          )
        }
      }
      invariant(lane.commitTs === null, `${lane.id} cannot replace commit_ts`)
      return {
        ...lane,
        commitTs: delta.timestamp,
        commitTsSource: delta.purpose === 'commit_ts'
          ? 'pd_tso_after_prewrite'
          : delta.purpose === 'one_pc_commit_ts'
            ? 'tikv_one_pc_result'
            : 'max_prewrite_min_commit_ts',
      }
    })
  } else if (delta.kind === 'protocol_region_raft') {
    next = replaceLane(current, delta.laneId, (lane) =>
      replaceRegion(lane, delta.regionId, (region) => {
        if (delta.action === 'propose') {
          invariant(
            region.raft.stage === 'idle' ||
              region.raft.stage === 'applied',
            `Region ${region.regionId} cannot replace an unfinished Raft entry`,
          )
          invariant(
            Number.isSafeInteger(delta.index) && delta.index > (region.raft.index ?? 0),
            `Region ${region.regionId} proposal index must advance`,
          )
          if (delta.operation === 'prewrite' || delta.operation === 'one_pc_prewrite') {
            invariant(
              lane.stage === 'prewriting' && lane.startTs !== null &&
                lane.requestMinCommitTs !== null && lane.maxCommitTs !== null,
              'Prewrite proposal requires the prepared transaction dispatch',
            )
            invariant(
              (delta.operation === 'one_pc_prewrite') === (lane.protocol === '1pc'),
              'Prewrite operation must match its selected protocol',
            )
            invariant(
              region.mvcc.defaultCf === 'empty' && region.mvcc.lockCf === 'empty' && region.mvcc.writeCf === 'empty',
              'This happy-path fixture cannot prewrite an already applied mutation',
            )
          } else {
            invariant(lane.commitTs !== null, 'Commit proposal requires the established commit timestamp')
            invariant(region.mvcc.lockCf === 'prewrite', 'Commit requires an applied prewrite lock')
            invariant(
              (delta.operation === 'commit_async' && lane.protocol === 'async_commit') ||
              (delta.operation === 'commit_primary' && lane.protocol === '2pc' && region.role === 'primary') ||
              (delta.operation === 'commit_secondary' && lane.protocol === '2pc' && region.role === 'secondary'),
              'Commit operation must match its protocol and primary/secondary role',
            )
            if (delta.operation === 'commit_secondary') {
              invariant(
                lane.regions.find((candidate) => candidate.role === 'primary')?.mvcc.writeCf === 'commit',
                'Secondary Commit must follow the primary decision',
              )
            }
          }
          return {
            ...region,
            raft: {
              operation: delta.operation,
              stage: 'proposed',
              index: delta.index,
              persistedStoreIds: [],
              acknowledgements: 0,
              quorum: 2,
            },
          }
        }
        invariant(
          region.raft.operation === delta.operation &&
            region.raft.index === delta.index,
          `Region ${region.regionId} Raft operation or index disagrees`,
        )
        if (delta.action === 'persist_quorum') {
          invariant(
            region.raft.stage === 'proposed',
            `Region ${region.regionId} must propose before persistence`,
          )
          const storeIds = [...(delta.storeIds ?? [])]
          invariant(storeIds.length >= 2, 'persist_quorum requires at least two voters')
          return {
            ...region,
            raft: {
              ...region.raft,
              stage: 'persisted_quorum',
              persistedStoreIds: storeIds,
              acknowledgements: storeIds.length,
            },
          }
        }
        if (delta.action === 'commit') {
          invariant(
            region.raft.stage === 'persisted_quorum',
            `Region ${region.regionId} must persist before commit`,
          )
          return {
            ...region,
            raft: { ...region.raft, stage: 'committed' },
          }
        }
        invariant(
          region.raft.stage === 'committed',
          `Region ${region.regionId} must commit before apply`,
        )
        const isPrewrite = delta.operation === 'prewrite'
        const isOnePc = delta.operation === 'one_pc_prewrite'
        const secondaryCount = isPrewrite &&
          lane.protocol === 'async_commit' &&
          region.role === 'primary'
          ? lane.eligibility.mutationCount - region.mutationCount
          : 0
        return {
          ...region,
          raft: { ...region.raft, stage: 'applied' },
          mvcc: isPrewrite
            ? {
              defaultCf: 'value',
              lockCf: 'prewrite',
              writeCf: 'empty',
              asyncCommit: lane.protocol === 'async_commit',
              secondaryCount,
            }
            : isOnePc
              ? {
                defaultCf: 'value',
                lockCf: 'empty',
                writeCf: 'commit',
                asyncCommit: false,
                secondaryCount: 0,
              }
              : {
                defaultCf: 'value',
                lockCf: 'empty',
                writeCf: 'commit',
                asyncCommit: false,
                secondaryCount: 0,
              },
        }
      }))
  } else if (delta.kind === 'protocol_client_response') {
    next = replaceLane(current, delta.laneId, (lane) => {
      invariant(
        lane.commitTs === delta.commitTs,
        `${lane.id} response commit_ts disagrees`,
      )
      return { ...lane, clientResponded: true }
    })
  } else {
    next = replaceLane(current, delta.laneId, (lane) => ({
      ...lane,
      backgroundComplete: true,
    }))
  }

  validateProtocolLab(next)
  return freezeProtocolLabSnapshot(next)
}
