/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type {
  TraceDomain,
  TraceMetadataValue,
  TraceStateDelta,
} from '../model/types'
import type { Locale } from './catalog'

/**
 * Renderer-facing event input.  In particular, this deliberately does not
 * require the model's English `label` or `detail`: visible copy is selected
 * from the stable event kind and its typed metadata/deltas instead.
 */
export interface TraceEventCopyInput {
  readonly id?: string
  readonly domain?: TraceDomain | string
  readonly kind?: string
  readonly source?: string
  readonly target?: string
  readonly regionId?: number
  readonly transactionId?: string
  readonly metadata?: Readonly<Record<string, TraceMetadataValue>>
  readonly deltas?: readonly TraceStateDelta[]
}

export interface TraceEventCopy {
  /** Localized event title suitable for visible text, title, and ARIA. */
  readonly label: string
  /** Localized explanatory sentence suitable for a detail panel or ARIA. */
  readonly detail: string
  /** Localized stable event-kind name for metadata tables. */
  readonly kind: string
}

interface LocalizedText {
  readonly ja: string
  readonly en: string
}

interface EventTemplate {
  readonly label: LocalizedText
  readonly detail: LocalizedText
  readonly kind?: LocalizedText
}

const localized = (ja: string, en: string): LocalizedText => ({ ja, en })

const event = (
  jaLabel: string,
  enLabel: string,
  jaDetail: string,
  enDetail: string,
  jaKind = jaLabel,
  enKind = enLabel,
): EventTemplate => ({
  label: localized(jaLabel, enLabel),
  detail: localized(jaDetail, enDetail),
  kind: localized(jaKind, enKind),
})

/*
 * These are presentation strings, not model strings.  Keeping the catalog
 * keyed by canonical kind means a receipt can remain byte-for-byte stable
 * while Japanese UI copy changes independently.  Values such as timestamps,
 * transaction IDs, and Region numbers are appended only from typed fields.
 */
const EVENT_CATALOG: Readonly<Record<string, EventTemplate>> = {
  submit: event(
    'クライアントがSQLリクエストを送信',
    'Client submitted SQL',
    'SQL本文はブラウザ内に留まり、モデルには分類だけが渡されます。',
    'The SQL text stays in this browser; the model retains only its classification.',
    'リクエスト送信',
    'Request submission',
  ),
  route: event(
    'TiProxyがセッションをルーティング',
    'TiProxy routed the session',
    'TiProxyはステートレスなTiDBノードを選択します。',
    'TiProxy selects a stateless TiDB node.',
    'セッションのルーティング',
    'Session routing',
  ),
  parse_optimize: event(
    'SQLを解析・最適化',
    'Parse and optimize',
    '入力は実行せず、分類されたモデル経路だけを組み立てます。',
    'The input is not executed; only the classified model route is built.',
  ),
  snapshot_ts: event(
    'PDがスナップショットTSOを割り当て',
    'PD allocated a snapshot timestamp',
    '読み取りに使うstart_tsをPDが割り当てます。',
    'PD allocates the start_ts used by the read.',
  ),
  timestamp: event(
    'タイムスタンプを処理',
    'Process timestamp',
    'モデル化された論理タイムスタンプを処理します。',
    'The modeled logical timestamp is processed.',
    'タイムスタンプ処理',
    'Timestamp processing',
  ),
  start_ts: event(
    'PDがstart_tsを割り当て',
    'PD allocated start_ts',
    'トランザクションの論理的な開始時刻を割り当てます。',
    'A logical start timestamp is allocated for the transaction.',
  ),
  commit_ts: event(
    'PDがcommit_tsを割り当て',
    'PD allocated commit_ts',
    '必要なprewriteの後に、論理的なcommit timestampを割り当てます。',
    'A logical commit timestamp is allocated after the required prewrites.',
  ),
  locate_regions: event(
    '対象Regionを特定',
    'Locate Regions',
    'テーブルのキー範囲を代表Regionへ対応付けます。',
    'The table key range is mapped to representative Regions.',
  ),
  locate_region: event(
    'Regionルートを特定',
    'Locate Region',
    'TiDBは対象Regionのルーティング情報を確認します。',
    'TiDB checks the routing information for the target Region.',
  ),
  point_get: event(
    'TiKV Point Getを実行',
    'TiKV Point Get',
    'TiKVがモデル化されたスナップショットをPoint Getで読み取ります。',
    'TiKV reads the modeled snapshot with a Point Get.',
  ),
  coprocessor_scan: event(
    'TiKV Coprocessor scan',
    'TiKV Coprocessor scan',
    'TiKVのCoprocessorが代表Regionのスナップショットを走査します。',
    'TiKV Coprocessor scans the snapshot in a representative Region.',
  ),
  complete: event(
    'モデル経路を完了',
    'Modeled route complete',
    '結果行は生成せず、アーキテクチャと状態遷移だけを記録します。',
    'No result rows are generated; only architecture and state transitions are recorded.',
    '完了',
    'Completion',
  ),
  error: event(
    'モデルリクエストが失敗',
    'Modeled request failed',
    'データベース出力を作らず、モデル上のエラー状態を返します。',
    'The model returns an error condition without inventing database output.',
    '失敗',
    'Failure',
  ),
  protocol_selection: event(
    'commit protocolを選択',
    'Select commit protocol',
    'モデルの適格性ルールに従ってcommit protocolを選択します。',
    'The modeled eligibility rules select a commit protocol.',
    'commit protocolの選択',
    'Commit-protocol selection',
  ),
  pessimistic_lock: event(
    'Leaderローカルの悲観ロックを取得',
    'Acquire leader-local pessimistic lock',
    '悲観ロックはLeaderのメモリに保持され、Raftでは複製されません。',
    'The pessimistic lock stays in leader memory and is not replicated by Raft.',
  ),
  commit_requested: event(
    '2PC coordinatorがCOMMITを開始',
    'COMMIT enters the 2PC coordinator',
    '2PC coordinatorがprimaryを選び、Regionのprewriteを開始します。',
    'The 2PC coordinator chooses a primary and starts Region prewrites.',
    '2PC coordinatorへのCOMMIT',
    '2PC coordinator commit request',
  ),
  prewrite: event(
    'Regionへprewriteを送信',
    'Dispatch primary prewrite',
    '対象Regionへ書き込みロックと仮の値を送ります。',
    'A write lock and tentative value are sent to the target Region.',
    'prewrite',
    'Prewrite',
  ),
  raft_propose: event(
    'Region Raftへ操作を提案',
    'Propose an operation to Region Raft',
    'Region Leaderが操作をRaftログへ提案します。',
    'The Region leader proposes the operation to its Raft log.',
    'Raft提案',
    'Raft proposal',
  ),
  raft_persist: event(
    'Raft entryをvoterへ永続化',
    'Persist Raft entry on voters',
    'RegionのvoterがRaft entryを永続化します。',
    'Region voters persist the Raft entry.',
    'Raft永続化',
    'Raft persistence',
  ),
  quorum_commit: event(
    'Raft quorumが操作をcommit',
    'Raft quorum committed the operation',
    '必要なvoter quorumがそろい、Regionはentryを適用できます。',
    'The required voter quorum is present and the Region can apply the entry.',
    'Raft quorum commit',
    'Raft quorum commit',
  ),
  raft_apply: event(
    'commit済みRaft entryを適用',
    'Apply the committed Raft entry',
    'RegionのKV state machineがcommit済みindexを適用します。',
    'The Region KV state machine applies the committed index.',
    'Raft適用',
    'Raft apply',
  ),
  append_entry: event(
    'Raft entryを追加',
    'Append Raft entry',
    '操作をRegionのRaftログへ追加します。',
    'The operation is appended to the Region Raft log.',
    'Raft entry追加',
    'Raft entry append',
  ),
  mutation: event(
    'Region LeaderへKV mutationを送信',
    'Send KV mutation to Region leader',
    'TiDBがRegion Leaderへモデル化されたmutationを送ります。',
    'TiDB sends the modeled mutation to the Region leader.',
    'KV mutation',
    'KV mutation',
  ),
  mvcc_prewrite: event(
    'MVCC prewriteを反映',
    'Materialize MVCC prewrite',
    'default CFの仮の値とlock CFのトランザクションロックを反映します。',
    'The tentative default-CF value and transaction lock in lock CF are materialized.',
    'MVCC prewrite',
    'MVCC prewrite',
  ),
  all_prewrite_complete: event(
    '全Regionのprewriteが完了',
    'Both Region prewrites completed',
    '2PC coordinatorが独立したRegion Raftの結果を合流させます。',
    'The 2PC coordinator joins the independent Region Raft branches.',
    'prewrite完了',
    'Prewrites complete',
  ),
  commit_primary: event(
    'primaryをcommit',
    'Commit the primary',
    'primary lockへcommitの決定を送ります。',
    'The commit decision is sent to the primary lock.',
    'primary commit',
    'Primary commit',
  ),
  mvcc_primary_commit: event(
    'primaryのMVCC commit recordを公開',
    'Publish the primary commit record',
    'lock CFのロックを削除し、write CFへcommit recordを書き込みます。',
    'The lock-CF entry is removed and a commit record is written to write CF.',
    'primaryのMVCC commit',
    'Primary MVCC commit',
  ),
  commit_secondary: event(
    '応答後にsecondaryを解決',
    'Resolve the secondary after response',
    'クライアント応答後にsecondary lockを解決します。',
    'The secondary lock is resolved after the client response.',
    'secondary commit',
    'Secondary commit',
  ),
  mvcc_secondary_commit: event(
    'secondaryのMVCC commit recordを公開',
    'Publish the secondary commit record',
    'secondaryのlock CFを削除し、同じcommit決定をwrite CFへ記録します。',
    'The secondary lock-CF entry is removed and the same commit decision is recorded in write CF.',
    'secondaryのMVCC commit',
    'Secondary MVCC commit',
  ),
  secondary_cleanup_complete: event(
    'secondary cleanupが完了',
    'Secondary cleanup complete',
    '全Regionがcommit recordを持ち、モデル化されたtransaction lockは残りません。',
    'All Regions expose commit records and no modeled transaction locks remain.',
    'secondary cleanup完了',
    'Secondary cleanup complete',
  ),
  write_conflict: event(
    '楽観的prewrite競合',
    'Optimistic prewrite conflict',
    '新しいcommit timestampがtransactionのstart_tsより後にあるため競合しました。',
    'A newer commit timestamp is greater than the transaction start_ts.',
    'optimistic conflict',
    'Optimistic conflict',
  ),
  rollback: event(
    'transactionをロールバック',
    'Transaction rolled back',
    '競合または失敗したtransactionをロールバックします。',
    'The conflicting or failed transaction is rolled back.',
    'ロールバック',
    'Rollback',
  ),
  one_phase_commit: event(
    '1PCを実行',
    'One-phase commit',
    '単一Regionがmutationとcommit状態を1つのRaft entryで永続化します。',
    'A single Region persists the mutation and commit state in one Raft entry.',
    '1PC',
    '1PC',
  ),
  region_split: event(
    'PDがRegion splitをスケジュール',
    'PD scheduled a Region split',
    'hotspotのキー範囲を2つの代表Regionへ分割します。',
    'The hotspot key range is split into two representative Regions.',
    'Region split',
    'Region split',
  ),

  /* Model-4 Region Raft failure slice. */
  raft_lab_start: event(
    '論理Region requestを開始',
    'Begin one logical Region request',
    'SQL本文や結果行を保持せず、分類と合成request IDだけを使います。',
    'Only the classification and a synthetic request ID are used; SQL text and result rows are not retained.',
    'Raft Lab開始',
    'Raft Lab start',
  ),
  region_request_attempt: event(
    'Region requestを送信',
    'Send a Region request attempt',
    'TiDB内部のRegion request pathが現在のrouteへ送信します。',
    'The internal TiDB Region request path sends to the current route.',
    'Region request試行',
    'Region request attempt',
  ),
  tikv_process_unreachable: event(
    '旧Leaderのプロセスが到達不能',
    'The old leader process becomes unreachable',
    '旧Leaderは読み取りを処理できず、対象Regionのpeerが停止状態になります。',
    'The old leader cannot serve the read and the affected Region peer goes down.',
    'TiKV process障害',
    'TiKV process failure',
  ),
  region_request_transport_error: event(
    '再試行可能なRegion transport errorを検知',
    'TiDB catches a retryable Region transport error',
    'クライアントへエラーを返さず、TiDB内部のRegion request pathで回復します。',
    'The client response stays pending while the internal Region request path recovers.',
    'Region transport error',
    'Region transport error',
  ),
  region_request_backoff: event(
    '古いLeader routeを無効化してbackoff',
    'Invalidate the cached leader and back off',
    '古いRegion routeを無効化し、代表的な内部backoffを待ちます。',
    'The stale Region route is invalidated and a representative internal backoff is waited.',
    'Region request backoff',
    'Region request backoff',
  ),
  raft_election_timeout: event(
    'Followerがelection timeoutに到達',
    'A live follower reaches its election timeout',
    '稼働中のfollowerが候補としてelectionを開始できる時刻に達します。',
    'A live follower reaches the point where it can begin an election.',
    'election timeout',
    'Election timeout',
  ),
  raft_pre_vote_start: event(
    'termを進めずにPre-Voteを開始',
    'Start pre-vote without advancing term',
    '候補が次のtermに向けてPre-Voteを開始します。',
    'The candidate starts Pre-Vote for the next term.',
    'Pre-Vote開始',
    'Pre-Vote start',
  ),
  raft_pre_vote_request: event(
    '別のvoterへPre-Voteを依頼',
    'Ask the other live voter for pre-vote',
    '候補が自身のlogの新しさをvoterへ提示します。',
    'The candidate presents its log freshness to another voter.',
    'Pre-Vote request',
    'Pre-Vote request',
  ),
  raft_pre_vote_granted: event(
    'Pre-Voteが2-of-3に到達',
    'Pre-vote reaches 2-of-3',
    '稼働中のvoterが候補のlogを認め、Pre-Vote quorumを形成します。',
    'A live voter accepts the candidate log and forms the Pre-Vote quorum.',
    'Pre-Vote grant',
    'Pre-Vote grant',
  ),
  raft_candidate_term: event(
    'termを進めて候補自身が投票',
    'Advance term and cast the candidate self-vote',
    '候補がtermを進め、自身への1票を記録します。',
    'The candidate advances the term and records its own vote.',
    'candidate term',
    'Candidate term',
  ),
  raft_vote_request: event(
    '2票目のVoteを依頼',
    'Request the second vote',
    '候補が同じtermのVote requestを別のvoterへ送ります。',
    'The candidate sends a same-term Vote request to another voter.',
    'Vote request',
    'Vote request',
  ),
  raft_vote_granted: event(
    'Voteが2-of-3に到達',
    'RequestVote reaches 2-of-3',
    'voterが候補への投票を記録し、選出quorumがそろいます。',
    'The voter records its vote for the candidate and the election quorum is reached.',
    'Vote grant',
    'Vote grant',
  ),
  raft_leader_elected: event(
    '稼働quorumが新しいRegion Leaderを選出',
    'The live quorum elects a new Region leader',
    'Raft peerが新しいLeaderを選出します。PDは候補選択や投票を行いません。',
    'Raft peers elect the new leader; PD does not nominate or vote.',
    'Leader選出',
    'Leader election',
  ),
  raft_leader_noop_propose: event(
    '新Leaderのcurrent-term no-opを追加',
    'Append the new leader current-term no-op',
    '新Leaderがuser-data mutationではない内部確認entryを提案します。',
    'The new leader proposes an internal confirmation entry, not a user-data mutation.',
    'Leader no-op提案',
    'Leader no-op proposal',
  ),
  raft_leader_noop_persist: event(
    'no-opを2つの稼働voterへ永続化',
    'Persist the no-op on two live voters',
    '新Leaderのcurrent-term no-opをvoter quorumへ永続化します。',
    'The new leader current-term no-op is persisted on the voter quorum.',
    'Leader no-op永続化',
    'Leader no-op persistence',
  ),
  raft_leader_noop_commit: event(
    'quorumでno-opをcommit',
    'Commit the no-op at quorum',
    '2-of-3 voter quorumによりcurrent-term no-opがcommitされます。',
    'The 2-of-3 voter quorum commits the current-term no-op.',
    'Leader no-op commit',
    'Leader no-op commit',
  ),
  raft_leader_noop_apply: event(
    '新Leaderがcommit済みno-opを適用',
    'The new leader applies the committed no-op',
    '新Leaderがno-opを適用します。読み取りはuser-data entryを作りません。',
    'The new leader applies the no-op; the read creates no user-data entry.',
    'Leader no-op適用',
    'Leader no-op apply',
  ),
  pd_observes_region_leader: event(
    'PDが新Leaderのheartbeatを観測',
    'PD observes the new leader heartbeat',
    'PDはLeader metadataを観測してrouteを支援しますが、選挙は行いません。',
    'PD observes leader metadata for routing support but does not run the election.',
    'PDのLeader観測',
    'PD leader observation',
  ),
  region_cache_refreshed: event(
    'Region routing metadataを更新',
    'Refresh Region routing metadata',
    'TiDBが新Leaderを知り、Region cacheを更新します。',
    'TiDB learns the new leader and refreshes its Region cache.',
    'Region cache更新',
    'Region cache refresh',
  ),
  region_request_retry: event(
    '同じlogical requestを新Leaderへ再試行',
    'Retry the same logical request on the new leader',
    'これはアプリケーションtransaction retryではなく、TiDB内部の再試行です。',
    'This is an internal TiDB retry, not an application transaction retry.',
    'Region request再試行',
    'Region request retry',
  ),
  point_get_recovered: event(
    '新Leaderがスナップショットを提供',
    'The new leader serves the modeled snapshot',
    '新Leaderがスナップショットを提供し、結果行は生成しません。',
    'The new leader serves the snapshot without generating a result row.',
    '復旧後のPoint Get',
    'Recovered Point Get',
  ),
  raft_failover_complete: event(
    '一時的なRegion errorを隠して成功を返却',
    'Return success without exposing the transient Region error',
    '同じクライアントrequestがTiDB内部のRegion retry後に完了します。',
    'The same client request completes after the internal TiDB Region retry.',
    'Raft failover完了',
    'Raft failover complete',
  ),
  raft_follower_noop_apply: event(
    '生存followerがbackgroundでno-opを適用',
    'The surviving follower applies in background',
    '生存followerがLeader確認用no-opをbackgroundで適用します。',
    'The surviving follower applies the leader-confirmation no-op in the background.',
    'follower no-op適用',
    'Follower no-op apply',
  ),

  /* Model-3 Lock Lab. */
  lock_lab_start: event(
    '2つのクライアントが合成Lock Labを開始',
    'Two clients begin a synthetic Lock Lab',
    'resource-aとresource-bだけを使い、SQL本文や行データは保持しません。',
    'Only resource-a and resource-b are used; SQL text and row data are not retained.',
    'Lock Lab開始',
    'Lock Lab start',
  ),
  lock_acquired: event(
    'ロック所有権を取得',
    'Acquire a lock',
    'pessimistic lockはRegion Leaderのメモリにだけ保持されます。',
    'The pessimistic lock is held only in Region leader memory.',
    'lock acquire',
    'Lock acquire',
  ),
  lock_wait_enqueued: event(
    'ロック待機をキューへ追加',
    'Enqueue a lock wait',
    '待機者から現在の保持者へのwait-for edgeを登録します。',
    'A waiter-to-current-holder wait-for edge is registered.',
    'lock wait enqueue',
    'Lock wait enqueue',
  ),
  deadlock_detector_lookup: event(
    'クラスタ全体のdeadlock detector leaderを特定',
    'Locate the cluster-wide detector leader',
    'PDはdetectorの場所だけを返し、lockやkeyのデータは通しません。',
    'PD returns only the detector location; lock and key data do not pass through it.',
    'detector leader lookup',
    'Detector leader lookup',
  ),
  deadlock_detected: event(
    'クラスタ全体のdetectorがcycleを検出',
    'Cluster-wide detector found a cycle',
    'wait-for graphにtransaction deadlockのcycleが見つかりました。',
    'The wait-for graph contains a transaction-deadlock cycle.',
    'deadlock検出',
    'Deadlock detection',
  ),
  deadlock_victim_selected: event(
    'deadlock victimを選択（MODEL POLICY）',
    'Select a deadlock victim (MODEL POLICY)',
    'cycleを閉じたwaiterをTiCity MODEL POLICYで決定論的に選びます。',
    'TiCity MODEL POLICY deterministically selects the cycle-closing waiter.',
    'victim選択',
    'Victim selection',
  ),
  deadlock_victim_rollback: event(
    'victimをロールバックして待機者を起こす',
    'Roll back the victim and wake the waiter',
    'victimのtransaction全体を終了し、解放したresourceを次の待機者へ渡します。',
    'The whole victim transaction ends and the released resource goes to the next waiter.',
    'victim rollback',
    'Victim rollback',
  ),
  deadlock_resolved: event(
    'wait-for cycleを解消',
    'Break the wait-for cycle',
    'victimのrollbackでwait edgeを解消し、deadlockの履歴を保持します。',
    'Victim rollback removes the wait edges while retaining deadlock history.',
    'deadlock解消',
    'Deadlock resolution',
  ),
  deadlock_error_1213: event(
    'ClientへError 1213を返却',
    'Return Error 1213 to the client',
    '再試行できないtransaction境界が完了し、全体retryはアプリケーションで開始します。',
    'The non-retryable transaction boundary is complete; a whole retry starts in the application.',
    'Error 1213',
    'Error 1213',
  ),
  application_retry_backoff: event(
    'アプリケーションがretry backoffをスケジュール',
    'Application schedules a retry backoff',
    'アプリケーションが新しいtransactionの前に固定backoffを待ちます。',
    'The application waits a fixed backoff before a new transaction.',
    'application retry backoff',
    'Application retry backoff',
  ),
  lock_waiter_woken: event(
    '待機中のtransactionを起こす（MODEL POLICY）',
    'Wake the waiting transaction (MODEL POLICY)',
    '解放されたresourceを決定論的なTiCity MODEL POLICYで引き渡します。',
    'The released resource is transferred by deterministic TiCity MODEL POLICY.',
    'waiter wake',
    'Waiter wake',
  ),
  commit_handoff: event(
    'transactionをcommit modelへ引き渡す',
    'Hand the transaction to the commit model',
    'Lock Labはcommit境界で止まり、詳細な2PC/Raftは別のLabで投影します。',
    'Lock Lab stops at the commit boundary; detailed 2PC/Raft is projected by another Lab.',
    'commit model handoff',
    'Commit-model handoff',
  ),
  commit_summary: event(
    'transactionのcommitが完了',
    'Transaction commit completed',
    '成功したcommit handoffだけを要約し、内部commitを重複再生しません。',
    'The successful commit handoff is summarized without replaying commit internals.',
    'commit summary',
    'Commit summary',
  ),
  lock_release_after_commit: event(
    'commit後にロックを解放',
    'Release locks after commit',
    '合成leader-memory resourceをcommit summaryの後で解放します。',
    'Synthetic leader-memory resources are released after the commit summary.',
    'commit後のlock release',
    'Post-commit lock release',
  ),
  application_retry_begin: event(
    'アプリケーションが新しいtransactionを開始',
    'Application starts a new transaction',
    '新しいtransaction IDとstart_tsで全体retryを開始します。',
    'A whole retry starts with a fresh transaction ID and start_ts.',
    'application retry開始',
    'Application retry start',
  ),
  retry_lock_acquired: event(
    'retry transactionがロックを取得',
    'Retry transaction acquired a lock',
    'retryでも同じ正規化されたresource順序を使います。',
    'The retry uses the same canonical resource order.',
    'retry lock acquire',
    'Retry lock acquire',
  ),
  lock_lab_summary: event(
    'Lock Labを完了',
    'Lock Lab completed',
    'victimのrollback、元transactionの完了、新しいapplication retryを記録します。',
    'The victim rollback, original completion, and fresh application retry are recorded.',
    'Lock Lab完了',
    'Lock Lab complete',
  ),

  /* Model-5 commit-protocol comparison. */
  protocol_comparison_start: event(
    'commit protocol比較を開始',
    'Begin the commit-protocol comparison',
    '3つの独立したfixtureでmessage shapeを比較し、latency benchmarkは行いません。',
    'Three independent fixtures compare message shape, not latency.',
    'protocol比較開始',
    'Protocol comparison start',
  ),
  protocol_client_request: event(
    'protocol fixtureへのrequestを開始',
    'Start a protocol fixture request',
    '選択したprotocol laneの合成requestを開始します。',
    'A synthetic request begins on the selected protocol lane.',
    'protocol request',
    'Protocol request',
  ),
  protocol_start_ts: event(
    'PDがprotocol fixtureのstart_tsを割り当て',
    'PD allocated the protocol fixture start_ts',
    '選択したprotocol laneに合成start_tsを割り当てます。',
    'A synthetic start_ts is allocated to the selected protocol lane.',
    'protocol start_ts',
    'Protocol start_ts',
  ),
  protocol_eligibility_check: event(
    'TryOnePc適格性を確認',
    'Choose the TryOnePc candidate',
    'feature flagとRegion batchingをモデルのfixture条件として判定します。',
    'Feature flags and Region batching are evaluated as declared fixture conditions.',
    'protocol適格性確認',
    'Protocol eligibility check',
  ),
  protocol_latest_ts_floor: event(
    'latest TSOと1PCのfloorを計算',
    'Get latest TSO and calculate the 1PC floor',
    'latest_tsと代表的な安全範囲からrequestのfloorを計算します。',
    'The request floor is calculated from latest_ts and a representative safe window.',
    'latest TSO floor',
    'Latest TSO floor',
  ),
  one_pc_prewrite_dispatch: event(
    'TryOnePc付きPrewriteを送信',
    'Send Prewrite with TryOnePc',
    '1PCは通常のCommit phaseとは別の、TryOnePc付きPrewrite requestです。',
    '1PC is a Prewrite request with TryOnePc, not a separate normal Commit phase.',
    '1PC Prewrite dispatch',
    '1PC Prewrite dispatch',
  ),
  protocol_raft_propose: event(
    'Region Leaderがprotocol mutationを提案',
    'Region leader proposed the mutation',
    'Region Leaderがprotocol laneのmutationをRaftへ提案します。',
    'The Region leader proposes the protocol-lane mutation to Raft.',
    'protocol Raft提案',
    'Protocol Raft proposal',
  ),
  protocol_raft_persist_quorum: event(
    '2つのvoterがprotocol Raft entryを永続化',
    'Two voters persisted the Raft entry',
    'Regionがモデル化された2/3 persistence quorumに到達します。',
    'The Region reaches its modeled 2/3 persistence quorum.',
    'protocol Raft quorum永続化',
    'Protocol Raft quorum persistence',
  ),
  protocol_raft_commit: event(
    'Region Raftがprotocol entryをcommit',
    'Region Raft committed the entry',
    'Region Raftのcommitとtransaction coordinationは別の層です。',
    'Region Raft commit and transaction coordination are separate layers.',
    'protocol Raft commit',
    'Protocol Raft commit',
  ),
  raft_apply_one_pc_mvcc: event(
    '1PCのMVCC recordを原子的に適用',
    'Apply 1PC MVCC records atomically',
    '1PCではdurable lock-CF中間状態を作らず、値とcommit recordを適用します。',
    '1PC applies the value and commit record without a durable lock-CF intermediate.',
    '1PC MVCC適用',
    '1PC MVCC apply',
  ),
  one_pc_result: event(
    'TiKVがone_pc_commit_tsを返却',
    'TiKV returned one_pc_commit_ts',
    'Regionが合成one_pc_commit_tsを返し、PDはこのcommit timestampを割り当てません。',
    'The Region returns a synthetic one_pc_commit_ts; PD does not allocate it.',
    '1PC結果',
    '1PC result',
  ),
  protocol_client_response: event(
    'protocolのcommit結果をクライアントへ返却',
    'Protocol returned committed',
    '選択したprotocolの応答境界でcommit結果を返します。',
    'The commit result is returned at the selected protocol response boundary.',
    'protocol client response',
    'Protocol client response',
  ),
  protocol_branch_complete: event(
    'protocol fixtureを完了',
    'Protocol fixture complete',
    '選択したprotocol laneのモデル化された処理が完了します。',
    'The modeled processing on the selected protocol lane is complete.',
    'protocol branch完了',
    'Protocol branch complete',
  ),
  async_prewrite_dispatch: event(
    'Async CommitのPrewriteをRegionへ送信',
    'Send Async Prewrite to Region',
    'primary PrewriteにUseAsyncCommitを付け、key listは保持しません。',
    'The primary Prewrite carries UseAsyncCommit; no key list is retained.',
    'Async Prewrite dispatch',
    'Async Prewrite dispatch',
  ),
  raft_apply_prewrite_mvcc: event(
    '仮の値とprewrite lockを適用',
    'Apply tentative value and prewrite lock',
    'Raft commit後にdefault CFの値とdurable transaction lockを適用します。',
    'After Raft commit, the value and durable transaction lock are applied.',
    'prewrite MVCC適用',
    'Prewrite MVCC apply',
  ),
  async_prewrite_result: event(
    'Regionがmin_commit_tsを返却',
    'Region returned min_commit_ts',
    'TiKVがPrewrite後に合成min_commit_tsを計算して返します。',
    'TiKV calculates and returns a synthetic min_commit_ts after Prewrite.',
    'Async Prewrite結果',
    'Async Prewrite result',
  ),
  async_commit_decision: event(
    '全PrewriteがAsync Commitを確立',
    'All prewrites established Async Commit',
    '複数Regionのmin_commit_tsからAsync commit_tsを決定します。',
    'The Async commit_ts is decided from the Regions’ min_commit_ts values.',
    'Async Commit決定',
    'Async Commit decision',
  ),
  async_commit_background_dispatch: event(
    'background CommitをRegionへ送信',
    'Dispatch background Commit to Region',
    'クライアント応答後のAsync Commit cleanupを決定的な順序で表示します。',
    'Async Commit cleanup after the client response is shown in deterministic order.',
    'Async background commit',
    'Async background commit',
  ),
  raft_apply_commit_mvcc: event(
    'commit recordを適用してlockを削除',
    'Apply commit record and remove lock',
    'write CFへcommit recordを適用し、prewrite lockを削除します。',
    'The write-CF commit record is applied and the prewrite lock is removed.',
    'commit MVCC適用',
    'Commit MVCC apply',
  ),
  two_pc_prewrite_dispatch: event(
    'regular 2PCのPrewriteをRegionへ送信',
    'Send regular Prewrite to Region',
    'TryOnePcとUseAsyncCommitを使わないregular 2PCのPrewriteです。',
    'This regular 2PC Prewrite uses neither TryOnePc nor UseAsyncCommit.',
    'regular 2PC Prewrite',
    'Regular 2PC Prewrite',
  ),
  two_pc_prewrite_result: event(
    'regular Prewriteが完了',
    'Region completed regular Prewrite',
    'Prewrite結果はこのfixtureのRaft apply後に確定します。',
    'The Prewrite result follows Raft apply in this fixture.',
    'regular Prewrite結果',
    'Regular Prewrite result',
  ),
  two_pc_all_prewritten: event(
    'regular 2PCの全Prewriteが完了',
    'All regular 2PC prewrites completed',
    '両Regionに仮の値とdurable prewrite lockが存在します。',
    'Both Regions contain tentative values and durable prewrite locks.',
    'regular 2PC prewrite完了',
    'Regular 2PC prewrites complete',
  ),
  two_pc_commit_ts: event(
    'PDがregular 2PCのcommit_tsを割り当て',
    'PD allocated regular 2PC commit_ts',
    '全Prewrite後にregular 2PC用のcommit_tsをPDから取得します。',
    'Regular 2PC obtains commit_ts from PD after all Prewrites.',
    'regular 2PC commit_ts',
    'Regular 2PC commit_ts',
  ),
  two_pc_primary_commit_dispatch: event(
    'primary RegionへCommitを送信',
    'Commit the primary Region',
    'regular 2PCのprimary Commit phaseを開始します。',
    'The regular 2PC primary Commit phase begins.',
    '2PC primary Commit',
    '2PC primary Commit',
  ),
  two_pc_secondary_commit_dispatch: event(
    'secondary Commitをbackgroundで送信',
    'Dispatch secondary Commit in background',
    'regular 2PCのsecondary cleanupをbackgroundで実行します。',
    'Regular 2PC secondary cleanup runs in the background.',
    '2PC secondary background commit',
    '2PC secondary background commit',
  ),
  protocol_lab_complete: event(
    'commit protocol比較を完了',
    'Commit-protocol comparison complete',
    '3つの代表fixtureとbackground lock cleanupが完了します。',
    'All three representative fixtures and modeled background cleanup are complete.',
    'protocol比較完了',
    'Protocol comparison complete',
  ),

  /* Model-6 GC / Storage Lab. */
  gc_round_start: event(
    'TiDB GC leaderがroundを開始',
    'TiDB GC leader started a round',
    '決定論的なGC teaching roundを開始します。これはSQL transactionではありません。',
    'A deterministic GC teaching round begins; this is not a SQL transaction.',
    'GC round開始',
    'GC round start',
  ),
  gc_safe_point_candidate: event(
    'GC lifetimeからsafe point候補を計算',
    'Lifetime produced a candidate safe point',
    'GC lifetimeからsafe point候補を作ります。TSO間隔は説明用に伸長されています。',
    'A safe-point candidate is produced from GC lifetime; TSO spacing is stretched for teaching.',
    'safe point候補',
    'Safe-point candidate',
  ),
  gc_min_start_ts_bound: event(
    'global min start_tsで候補を制限',
    'Global min start_ts capped the candidate',
    'active transactionのstart_tsを考慮してsafe pointの上限を決めます。',
    'The active transaction start_ts bounds the safe point.',
    'min start_ts bound',
    'Minimum start_ts bound',
  ),
  gc_min_start_ts_clear: event(
    '候補を制限するactive transactionなし',
    'No active transaction capped the candidate',
    '候補より古いactive start_tsはなく、外部serviceの制約もありません。',
    'No active start_ts or external service constrains the candidate.',
    'min start_ts制約なし',
    'Minimum start_ts clear',
  ),
  gc_service_safe_point: event(
    'PDがservice safe pointの下限を受理',
    'PD service minimum accepted the bound',
    'GC workerがservice safe pointを登録します。',
    'The GC worker registers its service safe point.',
    'service safe point',
    'Service safe point',
  ),
  gc_mysql_safe_point_staged: event(
    'tikv_gc_safe_pointをstaged',
    'TiDB staged tikv_gc_safe_point',
    'mysql.tidbの表示用safe pointをstagedします。PDのglobal pointそのものではありません。',
    'The display safe point in mysql.tidb is staged; it is not PD’s global point.',
    'MySQL safe point stage',
    'MySQL safe-point stage',
  ),
  gc_resolve_locks_start: event(
    'Region ScanLock解決を開始',
    'Region ScanLock resolution started',
    'bounded safe pointより前に、全Regionのlockを確認します。',
    'Locks are checked across Regions before the bounded safe point.',
    'Resolve Locks開始',
    'Resolve Locks start',
  ),
  gc_resolve_locks_scan: event(
    'Regionの古いlockを走査',
    'Scan a Region for old locks',
    'GC leaderがprimary statusを確認するため、代表RegionをScanLockします。',
    'The GC leader scans a representative Region to check primary status.',
    'Resolve Locks scan',
    'Resolve Locks scan',
  ),
  gc_resolve_lock_commit: event(
    'commit済みprimaryのlockを解決',
    'Resolve a committed primary lock',
    'primaryがcommit済みなので、古いsecondary lockもcommitとして解決します。',
    'Because the primary committed, the old secondary lock resolves as committed.',
    'Resolve Lock commit',
    'Resolve Lock commit',
  ),
  gc_resolve_lock_rollback: event(
    'rollback済みprimaryのlockを解決',
    'Resolve a rolled-back primary lock',
    'primaryがrollback済みなので、古いsecondary lockもrollbackとして解決します。',
    'Because the primary rolled back, the old secondary lock resolves as rolled back.',
    'Resolve Lock rollback',
    'Resolve Lock rollback',
  ),
  gc_visibility_safe_point_saved: event(
    'safe pointをcacheから可視化',
    'Saved safe point became visible to TiDB caches',
    'Resolve Locks後にsafe pointを保存し、cache barrierを確認します。',
    'After Resolve Locks, the safe point is saved and the cache barrier is observed.',
    'safe point可視化',
    'Safe-point visibility',
  ),
  gc_delete_ranges_start: event(
    'Delete Rangesにeligible rangeを登録',
    'Delete Ranges found an eligible DDL range',
    'safe pointより古い合成DDL rangeを削除対象にします。',
    'A synthetic DDL range older than the safe point becomes eligible for deletion.',
    'Delete Ranges開始',
    'Delete Ranges start',
  ),
  gc_delete_ranges_empty: event(
    'Delete Rangesに保留taskなし',
    'Delete Ranges had no pending fixture task',
    '前のroundで合成DDL rangeが完了しているため、保留taskはありません。',
    'The synthetic DDL range completed in the previous round, so no task is pending.',
    'Delete Ranges空',
    'Delete Ranges empty',
  ),
  gc_delete_range_store: event(
    'StoreへUnsafeDestroyRangeを送信',
    'Store received UnsafeDestroyRange',
    'classic raftstore-v1の合成range削除をRegion Raftなしで実行します。',
    'The classic raftstore-v1 synthetic range deletion bypasses Region Raft.',
    'Store range削除',
    'Store range deletion',
  ),
  gc_delete_range_complete: event(
    '全対象Storeのrange削除が完了',
    'All relevant stores completed the range deletion',
    '直接のRocksDB range deletionが完了し、キー境界は保持しません。',
    'Direct RocksDB range deletion completes without retaining key boundaries.',
    'range削除完了',
    'Range deletion complete',
  ),
  gc_global_safe_point_publish: event(
    'TiDBがglobal safe pointをPDへpublish',
    'TiDB published the global safe point to PD',
    'coordinator側のDistributed Do GCはここで完了し、storage cleanupは非同期に続きます。',
    'Distributed Do GC completes on the coordinator path while storage cleanup continues asynchronously.',
    'global safe point publish',
    'Global safe-point publish',
  ),
  gc_store_safe_point_detected: event(
    'TiKV Storeが新しいsafe pointを検知',
    'TiKV store detected the greater safe point',
    'TiKV GC managerがPDのsafe pointを観測し、Compaction Filterを起動します。',
    'The TiKV GC manager observes PD’s safe point and starts the Compaction Filter path.',
    'Store safe point検知',
    'Store safe-point detection',
  ),
  gc_compaction_filter_start: event(
    'RocksDB bottommost compactionでGC filterを開始',
    'RocksDB bottommost compaction opened GC filters',
    '代表StoreのCompaction Filterを開始します。',
    'Compaction Filters start for the representative stores.',
    'Compaction Filter開始',
    'Compaction Filter start',
  ),
  gc_compaction_filter_apply: event(
    'Compaction Filterが古いMVCC recordを除去',
    'Compaction Filter removed obsolete MVCC records',
    'rollback/lock recordを除去し、safe pointのsnapshot anchorを保持します。',
    'Rollback/lock records are removed while the safe-point snapshot anchor is retained.',
    'Compaction Filter適用',
    'Compaction Filter apply',
  ),
  gc_compaction_filter_complete: event(
    '全StoreのCompaction Filterが完了',
    'All representative store filters completed',
    'filtered SSTとlong-value削除を含むphysical storage stepが完了します。',
    'The physical storage step, including filtered SST output, completes.',
    'Compaction Filter完了',
    'Compaction Filter complete',
  ),
  gc_round_complete: event(
    'GC roundを完了',
    'GC round completed behind the blocker',
    'active fixtureが必要なsnapshotを保護するため、safe pointは制限されています。',
    'The active fixture protects its required snapshot, so the safe point remains bounded.',
    'GC round完了',
    'GC round complete',
  ),
  gc_blocker_complete: event(
    'teaching blockerを完了',
    'The teaching blocker completed',
    'fixture境界としてblockerを完了し、GC内でcommit protocolは再生しません。',
    'The fixture blocker completes; its commit protocol is not replayed inside GC.',
    'GC blocker完了',
    'GC blocker complete',
  ),
  gc_storage_lab_complete: event(
    'GC/Storage Labを完了',
    'GC/Storage Lab completed',
    '2つのsafe pointとstorage roundが完了します。Compaction FilterはRaft entryを作りません。',
    'Both safe-point and storage rounds complete; Compaction Filter creates no Raft entry.',
    'GC/Storage完了',
    'GC/Storage complete',
  ),

  /* Model-7 TiFlash learner and MPP slice. */
  tiflash_raft_leader_commit: event(
    'TiKV LeaderがRaft entryをcommit',
    'Region committed a Raft entry',
    'MPP query前に、TiKV Leaderが合成table mutationをcommitします。',
    'The TiKV leader commits a synthetic table mutation before the MPP query.',
    'TiFlash learner前のRaft commit',
    'Raft commit before TiFlash learner',
  ),
  tiflash_learner_receive: event(
    'TiFlash learnerがRaft entryを受信',
    'TiFlash learner received the entry',
    '投票権を持たないTiFlash learnerが通常のRegion Raft logを受け取ります。',
    'The non-voting TiFlash learner receives the ordinary Region Raft log.',
    'learner受信',
    'Learner receive',
  ),
  tiflash_learner_apply_command: event(
    'TiFlashがRaft commandを適用',
    'TiFlash applied the Raft command',
    'TiFlashがpersistent Region stateを適用します。これはMPP dataではありません。',
    'TiFlash applies persistent Region state; this is not MPP data.',
    'learner command適用',
    'Learner command apply',
  ),
  tiflash_dm_committed_flush: event(
    'TiFlashがcommit済み行をDeltaMergeへflush',
    'Region wrote committed rows to DeltaMerge',
    'commit済みRegion cache dataをTiFlash storageへ書き込みます。',
    'Committed Region-cache data is written to TiFlash storage.',
    'DeltaMerge flush',
    'DeltaMerge flush',
  ),
  tiflash_learner_applied_advance: event(
    'TiFlash learnerのapplied indexを更新',
    'Region advanced learner applied index',
    'persistent storage write後にlearnerのapplied indexを進めます。',
    'The learner applied index advances after the persistent storage write.',
    'learner applied index更新',
    'Learner applied-index advance',
  ),
  tiflash_mpp_query_received: event(
    'TiDBがgrouped aggregateを受信',
    'TiDB received the grouped aggregate',
    '合成query classだけを保持し、SQL本文・key・group valueは保持しません。',
    'Only a synthetic query class is retained; SQL text, keys, and group values are not retained.',
    'MPP query受信',
    'MPP query receive',
  ),
  tiflash_mpp_snapshot_tso: event(
    'PDがMPP snapshot TSOを割り当て',
    'PD allocated the query snapshot TSO',
    '全Regionへ要求するMVCC snapshotを1つの合成start_tsで識別します。',
    'One synthetic start_ts identifies the MVCC snapshot requested from every Region.',
    'MPP snapshot TSO',
    'MPP snapshot TSO',
  ),
  tiflash_safe_ts_read_state_update: event(
    'Regionごとのsafe-ts read stateを観測',
    'Per-Region safe-ts read state was observed',
    '各Regionのself safe-tsを個別に確認し、必要ならReadIndexを使います。',
    'Each Region self safe-ts is checked independently, using ReadIndex when needed.',
    'safe-ts read state',
    'Safe-ts read state',
  ),
  tiflash_replica_placement_observed: event(
    'provision済みTiFlash replicaを観測',
    'TiDB observed provisioned TiFlash replicas',
    'AVAILABLE/PROGRESSはaccess pathの適格性であり、snapshot readinessの証明ではありません。',
    'AVAILABLE/PROGRESS make the path eligible but do not prove snapshot readiness.',
    'replica placement観測',
    'Replica placement observation',
  ),
  tiflash_mpp_access_path_selected: event(
    'OptimizerがTiFlash MPP pathを選択',
    'Optimizer selected the TiFlash MPP path',
    '宣言済みfixtureのcosted MPP選択であり、replicaの存在だけでは強制されません。',
    'This declared fixture models a costed MPP choice; replica presence alone does not force it.',
    'MPP access path選択',
    'MPP access-path selection',
  ),
  tiflash_mpp_fragments_built: event(
    'TiDBが2つのMPP fragmentを構築',
    'TiDB built two MPP fragments',
    'scan fragmentとfinal fragmentでpartial/final aggregationを分担します。',
    'The scan and final fragments divide partial and final aggregation.',
    'MPP fragment構築',
    'MPP fragment build',
  ),
  tiflash_mpp_regions_scheduled: event(
    'TiDBがRegionをTiFlash Storeごとにgroup化',
    'TiDB grouped Regions by TiFlash store',
    'RegionをTiFlash addressごとにgroup化します。Region数とMPP task数は同じとは限りません。',
    'Regions are grouped by TiFlash address; Region count does not equal MPP task count.',
    'MPP Region scheduling',
    'MPP Region scheduling',
  ),
  tiflash_mpp_tasks_built: event(
    'TiDBが4つのMPP taskを構築',
    'TiDB instantiated four MPP tasks',
    '各fragmentで参加TiFlash Storeごとにtaskを作成します。',
    'Each fragment creates one task per participating TiFlash Store.',
    'MPP task構築',
    'MPP task build',
  ),
  tiflash_mpp_tunnels_registered: event(
    '一時MPP tunnelを登録',
    'Ephemeral MPP tunnels were registered',
    'HashPartitionとPassThroughのquery block用streamを登録し、Raft replicationとは分離します。',
    'HashPartition and PassThrough query-block streams are registered separately from Raft replication.',
    'MPP tunnel登録',
    'MPP tunnel registration',
  ),
  tiflash_mpp_dispatch_batch: event(
    'TiDBがMPP taskを同時dispatch',
    'TiDB dispatched MPP tasks concurrently',
    'これは決定論的なbatch表示であり、本番ネットワーク到着順を主張しません。',
    'This is a deterministic batch display and does not claim production arrival order.',
    'MPP task dispatch',
    'MPP task dispatch',
  ),
  tiflash_mpp_tasks_prepared: event(
    'TiFlashが全MPP taskをprepare',
    'TiFlash prepared and registered all tasks',
    '各taskがDAG requestとtunnelを登録し、fragment処理の準備を完了します。',
    'Each task registers its DAG request and tunnels and becomes ready for fragment work.',
    'MPP task prepare',
    'MPP task prepare',
  ),
  tiflash_snapshot_gating_started: event(
    'Regionごとのsnapshot gatingを開始',
    'Scan tasks began per-Region snapshot gating',
    'DeltaMerge scan前に、各Regionのsnapshot correctnessを個別に確認します。',
    'Snapshot correctness is checked independently for every Region before the DeltaMerge scan.',
    'snapshot gating開始',
    'Snapshot gating start',
  ),
  tiflash_snapshot_safe_ts_check: event(
    'start_tsとself safe-tsを比較',
    'Compare start_ts with self safe-ts',
    'learnerのself safe-tsと要求snapshotを比較し、ReadIndexの要否を判定します。',
    'The learner self safe-ts is compared with the requested snapshot to decide on ReadIndex.',
    'safe-ts比較',
    'Safe-ts comparison',
  ),
  tiflash_snapshot_gate_ready_safe_ts: event(
    'self safe-tsでsnapshot gateを通過',
    'Passed through self safe-ts',
    'self safe-tsが十分なため、ReadIndexなしでMVCC snapshotを進められます。',
    'The self safe-ts is sufficient, so the MVCC snapshot can proceed without ReadIndex.',
    'safe-ts gate完了',
    'Safe-ts gate ready',
  ),
  tiflash_read_index_requested: event(
    'RegionへReadIndexを要求',
    'Requested ReadIndex from the Region',
    'Region Leaderへcommit済みindexを問い合わせます。ReadIndexはdataをコピーしません。',
    'The Region leader is asked for the committed index; ReadIndex does not copy data.',
    'ReadIndex request',
    'ReadIndex request',
  ),
  tiflash_read_index_returned: event(
    '必要なReadIndexを受信',
    'Received the required ReadIndex',
    'local learnerがread前に適用すべきcommit済みRaft indexを受け取ります。',
    'The committed Raft index the local learner must apply before reading is received.',
    'ReadIndex response',
    'ReadIndex response',
  ),
  tiflash_learner_wait_applied: event(
    'learnerのapplyを待機',
    'Waited for learner apply',
    '古いsnapshotを返さず、local persistent Raft applicationを待ちます。',
    'The learner waits for local persistent Raft application instead of returning an older snapshot.',
    'learner apply待機',
    'Learner apply wait',
  ),
  tiflash_snapshot_gate_ready_read_index: event(
    'ReadIndexとapply後にsnapshot gateを通過',
    'Passed ReadIndex plus apply',
    '返却されたindexをlearnerが適用したため、要求snapshotを進められます。',
    'The learner applied the returned index, so the requested snapshot can proceed.',
    'ReadIndex gate完了',
    'ReadIndex gate ready',
  ),
  tiflash_mvcc_lock_checks_complete: event(
    '全RegionのMVCC lock checkが完了',
    'All Region MVCC lock checks completed',
    '成功fixtureではlock 0件を確認し、stale rowsは返しません。',
    'The successful fixture finds zero locks and does not return stale rows.',
    'MVCC lock check完了',
    'MVCC lock checks complete',
  ),
  tiflash_dm_snapshot_scans_started: event(
    'DeltaMerge snapshot readerでscanを開始',
    'Scan tasks built DeltaMerge snapshot readers',
    '全owned Regionのgate後に同じsnapshot TSOでscanします。',
    'Scanning uses the same snapshot TSO after all owned Region gates pass.',
    'DeltaMerge snapshot scan',
    'DeltaMerge snapshot scan',
  ),
  tiflash_regions_post_read_validated: event(
    'Region epochとrangeを再検証',
    'Region epochs and ranges were revalidated',
    'Region split/merge/epochがreaderのrangeを無効化していないことを確認します。',
    'Region split, merge, and epoch state are checked against the reader ranges.',
    'Region post-read validation',
    'Region post-read validation',
  ),
  tiflash_partial_hash_aggregate_complete: event(
    'scan taskのpartial aggregationが完了',
    'Scan tasks completed partial aggregation',
    'aggregate blockのbucketだけを保持し、group keyや結果値は保持しません。',
    'Only aggregate-block buckets are retained; group keys and result values are not.',
    'partial Hash aggregation',
    'Partial Hash aggregation',
  ),
  tiflash_hash_partition_started: event(
    'aggregate blockのHashPartitionを開始',
    'Scan tasks hash-partitioned aggregate blocks',
    '一時aggregate blockをfinal taskへscatterします。broadcastやRaftではありません。',
    'Ephemeral aggregate blocks scatter to final tasks; this is not broadcast or Raft.',
    'HashPartition開始',
    'HashPartition start',
  ),
  tiflash_hash_exchange_send: event(
    'HashPartition tunnelがaggregate blockを送信',
    'HashPartition tunnel sent aggregate blocks',
    'task間tunnel上でbounded packetの一時blockを送信します。',
    'A bounded ephemeral block packet is sent on the task-to-task tunnel.',
    'HashPartition送信',
    'HashPartition send',
  ),
  tiflash_hash_exchange_received: event(
    'final taskがHashPartition blockを受信',
    'Final tasks received all HashPartition blocks',
    'receiverが同じ一時packet formatをdecodeしてfinal aggregationへ進みます。',
    'Receivers decode the same ephemeral packet format before final aggregation.',
    'HashPartition受信',
    'HashPartition receive',
  ),
  tiflash_final_hash_aggregate_complete: event(
    'final taskの2段目aggregationが完了',
    'Final tasks completed the second aggregation stage',
    'final taskがpartitionを結合し、group keyやaggregate valueは公開しません。',
    'Final tasks combine partitions without exposing group keys or aggregate values.',
    'final Hash aggregation',
    'Final Hash aggregation',
  ),
  tiflash_root_passthrough_sent: event(
    'PassThrough root streamが結果blockをTiDBへ送信',
    'PassThrough root streams sent result blocks to TiDB',
    '各final taskのroot streamがTiDBのvirtual taskへblockを送信します。',
    'Each final-task root stream sends blocks to the TiDB virtual task.',
    'PassThrough送信',
    'PassThrough send',
  ),
  tiflash_mpp_gather_decoded: event(
    'TiDBがMPPGatherでresult chunkをdecode',
    'TiDB MPPGather decoded result chunks',
    'root streamを消費し、aggregate packetを内部chunkへdecodeします。',
    'Root streams are consumed and aggregate packets are decoded into internal chunks.',
    'MPPGather decode',
    'MPPGather decode',
  ),
  tiflash_client_columns_sent: event(
    'TiDBがresult-column metadataを送信',
    'TiDB sent result-column metadata',
    'client protocol境界へcolumn metadataを送り、SQL本文や値は保持しません。',
    'Column metadata crosses the client protocol boundary without retaining SQL text or values.',
    'client columns送信',
    'Client columns sent',
  ),
  tiflash_client_rows_streamed: event(
    'TiDBがaggregate row bucketをstream',
    'TiDB streamed a bounded aggregate row bucket',
    '小さなbucketだけを保持し、正確なrow valueは保持しません。',
    'Only a small bucket is retained; exact row values are not retained.',
    'client rows stream',
    'Client rows stream',
  ),
  tiflash_root_streams_eof: event(
    'root streamがEOFに到達',
    'Both root streams reached EOF',
    'bounded packetをすべて消費し、stream完了を記録します。',
    'All bounded packets are consumed and stream completion is recorded.',
    'root stream EOF',
    'Root stream EOF',
  ),
  tiflash_client_query_complete: event(
    'TiDBのclient responseが完了',
    'TiDB completed the client response',
    'retryなし・fallbackなしの成功fixtureとしてclient responseを完了します。',
    'The successful fixture completes the client response with no retry or fallback.',
    'client query完了',
    'Client query complete',
  ),
}

const SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/

function token(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return SAFE_TOKEN.test(trimmed) ? trimmed : null
}

function metadataValue(
  source: TraceEventCopyInput,
  key: string,
): TraceMetadataValue | undefined {
  return source.metadata?.[key]
}

function deltaRecord(
  source: TraceEventCopyInput,
  kind: string,
): Record<string, unknown> | null {
  const delta = source.deltas?.find((candidate) => candidate.kind === kind)
  return delta ? delta as unknown as Record<string, unknown> : null
}

function firstDeltaRecord(source: TraceEventCopyInput): Record<string, unknown> | null {
  const delta = source.deltas?.[0]
  return delta ? delta as unknown as Record<string, unknown> : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null
}

function roundNumber(source: TraceEventCopyInput): number | null {
  const metadataRound = numberValue(metadataValue(source, 'round'))
  if (metadataRound !== null) return metadataRound
  for (const delta of source.deltas ?? []) {
    const round = numberValue((delta as unknown as Record<string, unknown>).round)
    if (round !== null) return round
  }
  return null
}

function regionNumber(source: TraceEventCopyInput): number | null {
  if (source.regionId !== undefined && Number.isInteger(source.regionId)) {
    return source.regionId
  }
  const metadataRegion = numberValue(metadataValue(source, 'regionId'))
  if (metadataRegion !== null) return metadataRegion
  for (const kind of [
    'raft_propose',
    'raft_persist',
    'raft_commit',
    'raft_apply',
    'raft_peer_health',
    'raft_election_timeout',
    'raft_pre_vote',
    'raft_term_vote',
    'raft_leader_elected',
    'raft_region_request',
    'raft_pd_state',
    'pessimistic_lock',
    'mvcc',
    'protocol_region_raft',
    'tiflash_replica_raft_commit',
    'tiflash_replica_receive',
    'tiflash_replica_apply',
    'tiflash_replica_dm_flush',
    'tiflash_replica_applied_advance',
    'tiflash_mpp_snapshot_gate',
  ]) {
    const value = numberValue(deltaRecord(source, kind)?.regionId)
    if (value !== null) return value
  }
  return null
}

function operation(source: TraceEventCopyInput): string | null {
  const candidate = metadataValue(source, 'operation') ??
    firstDeltaRecord(source)?.operation
  const value = token(candidate)
  return value && OPERATION_LABELS[value] ? value : null
}

const OPERATION_LABELS: Readonly<Record<string, LocalizedText>> = {
  prewrite: localized('prewrite', 'prewrite'),
  commit_primary: localized('primary commit', 'primary commit'),
  commit_secondary: localized('secondary commit', 'secondary commit'),
  one_phase_commit: localized('1PC', '1PC'),
  one_pc_prewrite: localized('1PC prewrite', '1PC prewrite'),
  commit_background: localized('background commit', 'background commit'),
  commit_async: localized('Async commit', 'Async commit'),
  leader_noop: localized('Leader no-op', 'leader no-op'),
  read_index: localized('ReadIndex', 'ReadIndex'),
}

function operationText(source: TraceEventCopyInput, locale: Locale): string {
  const value = operation(source)
  if (!value) return locale === 'ja' ? '操作' : 'the operation'
  return OPERATION_LABELS[value][locale]
}

type CanonicalProtocol = '1pc' | 'async_commit' | '2pc'

const PROTOCOL_ALIASES: Readonly<Record<string, CanonicalProtocol>> = {
  '1pc': '1pc',
  one_pc: '1pc',
  async_commit: 'async_commit',
  'async-commit': 'async_commit',
  asynccommit: 'async_commit',
  '2pc': '2pc',
  two_pc: '2pc',
  'two-pc': '2pc',
  twopc: '2pc',
}

function canonicalProtocol(value: unknown): CanonicalProtocol | null {
  if (typeof value !== 'string') return null
  return PROTOCOL_ALIASES[value.trim().toLowerCase()] ?? null
}

function selectedProtocol(source: TraceEventCopyInput): CanonicalProtocol | null {
  return [
    metadataValue(source, 'selected'),
    metadataValue(source, 'protocol'),
    firstDeltaRecord(source)?.laneId,
  ]
    .map(canonicalProtocol)
    .find((value): value is CanonicalProtocol => value !== null)
    ?? null
}

function protocolText(source: TraceEventCopyInput, locale: Locale): string {
  const selected = selectedProtocol(source)
  const labels: Readonly<Record<CanonicalProtocol, LocalizedText>> = {
    '1pc': localized('1PC', '1PC'),
    async_commit: localized('Async Commit', 'Async Commit'),
    '2pc': localized('regular 2PC', 'regular 2PC'),
  }
  return selected
    ? labels[selected][locale]
    : locale === 'ja'
      ? 'commit protocol'
      : 'commit protocol'
}

function laneText(source: TraceEventCopyInput, locale: Locale): string {
  const lane = canonicalProtocol(firstDeltaRecord(source)?.laneId) ??
    canonicalProtocol(metadataValue(source, 'laneId'))
  if (!lane) return locale === 'ja' ? 'protocol lane' : 'protocol lane'
  return protocolText({
    ...source,
    metadata: { ...(source.metadata ?? {}), selected: lane },
  }, locale)
}

function dynamicRegionSuffix(source: TraceEventCopyInput, locale: Locale): string {
  const region = regionNumber(source)
  if (region === null) return ''
  return locale === 'ja' ? `（Region ${region}）` : ` (Region ${region})`
}

function dynamicTransactionSuffix(source: TraceEventCopyInput, locale: Locale): string {
  const transaction = token(source.transactionId) ?? token(metadataValue(source, 'transactionId'))
  if (!transaction) return ''
  return locale === 'ja' ? `（${transaction}）` : ` (${transaction})`
}

function dynamicTunnelSuffix(source: TraceEventCopyInput, locale: Locale): string {
  const tunnel = token(deltaRecord(source, 'tiflash_mpp_tunnel_data')?.tunnelId)
  if (!tunnel) return ''
  return locale === 'ja' ? `（${tunnel}）` : ` (${tunnel})`
}

const REGION_SCOPED_EVENT_KINDS: ReadonlySet<string> = new Set([
  'point_get',
  'one_pc_prewrite_dispatch',
  'one_pc_result',
  'raft_apply_one_pc_mvcc',
  'async_prewrite_dispatch',
  'async_prewrite_result',
  'async_commit_background_dispatch',
  'raft_apply_prewrite_mvcc',
  'raft_apply_commit_mvcc',
  'two_pc_prewrite_dispatch',
  'two_pc_prewrite_result',
  'two_pc_primary_commit_dispatch',
  'two_pc_secondary_commit_dispatch',
  'secondary_cleanup_complete',
  'region_split',
  'point_get_recovered',
])

function dynamicKindText(kind: string, locale: Locale): string {
  const words = kind
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
  return locale === 'ja' ? `イベント（${words || 'unknown'}）` : `Event: ${words || 'unknown'}`
}

function dynamicCopy(
  source: TraceEventCopyInput,
  locale: Locale,
  template: EventTemplate,
): TraceEventCopy {
  const kind = source.kind ?? ''
  let label = template.label[locale]
  let detail = template.detail[locale]
  let kindLabel = template.kind?.[locale] ?? label

  if (kind === 'parse_optimize') {
    const statement = token(metadataValue(source, 'statementKind'))
    const statementLabels: Readonly<Record<string, LocalizedText>> = {
      point_read: localized('ポイント読み取りを解析・最適化', 'Parse and optimize a point read'),
      range_read: localized('範囲読み取りを解析・最適化', 'Parse and optimize a range read'),
      aggregate: localized('集約読み取りを解析・最適化', 'Parse and optimize an aggregate read'),
      insert: localized('INSERTのモデル計画を作成', 'Build the INSERT model plan'),
      update: localized('UPDATEのモデル計画を作成', 'Build the UPDATE model plan'),
      delete: localized('DELETEのモデル計画を作成', 'Build the DELETE model plan'),
    }
    if (statement && statementLabels[statement]) {
      label = statementLabels[statement][locale]
      kindLabel = label
    }
  }
  if (kind === 'protocol_selection') {
    const protocol = selectedProtocol(source)
    const text = protocolText(source, locale)
    label = locale === 'ja' ? `${text}を選択` : `Select ${text}`
    kindLabel = locale === 'ja' ? 'commit protocolの選択' : 'Commit-protocol selection'
    if (protocol === '1pc') {
      detail = locale === 'ja'
        ? 'モデルの適格性ルールにより1PCを選択します。'
        : 'The modeled eligibility rules select 1PC.'
    } else if (protocol === 'async_commit') {
      detail = locale === 'ja'
        ? 'クライアントがprewrite前にAsync Commitを選択します。このfixtureではTiKVのruntime fallbackはありません。'
        : 'The client selects Async Commit before prewrite; this fixture has no TiKV runtime fallback.'
    } else if (protocol === '2pc') {
      detail = locale === 'ja'
        ? 'クライアント側でregular 2PCを選択します。最適化のruntime fallbackではありません。'
        : 'The client selects regular 2PC; this is not runtime fallback from an attempted optimization.'
    }
  }
  if (kind === 'protocol_client_request') {
    const lane = laneText(source, locale)
    label = locale === 'ja' ? `${lane} fixtureへのrequestを開始` : `Start the ${lane} fixture`
    kindLabel = locale === 'ja' ? 'protocol request' : 'Protocol request'
  }
  if (kind === 'protocol_start_ts') {
    const lane = laneText(source, locale)
    label = locale === 'ja' ? `PDが${lane} start_tsを割り当て` : `PD allocated ${lane} start_ts`
  }
  if (kind === 'protocol_raft_propose') {
    const op = operationText(source, locale)
    label = locale === 'ja' ? `Region Leaderが${op}をRaftへ提案` : `Region leader proposed ${op}`
    detail = locale === 'ja'
      ? `Region Leaderが${op}をRaftへ提案します。`
      : `The Region leader proposes ${op} to its Raft log.`
  }
  if (kind === 'protocol_raft_commit') {
    const op = operationText(source, locale)
    label = locale === 'ja' ? `Region Raftが${op}をcommit` : `Region Raft committed ${op}`
    detail = locale === 'ja'
      ? `Region Raftが${op}をcommitします。transaction coordinationとは別の層です。`
      : `Region Raft commits ${op}; transaction coordination remains a separate layer.`
  }
  if (kind === 'protocol_client_response') {
    const protocol = selectedProtocol(source)
    if (metadataValue(source, 'committed') === true && protocol === '1pc') {
      label = locale === 'ja'
        ? '1PCがcommit済みをクライアントへ返却'
        : '1PC returned committed'
      detail = locale === 'ja'
        ? 'クライアント応答は1 RegionのRaft apply後に続き、通常のCommit RPCとbackground lock cleanupはありません。'
        : 'The client response follows the one-Region Raft apply; there is no normal Commit RPC or background lock cleanup.'
      kindLabel = locale === 'ja' ? '1PCクライアント応答' : '1PC client response'
    } else if (metadataValue(source, 'committed') === true && protocol === 'async_commit') {
      label = locale === 'ja'
        ? 'Async Commitがcommit済みをクライアントへ返却'
        : 'Async Commit returned committed'
      detail = locale === 'ja'
        ? '論理commitを応答しますが、durableなAsync Commit lockはbackground Commit RPCを待ちます。'
        : 'The logical commit is acknowledged while durable Async Commit locks still await background Commit RPCs.'
      kindLabel = locale === 'ja' ? 'Async Commitクライアント応答' : 'Async Commit client response'
    } else if (metadataValue(source, 'committed') === true && protocol === '2pc') {
      label = locale === 'ja'
        ? 'regular 2PCがprimary commit後に返却'
        : 'Regular 2PC returned after primary commit'
      detail = locale === 'ja'
        ? 'commit済みprimaryがクライアント応答を通し、secondary commitはbackgroundで続きます。'
        : 'The committed primary gates the client response; secondary commit continues in the background.'
      kindLabel = locale === 'ja' ? 'regular 2PCクライアント応答' : 'Regular 2PC client response'
    }
  }
  if (kind === 'protocol_branch_complete') {
    const protocol = selectedProtocol(source)
    if (protocol === '1pc') {
      label = locale === 'ja' ? '1PC fixtureを完了' : '1PC fixture complete'
      detail = locale === 'ja'
        ? '単一Prewrite/TryOnePc経路が完了し、durableなlock CF中間状態はありません。'
        : 'The single Prewrite/TryOnePc path is complete with no durable lock-CF intermediate.'
      kindLabel = locale === 'ja' ? '1PC fixture完了' : '1PC fixture complete'
    } else if (protocol === 'async_commit') {
      label = locale === 'ja' ? 'Async Commitのbackground cleanupを完了' : 'Async Commit background cleanup complete'
      detail = locale === 'ja'
        ? '2つのRegion lockが解放され、2つのwrite CF commit recordが適用されます。'
        : 'Both Region locks are removed and both write-CF commit records are applied.'
      kindLabel = locale === 'ja' ? 'Async Commit fixture完了' : 'Async Commit fixture complete'
    } else if (protocol === '2pc') {
      label = locale === 'ja' ? 'regular 2PCのbackground cleanupを完了' : 'Regular 2PC background cleanup complete'
      detail = locale === 'ja'
        ? 'secondary lockが解放され、そのwrite CF commit recordが適用されます。'
        : 'The secondary lock is removed and its write-CF commit record is applied.'
      kindLabel = locale === 'ja' ? 'regular 2PC fixture完了' : 'Regular 2PC fixture complete'
    }
  }
  if (kind === 'gc_round_start') {
    const round = roundNumber(source)
    if (round === 1) {
      label = locale === 'ja'
        ? 'TiDB GC leaderが第1ラウンドを開始'
        : 'TiDB GC leader started round 1'
      detail = locale === 'ja'
        ? '選出されたTiDB GC leaderが決定論的なv8.5.0 teaching roundを開始します。これはSQL transactionではありません。'
        : 'The elected TiDB GC leader begins a deterministic v8.5.0 teaching round; this is not a SQL transaction.'
    } else if (round === 2) {
      label = locale === 'ja'
        ? 'TiDB GC leaderが第2ラウンドを開始'
        : 'TiDB GC leader started round 2'
      detail = locale === 'ja'
        ? 'blocker完了後の後続ラウンドを開始します。前の不変snapshotは変更されません。'
        : 'A later deterministic run starts after the blocker completes; previous immutable snapshots remain unchanged.'
    }
  }
  if (kind === 'gc_safe_point_candidate') {
    const round = roundNumber(source)
    if (round === 1) {
      label = locale === 'ja'
        ? 'GC lifetimeからsafe point候補を計算'
        : 'Lifetime produced a candidate safe point'
      detail = locale === 'ja'
        ? 'モデルの候補はoracle timeからtidb_gc_life_timeを引いた値です。数値TSO間隔は説明用に伸長されています。'
        : 'The model candidate represents oracle time minus tidb_gc_life_time; numeric TSO spacing is stretched for teaching.'
    } else if (round === 2) {
      label = locale === 'ja'
        ? 'GC lifetimeから次のsafe point候補を計算'
        : 'Lifetime produced the next candidate'
      detail = locale === 'ja'
        ? '候補は第1回公開safe pointより大きく、合成モデルtimestampです。'
        : 'The candidate is greater than the first published safe point and remains a synthetic model timestamp.'
    }
  }
  if (kind === 'gc_service_safe_point') {
    const requested = numberValue(metadataValue(source, 'requestedSafePoint'))
    const minimum = numberValue(metadataValue(source, 'minimumServiceSafePoint'))
    const hasRoundOneBlockerMarker = source.metadata !== undefined &&
      Object.hasOwn(source.metadata, 'externalServiceBlocker')
    const candidateWasCapped = hasRoundOneBlockerMarker ||
      (requested !== null && minimum !== null && requested !== minimum)
    if (requested !== null && minimum !== null && !candidateWasCapped) {
      label = locale === 'ja'
        ? 'PDがservice safe pointの候補を受理'
        : 'PD accepted the candidate service safe point'
      detail = locale === 'ja'
        ? 'GC workerがservice safe pointを登録し、候補がこのroundのsafe pointになります。'
        : 'The GC worker registers its service safe point; with no additional service constraint, the candidate becomes the round safe point.'
    } else if (requested !== null && minimum !== null && candidateWasCapped) {
      label = locale === 'ja'
        ? 'PDがservice safe pointの制限値を受理'
        : 'PD accepted the service safe-point cap'
      detail = locale === 'ja'
        ? 'GC workerがservice safe pointを登録し、active transactionが候補を制限する値を受け入れます。'
        : 'The GC worker registers its service safe point and accepts the value that caps the candidate for the active transaction.'
    }
  }
  if (kind === 'gc_mysql_safe_point_staged') {
    const stagedSafePoint = numberValue(deltaRecord(source, 'gc_safe_point_stage')?.safePoint)
    if (stagedSafePoint !== null) {
      label = locale === 'ja'
        ? 'TiDBがtikv_gc_safe_pointをstaged'
        : 'TiDB staged tikv_gc_safe_point'
      detail = locale === 'ja'
        ? `mysql.tidbのstatus値をsafe point ${stagedSafePoint}としてstagedします。PDのactual global GC pointではありません。`
        : `The human-readable mysql.tidb status value is staged at safe point ${stagedSafePoint}; it is not PD's actual global GC point.`
    }
  }
  if (kind === 'gc_resolve_locks_start' && metadataValue(source, 'unresolvedFixtureLocks') !== undefined) {
    label = locale === 'ja'
      ? 'Region ScanLock解決を第2ラウンドで開始'
      : 'Region ScanLock resolution started round 2'
    detail = locale === 'ja'
      ? '同じ2つの代表Regionをscanします。前のroundではfixture lockが未解決のまま残っていません。'
      : 'The same two representative Regions are scanned; the prior round left no unresolved fixture locks.'
  }
  if (kind === 'gc_resolve_locks_scan') {
    const locksFound = numberValue(metadataValue(source, 'locksFound'))
    if (locksFound === 0) {
      label = locale === 'ja'
        ? 'Regionに古いfixture lockがないことを確認'
        : 'Region scan found no old fixture locks'
      detail = locale === 'ja'
        ? 'この代表Regionに解決対象は残っていませんが、Resolve Locksは引き続き前提処理です。'
        : 'Resolve Locks remains a prerequisite even when this representative Region has nothing left to resolve.'
    } else if (locksFound !== null && locksFound > 0) {
      label = locale === 'ja'
        ? 'Regionから古いlockを検出'
        : 'Region returned an old lock'
      detail = locale === 'ja'
        ? 'GC leaderがsynthetic lockのprimary statusを確認します。key bytesは保持しません。'
        : 'The GC leader checks the primary status before resolving the synthetic lock; no key bytes are retained.'
    }
  }
  if (kind === 'gc_round_complete') {
    const round = roundNumber(source)
    if (round === 1) {
      label = locale === 'ja' ? '第1ラウンドをblocker下で完了' : 'Round 1 completed behind the blocker'
      detail = locale === 'ja'
        ? 'safe pointはstart_ts - 1まで進み、active fixtureが必要なsnapshotを保護します。'
        : 'The safe point advanced only to start_ts - 1. The active fixture still protects its required snapshot.'
    } else if (round === 2) {
      label = locale === 'ja' ? '第2ラウンドを完了' : 'Round 2 completed'
      detail = locale === 'ja'
        ? '第2ラウンドのsafe pointとstorage cleanupが完了します。'
        : 'The second round safe point and storage cleanup complete.'
    }
  }
  if (kind === 'gc_storage_lab_complete') {
    const round = roundNumber(source)
    if (round === 2) {
      label = locale === 'ja' ? 'GC/Storage Labの第2ラウンドを完了' : 'GC/Storage Lab completed round 2'
      detail = locale === 'ja'
        ? '第2のsafe pointがpublishされ、2つの代表storage roundが完了します。Compaction filtering自体はRaft entryを作りません。'
        : 'The second safe point is published and both representative storage rounds have completed. Compaction filtering itself creates no Raft entry.'
    }
  }
  if (kind === 'gc_visibility_safe_point_saved') {
    const savedSafePoint = numberValue(metadataValue(source, 'savedSafePoint'))
    if (savedSafePoint !== null) {
      detail += locale === 'ja'
        ? `（safe point ${savedSafePoint}）`
        : ` (safe point ${savedSafePoint})`
    }
  }
  if (kind === 'gc_global_safe_point_publish') {
    const publishedSafePoint = numberValue(metadataValue(source, 'safePoint'))
    if (publishedSafePoint !== null) {
      detail += locale === 'ja'
        ? `（safe point ${publishedSafePoint}）`
        : ` (safe point ${publishedSafePoint})`
    }
  }
  if (kind === 'gc_compaction_filter_apply') {
    const filtered = numberValue(metadataValue(source, 'filteredVersionsThisRound'))
    const anchors = numberValue(metadataValue(source, 'retainedAnchors'))
    if (filtered !== null && anchors !== null) {
      detail += locale === 'ja'
        ? `（${filtered}件を除去、${anchors}件のsnapshot anchorを保持）`
        : ` (${filtered} versions filtered; ${anchors} snapshot anchors retained.)`
    }
  }
  if (kind === 'gc_compaction_filter_complete') {
    const filtered = numberValue(metadataValue(source, 'totalFilteredVersions'))
    if (filtered !== null) {
      detail += locale === 'ja'
        ? `（累計${filtered}件）`
        : ` (${filtered} versions in total.)`
    }
  }
  if (kind === 'raft_propose') {
    const op = operationText(source, locale)
    label = locale === 'ja' ? `Region Raftへ${op}を提案` : `Propose ${op} to Region Raft`
  }
  if (kind === 'append_entry') {
    const op = operationText(source, locale)
    label = locale === 'ja' ? `${op}のRaft entryを追加` : `Append ${op} Raft entry`
  }
  if (kind === 'quorum_commit') {
    const op = operationText(source, locale)
    label = locale === 'ja' ? `Raft quorumが${op}をcommit` : `Raft quorum committed ${op}`
  }
  if (kind === 'mutation') {
    const op = operationText(source, locale)
    detail = locale === 'ja'
      ? `TiDBがRegion Leaderへ${op}を送信します。`
      : `TiDB sends ${op} to the Region leader.`
  }
  if (kind === 'prewrite') {
    const primary = metadataValue(source, 'primary') === true
    label = locale === 'ja'
      ? `${primary ? 'primary' : 'Region'}へprewriteを送信`
      : `${primary ? 'Dispatch primary' : 'Dispatch'} prewrite`
  }
  if (kind === 'complete' && deltaRecord(source, 'client_response')) {
    label = locale === 'ja' ? 'クライアントへのcommit応答を完了' : 'Primary decision acknowledged to client'
    kindLabel = locale === 'ja' ? 'クライアント応答完了' : 'Client response complete'
    detail = locale === 'ja'
      ? 'primary decisionがdurableになり、secondary cleanupはbackgroundで続きます。'
      : 'The primary decision is durable and secondary cleanup continues in the background.'
  }
  if (kind === 'lock_acquired') {
    const resource = token(metadataValue(source, 'resourceId'))
    if (resource) {
      label = locale === 'ja'
        ? `${resource}のロック所有権を取得`
        : `Acquire lock ownership for ${resource}`
    }
  }
  if (kind === 'lock_wait_enqueued') {
    const resource = token(metadataValue(source, 'resourceId'))
    if (resource) {
      label = locale === 'ja'
        ? `${resource}のロック待機をキューへ追加`
        : `Enqueue a lock wait for ${resource}`
    }
    const waiter = token(metadataValue(source, 'waiterTransactionId'))
    const holder = token(metadataValue(source, 'holderTransactionId'))
    if (resource && waiter && holder) {
      detail = locale === 'ja'
        ? `${resource}で${waiter}から${holder}へのwait-for edgeを登録します。`
        : `A ${waiter}-to-${holder} wait-for edge is registered for ${resource}.`
    }
  }
  if (kind === 'lock_waiter_woken') {
    const resource = token(metadataValue(source, 'resourceId'))
    if (resource) {
      label = locale === 'ja'
        ? `${resource}で待機中のtransactionを起こす`
        : `Wake the waiting transaction for ${resource}`
    }
  }
  if (kind === 'retry_lock_acquired') {
    const resource = token(metadataValue(source, 'resourceId'))
    const order = numberValue(metadataValue(source, 'acquisitionOrder'))
    if (resource && order !== null) {
      label = locale === 'ja'
        ? `retryが${resource}を${order}番目に取得`
        : `Retry acquired ${resource} (${order}${order === 1 ? 'st' : order === 2 ? 'nd' : 'th'})`
    }
  }
  if (kind === 'application_retry_backoff') {
    const backoff = numberValue(metadataValue(source, 'fixedBackoffMs'))
    if (backoff !== null) {
      detail = locale === 'ja'
        ? `アプリケーションが新しいtransactionの前に${backoff} msの固定backoffを待ちます。`
        : `The application waits a representative ${backoff} ms before starting a new whole transaction.`
    }
  }
  if (kind === 'deadlock_detected') {
    const cycleLength = numberValue(metadataValue(source, 'cycleLength'))
    if (cycleLength !== null) {
      detail = locale === 'ja'
        ? `wait-for graphに${cycleLength}つのtransactionからなるdeadlock cycleが見つかりました。`
        : `The wait-for graph contains a ${cycleLength}-transaction deadlock cycle.`
    }
  }
  if (kind === 'one_phase_commit') {
    const protocol = metadataValue(source, 'commitTs') !== undefined
    if (protocol) {
      detail = locale === 'ja'
        ? '単一Regionがmutationとcommit状態を1つのRaft entryで永続化します。'
        : 'A single Region persists the mutation and commit state in one Raft entry.'
    }
  }
  if (
    kind.startsWith('raft_') ||
    kind.startsWith('region_request_') ||
    kind.startsWith('gc_') ||
    kind.startsWith('tiflash_') ||
    kind.startsWith('lock_') ||
    kind.startsWith('deadlock_') ||
    kind === 'pessimistic_lock' ||
    kind === 'prewrite' ||
    kind === 'commit_primary' ||
    kind === 'commit_secondary' ||
    kind === 'mvcc_prewrite' ||
    kind === 'mvcc_primary_commit' ||
    kind === 'mvcc_secondary_commit' ||
    kind === 'mutation' ||
    kind === 'quorum_commit' ||
    kind === 'raft_apply' ||
    kind === 'raft_propose' ||
    kind === 'append_entry' ||
    REGION_SCOPED_EVENT_KINDS.has(kind)
  ) {
    detail += dynamicRegionSuffix(source, locale)
  }
  if (kind === 'tiflash_hash_exchange_send') {
    label += dynamicTunnelSuffix(source, locale)
  }
  if (
    kind.startsWith('lock_') ||
    kind.startsWith('deadlock_') ||
    kind.startsWith('application_retry') ||
    kind === 'retry_lock_acquired' ||
    kind === 'commit_handoff' ||
    kind === 'commit_summary' ||
    kind === 'lock_release_after_commit' ||
    (kind === 'complete' && deltaRecord(source, 'client_response') !== null)
  ) {
    detail += dynamicTransactionSuffix(source, locale)
  }
  if (kind === 'protocol_raft_propose' || kind === 'protocol_raft_commit') {
    detail += dynamicRegionSuffix(source, locale)
  }
  return { label, detail, kind: kindLabel }
}

export function traceEventCopy(
  source: TraceEventCopyInput,
  locale: Locale,
): TraceEventCopy {
  const kind = token(source.kind) ?? ''
  const template = Object.hasOwn(EVENT_CATALOG, kind)
    ? EVENT_CATALOG[kind]
    : undefined
  if (template) return dynamicCopy(source, locale, template)

  /* Unknown kinds keep their specific stable name, but never trust a raw
     model label/detail. This preserves meaning without leaking free-form SQL
     or turning arbitrary input into a UI dictionary entry. */
  const fallbackKind = dynamicKindText(kind || 'event', locale)
  return {
    label: fallbackKind,
    detail: locale === 'ja'
      ? 'このイベントは安定したkind名から表示されます。入力値やSQL本文は表示しません。'
      : 'This event is rendered from its stable kind name; input values and SQL text are not shown.',
    kind: fallbackKind,
  }
}

export const getTraceEventCopy = traceEventCopy
export const eventCopy = traceEventCopy

const DOMAIN_LABELS: Readonly<Record<Locale, Readonly<Record<TraceDomain, string>>>> = {
  ja: {
    client: 'クライアント',
    sql: 'SQL',
    tso: 'TSO / PD',
    txn2pc: 'トランザクション 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
    return: '応答',
  },
  en: {
    client: 'CLIENT',
    sql: 'SQL',
    tso: 'TSO / PD',
    txn2pc: 'Transaction 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
    return: 'RETURN',
  },
}

export function traceDomainLabel(locale: Locale, domain: TraceDomain): string {
  return DOMAIN_LABELS[locale][domain]
}

export function traceEndpointLabel(
  locale: Locale,
  rawValue: string | undefined,
  source: Pick<TraceEventCopyInput, 'regionId'> = {},
): string {
  if (!rawValue) return '—'
  const raw = rawValue.trim().toLowerCase()
  const clientBranch = /^client[-._]([a-z0-9]+)$/i.exec(raw)
  if (clientBranch) {
    return locale === 'ja'
      ? `クライアント ${clientBranch[1].toUpperCase()}`
      : `CLIENT ${clientBranch[1].toUpperCase()}`
  }
  if (
    raw === 'client' ||
    raw === 'clients' ||
    raw === 'application' ||
    raw === 'client-terminal'
  ) {
    return locale === 'ja' ? 'クライアント' : 'CLIENTS'
  }
  if (raw === 'pd' || raw === 'tso' || /^pd[-._]?\d*$/.test(raw)) return 'PD / TSO'
  if (raw === 'gc' || raw === 'gc-worker' || raw === 'safe-point') return 'MVCC GC'
  const tiflashStore = /^tiflash[-._]?([12])$/.exec(raw)
  if (tiflashStore) return `TiFlash Store ${tiflashStore[1]}`
  if (raw === 'tiflash' || raw === 'mpp' || /^tiflash[-._]?\d*$/.test(raw)) {
    return 'TiFlash / MPP'
  }

  const numbered = (
    pattern: RegExp,
    label: string,
    includeRegion = false,
  ): string | null => {
    const match = raw.match(pattern)
    if (!match) return null
    const number = match[1] || '1'
    const region = includeRegion && source.regionId !== undefined
      ? ` · Region ${source.regionId}`
      : ''
    return `${label} ${number}${region}`
  }
  return (
    numbered(/^tiproxy[-._]?(\d+)?$/, 'TiProxy') ??
    numbered(/^tidb[-._]?(\d+)?$/, 'TiDB') ??
    numbered(/^tikv[-._]?(\d+)?$/, 'TiKV', true) ??
    (raw.startsWith('region') && source.regionId !== undefined
      ? `Region ${source.regionId}`
      : rawValue)
  )
}

export const TRACE_EVENT_KINDS = Object.freeze(Object.keys(EVENT_CATALOG))
