// SPDX-License-Identifier: Apache-2.0

import type { Locale } from './catalog'
import type { TraceSourceGroup } from './trace-inspection'

interface Bilingual { readonly ja: string; readonly en: string }
export interface TraceReferenceSource {
  readonly title: Bilingual
  readonly url: string
}

export interface TraceReferenceGroup {
  readonly title: Bilingual
  readonly scope: Bilingual
  readonly sources: readonly TraceReferenceSource[]
}

const text = (ja: string, en: string): Bilingual => ({ ja, en })
// These immutable primary-source revisions match docs/SOURCE_AUDIT.md. They
// are constants: neither event metadata nor user input can enter a source URL.
const TIDB = 'https://github.com/pingcap/tidb/blob/d13e52ed6e22cc5789bed7c64c861578cd2ed55b/'
const TIKV = 'https://github.com/tikv/tikv/blob/a2c58c94f89cbb410e66d8f85c236308d6fc64f0/'
const CLIENT = 'https://github.com/tikv/client-go/blob/006dfb024c26859f2e3757172296d84ef36ff585/'
const RAFT = 'https://github.com/tikv/raft-rs/blob/a76fb6ef2cbd002ec10d63a2ac68b4a20b20fe3e/'
const FLASH = 'https://github.com/pingcap/tiflash/blob/6e12ba23c70f358f2ffbee837feac24118a3e988/'

export const TRACE_REFERENCE_GROUPS: Readonly<Record<TraceSourceGroup, TraceReferenceGroup>> = {
  overview: {
    title: text('SQL / PD 制御 / TiKV の概要', 'SQL / PD control / TiKV overview'),
    scope: text(
      '通常経路は主要な段階だけを示します。TSO・Region メタデータの制御通信と TiKV のデータ要求を分離し、実 optimizer・ネットワーク・結果行を再現しません。',
      'The overview shows major stages only. TSO and Region metadata control are separate from TiKV data requests; the real optimizer, network, and result rows are not reproduced.',
    ),
    sources: [
      { title: text('client-go: PD の TSO oracle', 'client-go: PD TSO oracle'), url: `${CLIENT}oracle/oracles/pd.go#L246-L272` },
      { title: text('client-go: TiKV snapshot Get', 'client-go: TiKV snapshot Get'), url: `${CLIENT}txnkv/txnsnapshot/snapshot.go#L665-L723` },
    ],
  },
  transaction: {
    title: text('トランザクションと Region Raft', 'Transaction and Region Raft'),
    scope: text(
      '固定キー・Region の commit 正常系をモデル化します。トランザクションの原子性と Region 単位の Raft 複製は別の条件です。全 RPC、再試行、ストレージエンジンの処理は再現しません。',
      'The model follows a commit path for fixed keys and Regions. Transaction atomicity and per-Region Raft replication have separate conditions. It does not reproduce every RPC, retry, or storage-engine operation.',
    ),
    sources: [
      { title: text('client-go: primary / secondary commit', 'client-go: primary / secondary commit'), url: `${CLIENT}txnkv/transaction/2pc.go#L998-L1054` },
      { title: text('TiKV: Prewrite の書き込み処理', 'TiKV: Prewrite write processing'), url: `${TIKV}src/storage/txn/commands/prewrite.rs` },
    ],
  },
  lock: {
    title: text('悲観 lock / deadlock / 再試行', 'Pessimistic lock / deadlock / retry'),
    scope: text(
      '固定トランザクションの wait-for graph と選択した再試行を示します。lock のメモリ保持には設定・容量・term 等の条件があり、通常の永続化への fallback を全てはモデル化しません。',
      'The fixture shows a wait-for graph and selected retries. Keeping locks in memory depends on configuration, capacity, term, and other conditions; not every fallback to normal persistence is modeled.',
    ),
    sources: [
      { title: text('TiKV: deadlock detector', 'TiKV: deadlock detector'), url: `${TIKV}src/server/lock_manager/deadlock.rs#L611-L723` },
      { title: text('TiDB: Repeatable Read の再試行', 'TiDB: Repeatable Read retry'), url: `${TIDB}pkg/sessiontxn/isolation/repeatable_read.go#L242-L258` },
    ],
  },
  raft: {
    title: text('Region Raft / ReadIndex', 'Region Raft / ReadIndex'),
    scope: text(
      '固定 voter 構成で選挙・persistence quorum・apply・ReadIndex を分離します。TiFlash learner は voter quorum に含めません。membership 変更や全 Raft message は対象外です。',
      'A fixed voter configuration separates election, persistence quorum, apply, and ReadIndex. TiFlash learners do not count toward voter quorum. Membership changes and the full Raft message set are outside the model.',
    ),
    sources: [
      { title: text('raft-rs: 選挙と log の投票条件', 'raft-rs: election and log voting conditions'), url: `${RAFT}src/raft.rs#L1472-L1503` },
      { title: text('TiKV: ReadIndex と読み取り条件', 'TiKV: ReadIndex and read conditions'), url: `${TIKV}components/raftstore/src/store/peer.rs#L3528-L3575` },
    ],
  },
  protocol: {
    title: text('1PC / Async Commit / 2PC', '1PC / Async Commit / 2PC'),
    scope: text(
      '固定 fixture で protocol の候補・条件・最終選択を比較します。1PC / Async Commit は最適化で、実装は条件を満たさなければ fallback します。全設定・RPC エラー・fallback の組合せは再現しません。',
      'Fixed fixtures compare protocol candidates, conditions, and final selection. 1PC and Async Commit are optimizations that fall back when implementation conditions are not met. The model does not cover every configuration, RPC error, or fallback combination.',
    ),
    sources: [
      { title: text('client-go: commit protocol の選択と実行', 'client-go: commit protocol selection and execution'), url: `${CLIENT}txnkv/transaction/2pc.go#L1707-L1980` },
      { title: text('TiKV: Prewrite 内の 1PC commit record', 'TiKV: 1PC commit records within Prewrite'), url: `${TIKV}src/storage/txn/commands/prewrite.rs#L949-L988` },
    ],
  },
  gc: {
    title: text('GC safe point / MVCC compaction', 'GC safe point / MVCC compaction'),
    scope: text(
      '完全な論理 MVCC version chain を持つ固定 fixture の GC を示します。compaction filter と GC-key task を分離し、実 SST の配置・pagination・compaction の開始時刻は再現しません。',
      'GC uses fixed fixtures with complete logical MVCC version chains. Compaction filtering and GC-key tasks are separate; actual SST placement, pagination, and compaction scheduling are not reproduced.',
    ),
    sources: [
      { title: text('TiDB: GC worker の処理順', 'TiDB: GC worker sequencing'), url: `${TIDB}pkg/store/gcworker/gc_worker.go#L482-L559` },
      { title: text('TiKV: MVCC compaction filter', 'TiKV: MVCC compaction filter'), url: `${TIKV}src/server/gc_worker/compaction_filter.rs#L457-L530` },
    ],
  },
  tiflash: {
    title: text('TiFlash learner read / MPP', 'TiFlash learner read / MPP'),
    scope: text(
      '固定 learner・task・tunnel の正常系を示します。dispatch 後の Region read gate、lock 解決、読み取り後の検証は別段階です。実行時の task 配置・retry・TiKV fallback は再現しません。',
      'The fixture follows a successful path for fixed learners, tasks, and tunnels. Post-dispatch Region read gates, lock resolution, and post-read validation are separate stages. Runtime task placement, retries, and TiKV fallback are not reproduced.',
    ),
    sources: [
      { title: text('TiDB: MPP fragment と task 構築', 'TiDB: MPP fragment and task construction'), url: `${TIDB}pkg/planner/core/fragment.go#L183-L223` },
      { title: text('TiFlash: Region 別 safe-ts / ReadIndex', 'TiFlash: per-Region safe-ts / ReadIndex'), url: `${FLASH}dbms/src/Storages/KVStore/Read/LearnerReadWorker.cpp#L108-L160` },
    ],
  },
}

export const TRACE_INSPECTION_COPY = {
  ja: {
    title: 'イベント Inspector',
    model: 'MODEL / SIMULATED',
    empty: 'イベントを選ぶと、因果関係と参照実装を確認できます。',
    selected: '選択イベント', parents: '直接の因果親', children: '直接の因果子',
    noParents: '明示された直接の因果親はありません。',
    noChildren: '明示された直接の因果子はありません。',
    causalNote: 'dependsOn に明示された依存だけを表示します。前後に並ぶイベントが因果関係を持つとは限りません。',
    fence: '表示順の fence',
    noFence: '表示順の fence は指定されていません。',
    fenceNote: 'この fence は表示の順序を整えるための指定です。因果親・因果子には含めません。',
    path: 'モデル内の経路',
    critical: 'critical — このモデルの応答までの経路',
    background: 'background — モデルの応答経路の外で進む処理',
    unspecified: 'このイベントには経路の指定がありません。',
    pathNote: '実クラスタで計測した latency や critical path ではありません。',
    sources: 'このモデルの参照実装',
    sourceNote: 'TiDB v8.5.0 とその依存の固定リビジョンを参照します。機構ごとの実装参照であり、合成イベント全ての行単位の対応ではありません。リンクを開くと GitHub に移動します。',
    scope: 'モデルの範囲と省略',
    more: (count: number) => `ほか ${count} 件`,
    select: (id: string) => `イベント ${id} を選択`,
  },
  en: {
    title: 'Event inspector',
    model: 'MODEL / SIMULATED',
    empty: 'Select an event to inspect causality and reference implementations.',
    selected: 'Selected event', parents: 'Direct causal parents', children: 'Direct causal children',
    noParents: 'No direct causal parents are explicitly recorded.',
    noChildren: 'No direct causal children are explicitly recorded.',
    causalNote: 'Only explicit dependsOn dependencies are shown. Adjacent events do not necessarily have a causal relationship.',
    fence: 'Presentation-order fence',
    noFence: 'No presentation-order fence is specified.',
    fenceNote: 'This fence orders the presentation. It is excluded from causal parents and children.',
    path: 'Path within the model',
    critical: 'critical — the response path in this model',
    background: 'background — work outside the modeled response path',
    unspecified: 'No path is specified for this event.',
    pathNote: 'This is not latency or a critical path measured in a real cluster.',
    sources: 'Reference implementations for this model',
    sourceNote: 'References use fixed TiDB v8.5.0 and dependency revisions. They describe mechanisms, not a line-by-line mapping for every synthetic event. Opening a link navigates to GitHub.',
    scope: 'Model scope and omissions',
    more: (count: number) => `${count} more`,
    select: (id: string) => `Select event ${id}`,
  },
} satisfies Record<Locale, unknown>
