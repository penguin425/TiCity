// SPDX-License-Identifier: Apache-2.0

import type { ScenarioId, TraceEvent } from '../model/types'
import type { Locale } from '../ui/catalog'
import type { DiagnoseCursor } from './cursor'

interface DiagnosePageCopy {
  scenario: string
  event: string
  finalState: string
  snapshotSuffix: string
  scenarioStartSuffix: string
  cursorRule: string
  exactCursor: string
  previousCursor: (eventLabel: string) => string
  scenarioStartCursor: string
  names: Record<ScenarioId, string>
}

export const DIAGNOSE_PAGE_COPY: Record<Locale, DiagnosePageCopy> = {
  ja: {
    scenario: '投影するシナリオ後の状態',
    event: '投影するイベント時点',
    finalState: '最終状態',
    snapshotSuffix: '直前の詳細スナップショットを使用',
    scenarioStartSuffix: 'シナリオ開始時点を使用',
    cursorRule: 'スナップショット規則：選択イベントに詳細状態がない場合は直前の詳細スナップショット、なければシナリオ開始時点を表示します。',
    exactCursor: '選択イベント直後の詳細スナップショットを表示しています。',
    previousCursor: (eventLabel) =>
      `選択イベントに詳細状態がないため、直前の「${eventLabel}」直後を表示しています。`,
    scenarioStartCursor: '選択イベント以前に詳細状態がないため、シナリオ開始時点を表示しています。',
    names: {
      'point-read': 'Point Readとルーティング',
      'cross-region-transaction': '複数Regionの悲観トランザクション',
      'optimistic-conflict': '楽観トランザクションの競合',
      'lock-deadlock': '悲観ロック待機とデッドロック',
      'commit-protocols': '1PC／Async Commit／2PC',
      'hotspot-split': 'hotspot、split、rebalance',
      'tikv-failover': 'TiKV障害とleader election',
      'gc-safe-point': '長時間transactionとGC safe point',
      'tiflash-mpp': 'TiFlash learner複製とMPP Exchange',
    },
  },
  en: {
    scenario: 'State after scenario',
    event: 'State at event',
    finalState: 'Final state',
    snapshotSuffix: 'uses nearest earlier detailed snapshot',
    scenarioStartSuffix: 'uses scenario start',
    cursorRule: 'Snapshot rule: when an event has no detailed state, Diagnose shows the nearest earlier detailed snapshot, or scenario start when none exists.',
    exactCursor: 'Showing the detailed snapshot immediately after the selected event.',
    previousCursor: (eventLabel) =>
      `This event has no detailed state; showing the snapshot after “${eventLabel}”.`,
    scenarioStartCursor: 'No earlier detailed state exists; showing scenario start.',
    names: {
      'point-read': 'Point read and routing',
      'cross-region-transaction': 'Cross-Region pessimistic transaction',
      'optimistic-conflict': 'Optimistic transaction conflict',
      'lock-deadlock': 'Pessimistic lock wait and deadlock',
      'commit-protocols': '1PC / Async Commit / 2PC',
      'hotspot-split': 'Hotspot, split, and rebalance',
      'tikv-failover': 'TiKV failure and leader election',
      'gc-safe-point': 'Long transaction and GC safe point',
      'tiflash-mpp': 'TiFlash learner replication and MPP Exchange',
    },
  },
}

const LOCK_EVENT_LABELS_JA: Readonly<Record<string, string>> = {
  'Two clients begin a synthetic Lock Lab': '2つのclientが合成Lock Labを開始',
  'PD allocated Client A start_ts': 'PDがClient Aのstart_tsを採番',
  'PD allocated Client B start_ts': 'PDがClient Bのstart_tsを採番',
  'Client A acquired resource-a': 'Client Aがresource-aを獲得',
  'Client B acquired resource-b': 'Client Bがresource-bを獲得',
  'Client A waits for Client B': 'Client AがClient Bを待機',
  'Client B waits for Client A': 'Client BがClient Aを待機',
  'Locate the cluster-wide detector leader': 'クラスタ全体のdetector leaderを検索',
  'Cluster-wide detector found a cycle': 'クラスタ全体のdetectorがcycleを検出',
  'Select Client B as victim (MODEL POLICY)': 'Client Bをvictimに選択（MODEL POLICY）',
  'Roll back Client B and wake Client A': 'Client BをrollbackしClient Aを起床',
  'Break the wait-for cycle': 'wait-for cycleを解消',
  'Return Error 1213 to Client B': 'Client BへError 1213を返却',
  'Application schedules a fixed retry backoff': 'applicationが固定retry backoffを設定',
  'Wake Client A by TiCity MODEL POLICY': 'TiCity MODEL POLICYでClient Aを起床',
  'Hand Client A to the commit model': 'Client Aをcommit modelへ引き渡し',
  'Client A commit completed': 'Client Aのcommitが完了',
  'Release Client A locks after commit': 'commit後にClient Aのlockを解放',
  'Client B starts a new transaction': 'Client Bが新しいtransactionを開始',
  'Retry acquired resource-a first': 'retryがresource-aを先に獲得',
  'Retry acquired resource-b second': 'retryがresource-bを次に獲得',
  'Hand retry attempt to the commit model': 'retry attemptをcommit modelへ引き渡し',
  'Application retry commit completed': 'application retryのcommitが完了',
  'Release retry locks after commit': 'commit後にretryのlockを解放',
  'Lock Lab completed': 'Lock Labが完了',
}

const PROTOCOL_EVENT_LABELS_JA: Readonly<Record<string, string>> = {
  'Begin the commit-protocol comparison': 'commit protocol比較を開始',
  'Start the 1PC fixture': '1PC代表ケースを開始',
  'PD allocated 1PC start_ts': 'PDが1PCのstart_tsを採番',
  'Choose the TryOnePc candidate': 'TryOnePc候補を選択',
  'Get latest TSO and calculate the 1PC floor':
    '最新TSOから1PCのtimestamp下限を算出',
  'Send Prewrite with TryOnePc': 'TryOnePc付きPrewriteを送信',
  'Region leader proposed the mutation': 'Region Leaderがmutationを提案',
  'Two voters persisted the Raft entry': '2つのvoterがRaft entryを永続化',
  'Region Raft committed the entry': 'Region Raftがentryをcommit',
  'Apply 1PC MVCC records atomically': '1PCのMVCC recordを原子的にapply',
  'Apply tentative value and prewrite lock':
    'tentative valueとPrewrite lockをapply',
  'Apply commit record and remove lock':
    'commit recordをapplyしてlockを削除',
  'TiKV returned one_pc_commit_ts': 'TiKVがone_pc_commit_tsを返却',
  '1PC returned committed': '1PCがclientへcommit完了を返却',
  '1PC fixture complete': '1PC代表ケースが完了',
  'Start the Async Commit fixture': 'Async Commit代表ケースを開始',
  'PD allocated Async Commit start_ts':
    'PDがAsync Commitのstart_tsを採番',
  'Check 1PC and Async Commit candidates':
    '1PCとAsync Commitの適格性を判定',
  'Select Async Commit': 'Async Commitを選択',
  'Get latest TSO and calculate the Async floor':
    '最新TSOからAsync Commitのtimestamp下限を算出',
  'All prewrites established Async Commit':
    '全Prewrite応答からAsync Commitを確定',
  'Async Commit returned committed':
    'Async Commitがclientへcommit完了を返却',
  'Async Commit background cleanup complete':
    'Async Commitの応答後cleanupが完了',
  'Start the regular 2PC fixture': '通常2PC代表ケースを開始',
  'PD allocated regular 2PC start_ts': 'PDが通常2PCのstart_tsを採番',
  'Reject optimization candidates before RPC':
    'RPC前にcommit最適化候補を除外',
  'Select regular 2PC': '通常2PCを選択',
  'All regular 2PC prewrites completed': '通常2PCの全Prewriteが完了',
  'PD allocated regular 2PC commit_ts': 'PDが通常2PCのcommit_tsを採番',
  'Commit the primary Region': 'primary RegionをCommit',
  'Regular 2PC returned after primary commit':
    'primary commit後に通常2PCの結果をclientへ返却',
  'Dispatch secondary Commit in background':
    'secondary Commitを応答後に送信',
  'Regular 2PC background cleanup complete': '通常2PCの応答後cleanupが完了',
  'Commit-protocol comparison complete': 'commit protocol比較が完了',
}

const GC_EVENT_LABELS_JA: Readonly<Record<string, string>> = {
  'TiDB GC leader started round 1': 'TiDB GC leaderがround 1を開始',
  'Lifetime produced a candidate safe point':
    'lifetimeからcandidate safe pointを算出',
  'Global min start_ts capped the candidate':
    'global minStartTSがcandidateを制限',
  'PD service minimum accepted the bound':
    'PD service minimumが制限値を採用',
  'TiDB staged tikv_gc_safe_point':
    'TiDBがtikv_gc_safe_pointをstage',
  'Region ScanLock resolution started':
    'Region ScanLockによるResolve Locksを開始',
  'Region 8 returned an old lock': 'Region 8がold lockを返却',
  'Committed primary resolved lock A':
    'commit済みprimaryに従いlock Aを解決',
  'Region 20 returned an old lock': 'Region 20がold lockを返却',
  'Rolled-back primary resolved lock B':
    'rollback済みprimaryに従いlock Bを解決',
  'Saved safe point became visible to TiDB caches':
    '保存safe pointがTiDB cacheから可視化',
  'Delete Ranges found one eligible DDL range':
    'Delete Rangesが適格なDDL rangeを1件検出',
  'All relevant stores completed the range deletion':
    '関連する全Storeでrange削除が完了',
  'TiDB published the global safe point to PD':
    'TiDBがPDへglobal safe pointを公開',
  'RocksDB bottommost compaction opened GC filters':
    'RocksDB bottommost compactionがGC filterを開始',
  'Compaction Filter removed obsolete MVCC records':
    'Compaction Filterが不要なMVCC recordを削除',
  'All representative store filters completed':
    '全代表Storeのfilterが完了',
  'Round 1 completed behind the blocker':
    'blockerに制限されたround 1が完了',
  'The teaching blocker completed': '教材用blockerが完了',
  'TiDB GC leader started round 2': 'TiDB GC leaderがround 2を開始',
  'Lifetime produced the next candidate':
    'lifetimeから次のcandidateを算出',
  'No active transaction capped the candidate':
    'candidateを制限するactive transactionなし',
  'PD service minimum accepted the candidate':
    'PD service minimumがcandidateを採用',
  'TiDB staged the later tikv_gc_safe_point':
    'TiDBが後続tikv_gc_safe_pointをstage',
  'Region ScanLock resolution started round 2':
    'round 2のRegion ScanLockを開始',
  'Region 8 scan found no old fixture locks':
    'Region 8にold fixture lockなし',
  'Region 20 scan found no old fixture locks':
    'Region 20にold fixture lockなし',
  'The later safe point became cache-visible':
    '後続safe pointがcacheから可視化',
  'Delete Ranges had no pending fixture task':
    'Delete Rangesに未処理fixture taskなし',
  'TiDB published the later global safe point':
    'TiDBが後続global safe pointを公開',
  'GC/Storage Lab completed': 'GC/Storage Labが完了',
}

const TIFLASH_EVENT_LABELS_JA: Readonly<Record<string, string>> = {
  tiflash_mpp_query_received:
    'TiDBがgrouped aggregate queryを受信',
  tiflash_mpp_snapshot_tso:
    'PDがquery snapshot TSOを採番',
  tiflash_safe_ts_read_state_update:
    'Region別safe-ts read stateを観測',
  tiflash_replica_placement_observed:
    'TiDBがTiFlash replicaの配置完了を観測',
  tiflash_mpp_access_path_selected:
    'optimizerがTiFlash MPP access pathを選択',
  tiflash_mpp_fragments_built:
    'TiDBが2つのMPP fragmentを構築',
  tiflash_mpp_regions_scheduled:
    'TiDBがRegionをTiFlash Store別にgroup化',
  tiflash_mpp_tasks_built:
    'TiDBが4つのMPP taskを生成',
  tiflash_mpp_tunnels_registered:
    '6本の一時的MPP tunnelを登録',
  tiflash_mpp_dispatch_batch:
    'TiDBが4つのtaskを並行dispatch',
  tiflash_mpp_tasks_prepared:
    'TiFlashが全taskをprepareして登録',
  tiflash_snapshot_gating_started:
    'scan taskがRegion別snapshot gateを開始',
  tiflash_snapshot_gate_ready_safe_ts:
    'Region 24がself safe-ts経路でgateを通過',
  tiflash_mvcc_lock_checks_complete:
    '全RegionのMVCC lock checkが完了',
  tiflash_dm_snapshot_scans_started:
    '2つのscan taskがDeltaMerge snapshot readerを構築',
  tiflash_regions_post_read_validated:
    'Region epochとrangeをread後に再検証',
  tiflash_partial_hash_aggregate_complete:
    'scan taskがpartial aggregationを完了',
  tiflash_hash_partition_started:
    'scan taskがaggregate blockのHashPartitionを開始',
  tiflash_hash_exchange_received:
    'final taskが全HashPartition blockを受信',
  tiflash_final_hash_aggregate_complete:
    'final taskが2段目のaggregationを完了',
  tiflash_root_passthrough_sent:
    '2本のPassThrough streamが結果blockをTiDBへ送信',
  tiflash_mpp_gather_decoded:
    'TiDB MPPGatherがresult chunkをdecode',
  tiflash_client_columns_sent:
    'TiDBがresult column metadataを送信',
  tiflash_client_rows_streamed:
    'TiDBがaggregate row bucketをstream',
  tiflash_root_streams_eof:
    '両root streamがEOFに到達',
  tiflash_client_query_complete:
    'TiDBがclient responseを完了',
}

function protocolEventNameJa(label: string): string | undefined {
  const exact = PROTOCOL_EVENT_LABELS_JA[label]
  if (exact) return exact
  const dynamicLabels: readonly [
    RegExp,
    (regionId: string) => string,
  ][] = [
    [
      /^Send Async Prewrite to Region (\d+)$/,
      (regionId) => `Region ${regionId}へAsync Prewriteを送信`,
    ],
    [
      /^Region (\d+) returned min_commit_ts$/,
      (regionId) => `Region ${regionId}がmin_commit_tsを返却`,
    ],
    [
      /^Dispatch background Commit to Region (\d+)$/,
      (regionId) => `Region ${regionId}へ応答後Commitを送信`,
    ],
    [
      /^Send regular Prewrite to Region (\d+)$/,
      (regionId) => `Region ${regionId}へ通常Prewriteを送信`,
    ],
    [
      /^Region (\d+) completed regular Prewrite$/,
      (regionId) => `Region ${regionId}の通常Prewriteが完了`,
    ],
  ]
  for (const [pattern, translate] of dynamicLabels) {
    const match = pattern.exec(label)
    if (match?.[1]) return translate(match[1])
  }
  return undefined
}

function gcEventNameJa(label: string): string | undefined {
  const exact = GC_EVENT_LABELS_JA[label]
  if (exact) return exact
  const unsafeDestroyRange = /^(.+) received UnsafeDestroyRange$/.exec(label)
  if (unsafeDestroyRange?.[1]) {
    return `${unsafeDestroyRange[1]}がUnsafeDestroyRangeを受信`
  }
  const safePointDetected = /^(.+) detected the greater safe point$/.exec(label)
  if (safePointDetected?.[1]) {
    return `${safePointDetected[1]}が更新safe pointを検出`
  }
  return undefined
}

function tiflashEventNameJa(event: TraceEvent): string | undefined {
  const exact = TIFLASH_EVENT_LABELS_JA[event.kind]
  if (exact) return exact
  const region = event.regionId
  if (region !== undefined) {
    const names: Readonly<Record<string, string>> = {
      tiflash_raft_leader_commit:
        `Region ${region}がRaft entryをcommit`,
      tiflash_learner_receive:
        `Region ${region} learnerがentryを受信`,
      tiflash_learner_apply_command:
        `Region ${region}がRaft commandをapply`,
      tiflash_dm_committed_flush:
        `Region ${region}がcommit済みrowをDeltaMergeへ書き込み`,
      tiflash_learner_applied_advance:
        `Region ${region} learnerのapplied indexが前進`,
      tiflash_snapshot_safe_ts_check:
        `Region ${region}がstart_tsとself safe-tsを比較`,
      tiflash_read_index_requested:
        `Region ${region}がReadIndexを要求`,
      tiflash_read_index_returned:
        `Region ${region}が必要なReadIndexを受信`,
      tiflash_learner_wait_applied:
        `Region ${region}がlearner applyを待機`,
      tiflash_snapshot_gate_ready_read_index:
        `Region ${region}がReadIndexとapplyでgateを通過`,
    }
    return names[event.kind]
  }
  if (event.kind === 'tiflash_hash_exchange_send') {
    const tunnel = event.label.split(' ')[0]
    return `${tunnel}がaggregate blockを送信`
  }
  return undefined
}

export function diagnoseEventName(locale: Locale, event: TraceEvent): string {
  return locale === 'ja'
    ? LOCK_EVENT_LABELS_JA[event.label] ??
      protocolEventNameJa(event.label) ??
      gcEventNameJa(event.label) ??
      tiflashEventNameJa(event) ??
      event.label
    : event.label
}

export function diagnoseEventOptionLabel(
  locale: Locale,
  event: TraceEvent,
  index: number,
  cursor: DiagnoseCursor,
): string {
  const copy = DIAGNOSE_PAGE_COPY[locale]
  const suffix = cursor.resolution === 'previous'
    ? ` (${copy.snapshotSuffix})`
    : cursor.resolution === 'scenario-start'
      ? ` (${copy.scenarioStartSuffix})`
      : ''
  return `${index + 1}. ${diagnoseEventName(locale, event)}${suffix}`
}

export function diagnoseCursorNote(
  locale: Locale,
  cursor: DiagnoseCursor,
): string {
  const copy = DIAGNOSE_PAGE_COPY[locale]
  if (cursor.resolution === 'previous' && cursor.snapshotEvent) {
    return `${copy.previousCursor(diagnoseEventName(locale, cursor.snapshotEvent))} ${copy.cursorRule}`
  }
  if (cursor.resolution === 'scenario-start') {
    return `${copy.scenarioStartCursor} ${copy.cursorRule}`
  }
  if (cursor.resolution === 'exact') {
    return `${copy.exactCursor} ${copy.cursorRule}`
  }
  return copy.cursorRule
}
