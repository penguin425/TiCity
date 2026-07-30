/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure model-6 GC/Storage Lab state. The reducer pins TiDB/TiKV v8.5.0's
 * default LEGACY Resolve Locks plus distributed safe-point and Compaction
 * Filter path. All identifiers and counts are synthetic teaching fixtures.
 */

import type {
  StoreId,
  TraceGcDeleteRangeSnapshot,
  TraceGcKeyChainSnapshot,
  TraceGcLabSnapshot,
  TraceGcLockSnapshot,
  TraceGcStoreSnapshot,
  TraceGcVersionSnapshot,
  TraceStateDelta,
} from './types'

export type GcLabDelta = Extract<
  TraceStateDelta,
  {
    kind:
      | 'gc_phase'
      | 'gc_safe_point_candidate'
      | 'gc_safe_point_bound'
      | 'gc_blocker_state'
      | 'gc_resolve_lock_scan'
      | 'gc_resolve_lock'
      | 'gc_delete_range'
      | 'gc_safe_point_stage'
      | 'gc_visibility_safe_point_save'
      | 'gc_safe_point_publish'
      | 'gc_store_safe_point'
      | 'gc_compaction_state'
      | 'gc_compaction_filter'
  }
>

export interface GcLabVersionDefinition {
  id: string
  commitTs: number
  writeType: TraceGcVersionSnapshot['writeType']
  valueStorage: TraceGcVersionSnapshot['valueStorage']
}

export interface GcLabKeyChainDefinition {
  id: string
  regionId: number
  versions: readonly GcLabVersionDefinition[]
}

export interface GcLabLockDefinition {
  id: string
  regionId: number
  startTs: number
  primaryStatus: TraceGcLockSnapshot['primaryStatus']
}

export interface GcLabDeleteRangeDefinition {
  id: string
  dropTs: number
}

export interface GcLabDefinition {
  initialSafePoint: number
  blockerTransactionId: string
  blockerStartTs: number
  storeIds: readonly StoreId[]
  keyChains: readonly GcLabKeyChainDefinition[]
  locks: readonly GcLabLockDefinition[]
  deleteRanges: readonly GcLabDeleteRangeDefinition[]
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`GC/Storage Lab invariant: ${message}`)
}

export function isGcLabDelta(delta: TraceStateDelta): delta is GcLabDelta {
  return delta.kind === 'gc_phase' ||
    delta.kind === 'gc_safe_point_candidate' ||
    delta.kind === 'gc_safe_point_bound' ||
    delta.kind === 'gc_blocker_state' ||
    delta.kind === 'gc_resolve_lock_scan' ||
    delta.kind === 'gc_resolve_lock' ||
    delta.kind === 'gc_delete_range' ||
    delta.kind === 'gc_safe_point_stage' ||
    delta.kind === 'gc_visibility_safe_point_save' ||
    delta.kind === 'gc_safe_point_publish' ||
    delta.kind === 'gc_store_safe_point' ||
    delta.kind === 'gc_compaction_state' ||
    delta.kind === 'gc_compaction_filter'
}

function freezeVersion(
  version: TraceGcVersionSnapshot,
): TraceGcVersionSnapshot {
  return Object.freeze({ ...version })
}

function freezeChain(
  chain: TraceGcKeyChainSnapshot,
): TraceGcKeyChainSnapshot {
  return Object.freeze({
    ...chain,
    versions: Object.freeze(chain.versions.map(freezeVersion)),
  })
}

export function freezeGcLabSnapshot(
  snapshot: TraceGcLabSnapshot,
): TraceGcLabSnapshot {
  return Object.freeze({
    ...snapshot,
    configuration: Object.freeze({ ...snapshot.configuration }),
    safePoint: Object.freeze({ ...snapshot.safePoint }),
    blocker: Object.freeze({ ...snapshot.blocker }),
    resolveLocks: Object.freeze({
      ...snapshot.resolveLocks,
      scannedRegionIds: Object.freeze([
        ...snapshot.resolveLocks.scannedRegionIds,
      ]),
      locks: Object.freeze(snapshot.resolveLocks.locks.map((lock) =>
        Object.freeze({ ...lock }))),
    }),
    deleteRanges: Object.freeze(snapshot.deleteRanges.map((range) =>
      Object.freeze({ ...range }))),
    stores: Object.freeze(snapshot.stores.map((store) =>
      Object.freeze({ ...store }))),
    keyChains: Object.freeze(snapshot.keyChains.map(freezeChain)),
    storage: Object.freeze({ ...snapshot.storage }),
  })
}

function allVersions(
  keyChains: readonly TraceGcKeyChainSnapshot[],
): readonly TraceGcVersionSnapshot[] {
  return keyChains.flatMap((chain) => chain.versions)
}

function storageProjection(
  keyChains: readonly TraceGcKeyChainSnapshot[],
): TraceGcLabSnapshot['storage'] {
  const versions = allVersions(keyChains)
  const filtered = versions.filter((version) => version.state === 'filtered')
  return {
    representation: 'logical_chains_counted_once',
    compactionLevel: 'bottommost_model_fixture',
    initialVersionCount: versions.length,
    filteredVersionCount: filtered.length,
    retainedAnchorCount: versions.filter((version) =>
      version.state === 'retained_anchor').length,
    presentVersionCount: versions.length - filtered.length,
    deletedDefaultCfValues: filtered.filter((version) =>
      version.writeType === 'put' &&
      version.valueStorage === 'write_and_default_cf').length,
    compactionRaftEntriesCreated: 0,
  }
}

function validateVersionChains(
  keyChains: readonly TraceGcKeyChainSnapshot[],
  publishedSafePoint: number,
): void {
  const chainIds = new Set<string>()
  const versionIds = new Set<string>()
  for (const chain of keyChains) {
    invariant(!chainIds.has(chain.id), `duplicate chain ${chain.id}`)
    chainIds.add(chain.id)
    invariant(chain.versions.length > 0, `${chain.id} must not be empty`)
    let previousTs = 0
    for (const version of chain.versions) {
      invariant(!versionIds.has(version.id), `duplicate version ${version.id}`)
      versionIds.add(version.id)
      invariant(
        Number.isSafeInteger(version.commitTs) &&
        version.commitTs > previousTs,
        `${chain.id} versions must have increasing positive commit_ts`,
      )
      previousTs = version.commitTs
      if (version.state === 'filtered') {
        invariant(
          version.commitTs <= publishedSafePoint,
          `${version.id} was filtered beyond the published safe point`,
        )
      }
      if (version.state === 'retained_anchor') {
        invariant(
          version.writeType === 'put' &&
          version.commitTs <= publishedSafePoint,
          `${version.id} is not a valid retained Put anchor`,
        )
      }
    }
    invariant(
      chain.versions.filter((version) =>
        version.state === 'retained_anchor').length <= 1,
      `${chain.id} has more than one retained anchor`,
    )
  }
}

function validateGcLab(state: TraceGcLabSnapshot): void {
  invariant(
    state.configuration.gcEnabled &&
    state.configuration.runIntervalSeconds === 600 &&
    state.configuration.lifeTimeSeconds === 600 &&
    state.configuration.maxWaitTimeSeconds === 86400 &&
    state.configuration.minStartTsReportIntervalSeconds === 30 &&
    state.configuration.scanLockImplementation === 'REGION_SCAN_LOCK' &&
    !state.configuration.scanLockModeVariableUsed &&
    !state.configuration.physicalScanLockAvailable &&
    state.configuration.distributedGc &&
    state.configuration.compactionFilterEnabled &&
    state.configuration.compactionFilterRatioThreshold === 1.1 &&
    state.configuration.raftstoreMode === 'v1_classic',
    'v8.5.0 configuration profile changed',
  )
  invariant(
    state.safePoint.staged >= state.safePoint.previous &&
    state.safePoint.visibilitySaved >= state.safePoint.previous &&
    state.safePoint.published >= state.safePoint.previous &&
    state.safePoint.visibilitySaved >= state.safePoint.published,
    'safe-point stores must be monotonic and visibility must not trail publication',
  )
  if (state.safePoint.candidate !== null) {
    invariant(
      state.safePoint.candidate >= state.safePoint.previous,
      'candidate safe point moved backwards',
    )
  }
  if (state.safePoint.blocked) {
    invariant(
      state.safePoint.globalMinStartTs === state.blocker.startTs &&
      state.safePoint.activeTransactionBound === state.blocker.startTs - 1 &&
      state.safePoint.serviceSafePoint === state.blocker.startTs - 1 &&
      state.blocker.status === 'active',
      'blocked safe point does not match start_ts - 1',
    )
  }

  invariant(
    new Set(state.resolveLocks.scannedRegionIds).size ===
      state.resolveLocks.scannedRegionIds.length,
    'Resolve Locks scanned a Region more than once in one round',
  )
  invariant(
    new Set(state.resolveLocks.locks.map((lock) => lock.id)).size ===
      state.resolveLocks.locks.length,
    'lock ids must be unique',
  )
  for (const lock of state.resolveLocks.locks) {
    if (lock.status === 'resolved_commit') {
      invariant(lock.primaryStatus === 'committed', `${lock.id} resolution disagrees`)
    }
    if (lock.status === 'resolved_rollback') {
      invariant(lock.primaryStatus === 'rolled_back', `${lock.id} resolution disagrees`)
    }
  }

  invariant(
    new Set(state.deleteRanges.map((range) => range.id)).size ===
      state.deleteRanges.length,
    'delete-range ids must be unique',
  )
  invariant(
    new Set(state.stores.map((store) => store.storeId)).size ===
      state.stores.length,
    'store ids must be unique',
  )
  for (const store of state.stores) {
    invariant(
      store.detectedSafePoint <= state.safePoint.published,
      `${store.storeId} detected an unpublished safe point`,
    )
    invariant(
      store.filterActive === (store.compaction === 'running'),
      `${store.storeId} filter activity disagrees with compaction state`,
    )
  }
  validateVersionChains(state.keyChains, state.safePoint.published)
  const storage = storageProjection(state.keyChains)
  invariant(
    JSON.stringify(storage) === JSON.stringify(state.storage),
    'storage counters disagree with version states',
  )
  if (state.phase === 'complete') {
    invariant(state.blocker.status === 'completed', 'final blocker is still active')
    invariant(
      state.resolveLocks.locks.every((lock) => lock.status !== 'pending'),
      'final state retains unresolved locks',
    )
    invariant(
      state.deleteRanges.every((range) => range.status === 'deleted'),
      'final state retains a pending delete range',
    )
    invariant(
      state.stores.every((store) => store.compaction === 'complete'),
      'final state retains unfinished compaction',
    )
  }
}

export function createGcLabState(
  definition: GcLabDefinition,
): TraceGcLabSnapshot {
  invariant(
    Number.isSafeInteger(definition.initialSafePoint) &&
    definition.initialSafePoint > 0,
    'initial safe point must be a positive integer',
  )
  invariant(
    Number.isSafeInteger(definition.blockerStartTs) &&
    definition.blockerStartTs > definition.initialSafePoint,
    'blocker start_ts must be newer than the initial safe point',
  )
  invariant(definition.storeIds.length === 3, 'fixture requires three stores')
  const keyChains = definition.keyChains.map(
    (chain): TraceGcKeyChainSnapshot => ({
      id: chain.id,
      regionId: chain.regionId,
      versions: chain.versions.map((version) => ({
        ...version,
        state: 'present',
      })),
    }),
  )
  const state: TraceGcLabSnapshot = {
    phase: 'idle',
    round: 1,
    configuration: {
      gcEnabled: true,
      runIntervalSeconds: 600,
      lifeTimeSeconds: 600,
      maxWaitTimeSeconds: 86400,
      minStartTsReportIntervalSeconds: 30,
      scanLockImplementation: 'REGION_SCAN_LOCK',
      scanLockModeVariableUsed: false,
      physicalScanLockAvailable: false,
      resolveLockRaftDetailModeled: false,
      visibilityCacheBarrierSeconds: 100,
      gcLeaderLeaseStore: 'mysql.tidb',
      distributedGc: true,
      deleteRangeRequest: 'UnsafeDestroyRange',
      deleteRangeBypassesRaft: true,
      compactionFilterEnabled: true,
      compactionFilterRatioThreshold: 1.1,
      raftstoreMode: 'v1_classic',
    },
    safePoint: {
      previous: definition.initialSafePoint,
      candidate: null,
      globalMinStartTs: null,
      activeTransactionBound: null,
      serviceSafePoint: null,
      staged: definition.initialSafePoint,
      visibilitySaved: definition.initialSafePoint,
      published: definition.initialSafePoint,
      blocked: false,
    },
    blocker: {
      transactionId: definition.blockerTransactionId,
      startTs: definition.blockerStartTs,
      status: 'active',
      reportedByTiDB: true,
      withinMaxWaitTime: true,
    },
    resolveLocks: {
      implementation: 'REGION_SCAN_LOCK',
      scannedRegionIds: [],
      locks: definition.locks.map((lock) => ({
        ...lock,
        status: 'pending',
      })),
    },
    deleteRanges: definition.deleteRanges.map((range) => ({
      ...range,
      status: 'pending',
    })),
    stores: definition.storeIds.map((storeId): TraceGcStoreSnapshot => ({
      storeId,
      detectedSafePoint: definition.initialSafePoint,
      compaction: 'idle',
      filterActive: false,
    })),
    keyChains,
    storage: storageProjection(keyChains),
  }
  validateGcLab(state)
  return freezeGcLabSnapshot(state)
}

function replaceStore(
  stores: readonly TraceGcStoreSnapshot[],
  storeId: StoreId,
  update: (store: TraceGcStoreSnapshot) => TraceGcStoreSnapshot,
): readonly TraceGcStoreSnapshot[] {
  let found = false
  const result = stores.map((store) => {
    if (store.storeId !== storeId) return store
    found = true
    return update(store)
  })
  invariant(found, `unknown store ${storeId}`)
  return result
}

export function reduceGcLabState(
  state: TraceGcLabSnapshot,
  delta: GcLabDelta,
): TraceGcLabSnapshot {
  let next: TraceGcLabSnapshot = state

  if (delta.kind === 'gc_phase') {
    invariant(delta.from === state.phase, `phase expected ${state.phase}`)
    invariant(
      delta.round === state.round ||
      (
        state.phase === 'between_rounds' &&
        state.round === 1 &&
        delta.round === 2
      ),
      'round transition is invalid',
    )
    const startsNewRound = delta.round !== state.round
    next = {
      ...state,
      phase: delta.to,
      round: delta.round,
      ...(startsNewRound
        ? {
          safePoint: {
            ...state.safePoint,
            previous: state.safePoint.published,
            candidate: null,
            globalMinStartTs: null,
            activeTransactionBound: null,
            serviceSafePoint: null,
            blocked: false,
          },
          resolveLocks: {
            ...state.resolveLocks,
            scannedRegionIds: [],
          },
          stores: state.stores.map((store) => ({
            ...store,
            compaction: 'idle' as const,
            filterActive: false,
          })),
        }
        : {}),
    }
  } else if (delta.kind === 'gc_safe_point_candidate') {
    invariant(delta.round === state.round, 'candidate round disagrees')
    invariant(delta.previous === state.safePoint.published, 'previous safe point disagrees')
    invariant(delta.candidate > delta.previous, 'candidate must advance')
    next = {
      ...state,
      safePoint: {
        ...state.safePoint,
        previous: delta.previous,
        candidate: delta.candidate,
      },
    }
  } else if (delta.kind === 'gc_safe_point_bound') {
    invariant(delta.round === state.round, 'safe-point bound round disagrees')
    invariant(state.safePoint.candidate !== null, 'candidate is missing')
    invariant(
      delta.serviceSafePoint <= state.safePoint.candidate,
      'service safe point exceeds candidate',
    )
    if (delta.blocked) {
      invariant(delta.globalMinStartTs !== null, 'blocked round lacks min start_ts')
      invariant(
        delta.activeTransactionBound === delta.globalMinStartTs - 1,
        'active transaction bound must be min start_ts - 1',
      )
    } else {
      invariant(
        delta.activeTransactionBound === null &&
        delta.serviceSafePoint === state.safePoint.candidate,
        'unblocked fixture must accept the candidate',
      )
    }
    next = {
      ...state,
      safePoint: {
        ...state.safePoint,
        globalMinStartTs: delta.globalMinStartTs,
        activeTransactionBound: delta.activeTransactionBound,
        serviceSafePoint: delta.serviceSafePoint,
        blocked: delta.blocked,
      },
    }
  } else if (delta.kind === 'gc_blocker_state') {
    invariant(state.blocker.status === delta.from, 'blocker is not active')
    next = {
      ...state,
      blocker: { ...state.blocker, status: delta.to },
      safePoint: {
        ...state.safePoint,
        globalMinStartTs: null,
        activeTransactionBound: null,
        blocked: false,
      },
    }
  } else if (delta.kind === 'gc_resolve_lock_scan') {
    invariant(
      !state.resolveLocks.scannedRegionIds.includes(delta.regionId),
      `Region ${delta.regionId} already scanned`,
    )
    next = {
      ...state,
      resolveLocks: {
        ...state.resolveLocks,
        scannedRegionIds: [
          ...state.resolveLocks.scannedRegionIds,
          delta.regionId,
        ],
      },
    }
  } else if (delta.kind === 'gc_resolve_lock') {
    let found = false
    const locks = state.resolveLocks.locks.map((lock) => {
      if (lock.id !== delta.lockId) return lock
      found = true
      invariant(lock.status === 'pending', `${lock.id} is already resolved`)
      invariant(
        state.resolveLocks.scannedRegionIds.includes(lock.regionId),
        `${lock.id} Region has not been scanned`,
      )
      invariant(
        (delta.action === 'commit' && lock.primaryStatus === 'committed') ||
        (delta.action === 'rollback' && lock.primaryStatus === 'rolled_back'),
        `${lock.id} primary status disagrees`,
      )
      return {
        ...lock,
        status: delta.action === 'commit'
          ? 'resolved_commit' as const
          : 'resolved_rollback' as const,
      }
    })
    invariant(found, `unknown lock ${delta.lockId}`)
    next = {
      ...state,
      resolveLocks: { ...state.resolveLocks, locks },
    }
  } else if (delta.kind === 'gc_delete_range') {
    let found = false
    const deleteRanges = state.deleteRanges.map((range) => {
      if (range.id !== delta.rangeId) return range
      found = true
      if (delta.action === 'mark_eligible') {
        invariant(range.status === 'pending', `${range.id} is not pending`)
        const safePoint = state.safePoint.serviceSafePoint
        invariant(
          safePoint !== null && range.dropTs < safePoint,
          `${range.id} is not older than the safe point`,
        )
        return { ...range, status: 'eligible' as const }
      }
      invariant(range.status === 'eligible', `${range.id} is not eligible`)
      return { ...range, status: 'deleted' as const }
    })
    invariant(found, `unknown delete range ${delta.rangeId}`)
    next = { ...state, deleteRanges }
  } else if (delta.kind === 'gc_safe_point_stage') {
    invariant(
      delta.safePoint === state.safePoint.serviceSafePoint,
      'staged safe point disagrees with service minimum',
    )
    invariant(delta.safePoint >= state.safePoint.staged, 'staged value moved backwards')
    next = {
      ...state,
      safePoint: { ...state.safePoint, staged: delta.safePoint },
    }
  } else if (delta.kind === 'gc_visibility_safe_point_save') {
    invariant(
      delta.safePoint === state.safePoint.serviceSafePoint,
      'visibility safe point disagrees with service minimum',
    )
    invariant(
      delta.safePoint >= state.safePoint.visibilitySaved,
      'visibility safe point moved backwards',
    )
    next = {
      ...state,
      safePoint: { ...state.safePoint, visibilitySaved: delta.safePoint },
    }
  } else if (delta.kind === 'gc_safe_point_publish') {
    invariant(
      delta.safePoint === state.safePoint.visibilitySaved,
      'published visibility-safe-point mismatch',
    )
    invariant(delta.safePoint >= state.safePoint.published, 'publication moved backwards')
    next = {
      ...state,
      safePoint: { ...state.safePoint, published: delta.safePoint },
    }
  } else if (delta.kind === 'gc_store_safe_point') {
    invariant(delta.safePoint === state.safePoint.published, 'store observed unpublished value')
    next = {
      ...state,
      stores: replaceStore(state.stores, delta.storeId, (store) => ({
        ...store,
        detectedSafePoint: delta.safePoint,
        compaction: 'eligible',
        filterActive: false,
      })),
    }
  } else if (delta.kind === 'gc_compaction_state') {
    next = {
      ...state,
      stores: replaceStore(state.stores, delta.storeId, (store) => {
        invariant(store.compaction === delta.from, `${store.storeId} state disagrees`)
        return {
          ...store,
          compaction: delta.to,
          filterActive: delta.to === 'running',
        }
      }),
    }
  } else {
    invariant(delta.safePoint === state.safePoint.published, 'filter safe point mismatch')
    const filteredIds = new Set(delta.filteredVersionIds)
    const anchorIds = new Set(delta.retainedAnchorIds)
    invariant(
      filteredIds.size === delta.filteredVersionIds.length &&
      anchorIds.size === delta.retainedAnchorIds.length,
      'filter ids must be unique',
    )
    invariant(
      [...filteredIds].every((id) => !anchorIds.has(id)),
      'a version cannot be filtered and retained',
    )
    const knownIds = new Set(allVersions(state.keyChains).map((version) => version.id))
    invariant(
      [...filteredIds, ...anchorIds].every((id) => knownIds.has(id)),
      'filter references an unknown version',
    )
    const keyChains = state.keyChains.map((chain) => ({
      ...chain,
      versions: chain.versions.map((version) => {
        if (filteredIds.has(version.id)) {
          invariant(version.state !== 'filtered', `${version.id} was already filtered`)
          invariant(
            version.commitTs <= delta.safePoint,
            `${version.id} exceeds the filter safe point`,
          )
          return { ...version, state: 'filtered' as const }
        }
        if (anchorIds.has(version.id)) {
          invariant(version.writeType === 'put', `${version.id} anchor is not Put`)
          invariant(
            version.commitTs <= delta.safePoint,
            `${version.id} anchor exceeds the filter safe point`,
          )
          return { ...version, state: 'retained_anchor' as const }
        }
        return version.state === 'retained_anchor'
          ? { ...version, state: 'present' as const }
          : version
      }),
    }))
    next = {
      ...state,
      keyChains,
      storage: storageProjection(keyChains),
    }
  }

  if (delta.kind !== 'gc_compaction_filter') {
    next = { ...next, storage: storageProjection(next.keyChains) }
  }
  validateGcLab(next)
  return freezeGcLabSnapshot(next)
}
