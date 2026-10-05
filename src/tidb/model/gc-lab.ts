/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure model-9 GC/Storage Lab state. The reducer pins TiDB/TiKV v8.5.0's
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
      | 'gc_key_cleanup'
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

function timestamp(value: number, description: string): void {
  invariant(Number.isSafeInteger(value) && value > 0, `${description} must be a positive safe integer`)
}

function isRemoved(version: TraceGcVersionSnapshot): boolean {
  return version.state === 'filtered' || version.state === 'gc_deleted'
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  const ids = new Set(actual)
  return ids.size === actual.length && ids.size === expected.length &&
    expected.every((id) => ids.has(id))
}

export interface GcCompactionPlan {
  readonly safePoint: number
  readonly filteredVersionIds: readonly string[]
  readonly retainedAnchorIds: readonly string[]
  readonly eligibleDeleteMarkerIds: readonly string[]
  readonly deletedDefaultCfValueIds: readonly string[]
}

/**
 * One complete logical-chain, bottommost compaction fixture. It mirrors the
 * descending WRITE-CF scan in pinned TiKV compaction_filter.rs:457-530. Physical
 * SST subsets and replica copies are deliberately outside this planner.
 */
export function planGcCompaction(
  keyChains: readonly TraceGcKeyChainSnapshot[],
  safePoint: number,
): GcCompactionPlan {
  timestamp(safePoint, 'compaction safe point')
  validateVersionChains(keyChains, safePoint)
  const filteredVersionIds: string[] = []
  const retainedAnchorIds: string[] = []
  const eligibleDeleteMarkerIds: string[] = []
  const deletedDefaultCfValueIds: string[] = []
  for (const chain of keyChains) {
    let boundarySeen = false
    for (let index = chain.versions.length - 1; index >= 0; index--) {
      const version = chain.versions[index]
      if (isRemoved(version) || version.commitTs > safePoint) continue
      if (boundarySeen || version.writeType === 'rollback' || version.writeType === 'lock') {
        filteredVersionIds.push(version.id)
        if (version.writeType === 'put' && version.valueStorage === 'write_and_default_cf') {
          deletedDefaultCfValueIds.push(version.id)
        }
      } else {
        boundarySeen = true
        if (version.writeType === 'put') retainedAnchorIds.push(version.id)
        else if (chain.versions.slice(0, index).every(isRemoved)) {
          // This examines compaction INPUT. Versions filtered in this pass
          // still overlap the Delete and cannot make it eligible immediately.
          eligibleDeleteMarkerIds.push(version.id)
        }
      }
    }
  }
  return Object.freeze({
    safePoint,
    filteredVersionIds: Object.freeze(filteredVersionIds),
    retainedAnchorIds: Object.freeze(retainedAnchorIds),
    eligibleDeleteMarkerIds: Object.freeze(eligibleDeleteMarkerIds),
    deletedDefaultCfValueIds: Object.freeze(deletedDefaultCfValueIds),
  })
}

function acceptedSafePoint(state: TraceGcLabSnapshot): number {
  const safePoint = state.safePoint.serviceSafePoint
  invariant(safePoint !== null, 'accepted safe point is missing')
  return safePoint
}

function oldLocksResolved(state: TraceGcLabSnapshot): boolean {
  const safePoint = acceptedSafePoint(state)
  return state.resolveLocks.locks.every((lock) =>
    lock.startTs > safePoint || lock.status !== 'pending')
}

function representativeRegionsScanned(state: TraceGcLabSnapshot): boolean {
  const regions = new Set([
    ...state.keyChains.map((chain) => chain.regionId),
    ...state.resolveLocks.locks.map((lock) => lock.regionId),
  ])
  return [...regions].every((regionId) => state.resolveLocks.scannedRegionIds.includes(regionId))
}

function oldRangesDeleted(state: TraceGcLabSnapshot): boolean {
  // Successful fan-out fixture only. Upstream logs per-range RPC failures and
  // may still finish the coordinator job with an individual range pending.
  const safePoint = acceptedSafePoint(state)
  return state.deleteRanges.every((range) => range.dropTs >= safePoint || range.status === 'deleted')
}

const PHASE_SUCCESSORS: Readonly<Record<TraceGcLabSnapshot['phase'], readonly TraceGcLabSnapshot['phase'][]>> = {
  idle: ['preparing'],
  preparing: ['safe_point_bounded'],
  safe_point_bounded: ['resolving_locks'],
  resolving_locks: ['caching_safe_point'],
  caching_safe_point: ['deleting_ranges'],
  deleting_ranges: ['publishing_safe_point'],
  publishing_safe_point: ['tikv_observing'],
  tikv_observing: ['compacting'],
  compacting: ['cleaning_delete_markers', 'between_rounds', 'complete'],
  cleaning_delete_markers: ['between_rounds', 'complete'],
  between_rounds: ['preparing'],
  complete: [],
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
    delta.kind === 'gc_compaction_filter' ||
    delta.kind === 'gc_key_cleanup'
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
    gcKeyCleanup: Object.freeze({
      eligibleVersionIds: Object.freeze([...snapshot.gcKeyCleanup.eligibleVersionIds]),
      scheduledVersionIds: Object.freeze([...snapshot.gcKeyCleanup.scheduledVersionIds]),
      deletedVersionIds: Object.freeze([...snapshot.gcKeyCleanup.deletedVersionIds]),
    }),
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
  const gcDeleted = versions.filter((version) => version.state === 'gc_deleted')
  return {
    representation: 'logical_chains_counted_once',
    compactionLevel: 'bottommost_model_fixture',
    initialVersionCount: versions.length,
    filteredVersionCount: filtered.length,
    gcKeyDeletedVersionCount: gcDeleted.length,
    retainedAnchorCount: versions.filter((version) =>
      version.state === 'retained_anchor').length,
    presentVersionCount: versions.length - filtered.length - gcDeleted.length,
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
    invariant(chain.id.length > 0, 'chain id must not be empty')
    invariant(Number.isSafeInteger(chain.regionId) && chain.regionId >= 0, 'Region id is invalid')
    invariant(!chainIds.has(chain.id), `duplicate chain ${chain.id}`)
    chainIds.add(chain.id)
    invariant(chain.versions.length > 0, `${chain.id} must not be empty`)
    let previousTs = 0
    for (const version of chain.versions) {
      invariant(version.id.length > 0, 'version id must not be empty')
      invariant(!versionIds.has(version.id), `duplicate version ${version.id}`)
      versionIds.add(version.id)
      invariant(
        Number.isSafeInteger(version.commitTs) &&
        version.commitTs > previousTs,
        `${chain.id} versions must have increasing positive WRITE-CF timestamps`,
      )
      previousTs = version.commitTs
      invariant(version.writeType === 'put'
        ? version.valueStorage !== 'write_cf_only'
        : version.valueStorage === 'write_cf_only',
      `${version.id} CF representation disagrees with its Write type`)
      if (version.state === 'filtered' || version.state === 'gc_deleted') {
        invariant(
          version.commitTs <= publishedSafePoint,
          `${version.id} was filtered beyond the published safe point`,
        )
      }
      if (version.state === 'gc_deleted') {
        invariant(version.writeType === 'delete', `${version.id} key GC is not a Delete marker`)
        invariant(chain.versions.filter((older) => older.commitTs < version.commitTs).every(isRemoved),
          `${version.id} was GC-key-deleted while older versions remained`)
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
  invariant(typeof state.compactionFilterApplied === 'boolean', 'compaction input pass marker is missing')
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
  invariant(state.blocker.transactionId.length > 0, 'blocker transaction id must not be empty')
  timestamp(state.blocker.startTs, 'blocker start_ts')
  invariant(
    state.safePoint.staged >= state.safePoint.previous &&
    state.safePoint.visibilitySaved >= state.safePoint.previous &&
    state.safePoint.published >= state.safePoint.previous &&
    state.safePoint.staged >= state.safePoint.visibilitySaved &&
    state.safePoint.visibilitySaved >= state.safePoint.published,
    'safe-point stores must be monotonic and visibility must not trail publication',
  )
  for (const [name, value] of Object.entries(state.safePoint)) {
    if (typeof value === 'number') timestamp(value, `${name} safe point`)
  }
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
      state.safePoint.serviceSafePoint !== null &&
      state.safePoint.serviceSafePoint <= state.blocker.startTs - 1 &&
      state.blocker.status === 'active',
      'blocked safe point does not match start_ts - 1',
    )
  }
  if (state.safePoint.serviceSafePoint !== null) {
    invariant(state.safePoint.candidate !== null &&
      state.safePoint.serviceSafePoint <= state.safePoint.candidate,
    'accepted service safe point exceeds the lifetime candidate')
    if (state.safePoint.activeTransactionBound !== null) {
      invariant(state.safePoint.serviceSafePoint <= state.safePoint.activeTransactionBound,
        'accepted service safe point exceeds the active transaction bound')
    }
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
    invariant(lock.id.length > 0, 'lock id must not be empty')
    timestamp(lock.startTs, `${lock.id} start_ts`)
    invariant(Number.isSafeInteger(lock.regionId) && lock.regionId >= 0, 'lock Region id is invalid')
    if (lock.status === 'resolved_commit') {
      invariant(lock.primaryStatus === 'committed', `${lock.id} resolution disagrees`)
    }
    if (lock.status === 'resolved_rollback') {
      invariant(lock.primaryStatus === 'rolled_back', `${lock.id} resolution disagrees`)
    }
  }
  for (const range of state.deleteRanges) {
    invariant(range.id.length > 0, 'delete-range id must not be empty')
    timestamp(range.dropTs, `${range.id} drop timestamp`)
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
    timestamp(store.detectedSafePoint, `${store.storeId} detected safe point`)
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
  const versions = new Map(allVersions(state.keyChains).map((version) => [version.id, version]))
  invariant(new Set(state.gcKeyCleanup.eligibleVersionIds).size === state.gcKeyCleanup.eligibleVersionIds.length,
    'duplicate eligible GC-key marker')
  invariant(state.compactionFilterApplied || state.gcKeyCleanup.eligibleVersionIds.length === 0,
    'Delete-marker eligibility requires an observed compaction input pass')
  for (const id of [...state.gcKeyCleanup.eligibleVersionIds,
    ...state.gcKeyCleanup.scheduledVersionIds, ...state.gcKeyCleanup.deletedVersionIds]) {
    const version = versions.get(id)
    invariant(version?.writeType === 'delete', `${id} GC-key task is not a known Delete marker`)
  }
  invariant(new Set(state.gcKeyCleanup.scheduledVersionIds).size ===
    state.gcKeyCleanup.scheduledVersionIds.length, 'duplicate scheduled GC-key cleanup')
  invariant(new Set(state.gcKeyCleanup.deletedVersionIds).size ===
    state.gcKeyCleanup.deletedVersionIds.length, 'duplicate completed GC-key cleanup')
  invariant(state.gcKeyCleanup.deletedVersionIds.every((id) =>
    state.gcKeyCleanup.scheduledVersionIds.includes(id)), 'unscheduled GC-key cleanup completed')
  invariant(allVersions(state.keyChains).filter((version) => version.state === 'gc_deleted')
    .every((version) => state.gcKeyCleanup.deletedVersionIds.includes(version.id)),
  'Delete-marker states disagree with completed GC-key cleanup')
  invariant(state.gcKeyCleanup.deletedVersionIds.every((id) => versions.get(id)?.state === 'gc_deleted'),
    'completed GC-key task did not delete its marker')
  const storage = storageProjection(state.keyChains)
  invariant(
    JSON.stringify(storage) === JSON.stringify(state.storage),
    'storage counters disagree with version states',
  )
  if (state.phase === 'complete') {
    invariant(state.blocker.status === 'completed', 'final blocker is still active')
    invariant(
      oldLocksResolved(state),
      'final state retains unresolved locks',
    )
    invariant(
      oldRangesDeleted(state),
      'final state retains a pending delete range',
    )
    invariant(
      state.stores.every((store) => store.compaction === 'complete'),
      'final state retains unfinished compaction',
    )
    invariant(state.gcKeyCleanup.scheduledVersionIds.every((id) =>
      state.gcKeyCleanup.deletedVersionIds.includes(id)), 'final state has a pending scheduled GC-key task')
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
    compactionFilterApplied: false,
    gcKeyCleanup: { eligibleVersionIds: [], scheduledVersionIds: [], deletedVersionIds: [] },
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
    invariant(PHASE_SUCCESSORS[state.phase].includes(delta.to),
      `coordinator cannot skip from ${state.phase} to ${delta.to}`)
    invariant(
      delta.round === state.round ||
      (
        state.phase === 'between_rounds' &&
        state.round === 1 &&
        delta.round === 2
      ),
      'round transition is invalid',
    )
    if (delta.to === 'safe_point_bounded') {
      invariant(acceptedSafePoint(state) > state.safePoint.previous,
        'this successful GC round requires an advancing accepted safe point')
    }
    if (delta.to === 'resolving_locks') {
      invariant(state.safePoint.staged === acceptedSafePoint(state),
        'Resolve Locks requires the accepted mysql.tidb status to be staged')
    }
    if (delta.to === 'caching_safe_point') {
      invariant(representativeRegionsScanned(state) && oldLocksResolved(state),
        'visibility save requires completed representative Region scans and old-lock resolution')
    }
    if (delta.to === 'deleting_ranges') {
      invariant(state.safePoint.visibilitySaved === acceptedSafePoint(state),
        'range deletion requires the saved visibility safe point / fixture cache barrier')
    }
    if (delta.to === 'publishing_safe_point') {
      invariant(oldRangesDeleted(state), 'this successful fixture requires eligible DDL ranges to be deleted')
    }
    if (delta.to === 'tikv_observing') {
      invariant(state.safePoint.published === acceptedSafePoint(state) &&
        state.safePoint.published > state.safePoint.previous,
      'Store observation requires an advancing published safe point')
    }
    if (delta.to === 'compacting') {
      invariant(state.stores.every((store) => store.compaction === 'eligible' &&
        store.detectedSafePoint === state.safePoint.published),
      'the aggregate compaction fixture requires all representative Stores to observe the safe point')
    }
    if (delta.to === 'cleaning_delete_markers' || delta.to === 'between_rounds' || delta.to === 'complete') {
      invariant(state.stores.every((store) => store.compaction === 'complete'),
        'the aggregate completion fixture requires completed representative compactions')
      if (delta.to === 'between_rounds' || delta.to === 'complete') {
        invariant(state.gcKeyCleanup.scheduledVersionIds.every((id) =>
          state.gcKeyCleanup.deletedVersionIds.includes(id)), 'round completion has pending GC-key tasks')
      }
    }
    if (state.phase === 'between_rounds') {
      invariant(delta.round === 2 && state.round === 1, 'the second fixture round must advance the round number')
    }
    if (delta.to === 'between_rounds') invariant(delta.round === 1, 'only round 1 has a between-rounds boundary')
    if (delta.to === 'complete') invariant(delta.round === 2, 'the two-round fixture completes in round 2')
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
          gcKeyCleanup: { ...state.gcKeyCleanup, eligibleVersionIds: [] },
          compactionFilterApplied: false,
        }
        : {}),
    }
  } else if (delta.kind === 'gc_safe_point_candidate') {
    invariant(state.phase === 'preparing' && state.safePoint.candidate === null,
      'candidate belongs to one preparation step per round')
    timestamp(delta.candidate, 'candidate safe point')
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
    invariant(state.phase === 'preparing' && state.safePoint.serviceSafePoint === null,
      'safe-point bounds belong to one preparation step per round')
    invariant(delta.round === state.round, 'safe-point bound round disagrees')
    invariant(state.safePoint.candidate !== null, 'candidate is missing')
    timestamp(delta.serviceSafePoint, 'accepted service safe point')
    invariant(delta.serviceSafePoint > state.safePoint.previous,
      'accepted service safe point does not advance this successful round')
    invariant(
      delta.serviceSafePoint <= state.safePoint.candidate,
      'service safe point exceeds candidate',
    )
    if (delta.globalMinStartTs === null) {
      invariant(delta.activeTransactionBound === null && !delta.blocked,
        'active transaction bound requires reported min start_ts')
    } else {
      timestamp(delta.globalMinStartTs, 'reported min start_ts')
      invariant(delta.activeTransactionBound === delta.globalMinStartTs - 1,
        'active transaction bound must be min start_ts - 1')
      invariant(delta.serviceSafePoint <= delta.activeTransactionBound,
        'service safe point exceeds the active transaction limit')
      invariant(delta.blocked === (delta.activeTransactionBound < state.safePoint.candidate),
        'active-transaction blocked flag disagrees with the candidate')
    }
    if (state.blocker.status === 'active' && state.blocker.startTs - 1 < state.safePoint.candidate) {
      invariant(delta.globalMinStartTs === state.blocker.startTs && delta.blocked,
        'candidate crossed the reported active fixture transaction')
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
    invariant(state.phase === 'between_rounds', 'blocker completion is the explicit between-rounds fixture boundary')
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
    invariant(state.phase === 'resolving_locks', 'Region ScanLock belongs to Resolve Locks')
    invariant(Number.isSafeInteger(delta.regionId) && delta.regionId >= 0, 'scan Region id is invalid')
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
    invariant(state.phase === 'resolving_locks', 'ResolveLock belongs to Resolve Locks')
    let found = false
    const locks = state.resolveLocks.locks.map((lock) => {
      if (lock.id !== delta.lockId) return lock
      found = true
      invariant(lock.status === 'pending', `${lock.id} is already resolved`)
      invariant(lock.startTs <= acceptedSafePoint(state), `${lock.id} is newer than the ScanLock maximum`)
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
    invariant(state.phase === 'deleting_ranges' &&
      state.safePoint.visibilitySaved === acceptedSafePoint(state),
    'DDL range deletion requires saved visibility and its coordinator stage')
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
    invariant(state.phase === 'safe_point_bounded', 'mysql.tidb staging must precede Resolve Locks')
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
    invariant(state.phase === 'caching_safe_point' &&
      representativeRegionsScanned(state) && oldLocksResolved(state),
    'visibility save must follow old-lock resolution')
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
    invariant(state.phase === 'publishing_safe_point' && oldRangesDeleted(state),
      'global publication belongs to the successful post-Delete-Range stage')
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
    invariant(state.phase === 'tikv_observing', 'Store polling belongs to the observing fixture stage')
    invariant(delta.safePoint === state.safePoint.published, 'store observed unpublished value')
    next = {
      ...state,
      stores: replaceStore(state.stores, delta.storeId, (store) => {
        invariant(delta.safePoint > store.detectedSafePoint, 'unchanged Store safe point must not restart compaction')
        invariant(store.compaction === 'idle', 'Store observation must not reset an active compaction')
        return { ...store, detectedSafePoint: delta.safePoint, compaction: 'eligible', filterActive: false }
      }),
    }
  } else if (delta.kind === 'gc_compaction_state') {
    invariant(state.phase === 'compacting', 'Store compaction belongs to the aggregate compaction fixture')
    invariant((delta.from === 'eligible' && delta.to === 'running') ||
      (delta.from === 'running' && delta.to === 'complete'), 'invalid Store compaction transition')
    if (delta.to === 'complete') {
      invariant(state.compactionFilterApplied,
        'complete-chain compaction cannot finish with unprocessed filter decisions: no input pass was recorded')
      const remaining = planGcCompaction(state.keyChains, state.safePoint.published)
      invariant(remaining.filteredVersionIds.length === 0 && remaining.retainedAnchorIds.every((id) =>
        allVersions(state.keyChains).some((version) => version.id === id && version.state === 'retained_anchor')),
      'complete-chain compaction cannot finish with unprocessed filter decisions')
      invariant(state.gcKeyCleanup.eligibleVersionIds.every((id) =>
        state.gcKeyCleanup.scheduledVersionIds.includes(id)),
      'successful scheduler fixture must enqueue eligible GC-key tasks at filter Drop before completion')
    }
    next = {
      ...state,
      stores: replaceStore(state.stores, delta.storeId, (store) => {
        invariant(store.compaction === delta.from, `${store.storeId} state disagrees`)
        invariant(store.detectedSafePoint === state.safePoint.published,
          'Store cannot compact with an unobserved safe point')
        return {
          ...store,
          compaction: delta.to,
          filterActive: delta.to === 'running',
        }
      }),
    }
  } else if (delta.kind === 'gc_key_cleanup') {
    invariant(delta.safePoint === state.safePoint.published, 'key GC safe point mismatch')
    if (delta.action === 'schedule') {
      invariant(state.phase === 'compacting' &&
        state.stores.every((store) => store.compaction === 'running'),
      'key GC must be enqueued at filter Drop before compaction completion')
    } else {
      invariant(state.phase === 'cleaning_delete_markers', 'key GC requires its separate cleanup phase')
      invariant(state.stores.every((store) => store.compaction === 'complete'),
        'this key GC execution fixture requires completed compaction')
    }
    const ids = new Set(delta.versionIds)
    invariant(ids.size > 0, 'a GC-key task must contain at least one eligible Delete marker')
    invariant(ids.size === delta.versionIds.length, 'key GC ids must be unique')
    const knownIds = new Set(allVersions(state.keyChains).map((version) => version.id))
    invariant([...ids].every((id) => knownIds.has(id)), 'key GC references an unknown version')
    for (const chain of state.keyChains) {
      for (const version of chain.versions.filter((version) => ids.has(version.id))) {
        invariant(state.gcKeyCleanup.eligibleVersionIds.includes(version.id),
          `${version.id} was not observed without older versions in a later compaction`)
        invariant(version.writeType === 'delete' && version.state === 'present' &&
          version.commitTs <= delta.safePoint, `${version.id} is not an eligible Delete marker`)
        invariant(chain.versions.filter((older) => older.commitTs < version.commitTs)
          .every((older) => older.state === 'filtered' || older.state === 'gc_deleted'),
        `${version.id} still overlaps older versions`)
        invariant(delta.action === 'schedule' ||
          state.gcKeyCleanup.scheduledVersionIds.includes(version.id),
        `${version.id} cleanup was not scheduled`)
        invariant(delta.action !== 'schedule' ||
          !state.gcKeyCleanup.scheduledVersionIds.includes(version.id),
        `${version.id} cleanup was already scheduled`)
      }
    }
    next = delta.action === 'schedule'
      ? {
        ...state,
        gcKeyCleanup: {
          ...state.gcKeyCleanup,
          scheduledVersionIds: [...state.gcKeyCleanup.scheduledVersionIds, ...ids],
        },
      }
      : {
        ...state,
        gcKeyCleanup: {
          ...state.gcKeyCleanup,
          deletedVersionIds: [...state.gcKeyCleanup.deletedVersionIds, ...ids],
        },
        keyChains: state.keyChains.map((chain) => ({
          ...chain,
          versions: chain.versions.map((version) => ids.has(version.id)
            ? { ...version, state: 'gc_deleted' as const }
            : version),
        })),
      }
  } else {
    invariant(state.phase === 'compacting' &&
      state.stores.every((store) => store.compaction === 'running' &&
        store.detectedSafePoint === delta.safePoint),
    'aggregate filtering requires running compactions at their observed safe point')
    invariant(!state.compactionFilterApplied,
      'compaction input must be filtered exactly once per round; this pass cannot reuse its own removals')
    invariant(delta.safePoint === state.safePoint.published, 'filter safe point mismatch')
    const filteredIds = new Set(delta.filteredVersionIds)
    const anchorIds = new Set(delta.retainedAnchorIds)
    invariant(filteredIds.size === delta.filteredVersionIds.length &&
      anchorIds.size === delta.retainedAnchorIds.length, 'filter ids must be unique')
    invariant([...filteredIds].every((id) => !anchorIds.has(id)), 'a version cannot be filtered and retained')
    const knownIds = new Set(allVersions(state.keyChains).map((version) => version.id))
    invariant([...filteredIds, ...anchorIds].every((id) => knownIds.has(id)),
      'filter references an unknown version')
    const plan = planGcCompaction(state.keyChains, delta.safePoint)
    invariant(sameIds(delta.filteredVersionIds, plan.filteredVersionIds),
      'filter plan must keep the newest eligible Put/Delete and remove exactly the obsolete input records')
    invariant(sameIds(delta.retainedAnchorIds, plan.retainedAnchorIds),
      'anchor plan must match the newest eligible Put kept in WRITE CF; removed versions cannot return')
    const keyChains = state.keyChains.map((chain) => ({
      ...chain,
      versions: chain.versions.map((version) => {
        if (filteredIds.has(version.id)) return { ...version, state: 'filtered' as const }
        if (anchorIds.has(version.id)) return { ...version, state: 'retained_anchor' as const }
        return version.state === 'retained_anchor' ? { ...version, state: 'present' as const } : version
      }),
    }))
    next = {
      ...state,
      keyChains,
      compactionFilterApplied: true,
      gcKeyCleanup: { ...state.gcKeyCleanup, eligibleVersionIds: plan.eligibleDeleteMarkerIds },
      storage: storageProjection(keyChains),
    }
  }

  if (delta.kind !== 'gc_compaction_filter') {
    next = { ...next, storage: storageProjection(next.keyChains) }
  }
  validateGcLab(next)
  return freezeGcLabSnapshot(next)
}
