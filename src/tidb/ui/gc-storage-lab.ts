// SPDX-License-Identifier: Apache-2.0

import type {
  TraceEvent,
  TraceGcDeleteRangeSnapshot,
  TraceGcLabPhase,
  TraceGcLabSnapshot,
  TraceGcLockSnapshot,
  TraceGcStoreSnapshot,
  TraceGcVersionSnapshot,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'

type LockStatus = TraceGcLockSnapshot['status']
type PrimaryStatus = TraceGcLockSnapshot['primaryStatus']
type DeleteRangeStatus = TraceGcDeleteRangeSnapshot['status']
type CompactionStatus = TraceGcStoreSnapshot['compaction']
type VersionState = TraceGcVersionSnapshot['state']
type WriteType = TraceGcVersionSnapshot['writeType']
type ValueStorage = TraceGcVersionSnapshot['valueStorage']

interface GcStorageLabCopy {
  readonly title: string
  readonly model: string
  readonly phase: string
  readonly round: string
  readonly overview: string
  readonly privacy: string
  readonly privacyNote: string
  readonly configuration: string
  readonly enabled: string
  readonly runInterval: string
  readonly lifeTime: string
  readonly maxWaitTime: string
  readonly minStartTsReportInterval: string
  readonly scanLockImplementation: string
  readonly scanLockModeVariableUsed: string
  readonly physicalScanLockAvailable: string
  readonly resolveLockRaftDetailModeled: string
  readonly visibilityCacheBarrier: string
  readonly gcLeaderLeaseStore: string
  readonly distributedGc: string
  readonly deleteRangeRequest: string
  readonly deleteRangeBypassesRaft: string
  readonly compactionFilter: string
  readonly ratioThreshold: string
  readonly raftstoreMode: string
  readonly on: string
  readonly seconds: string
  readonly safePointGate: string
  readonly previous: string
  readonly candidate: string
  readonly globalMinStartTs: string
  readonly activeTransactionBound: string
  readonly serviceSafePoint: string
  readonly staged: string
  readonly visibilitySaved: string
  readonly published: string
  readonly blocked: string
  readonly yes: string
  readonly no: string
  readonly pending: string
  readonly blocker: string
  readonly transactionId: string
  readonly startTs: string
  readonly state: string
  readonly reportedByTiDB: string
  readonly withinMaxWait: string
  readonly blockerNote: string
  readonly resolveLocks: string
  readonly regionScan: string
  readonly scannedRegions: string
  readonly noScannedRegions: string
  readonly lockId: string
  readonly region: string
  readonly primaryOutcome: string
  readonly lockResolution: string
  readonly noLocks: string
  readonly deleteRanges: string
  readonly rangeId: string
  readonly dropTs: string
  readonly rangeState: string
  readonly noDeleteRanges: string
  readonly stores: string
  readonly detectedSafePoint: string
  readonly detectorCurrent: string
  readonly compaction: string
  readonly filterActive: string
  readonly mvccChains: string
  readonly logicalProjection: string
  readonly chainId: string
  readonly versionId: string
  readonly commitTs: string
  readonly writeType: string
  readonly valueStorage: string
  readonly versionState: string
  readonly storageSummary: string
  readonly representation: string
  readonly countedOnce: string
  readonly compactionLevel: string
  readonly bottommostFixture: string
  readonly initialVersions: string
  readonly filteredVersions: string
  readonly retainedAnchors: string
  readonly presentVersions: string
  readonly deletedDefaultValues: string
  readonly compactionRaftEntries: string
  readonly boundary: string
  readonly boundaryNote: string
  readonly phases: Readonly<Record<TraceGcLabPhase, string>>
  readonly blockerStates:
    Readonly<Record<TraceGcLabSnapshot['blocker']['status'], string>>
  readonly lockStatuses: Readonly<Record<LockStatus, string>>
  readonly primaryStatuses: Readonly<Record<PrimaryStatus, string>>
  readonly deleteRangeStatuses:
    Readonly<Record<DeleteRangeStatus, string>>
  readonly compactionStatuses:
    Readonly<Record<CompactionStatus, string>>
  readonly versionStates: Readonly<Record<VersionState, string>>
  readonly writeTypes: Readonly<Record<WriteType, string>>
  readonly valueStorages: Readonly<Record<ValueStorage, string>>
}

const COPY: Readonly<Record<Locale, GcStorageLabCopy>> = {
  ja: {
    title: 'GC / Storage Lab',
    model: 'MODEL / SIMULATED',
    phase: 'フェーズ',
    round: 'GCラウンド',
    overview:
      'safe pointの制限、REGION_SCAN_LOCK Resolve Locks、Delete Range、visibility safe pointの保存とPDへの公開、各TiKVの観測、Compaction Filterを、選択したexact event時点の状態で表示します。',
    privacy: 'プライバシー境界',
    privacyNote:
      '合成IDと集計数だけを表示します。SQL文、literal、実key、encoded key、row値、結果行は保持も投影もしません。',
    configuration: '固定fixture設定（TiDB / TiKV v8.5.0）',
    enabled: 'GC',
    runInterval: 'tidb_gc_run_interval',
    lifeTime: 'tidb_gc_life_time',
    maxWaitTime: 'tidb_gc_max_wait_time',
    minStartTsReportInterval: 'min start_ts report interval',
    scanLockImplementation: 'Resolve Locks実装',
    scanLockModeVariableUsed: 'tidb_gc_scan_lock_modeを使用',
    physicalScanLockAvailable: 'PHYSICAL mode',
    resolveLockRaftDetailModeled: 'ResolveLockのRaft経路を展開',
    visibilityCacheBarrier: 'visibility cache barrier',
    gcLeaderLeaseStore: 'GC leader lease',
    distributedGc: '分散GC',
    deleteRangeRequest: 'Delete Range request',
    deleteRangeBypassesRaft: 'Delete RangeはRaftを迂回',
    compactionFilter: 'Compaction Filter',
    ratioThreshold: 'ratio threshold',
    raftstoreMode: 'Raftstore mode',
    on: 'ON',
    seconds: '秒',
    safePointGate: 'Safe-point gate',
    previous: '前回safe point',
    candidate: '候補',
    globalMinStartTs: 'global min start_ts',
    activeTransactionBound: 'active transaction上限',
    serviceSafePoint: 'service safe point',
    staged: 'staged safe point',
    visibilitySaved: 'visibility safe point保存済み',
    published: 'PDへ公開',
    blocked: 'active transactionで制限',
    yes: 'はい',
    no: 'いいえ',
    pending: '未確定',
    blocker: 'Safe-point blocker',
    transactionId: '合成Transaction ID',
    startTs: 'start_ts',
    state: '状態',
    reportedByTiDB: 'TiDBから報告',
    withinMaxWait: 'max wait以内',
    blockerNote:
      'active transactionは候補を start_ts - 1 に制限します。このfixtureでは24時間のmax wait経過を省略します。',
    resolveLocks: 'Resolve Locks',
    regionScan: 'Region scan mode',
    scannedRegions: '走査済みRegion',
    noScannedRegions: 'まだRegionを走査していません。',
    lockId: '合成Lock ID',
    region: 'Region',
    primaryOutcome: 'Primary状態',
    lockResolution: '解決状態',
    noLocks: '対象lockはありません。',
    deleteRanges: 'Delete Range',
    rangeId: '合成Range ID',
    dropTs: 'drop_ts',
    rangeState: '状態',
    noDeleteRanges: '対象rangeはありません。',
    stores: 'TiKV safe-point detector / Compaction Filter',
    detectedSafePoint: '観測safe point',
    detectorCurrent: '公開値と一致',
    compaction: 'Compaction',
    filterActive: 'Filter稼働中',
    mvccChains: '論理MVCC version chains',
    logicalProjection:
      '各chainは論理的に1回だけ数えます。3 replica分へ乗算していません。',
    chainId: '合成Chain ID',
    versionId: '合成Version ID',
    commitTs: 'commit_ts',
    writeType: 'Write type',
    valueStorage: '概念的CF格納',
    versionState: '状態',
    storageSummary: '論理storage集計',
    representation: '表現',
    countedOnce: 'logical chains / counted once',
    compactionLevel: 'Compaction level',
    bottommostFixture: 'bottommost MODEL fixture',
    initialVersions: '初期version',
    filteredVersions: 'filter済みversion',
    retainedAnchors: '保持anchor',
    presentVersions: '残存version',
    deletedDefaultValues: '削除DEFAULT CF value',
    compactionRaftEntries: 'Compactionが作成したRaft entry',
    boundary: 'Storage境界',
    boundaryNote:
      'MVCC GCと物理compaction、Raft log GCは別の仕組みです。平たいfilter済みmarkerは、このMODELのbottommost Compaction Filterで除去された論理versionを示し、実disk byte量ではありません。',
    phases: {
      idle: '待機',
      preparing: 'safe point候補を計算',
      safe_point_bounded: 'active transactionで上限を決定',
      resolving_locks: 'REGION_SCAN_LOCK Resolve Locks',
      caching_safe_point: 'safe pointをstageしvisibility値を保存',
      deleting_ranges: 'Delete Rangeを処理',
      publishing_safe_point: 'safe pointをPDへ公開',
      tikv_observing: 'TiKVがsafe pointを観測',
      compacting: 'Compaction Filterを実行',
      between_rounds: '次ラウンド待機',
      complete: '完了',
    },
    blockerStates: {
      active: 'active',
      completed: '完了',
    },
    lockStatuses: {
      pending: '未解決',
      resolved_commit: 'commitとして解決',
      resolved_rollback: 'rollbackとして解決',
    },
    primaryStatuses: {
      committed: 'commit済み',
      rolled_back: 'rollback済み',
    },
    deleteRangeStatuses: {
      pending: '待機',
      eligible: 'safe pointより古く削除対象',
      deleted: '削除済み',
    },
    compactionStatuses: {
      idle: '待機',
      eligible: '実行対象',
      running: '実行中',
      complete: '完了',
    },
    versionStates: {
      present: '残存',
      retained_anchor: 'safe point以前の最新Putを保持',
      filtered: 'filter済み',
    },
    writeTypes: {
      put: 'Put',
      delete: 'Delete',
      rollback: 'Rollback',
      lock: 'Lock',
    },
    valueStorages: {
      write_cf_only: 'WRITE CFのみ',
      write_cf_inline: 'WRITE CF inline value',
      write_and_default_cf: 'WRITE + DEFAULT CF',
    },
  },
  en: {
    title: 'GC / Storage Lab',
    model: 'MODEL / SIMULATED',
    phase: 'Phase',
    round: 'GC round',
    overview:
      'Shows the safe-point bound, REGION_SCAN_LOCK Resolve Locks, Delete Range, visibility-safe-point save and PD publication, per-TiKV observation, and Compaction Filter at the selected exact event.',
    privacy: 'Privacy boundary',
    privacyNote:
      'Only aggregate counts and synthetic IDs are shown. SQL text, literals, real or encoded keys, row values, and result rows are neither retained nor projected.',
    configuration: 'Pinned fixture configuration (TiDB / TiKV v8.5.0)',
    enabled: 'GC',
    runInterval: 'tidb_gc_run_interval',
    lifeTime: 'tidb_gc_life_time',
    maxWaitTime: 'tidb_gc_max_wait_time',
    minStartTsReportInterval: 'min start_ts report interval',
    scanLockImplementation: 'Resolve Locks implementation',
    scanLockModeVariableUsed: 'Uses tidb_gc_scan_lock_mode',
    physicalScanLockAvailable: 'PHYSICAL mode',
    resolveLockRaftDetailModeled: 'ResolveLock Raft path expanded',
    visibilityCacheBarrier: 'Visibility cache barrier',
    gcLeaderLeaseStore: 'GC leader lease',
    distributedGc: 'Distributed GC',
    deleteRangeRequest: 'Delete Range request',
    deleteRangeBypassesRaft: 'Delete Range bypasses Raft',
    compactionFilter: 'Compaction Filter',
    ratioThreshold: 'ratio threshold',
    raftstoreMode: 'Raftstore mode',
    on: 'ON',
    seconds: 'seconds',
    safePointGate: 'Safe-point gate',
    previous: 'Previous safe point',
    candidate: 'Candidate',
    globalMinStartTs: 'Global min start_ts',
    activeTransactionBound: 'Active transaction bound',
    serviceSafePoint: 'Service safe point',
    staged: 'Staged safe point',
    visibilitySaved: 'Visibility safe point saved',
    published: 'Published to PD',
    blocked: 'Bounded by active transaction',
    yes: 'Yes',
    no: 'No',
    pending: 'Pending',
    blocker: 'Safe-point blocker',
    transactionId: 'Synthetic transaction ID',
    startTs: 'start_ts',
    state: 'State',
    reportedByTiDB: 'Reported by TiDB',
    withinMaxWait: 'Within max wait',
    blockerNote:
      'An active transaction bounds the candidate at start_ts - 1. This fixture does not fast-forward through the 24-hour max wait.',
    resolveLocks: 'Resolve Locks',
    regionScan: 'Region scan mode',
    scannedRegions: 'Scanned Regions',
    noScannedRegions: 'No Region has been scanned yet.',
    lockId: 'Synthetic lock ID',
    region: 'Region',
    primaryOutcome: 'Primary status',
    lockResolution: 'Resolution',
    noLocks: 'No locks are in this fixture.',
    deleteRanges: 'Delete Range',
    rangeId: 'Synthetic range ID',
    dropTs: 'drop_ts',
    rangeState: 'State',
    noDeleteRanges: 'No ranges are in this fixture.',
    stores: 'TiKV safe-point detectors / Compaction Filters',
    detectedSafePoint: 'Detected safe point',
    detectorCurrent: 'Matches published value',
    compaction: 'Compaction',
    filterActive: 'Filter active',
    mvccChains: 'Logical MVCC version chains',
    logicalProjection:
      'Each chain is counted once logically; it is not multiplied by three replicas.',
    chainId: 'Synthetic chain ID',
    versionId: 'Synthetic version ID',
    commitTs: 'commit_ts',
    writeType: 'Write type',
    valueStorage: 'Conceptual CF storage',
    versionState: 'State',
    storageSummary: 'Logical storage summary',
    representation: 'Representation',
    countedOnce: 'logical chains / counted once',
    compactionLevel: 'Compaction level',
    bottommostFixture: 'bottommost MODEL fixture',
    initialVersions: 'Initial versions',
    filteredVersions: 'Filtered versions',
    retainedAnchors: 'Retained anchors',
    presentVersions: 'Present versions',
    deletedDefaultValues: 'Deleted DEFAULT CF values',
    compactionRaftEntries: 'Raft entries created by compaction',
    boundary: 'Storage boundary',
    boundaryNote:
      'MVCC GC, physical compaction, and Raft log GC are distinct mechanisms. A flat filtered marker means this MODEL removed a logical version through its bottommost Compaction Filter; it is not a disk-byte gauge.',
    phases: {
      idle: 'Idle',
      preparing: 'Computing a safe-point candidate',
      safe_point_bounded: 'Applying the active-transaction bound',
      resolving_locks: 'Running REGION_SCAN_LOCK Resolve Locks',
      caching_safe_point: 'Staging and saving the visibility safe point',
      deleting_ranges: 'Processing Delete Range',
      publishing_safe_point: 'Publishing the safe point to PD',
      tikv_observing: 'TiKV stores observing the safe point',
      compacting: 'Running Compaction Filters',
      between_rounds: 'Waiting for the next round',
      complete: 'Complete',
    },
    blockerStates: {
      active: 'Active',
      completed: 'Completed',
    },
    lockStatuses: {
      pending: 'Pending',
      resolved_commit: 'Resolved as commit',
      resolved_rollback: 'Resolved as rollback',
    },
    primaryStatuses: {
      committed: 'Committed',
      rolled_back: 'Rolled back',
    },
    deleteRangeStatuses: {
      pending: 'Pending',
      eligible: 'Older than safe point / eligible',
      deleted: 'Deleted',
    },
    compactionStatuses: {
      idle: 'Idle',
      eligible: 'Eligible',
      running: 'Running',
      complete: 'Complete',
    },
    versionStates: {
      present: 'Present',
      retained_anchor: 'Newest Put at or before safe point retained',
      filtered: 'Filtered',
    },
    writeTypes: {
      put: 'Put',
      delete: 'Delete',
      rollback: 'Rollback',
      lock: 'Lock',
    },
    valueStorages: {
      write_cf_only: 'WRITE CF only',
      write_cf_inline: 'WRITE CF inline value',
      write_and_default_cf: 'WRITE + DEFAULT CF',
    },
  },
}

export interface GcStorageLabPanel {
  readonly root: HTMLElement
  update(event: TraceEvent | null, activeEvents?: readonly TraceEvent[]): void
  setLocale(locale: Locale): void
  dispose(): void
}

function metric(label: string, value: string): HTMLElement {
  return element(
    'div',
    { className: 'tidb-gc-storage-lab__metric' },
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function maybeTimestamp(value: number | null, copy: GcStorageLabCopy): string {
  return value === null ? copy.pending : String(value)
}

function booleanValue(value: boolean, copy: GcStorageLabCopy): string {
  return value ? copy.yes : copy.no
}

function configurationSection(
  snapshot: TraceGcLabSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  const config = snapshot.configuration
  return element(
    'section',
    { className: 'tidb-gc-storage-lab__configuration' },
    element('h3', { text: copy.configuration }),
    element(
      'dl',
      { className: 'tidb-gc-storage-lab__facts' },
      metric(copy.enabled, config.gcEnabled ? copy.on : copy.no),
      metric(copy.runInterval, `${config.runIntervalSeconds} ${copy.seconds}`),
      metric(copy.lifeTime, `${config.lifeTimeSeconds} ${copy.seconds}`),
      metric(copy.maxWaitTime, `${config.maxWaitTimeSeconds} ${copy.seconds}`),
      metric(
        copy.minStartTsReportInterval,
        `${config.minStartTsReportIntervalSeconds} ${copy.seconds}`,
      ),
      metric(copy.scanLockImplementation, config.scanLockImplementation),
      metric(
        copy.scanLockModeVariableUsed,
        booleanValue(config.scanLockModeVariableUsed, copy),
      ),
      metric(
        copy.physicalScanLockAvailable,
        booleanValue(config.physicalScanLockAvailable, copy),
      ),
      metric(
        copy.resolveLockRaftDetailModeled,
        booleanValue(config.resolveLockRaftDetailModeled, copy),
      ),
      metric(
        copy.visibilityCacheBarrier,
        `${config.visibilityCacheBarrierSeconds} ${copy.seconds}`,
      ),
      metric(copy.gcLeaderLeaseStore, config.gcLeaderLeaseStore),
      metric(copy.distributedGc, booleanValue(config.distributedGc, copy)),
      metric(copy.deleteRangeRequest, config.deleteRangeRequest),
      metric(
        copy.deleteRangeBypassesRaft,
        booleanValue(config.deleteRangeBypassesRaft, copy),
      ),
      metric(
        copy.compactionFilter,
        booleanValue(config.compactionFilterEnabled, copy),
      ),
      metric(
        copy.ratioThreshold,
        String(config.compactionFilterRatioThreshold),
      ),
      metric(copy.raftstoreMode, config.raftstoreMode),
    ),
  )
}

function safePointSection(
  snapshot: TraceGcLabSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  const safePoint = snapshot.safePoint
  const blocker = snapshot.blocker
  return element(
    'section',
    {
      className: 'tidb-gc-storage-lab__safe-point',
      attrs: {
        'data-safe-point-blocked': String(safePoint.blocked),
        'data-safe-point-published': String(safePoint.published),
      },
    },
    element('h3', { text: copy.safePointGate }),
    element(
      'dl',
      { className: 'tidb-gc-storage-lab__facts' },
      metric(copy.previous, String(safePoint.previous)),
      metric(copy.candidate, maybeTimestamp(safePoint.candidate, copy)),
      metric(
        copy.globalMinStartTs,
        maybeTimestamp(safePoint.globalMinStartTs, copy),
      ),
      metric(
        copy.activeTransactionBound,
        maybeTimestamp(safePoint.activeTransactionBound, copy),
      ),
      metric(
        copy.serviceSafePoint,
        maybeTimestamp(safePoint.serviceSafePoint, copy),
      ),
      metric(copy.staged, String(safePoint.staged)),
      metric(copy.visibilitySaved, String(safePoint.visibilitySaved)),
      metric(copy.published, String(safePoint.published)),
      metric(copy.blocked, booleanValue(safePoint.blocked, copy)),
    ),
    element(
      'article',
      {
        className: 'tidb-gc-storage-lab__blocker',
        attrs: {
          'data-gc-blocker-transaction-id': blocker.transactionId,
          'data-gc-blocker-state': blocker.status,
        },
      },
      element('h4', { text: copy.blocker }),
      element(
        'dl',
        { className: 'tidb-gc-storage-lab__facts' },
        metric(copy.transactionId, blocker.transactionId),
        metric(copy.startTs, String(blocker.startTs)),
        metric(copy.state, copy.blockerStates[blocker.status]),
        metric(
          copy.reportedByTiDB,
          booleanValue(blocker.reportedByTiDB, copy),
        ),
        metric(
          copy.withinMaxWait,
          booleanValue(blocker.withinMaxWaitTime, copy),
        ),
      ),
      element('p', {
        className: 'tidb-gc-storage-lab__boundary-note',
        text: copy.blockerNote,
      }),
    ),
  )
}

function resolveLocksSection(
  snapshot: TraceGcLabSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  const resolveLocks = snapshot.resolveLocks
  return element(
    'section',
    {
      className: 'tidb-gc-storage-lab__resolve-locks',
      attrs: {
        'data-scan-lock-implementation': resolveLocks.implementation,
      },
    },
    element('h3', { text: copy.resolveLocks }),
    element(
      'dl',
      { className: 'tidb-gc-storage-lab__facts' },
      metric(copy.regionScan, resolveLocks.implementation),
      metric(
        copy.scannedRegions,
        resolveLocks.scannedRegionIds.length > 0
          ? resolveLocks.scannedRegionIds.map((id) => `Region ${id}`).join(' · ')
          : copy.noScannedRegions,
      ),
    ),
    resolveLocks.locks.length > 0
      ? element(
        'div',
        {
          className: 'tidb-gc-storage-lab__lock-list',
          attrs: { role: 'list' },
        },
        ...resolveLocks.locks.map((lock) => {
          const card = element(
            'article',
            {
              className: 'tidb-gc-storage-lab__lock',
              attrs: {
                'data-gc-lock-id': lock.id,
                'data-gc-lock-state': lock.status,
                'data-region-id': String(lock.regionId),
              },
            },
            element('h4', { text: lock.id }),
            element(
              'dl',
              { className: 'tidb-gc-storage-lab__facts' },
              metric(copy.lockId, lock.id),
              metric(copy.region, `Region ${lock.regionId}`),
              metric(copy.startTs, String(lock.startTs)),
              metric(
                copy.primaryOutcome,
                copy.primaryStatuses[lock.primaryStatus],
              ),
              metric(copy.lockResolution, copy.lockStatuses[lock.status]),
            ),
          )
          card.setAttribute('role', 'listitem')
          return card
        }),
      )
      : element('p', {
        className: 'tidb-gc-storage-lab__empty',
        text: copy.noLocks,
      }),
  )
}

function deleteRangesSection(
  snapshot: TraceGcLabSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  return element(
    'section',
    { className: 'tidb-gc-storage-lab__delete-ranges' },
    element('h3', { text: copy.deleteRanges }),
    snapshot.deleteRanges.length > 0
      ? element(
        'div',
        {
          className: 'tidb-gc-storage-lab__delete-range-list',
          attrs: { role: 'list' },
        },
        ...snapshot.deleteRanges.map((range) => {
          const card = element(
            'article',
            {
              className: 'tidb-gc-storage-lab__delete-range',
              attrs: {
                'data-delete-range-id': range.id,
                'data-delete-range-state': range.status,
              },
            },
            element('h4', { text: range.id }),
            element(
              'dl',
              { className: 'tidb-gc-storage-lab__facts' },
              metric(copy.rangeId, range.id),
              metric(copy.dropTs, String(range.dropTs)),
              metric(
                copy.rangeState,
                copy.deleteRangeStatuses[range.status],
              ),
            ),
          )
          card.setAttribute('role', 'listitem')
          return card
        }),
      )
      : element('p', {
        className: 'tidb-gc-storage-lab__empty',
        text: copy.noDeleteRanges,
      }),
  )
}

function storesSection(
  snapshot: TraceGcLabSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  return element(
    'section',
    { className: 'tidb-gc-storage-lab__stores' },
    element('h3', { text: copy.stores }),
    element(
      'div',
      {
        className: 'tidb-gc-storage-lab__store-list',
        attrs: { role: 'list' },
      },
      ...snapshot.stores.map((store) => {
        const detectorCurrent =
          store.detectedSafePoint === snapshot.safePoint.published
        const card = element(
          'article',
          {
            className: 'tidb-gc-storage-lab__store',
            attrs: {
              'data-gc-store-id': store.storeId,
              'data-compaction-state': store.compaction,
              'data-filter-active': String(store.filterActive),
            },
          },
          element('h4', { text: store.storeId }),
          element(
            'dl',
            { className: 'tidb-gc-storage-lab__facts' },
            metric(
              copy.detectedSafePoint,
              String(store.detectedSafePoint),
            ),
            metric(
              copy.detectorCurrent,
              booleanValue(detectorCurrent, copy),
            ),
            metric(
              copy.compaction,
              copy.compactionStatuses[store.compaction],
            ),
            metric(
              copy.filterActive,
              booleanValue(store.filterActive, copy),
            ),
          ),
        )
        card.setAttribute('role', 'listitem')
        return card
      }),
    ),
  )
}

function versionItem(
  version: TraceGcVersionSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  return element(
    'li',
    {
      className: 'tidb-gc-storage-lab__version',
      attrs: {
        'data-gc-version-id': version.id,
        'data-gc-version-state': version.state,
        'data-write-type': version.writeType,
      },
    },
    element('h5', { text: version.id }),
    element(
      'dl',
      { className: 'tidb-gc-storage-lab__facts' },
      metric(copy.versionId, version.id),
      metric(copy.commitTs, String(version.commitTs)),
      metric(copy.writeType, copy.writeTypes[version.writeType]),
      metric(
        copy.valueStorage,
        copy.valueStorages[version.valueStorage],
      ),
      metric(copy.versionState, copy.versionStates[version.state]),
    ),
  )
}

function mvccSection(
  snapshot: TraceGcLabSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  return element(
    'section',
    { className: 'tidb-gc-storage-lab__mvcc' },
    element('h3', { text: copy.mvccChains }),
    element('p', {
      className: 'tidb-gc-storage-lab__boundary-note',
      text: copy.logicalProjection,
    }),
    element(
      'div',
      {
        className: 'tidb-gc-storage-lab__chain-list',
        attrs: { role: 'list' },
      },
      ...snapshot.keyChains.map((chain) => {
        const card = element(
          'article',
          {
            className: 'tidb-gc-storage-lab__chain',
            attrs: {
              'data-gc-chain-id': chain.id,
              'data-region-id': String(chain.regionId),
            },
          },
          element('h4', { text: chain.id }),
          element(
            'dl',
            { className: 'tidb-gc-storage-lab__facts' },
            metric(copy.chainId, chain.id),
            metric(copy.region, `Region ${chain.regionId}`),
          ),
          element(
            'ol',
            {
              className: 'tidb-gc-storage-lab__version-list',
              attrs: {
                'aria-label': `${copy.mvccChains}: ${chain.id}`,
              },
            },
            ...chain.versions.map((version) => versionItem(version, copy)),
          ),
        )
        card.setAttribute('role', 'listitem')
        return card
      }),
    ),
  )
}

function storageSummarySection(
  snapshot: TraceGcLabSnapshot,
  copy: GcStorageLabCopy,
): HTMLElement {
  const storage = snapshot.storage
  return element(
    'section',
    { className: 'tidb-gc-storage-lab__storage-summary' },
    element('h3', { text: copy.storageSummary }),
    element(
      'dl',
      { className: 'tidb-gc-storage-lab__facts' },
      metric(copy.representation, copy.countedOnce),
      metric(copy.compactionLevel, copy.bottommostFixture),
      metric(copy.initialVersions, String(storage.initialVersionCount)),
      metric(copy.filteredVersions, String(storage.filteredVersionCount)),
      metric(copy.retainedAnchors, String(storage.retainedAnchorCount)),
      metric(copy.presentVersions, String(storage.presentVersionCount)),
      metric(
        copy.deletedDefaultValues,
        String(storage.deletedDefaultCfValues),
      ),
      metric(
        copy.compactionRaftEntries,
        String(storage.compactionRaftEntriesCreated),
      ),
    ),
    element('h4', { text: copy.boundary }),
    element('p', {
      className: 'tidb-gc-storage-lab__boundary-note',
      text: copy.boundaryNote,
    }),
  )
}

export function createGcStorageLabPanel(
  initialLocale: Locale,
): GcStorageLabPanel {
  const root = element('section', {
    className: 'tidb-gc-storage-lab',
    attrs: {
      'data-gc-storage-lab': '',
      tabindex: '0',
    },
  })
  root.hidden = true

  let locale = initialLocale
  let currentSnapshot: TraceGcLabSnapshot | undefined
  let renderedSnapshot: TraceGcLabSnapshot | undefined
  let renderedLocale: Locale | null = null
  let disposed = false

  const render = (): void => {
    if (disposed) return
    if (
      currentSnapshot === renderedSnapshot &&
      locale === renderedLocale
    ) {
      return
    }
    renderedSnapshot = currentSnapshot
    renderedLocale = locale

    root.hidden = currentSnapshot === undefined
    if (!currentSnapshot) {
      root.replaceChildren()
      root.removeAttribute('aria-label')
      return
    }

    const snapshot = currentSnapshot
    const copy = COPY[locale]
    root.setAttribute('aria-label', copy.title)
    root.replaceChildren(
      element(
        'header',
        { className: 'tidb-gc-storage-lab__head' },
        element(
          'div',
          {},
          element('p', {
            className: 'tidb-gc-storage-lab__eyebrow',
            text: copy.model,
          }),
          element('h2', { text: copy.title }),
          element('p', {
            className: 'tidb-gc-storage-lab__overview',
            text: copy.overview,
          }),
        ),
        element(
          'div',
          { className: 'tidb-gc-storage-lab__status' },
          element('p', {
            text: `${copy.round}: ${snapshot.round}`,
            attrs: {
              'data-gc-round': String(snapshot.round),
            },
          }),
          element('p', {
            text: `${copy.phase}: ${copy.phases[snapshot.phase]}`,
            attrs: {
              role: 'status',
              'aria-live': 'polite',
              'aria-atomic': 'true',
              'data-gc-phase': snapshot.phase,
            },
          }),
        ),
      ),
      element(
        'section',
        { className: 'tidb-gc-storage-lab__privacy' },
        element('h3', { text: copy.privacy }),
        element('p', {
          className: 'tidb-gc-storage-lab__boundary-note',
          text: copy.privacyNote,
        }),
      ),
      configurationSection(snapshot, copy),
      safePointSection(snapshot, copy),
      resolveLocksSection(snapshot, copy),
      deleteRangesSection(snapshot, copy),
      storesSection(snapshot, copy),
      mvccSection(snapshot, copy),
      storageSummarySection(snapshot, copy),
    )
  }

  return {
    root,
    update(event): void {
      /*
       * Deliberately retain only the synthetic GC snapshot. Event labels,
       * details, metadata, SQL, and active-event payloads never enter this UI.
       */
      currentSnapshot = event?.snapshot?.gcLab
      render()
    },
    setLocale(next): void {
      if (locale === next) return
      locale = next
      renderedLocale = null
      render()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      root.remove()
      currentSnapshot = undefined
      renderedSnapshot = undefined
    },
  }
}
