// SPDX-License-Identifier: Apache-2.0

import type {
  TraceDomain,
  TraceEvent,
  TraceGcLabPhase,
  TraceGcLabSnapshot,
  TraceLockLabSnapshot,
  TraceProtocolLaneId,
  TraceProtocolLaneSnapshot,
  TraceProtocolLabSnapshot,
  TraceProtocolRegionSnapshot,
  TraceRaftLabPeerSnapshot,
  TraceRaftLabSnapshot,
  TraceReceipt,
  TraceStateSnapshot,
  TraceTiFlashMppLabSnapshot,
} from '../model/types'
import { CATALOG, resolveLocale, type Locale } from '../ui/catalog'
import { element, svgElement } from '../ui/dom'
import { createModelBadge } from '../ui/legal'
import { installCityUiStyles } from '../ui/styles'
import { installMachineStyles } from './styles'

export {
  MACHINE_PAGE_COPY,
  MACHINE_SCENARIOS,
  resolveMachineScenario,
} from './catalog'
export { MACHINE_CSS, installMachineStyles } from './styles'

export const MACHINE_LANES = ['sql', 'tso', 'txn2pc', 'raft', 'kv', 'tiflash'] as const
export type MachineLane = (typeof MACHINE_LANES)[number]

export interface MachineEvent {
  id: string
  atMs: number
  durationMs: number
  domain: MachineLane
  /** Canonical model event kind, retained independently from its visible label. */
  kind?: string
  label: string
  detail: string
  source?: string
  target?: string
  status?: string
  /** Explicit causal parents. Legacy receipts fall back to the prior event. */
  dependsOn?: readonly string[]
  /** False marks work that continues after the client critical path. */
  criticalPath?: boolean
  regionId?: number
  transactionId?: string
  /** Stable parallel-branch identity from the canonical receipt. */
  branchId?: string
  /** The exact immutable post-event model projection; never reconstructed here. */
  snapshot?: TraceStateSnapshot
}

export interface MachineReceipt {
  id: string
  events: readonly MachineEvent[]
}

export interface MachineOptions {
  receipt: TraceReceipt | MachineReceipt | unknown
  locale?: Locale
  search?: string
  initialIndex?: number
  /** Preferred cursor contract. Resolved after receipt adaptation. */
  initialEventId?: string
  stepIntervalMs?: number
  autoplay?: boolean
  adaptReceipt?: (receipt: unknown) => MachineReceipt
  onSeek?: (event: MachineEvent | null, index: number) => void
}

const LANE_LABELS: Record<Locale, Record<MachineLane, string>> = {
  ja: {
    sql: 'SQL / Client',
    tso: 'TSO',
    txn2pc: 'Transaction commit',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
  },
  en: {
    sql: 'SQL / Client',
    tso: 'TSO',
    txn2pc: 'Transaction commit',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
  },
}

const LANE_CODES: Record<MachineLane, string> = {
  sql: 'SQL',
  tso: 'TSO',
  txn2pc: 'TXN',
  raft: 'RAFT',
  kv: 'KV',
  tiflash: 'MPP',
}

const MACHINE_COPY = {
  ja: {
    eyebrow: 'TRACE REPLAY / 6 LAYERS',
    summary: 'トレース再生の概要',
    step: '段階',
    modelTime: 'モデル時刻',
    activeLayer: '現在の層',
    timeWindow: '時間幅',
    progress: 'トレース再生位置',
    duration: '継続時間',
    route: '経路',
    current: '現在のイベント',
    eventKind: 'イベント種別',
    branch: '並列ブランチ',
    lockEyebrow: 'LOCK LAB / SEMANTIC STATE',
    lockTitle: 'ロック待機とデッドロック',
    waitGraph: 'Wait-for グラフ',
    waitDirection: '矢印は待機者 → 現在の保持者です。上の因果 DAG とは別の意味グラフです。',
    noWaitEdges: '現在の wait-for edge はありません。',
    resource: '合成リソース',
    waiter: '待機者',
    holder: '保持者',
    detector: 'デッドロック検出器',
    detectorScope: 'クラスタ全体',
    detectorLeader: '検出器 leader',
    deadlock: 'デッドロック判定',
    noDeadlock: 'この時点ではデッドロックは検出されていません。',
    cycle: '循環',
    victim: 'victim',
    pending: '未選択',
    modelPolicy: 'MODEL POLICY：循環を閉じた待機者を決定論的に選択',
    retryableFalse: 'RETRYABLE=false（このトランザクション全体を終了）',
    applicationRetry: 'アプリケーション再試行',
    noApplicationRetry: 'アプリケーション再試行はまだ予定されていません。',
    retrySource: 'TiDB 内部再試行ではなくアプリケーション',
    retryOf: '再試行元',
    newTransaction: '新しい transaction',
    fixedBackoff: '固定 teaching backoff',
    raftEyebrow: 'RAFT FAILURE LAB / SEMANTIC STATE',
    raftTitle: 'Region Raft選出と内部retry',
    raftPhase: 'Raft Labフェーズ',
    raftGraph: 'Pre-Vote / Vote グラフ',
    raftGraphDirection: '矢印は投票するvoter → 候補です。この選出意味グラフは上の因果 DAG とは別です。',
    raftGraphContract: 'PRE-VOTE / VOTE · 2-OF-3',
    region: 'Region',
    electionState: '選出状態',
    candidate: '候補',
    preVote: 'Pre-Vote',
    enabled: '有効',
    oldToNewLeader: 'Leader遷移',
    noLeader: 'Leader不在',
    failedStore: '障害Store',
    liveVoters: '稼働voter',
    electionQuorum: '選出quorum',
    twoOfThree: '3 voter中2（2-of-3）',
    grant: '獲得',
    noGrants: 'この時点では獲得票はありません。',
    voter: '投票者',
    peerStates: '3 voter peer状態',
    raftRole: 'Raft role',
    health: 'Health',
    healthy: '稼働',
    down: '停止',
    currentTerm: 'current term',
    votedFor: '投票先',
    lastLog: 'last log index / term',
    matchIndex: 'match index',
    commitIndex: 'commit index',
    appliedIndex: 'apply index',
    electionPolicy: '候補とtiming',
    candidatePolicy: '候補決定',
    candidatePolicyValue: '稼働中でlogが最新のStore ID最小',
    configuredWindow: '設定上のtimeout範囲',
    elapsedTicks: 'この断面の経過',
    ticks: 'ticks',
    deterministicPolicy: '候補と正確なtick進行は決定的なTiCity MODEL POLICYです。TiDB/TiKVの実運用結果を保証しません。',
    postElectionLog: '選出後log',
    logEntry: 'Entry',
    noEntry: 'まだありません',
    persistedStores: '永続化Store',
    committed: 'Commit済み',
    appliedStores: 'Apply済みStore',
    yes: 'はい',
    no: 'いいえ',
    pdBoundary: 'PDの境界',
    pdRole: 'PD role',
    pdObserveRouteOnly: '監視とroute metadataのみ',
    observedLeader: '観測Leader',
    routeLookup: 'route lookup',
    pdDoesNotVote: 'PDはLeader情報を観測してrouteを支援しますが、候補選択・Pre-Vote・Vote・Leader選出は行いません。',
    tidbRetry: 'TiDB内部request retry',
    logicalRequest: 'Logical request',
    raftRetrySource: '再試行元',
    tidbInternal: 'TiDB内部',
    retryAttempt: '内部試行',
    cachedLeader: 'cache上のLeader',
    cacheState: 'Leader cache',
    requestState: 'Request状態',
    internalBackoff: '内部backoff',
    clientVisibleError: 'client-visible error',
    clientBoundary: 'Client境界',
    clientPending: '応答待ち（エラー未返却）',
    clientSuccess: '成功（エラーなし）',
    sameLogicalRetry: '同じlogical requestに対するTiDB内部retryです。アプリケーションretryではありません。',
    completeValue: '完了',
    incompleteValue: '未完了',
    protocolEyebrow: 'PROTOCOL LAB / EXACT SNAPSHOT',
    protocolTitle: '1PC / Async Commit / regular 2PC',
    protocolPhase: 'Protocol Labフェーズ',
    protocolFocus: '注目レーン',
    protocolGraph: 'Commit protocol比較グラフ',
    protocolGraphDirection: '宣言済みfixture profile / outcomeは比較開始時から固定表示します。stage、timestamp、Region、client境界、cleanupは選択したexact event時点です。この意味グラフは上の因果DAGとは別です。',
    protocolGraphContract: '3 INDEPENDENT TXNS · EXACT SNAPSHOT',
    protocolMatrix: '3プロトコルの現在状態',
    protocolLane: 'プロトコル',
    transactionStage: 'Exact-event transaction段階',
    transactionId: 'Transaction',
    requestId: 'Request',
    eligibility: '宣言済みfixture profile / outcome（固定）',
    profileNode: '宣言済みprofile',
    profileVisibility: '比較開始時から表示',
    timestampProvenance: 'Exact-event timestampと由来',
    regionState: 'Exact-event Region Raft / MVCC',
    clientResponse: 'Client応答',
    exactClientResponse: 'Exact-event client応答',
    cleanup: 'Cleanup',
    exactCleanup: 'Exact-event cleanup',
    criticalPath: 'Client critical path',
    backgroundPath: '応答後のbackground',
    futurePath: '未到達',
    currentPath: '進行中',
    completePath: '通過済み',
    selectedProtocol: '宣言済みprotocol outcome',
    selectionReason: '宣言済みoutcomeの根拠',
    enabledFlags: '宣言済み機能フラグ',
    onePcEligible: '宣言済み1PC eligibility',
    asyncEligible: '宣言済みAsync Commit eligibility',
    mutationProfile: '集約mutation',
    totalKeyBytes: '合計key bytes',
    limits: '宣言済みAsync既定上限',
    decisionPoint: '宣言済み判定点',
    tryOnePc: '宣言済みTryOnePc request flag',
    onePcRejectedBeforeRpc: '宣言済み1PC RPC前除外',
    asyncRejectedAtPrecheck: '宣言済みAsync client事前除外',
    runtimeFallback: '宣言済みruntime fallback outcome',
    consistency: '整合性',
    linearizable: 'linearizable（既定）',
    startTs: 'start_ts',
    latestTs: 'latest_ts',
    requestMinCommitTs: 'request min_commit_ts',
    maxCommitTs: 'max_commit_ts',
    commitTs: 'commit_ts',
    timestampSource: '由来',
    notAllocated: '未割り当て',
    notApplicable: '非該当',
    notUsedByProtocol: 'このprotocolでは使用しません',
    leader: 'Leader',
    role: '役割',
    primary: 'primary',
    secondary: 'secondary',
    mutations: 'mutations',
    raftOperation: 'Raft entry',
    raftProgress: 'Raft進行',
    raftQuorum: 'Region quorum',
    persisted: '永続化',
    acknowledgements: 'acknowledgements',
    mvccDefault: 'default CF',
    mvccLock: 'lock CF',
    mvccWrite: 'write CF',
    returnedMinCommitTs: '返却 min_commit_ts',
    asyncMetadata: 'Async lock metadata',
    secondaryCount: 'secondary数',
    responsePending: '応答待ち',
    responseSent: 'commit済みを応答',
    cleanupPending: '未完了',
    cleanupDone: '完了',
    cleanupNotRequired: '不要（background cleanupなし）',
    focusNone: 'なし（全レーン完了）',
    runningValue: '進行中',
    idleValue: '待機',
    deterministicBackground: 'client応答後の決定的な表示順（TiCity MODEL POLICY）',
    aggregateOnly: '集約件数のみ。SQL literal、key/value、結果行は保持しません。',
    eligibilityCaveat: 'この固定fixtureはfeature flag、mutation件数、key bytes、Region batchingをまとめて判定します。Region数だけで一般的なAsync Commit適格性は決まりません。',
    transactionRaftBoundary: 'Transaction commitはTiDBの原子的commit調整です。各RegionのRaftは別々に2-of-3 quorumを確立します。1PCとAsync CommitはRaft modeではありません。',
    nonBenchmark: 'MODEL / SIMULATED：3件は独立した代表transactionです。横方向は意味上の段階であり、protocol間のlatency benchmarkではありません。',
    responseBoundaryNote: 'Client応答はcommit成立後です。Async Commitとregular 2PCのlock cleanupは応答後も続きます。',
    protocolAccessibleMirror: '宣言済みprofile / outcomeとexact-event状態のアクセシブルな比較',
    selectOnePc: '1PCを選択',
    selectAsync: 'Async Commitを選択',
    selectTwoPc: 'regular 2PCを選択',
    fetchLatestTs: 'latest_tsと安全上限',
    onePcCommit: '1回のPrewriteでcommit',
    prewriteRegions: '全RegionをPrewrite',
    establishAsyncCommit: 'Async commit_tsを確定',
    fetchCommitTs: 'PD commit_ts',
    commitPrimary: 'primaryをcommit',
    returnClient: 'clientへcommit応答',
    backgroundCommit: 'background Commit',
    finishLane: 'cleanup不要で完了',
    empty: '—',
  },
  en: {
    eyebrow: 'TRACE REPLAY / 6 LAYERS',
    summary: 'Trace replay overview',
    step: 'Step',
    modelTime: 'Model time',
    activeLayer: 'Active layer',
    timeWindow: 'Time window',
    progress: 'Trace replay position',
    duration: 'Duration',
    route: 'Route',
    current: 'Current event',
    eventKind: 'Event kind',
    branch: 'Parallel branch',
    lockEyebrow: 'LOCK LAB / SEMANTIC STATE',
    lockTitle: 'Lock waits and deadlock',
    waitGraph: 'Wait-for graph',
    waitDirection: 'Arrows run waiter → current holder. This semantic graph is separate from the causal DAG above.',
    noWaitEdges: 'There are no active wait-for edges at this event.',
    resource: 'Synthetic resource',
    waiter: 'Waiter',
    holder: 'Holder',
    detector: 'Deadlock detector',
    detectorScope: 'Cluster-wide',
    detectorLeader: 'Detector leader',
    deadlock: 'Deadlock decision',
    noDeadlock: 'No deadlock has been detected at this event.',
    cycle: 'Cycle',
    victim: 'Victim',
    pending: 'Pending',
    modelPolicy: 'MODEL POLICY: deterministically select the cycle-closing waiter',
    retryableFalse: 'RETRYABLE=false (end this whole transaction)',
    applicationRetry: 'Application retry',
    noApplicationRetry: 'No application retry has been scheduled yet.',
    retrySource: 'Application, not an internal TiDB retry',
    retryOf: 'Retry of',
    newTransaction: 'New transaction',
    fixedBackoff: 'Fixed teaching backoff',
    raftEyebrow: 'RAFT FAILURE LAB / SEMANTIC STATE',
    raftTitle: 'Region Raft election and internal retry',
    raftPhase: 'Raft Lab phase',
    raftGraph: 'Pre-Vote / Vote graph',
    raftGraphDirection: 'Arrows run granting voter → candidate. This election semantic graph is separate from the causal DAG above.',
    raftGraphContract: 'PRE-VOTE / VOTE · 2-OF-3',
    region: 'Region',
    electionState: 'Election state',
    candidate: 'Candidate',
    preVote: 'Pre-Vote',
    enabled: 'Enabled',
    oldToNewLeader: 'Leader transition',
    noLeader: 'No leader',
    failedStore: 'Failed store',
    liveVoters: 'Live voters',
    electionQuorum: 'Election quorum',
    twoOfThree: '2 of 3 voters (2-of-3)',
    grant: 'Granted',
    noGrants: 'No votes have been granted at this event.',
    voter: 'Voter',
    peerStates: 'Three voter peer states',
    raftRole: 'Raft role',
    health: 'Health',
    healthy: 'Healthy',
    down: 'Down',
    currentTerm: 'Current term',
    votedFor: 'Voted for',
    lastLog: 'Last log index / term',
    matchIndex: 'Match index',
    commitIndex: 'Commit index',
    appliedIndex: 'Apply index',
    electionPolicy: 'Candidate and timing',
    candidatePolicy: 'Candidate selection',
    candidatePolicyValue: 'Lowest live, up-to-date Store ID',
    configuredWindow: 'Configured timeout window',
    elapsedTicks: 'Elapsed at this snapshot',
    ticks: 'ticks',
    deterministicPolicy: 'The exact candidate and tick progression are deterministic TiCity MODEL POLICY, not a TiDB/TiKV production guarantee.',
    postElectionLog: 'Post-election log',
    logEntry: 'Entry',
    noEntry: 'Not present yet',
    persistedStores: 'Persisted stores',
    committed: 'Committed',
    appliedStores: 'Applied stores',
    yes: 'Yes',
    no: 'No',
    pdBoundary: 'PD boundary',
    pdRole: 'PD role',
    pdObserveRouteOnly: 'Observe and route metadata only',
    observedLeader: 'Observed leader',
    routeLookup: 'Route lookup',
    pdDoesNotVote: 'PD observes leader metadata and assists routing; it does not choose a candidate, grant Pre-Votes or Votes, or elect the leader.',
    tidbRetry: 'TiDB internal request retry',
    logicalRequest: 'Logical request',
    raftRetrySource: 'Retry source',
    tidbInternal: 'TiDB internal',
    retryAttempt: 'Internal attempt',
    cachedLeader: 'Cached leader',
    cacheState: 'Leader cache',
    requestState: 'Request state',
    internalBackoff: 'Internal backoff',
    clientVisibleError: 'Client-visible error',
    clientBoundary: 'Client boundary',
    clientPending: 'Response pending; no error returned',
    clientSuccess: 'Succeeded with no error',
    sameLogicalRetry: 'This is a TiDB internal retry of the same logical request, not an application retry.',
    completeValue: 'Complete',
    incompleteValue: 'Incomplete',
    protocolEyebrow: 'PROTOCOL LAB / EXACT SNAPSHOT',
    protocolTitle: '1PC / Async Commit / regular 2PC',
    protocolPhase: 'Protocol Lab phase',
    protocolFocus: 'Focused lane',
    protocolGraph: 'Commit protocol comparison graph',
    protocolGraphDirection: 'Declared fixture profiles and outcomes are fixed from comparison start. Stage, timestamps, Regions, the client boundary, and cleanup reflect the selected exact event. This semantic graph is separate from the causal DAG above.',
    protocolGraphContract: '3 INDEPENDENT TXNS · EXACT SNAPSHOT',
    protocolMatrix: 'Current state of three protocols',
    protocolLane: 'Protocol',
    transactionStage: 'Exact-event transaction stage',
    transactionId: 'Transaction',
    requestId: 'Request',
    eligibility: 'Declared fixture profile / outcome (static)',
    profileNode: 'Declared profile',
    profileVisibility: 'Visible from comparison start',
    timestampProvenance: 'Exact-event timestamps and provenance',
    regionState: 'Exact-event Region Raft / MVCC',
    clientResponse: 'Client response',
    exactClientResponse: 'Exact-event client response',
    cleanup: 'Cleanup',
    exactCleanup: 'Exact-event cleanup',
    criticalPath: 'Client critical path',
    backgroundPath: 'Post-response background',
    futurePath: 'Not reached',
    currentPath: 'In progress',
    completePath: 'Passed',
    selectedProtocol: 'Declared protocol outcome',
    selectionReason: 'Declared outcome rationale',
    enabledFlags: 'Declared feature flags',
    onePcEligible: 'Declared 1PC eligibility',
    asyncEligible: 'Declared Async Commit eligibility',
    mutationProfile: 'Aggregate mutations',
    totalKeyBytes: 'Total key bytes',
    limits: 'Declared Async default limits',
    decisionPoint: 'Declared decision points',
    tryOnePc: 'Declared TryOnePc request flag',
    onePcRejectedBeforeRpc: 'Declared pre-RPC 1PC exclusion',
    asyncRejectedAtPrecheck: 'Declared Async client-precheck exclusion',
    runtimeFallback: 'Declared runtime-fallback outcome',
    consistency: 'Consistency',
    linearizable: 'Linearizable (default)',
    startTs: 'start_ts',
    latestTs: 'latest_ts',
    requestMinCommitTs: 'request min_commit_ts',
    maxCommitTs: 'max_commit_ts',
    commitTs: 'commit_ts',
    timestampSource: 'Source',
    notAllocated: 'Not allocated',
    notApplicable: 'Not applicable',
    notUsedByProtocol: 'Not used by this protocol',
    leader: 'Leader',
    role: 'Role',
    primary: 'Primary',
    secondary: 'Secondary',
    mutations: 'mutations',
    raftOperation: 'Raft entry',
    raftProgress: 'Raft progress',
    raftQuorum: 'Region quorum',
    persisted: 'Persisted',
    acknowledgements: 'acknowledgements',
    mvccDefault: 'default CF',
    mvccLock: 'lock CF',
    mvccWrite: 'write CF',
    returnedMinCommitTs: 'Returned min_commit_ts',
    asyncMetadata: 'Async lock metadata',
    secondaryCount: 'Secondaries',
    responsePending: 'Response pending',
    responseSent: 'Committed response sent',
    cleanupPending: 'Incomplete',
    cleanupDone: 'Complete',
    cleanupNotRequired: 'Not required (no background cleanup)',
    focusNone: 'None (all lanes complete)',
    runningValue: 'Running',
    idleValue: 'Idle',
    deterministicBackground: 'Deterministic display order after the client response (TiCity MODEL POLICY)',
    aggregateOnly: 'Aggregate counts only; no SQL literals, keys, values, or result rows are retained.',
    eligibilityCaveat: 'This fixed fixture evaluates feature flags, mutation count, key bytes, and Region batching together. Region count alone does not establish general Async Commit eligibility.',
    transactionRaftBoundary: 'Transaction commit is TiDB atomic commit coordination. Each Region separately establishes its own 2-of-3 Raft quorum. 1PC and Async Commit are not Raft modes.',
    nonBenchmark: 'MODEL / SIMULATED: these are three independent representative transactions. Horizontal position is a semantic stage, not a latency benchmark between protocols.',
    responseBoundaryNote: 'The client responds after commit is established. Async Commit and regular 2PC lock cleanup can continue after that boundary.',
    protocolAccessibleMirror: 'Accessible comparison of declared profiles / outcomes and exact-event state',
    selectOnePc: 'Select 1PC',
    selectAsync: 'Select Async Commit',
    selectTwoPc: 'Select regular 2PC',
    fetchLatestTs: 'latest_ts and safe bound',
    onePcCommit: 'Commit in one Prewrite',
    prewriteRegions: 'Prewrite every Region',
    establishAsyncCommit: 'Establish Async commit_ts',
    fetchCommitTs: 'PD commit_ts',
    commitPrimary: 'Commit primary',
    returnClient: 'Return committed to client',
    backgroundCommit: 'Background Commit',
    finishLane: 'Complete without cleanup',
    empty: '—',
  },
} as const

type GcPipelineStage =
  | 'candidate'
  | 'bound'
  | 'mysql_staged'
  | 'resolve_locks'
  | 'visibility_saved'
  | 'delete_range'
  | 'pd_published'
  | 'tikv_detected'
  | 'compaction_filter'

type GcPipelineState = 'complete' | 'current' | 'future'

const GC_PIPELINE_STAGES: readonly GcPipelineStage[] = [
  'candidate',
  'bound',
  'mysql_staged',
  'resolve_locks',
  'visibility_saved',
  'delete_range',
  'pd_published',
  'tikv_detected',
  'compaction_filter',
]

const GC_MACHINE_COPY = {
  ja: {
    eyebrow: 'GC / STORAGE LAB · EXACT SNAPSHOT',
    title: '2ラウンドのGCと物理storage',
    phase: 'フェーズ',
    round: 'ラウンド',
    snapshot: 'スナップショット',
    graphTitle: 'GC coordinator → TiKV storage pipeline',
    graphContract: '2 ROUNDS · EXACT EVENT',
    graphDirection:
      '各行は選択中のimmutable snapshotから導いた意味上のpipelineです。上の因果DAGを置換せず、並列Storeを直列化しません。',
    stages: {
      candidate: 'life time候補',
      bound: 'minStartTS - 1 / service bound',
      mysql_staged: 'mysql.tidbへstage',
      resolve_locks: 'Resolve ScanLock',
      visibility_saved: 'visibility保存 / cache barrier',
      delete_range: 'UnsafeDestroyRange',
      pd_published: 'PD global公開',
      tikv_detected: '各TiKVが観測',
      compaction_filter: 'Compaction Filter',
    },
    states: {
      complete: '完了',
      current: '現在',
      future: '未到達',
    },
    priorRound: '以前のimmutable snapshotで完了',
    futureRound: 'このラウンドは未開始',
    pending: '未確定',
    candidate: '候補safe point',
    previous: '前回safe point',
    globalMinStartTs: 'global min start_ts',
    activeBound: 'active transaction上限',
    serviceBound: 'service safe point',
    blocked: '長時間transactionで制限',
    blocker: 'blocker',
    active: 'active',
    completed: '完了',
    yes: 'はい',
    no: 'いいえ',
    scanned: '走査済みRegion',
    detected: '観測済みStore',
    compacted: '完了Store filter',
    safePointStores: '3つのsafe-point保存境界',
    safePointStoresNote:
      'mysql.tidbの表示値、TiDB内のvisibility/cache値、PDのglobal値は別の保存・公開境界です。',
    mysqlStatus: 'mysql.tidb status',
    visibilityCache: 'TiDB visibility / cache barrier',
    pdGlobal: 'PD global GC safe point',
    leaderLease: 'GC leader lease',
    cacheBarrier: 'cache barrier',
    stagedValue: 'staged',
    savedValue: 'saved',
    publishedValue: 'published',
    resolveTitle: 'Resolve Locks / ScanLock',
    resolveImplementation: '実装',
    resolveRegions: '走査Region',
    noRegions: 'まだ走査していません',
    resolvedLocks: '合成lock',
    noLocks: '対象lockなし',
    committedPrimary: 'primary committed → commit解決',
    rolledBackPrimary: 'primary rolled back → rollback解決',
    pendingLock: '未解決',
    resolveBoundary:
      'ResolveLockは通常のTiKV write commandですが、そのRaft entry詳細はこのGC sliceの範囲外です。',
    deleteTitle: 'classic raftstore-v1 Delete Range fan-out',
    deleteNote:
      'UnsafeDestroyRangeは各Storeへ直接fan-outし、Region Raftを経由しません。個別ackはsnapshotに保持せず、集約range状態だけを投影します。',
    rangeState: '集約range状態',
    unsafeDestroy: 'UnsafeDestroyRange',
    ackNotProjected: '個別ack未投影',
    aggregateComplete: '集約完了',
    storeTitle: 'TiKV safe-point detector / filter',
    detectedSafePoint: '観測safe point',
    compaction: 'Compaction',
    filterActive: 'filter稼働',
    storageTitle: '論理MVCC chains（1回だけ集計）',
    storageNote:
      '論理chainを3 replica分へ乗算しません。合成IDと件数だけを表示し、実key・encoded key・value・SQL literalは保持しません。',
    initialVersions: '初期version',
    filteredVersions: 'filter済み',
    putAnchors: '保持Put anchor',
    deleteChains: 'Deleteで旧chainを除去',
    defaultDeletes: '長いDEFAULT CF value削除',
    none: 'なし',
    region: 'Region',
    writeType: 'Write',
    valueStorage: 'CF',
    versionState: '状態',
    present: '残存',
    retainedAnchor: 'Put anchor保持',
    filtered: 'filter済み',
    boundaries: '仕組みの境界',
    compactionBoundary:
      'Compaction FilterはRocksDB compaction中のno-Raft物理storage処理で、Raft entryを作りません。',
    separateBoundary:
      'MVCC GC、Delete Range、物理compaction、Raft log GCは別の仕組みです。表示件数はdisk byte量やlatency benchmarkではありません。',
    privacy:
      'PRIVACY: SQL文、literal、実key/value、結果行は保存・表示しません。',
    phaseNames: {
      idle: '待機',
      preparing: '候補とbound',
      safe_point_bounded: 'mysql stage',
      resolving_locks: 'Resolve Locks',
      caching_safe_point: 'visibility / cache barrier',
      deleting_ranges: 'Delete Ranges',
      publishing_safe_point: 'PD公開',
      tikv_observing: 'TiKV観測',
      compacting: 'Compaction Filter',
      between_rounds: 'ラウンド間',
      complete: '完了',
    },
    compactionStates: {
      idle: '待機',
      eligible: '対象',
      running: '実行中',
      complete: '完了',
    },
    deleteStates: {
      pending: '待機',
      eligible: '対象',
      deleted: '削除済み',
    },
  },
  en: {
    eyebrow: 'GC / STORAGE LAB · EXACT SNAPSHOT',
    title: 'Two GC rounds and physical storage',
    phase: 'Phase',
    round: 'Round',
    snapshot: 'Snapshot',
    graphTitle: 'GC coordinator → TiKV storage pipeline',
    graphContract: '2 ROUNDS · EXACT EVENT',
    graphDirection:
      'Each row is a semantic pipeline derived from the selected immutable snapshot. It does not replace the causal DAG above or serialize parallel Stores.',
    stages: {
      candidate: 'life-time candidate',
      bound: 'minStartTS - 1 / service bound',
      mysql_staged: 'stage in mysql.tidb',
      resolve_locks: 'Resolve ScanLock',
      visibility_saved: 'visibility save / cache barrier',
      delete_range: 'UnsafeDestroyRange',
      pd_published: 'publish global to PD',
      tikv_detected: 'each TiKV detects',
      compaction_filter: 'Compaction Filter',
    },
    states: {
      complete: 'Complete',
      current: 'Current',
      future: 'Not reached',
    },
    priorRound: 'Completed in prior immutable snapshots',
    futureRound: 'This round has not started',
    pending: 'Pending',
    candidate: 'Candidate safe point',
    previous: 'Previous safe point',
    globalMinStartTs: 'Global min start_ts',
    activeBound: 'Active transaction bound',
    serviceBound: 'Service safe point',
    blocked: 'Bounded by long transaction',
    blocker: 'Blocker',
    active: 'Active',
    completed: 'Complete',
    yes: 'Yes',
    no: 'No',
    scanned: 'Scanned Regions',
    detected: 'Stores detected',
    compacted: 'Store filters complete',
    safePointStores: 'Three safe-point storage boundaries',
    safePointStoresNote:
      'The mysql.tidb display value, TiDB visibility/cache value, and PD global value are separate storage and publication boundaries.',
    mysqlStatus: 'mysql.tidb status',
    visibilityCache: 'TiDB visibility / cache barrier',
    pdGlobal: 'PD global GC safe point',
    leaderLease: 'GC leader lease',
    cacheBarrier: 'cache barrier',
    stagedValue: 'Staged',
    savedValue: 'Saved',
    publishedValue: 'Published',
    resolveTitle: 'Resolve Locks / ScanLock',
    resolveImplementation: 'Implementation',
    resolveRegions: 'Scanned Regions',
    noRegions: 'No Region scanned yet',
    resolvedLocks: 'Synthetic locks',
    noLocks: 'No target locks',
    committedPrimary: 'Primary committed → resolve commit',
    rolledBackPrimary: 'Primary rolled back → resolve rollback',
    pendingLock: 'Pending',
    resolveBoundary:
      'ResolveLock is a normal TiKV write command, but its Raft-entry detail is outside this GC slice.',
    deleteTitle: 'Classic raftstore-v1 Delete Range fan-out',
    deleteNote:
      'UnsafeDestroyRange fans out directly to each Store and bypasses Region Raft. Per-Store acknowledgements are not retained in the snapshot; only the aggregate range state is projected.',
    rangeState: 'Aggregate range state',
    unsafeDestroy: 'UnsafeDestroyRange',
    ackNotProjected: 'Per-Store ack not projected',
    aggregateComplete: 'Aggregate complete',
    storeTitle: 'TiKV safe-point detector / filter',
    detectedSafePoint: 'Detected safe point',
    compaction: 'Compaction',
    filterActive: 'Filter active',
    storageTitle: 'Logical MVCC chains (counted once)',
    storageNote:
      'Logical chains are not multiplied by three replicas. Only synthetic IDs and counts are shown; no real or encoded keys, values, or SQL literals are retained.',
    initialVersions: 'Initial versions',
    filteredVersions: 'Filtered',
    putAnchors: 'Retained Put anchors',
    deleteChains: 'Old chain removed by Delete',
    defaultDeletes: 'Long DEFAULT CF values deleted',
    none: 'None',
    region: 'Region',
    writeType: 'Write',
    valueStorage: 'CF',
    versionState: 'State',
    present: 'Present',
    retainedAnchor: 'Retained Put anchor',
    filtered: 'Filtered',
    boundaries: 'Mechanism boundaries',
    compactionBoundary:
      'Compaction Filter is no-Raft physical storage work during RocksDB compaction and creates no Raft entry.',
    separateBoundary:
      'MVCC GC, Delete Range, physical compaction, and Raft log GC are separate mechanisms. Displayed counts are not disk bytes or a latency benchmark.',
    privacy:
      'PRIVACY: no SQL text, literals, real keys/values, or result rows are stored or displayed.',
    phaseNames: {
      idle: 'Idle',
      preparing: 'Candidate and bound',
      safe_point_bounded: 'mysql stage',
      resolving_locks: 'Resolve Locks',
      caching_safe_point: 'Visibility / cache barrier',
      deleting_ranges: 'Delete Ranges',
      publishing_safe_point: 'PD publication',
      tikv_observing: 'TiKV observation',
      compacting: 'Compaction Filter',
      between_rounds: 'Between rounds',
      complete: 'Complete',
    },
    compactionStates: {
      idle: 'Idle',
      eligible: 'Eligible',
      running: 'Running',
      complete: 'Complete',
    },
    deleteStates: {
      pending: 'Pending',
      eligible: 'Eligible',
      deleted: 'Deleted',
    },
  },
} as const

const TIFLASH_MPP_MACHINE_COPY = {
  ja: {
    eyebrow: 'TIFLASH / MPP LAB · EXACT SNAPSHOT',
    title: 'Learner複製と2-stage MPP',
    phase: 'フェーズ',
    snapshot: 'Snapshot',
    graphTitle: 'Fragment / task意味グラフ',
    graphDirection:
      'この意味グラフは選択exact eventのsnapshotから導出します。上の時系列因果DAGを置き換えず、並行eventの実network到着順も主張しません。',
    persistent: 'PERSISTENT · REGION RAFT / DELTAMERGE',
    ephemeral: 'EPHEMERAL · MPP EXCHANGE',
    provisioning: 'Replica provisioning',
    provisioningNote:
      'AVAILABLE / PROGRESSは配置状態であり、任意snapshotの即時read readinessではありません。',
    learners: 'Region learner / snapshot gate',
    tasks: 'Fragments / tasks',
    tunnels: 'Exchange tunnels',
    root: 'TiDB root / client stream',
    region: 'Region',
    learner: 'Learner',
    indexes: 'commit / received / DM / applied / required',
    gate: 'Read gate',
    store: 'Store',
    task: 'Task',
    fragment: 'Fragment',
    stage: 'Stage',
    exchange: 'Exchange',
    packets: 'Packets',
    result: 'Result stage',
    retry: 'Retry / fallback',
    boundary:
      'Raft learner複製は永続MVCC stateを更新します。MPP Exchangeは一時query blockだけを運び、Raft/MVCC stateを変更しません。',
    privacy:
      'PRIVACY: raw SQL、address、実key/value、group値、結果行、session ID、production TSOを保持しません。',
  },
  en: {
    eyebrow: 'TIFLASH / MPP LAB · EXACT SNAPSHOT',
    title: 'Learner replication and two-stage MPP',
    phase: 'Phase',
    snapshot: 'Snapshot',
    graphTitle: 'Fragment and task semantic graph',
    graphDirection:
      'This semantic graph is derived from the selected exact-event snapshot. It does not replace the chronological causal DAG above or claim a production network arrival order.',
    persistent: 'PERSISTENT · REGION RAFT / DELTAMERGE',
    ephemeral: 'EPHEMERAL · MPP EXCHANGE',
    provisioning: 'Replica provisioning',
    provisioningNote:
      'AVAILABLE and PROGRESS describe placement, not immediate read readiness for an arbitrary snapshot.',
    learners: 'Region learners and snapshot gates',
    tasks: 'Fragments and tasks',
    tunnels: 'Exchange tunnels',
    root: 'TiDB root and client stream',
    region: 'Region',
    learner: 'Learner',
    indexes: 'commit / received / DM / applied / required',
    gate: 'Read gate',
    store: 'Store',
    task: 'Task',
    fragment: 'Fragment',
    stage: 'Stage',
    exchange: 'Exchange',
    packets: 'Packets',
    result: 'Result stage',
    retry: 'Retry / fallback',
    boundary:
      'Raft learner replication updates persistent MVCC state. MPP Exchange carries ephemeral query blocks and never changes Raft or MVCC state.',
    privacy:
      'PRIVACY: no raw SQL, address, real key/value, group value, result row, session ID, or production TSO is retained.',
  },
} as const

interface TimelineEventLayout {
  event: MachineEvent
  index: number
  x: number
  endX: number
  y: number
  state: 'complete' | 'current' | 'future'
  status: 'queued' | 'active' | 'success' | 'warning' | 'failed'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string =>
    typeof entry === 'string' && entry.length > 0)
  return strings.length > 0 ? strings : undefined
}

function asTraceSnapshot(value: unknown): TraceStateSnapshot | undefined {
  return value && typeof value === 'object'
    ? value as TraceStateSnapshot
    : undefined
}

function machineDomain(value: unknown): MachineLane | null {
  if (value === 'client' || value === 'return' || value === 'sql') return 'sql'
  if (value === 'tso') return 'tso'
  if (value === 'txn' || value === 'transaction' || value === 'txn2pc') return 'txn2pc'
  if (value === 'raft') return 'raft'
  if (value === 'kv') return 'kv'
  if (value === 'tiflash') return 'tiflash'
  return null
}

function machineStatus(value: string | undefined): TimelineEventLayout['status'] {
  if (value === 'queued' || value === 'active' || value === 'warning' || value === 'failed') {
    return value
  }
  return 'success'
}

function receiptEndMs(receipt: MachineReceipt): number {
  return Math.max(
    1,
    ...receipt.events.map((event) => event.atMs + Math.max(0, event.durationMs)),
  )
}

function formatModelTime(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ms`
}

function shortLabel(label: string, maxLength = 32): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label
}

function lockAttemptLabel(clientId: string, attempt: number): string {
  if (attempt <= 1) return clientId
  if (attempt <= 4) return `${clientId}${'′'.repeat(attempt - 1)}`
  return `${clientId} (${attempt})`
}

function appendSvgText(
  parent: SVGElement,
  className: string,
  text: string,
  x: number,
  y: number,
  attrs: Record<string, string> = {},
): SVGTextElement {
  const node = svgElement('text', {
    class: className,
    x: String(x),
    y: String(y),
    ...attrs,
  })
  node.textContent = text
  parent.append(node)
  return node
}

const LOCK_TRANSACTION_STATUS_COPY = {
  ja: {
    active: '実行中',
    waiting: '待機中',
    victim: 'victim',
    rolled_back: 'ロールバック済み',
    commit_handoff: 'commit modelへ引き渡し',
    completed: '完了',
  },
  en: {
    active: 'Active',
    waiting: 'Waiting',
    victim: 'Victim',
    rolled_back: 'Rolled back',
    commit_handoff: 'Commit-model handoff',
    completed: 'Completed',
  },
} as const

const DEADLOCK_RESOLUTION_COPY = {
  ja: {
    detected: '循環を検出',
    rolling_back: 'victimをロールバック中',
    resolved: '解消済み（履歴を保持）',
  },
  en: {
    detected: 'Cycle detected',
    rolling_back: 'Rolling back victim',
    resolved: 'Resolved (history retained)',
  },
} as const

const APPLICATION_RETRY_STATUS_COPY = {
  ja: {
    backoff: 'backoff中',
    started: '新しいtransactionを開始',
    completed: '再試行完了',
  },
  en: {
    backoff: 'In backoff',
    started: 'New transaction started',
    completed: 'Retry completed',
  },
} as const

const RAFT_PHASE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['phase'], string>>
>> = {
  ja: {
    healthy: '正常',
    requesting: '旧Leaderへrequest',
    leader_lost: 'Leader喪失',
    backoff: 'TiDB内部backoff',
    timeout: '選出timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: '新Leader選出',
    confirming: '新Leaderを確認',
    routing: 'routeを更新',
    serving: 'requestを再実行',
    complete: '完了',
  },
  en: {
    healthy: 'Healthy',
    requesting: 'Requesting the old leader',
    leader_lost: 'Leader lost',
    backoff: 'TiDB internal backoff',
    timeout: 'Election timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: 'New leader elected',
    confirming: 'Confirming the new leader',
    routing: 'Refreshing the route',
    serving: 'Serving the retried request',
    complete: 'Complete',
  },
}

const RAFT_ELECTION_PHASE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['election']['phase'], string>>
>> = {
  ja: {
    idle: '待機',
    timeout: 'Timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: '選出済み',
  },
  en: {
    idle: 'Idle',
    timeout: 'Timeout',
    pre_vote: 'Pre-Vote',
    vote: 'Vote',
    elected: 'Elected',
  },
}

const RAFT_ROLE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabPeerSnapshot['role'], string>>
>> = {
  ja: {
    leader: 'Leader',
    follower: 'Follower',
    pre_candidate: 'Pre-Candidate',
    candidate: 'Candidate',
    offline: 'Offline',
  },
  en: {
    leader: 'Leader',
    follower: 'Follower',
    pre_candidate: 'Pre-Candidate',
    candidate: 'Candidate',
    offline: 'Offline',
  },
}

const RAFT_REQUEST_STATUS_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['request']['status'], string>>
>> = {
  ja: {
    idle: '待機',
    sent: '送信済み',
    transport_error: 'transport error',
    backoff: 'backoff',
    retrying: '再試行中',
    served: 'TiKVで処理済み',
    completed: '完了',
  },
  en: {
    idle: 'Idle',
    sent: 'Sent',
    transport_error: 'Transport error',
    backoff: 'Backoff',
    retrying: 'Retrying',
    served: 'Served by TiKV',
    completed: 'Completed',
  },
}

const RAFT_CACHE_STATE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceRaftLabSnapshot['request']['cacheState'], string>>
>> = {
  ja: {
    cached: 'cache済み',
    invalidated: '無効化',
    refreshed: '更新済み',
  },
  en: {
    cached: 'Cached',
    invalidated: 'Invalidated',
    refreshed: 'Refreshed',
  },
}

const PROTOCOL_LANE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceProtocolLaneId, string>>
>> = {
  ja: {
    one_pc: '1PC',
    async_commit: 'Async Commit',
    two_pc: 'regular 2PC',
  },
  en: {
    one_pc: '1PC',
    async_commit: 'Async Commit',
    two_pc: 'regular 2PC',
  },
}

const PROTOCOL_STAGE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceProtocolLaneSnapshot['stage'], string>>
>> = {
  ja: {
    idle: '未開始',
    requested: 'request受信',
    started: 'start_ts取得済み',
    selected: 'protocol選択済み',
    latest_ts: 'latest_ts取得済み',
    prewriting: 'Prewrite進行中',
    prewritten: 'Prewrite完了',
    commit_ts: 'commit_ts取得済み',
    committing: 'Commit進行中',
    client_acknowledged: 'client応答済み',
    background: 'background cleanup中',
    complete: '完了',
  },
  en: {
    idle: 'Not started',
    requested: 'Request received',
    started: 'start_ts allocated',
    selected: 'Protocol selected',
    latest_ts: 'latest_ts allocated',
    prewriting: 'Prewrite in progress',
    prewritten: 'Prewrite complete',
    commit_ts: 'commit_ts allocated',
    committing: 'Commit in progress',
    client_acknowledged: 'Client acknowledged',
    background: 'Background cleanup',
    complete: 'Complete',
  },
}

const PROTOCOL_SELECTION_REASON_COPY: Readonly<Record<
  Locale,
  Readonly<Record<
    TraceProtocolLaneSnapshot['eligibility']['selectionReason'],
    string
  >>
>> = {
  ja: {
    single_region_one_pc_model_case: '単一Regionの固定1PC代表fixture',
    multi_region_async_commit_model_case: '制限内の複数Region固定Async代表fixture',
    async_key_count_limit_model_case: '257 mutationsがAsync既定上限256を超過',
  },
  en: {
    single_region_one_pc_model_case: 'Fixed single-Region representative 1PC fixture',
    multi_region_async_commit_model_case: 'Fixed in-limit multi-Region Async fixture',
    async_key_count_limit_model_case: '257 mutations exceed the Async default limit of 256',
  },
}

const PROTOCOL_DECISION_POINT_COPY: Readonly<Record<
  Locale,
  Readonly<Record<
    TraceProtocolLaneSnapshot['eligibility']['onePcDecisionPoint'] |
    TraceProtocolLaneSnapshot['eligibility']['asyncDecisionPoint'],
    string
  >>
>> = {
  ja: {
    region_batching: 'TiDB clientのRegion batching',
    tikv_prewrite: 'TiKV Prewrite',
    client_precheck: 'TiDB client precheck',
  },
  en: {
    region_batching: 'TiDB client Region batching',
    tikv_prewrite: 'TiKV Prewrite',
    client_precheck: 'TiDB client precheck',
  },
}

const PROTOCOL_COMMIT_TS_SOURCE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<
    NonNullable<TraceProtocolLaneSnapshot['commitTsSource']>,
    string
  >>
>> = {
  ja: {
    tikv_one_pc_result: 'TiKVの1PC Prewrite結果',
    max_prewrite_min_commit_ts: 'TiKVが返したmin_commit_tsの最大値',
    pd_tso_after_prewrite: '全Prewrite後のPD TSO',
  },
  en: {
    tikv_one_pc_result: 'TiKV 1PC Prewrite result',
    max_prewrite_min_commit_ts: 'Maximum min_commit_ts returned by TiKV',
    pd_tso_after_prewrite: 'PD TSO after every Prewrite',
  },
}

const PROTOCOL_RAFT_OPERATION_COPY: Readonly<Record<
  Locale,
  Readonly<Record<
    NonNullable<TraceProtocolRegionSnapshot['raft']['operation']>,
    string
  >>
>> = {
  ja: {
    one_pc_prewrite: '1PC Prewrite + commit',
    prewrite: 'Prewrite',
    commit_primary: 'primary Commit',
    commit_secondary: 'secondary Commit',
    commit_async: 'Async background Commit',
  },
  en: {
    one_pc_prewrite: '1PC Prewrite + commit',
    prewrite: 'Prewrite',
    commit_primary: 'Primary Commit',
    commit_secondary: 'Secondary Commit',
    commit_async: 'Async background Commit',
  },
}

const PROTOCOL_RAFT_STAGE_COPY: Readonly<Record<
  Locale,
  Readonly<Record<TraceProtocolRegionSnapshot['raft']['stage'], string>>
>> = {
  ja: {
    idle: '未提案',
    proposed: '提案済み',
    persisted_quorum: '2-of-3永続化',
    committed: 'Raft commit済み',
    applied: 'MVCC apply済み',
  },
  en: {
    idle: 'Not proposed',
    proposed: 'Proposed',
    persisted_quorum: 'Persisted by 2 of 3',
    committed: 'Raft committed',
    applied: 'Applied to MVCC',
  },
}

const PROTOCOL_STAGE_ORDER: Readonly<Record<
  TraceProtocolLaneSnapshot['stage'],
  number
>> = {
  idle: 0,
  requested: 1,
  started: 2,
  selected: 3,
  latest_ts: 4,
  prewriting: 5,
  prewritten: 6,
  commit_ts: 7,
  committing: 8,
  client_acknowledged: 9,
  background: 10,
  complete: 11,
}

function raftFact(label: string, value: string): HTMLElement {
  return element('div', {},
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function renderRaftElectionGraph(
  raftLab: TraceRaftLabSnapshot,
  locale: Locale,
): HTMLDivElement {
  const copy = MACHINE_COPY[locale]
  const candidate = raftLab.election.candidateStoreId
  const wrapper = element('div', {
    className: 'tidb-machine__raft-election-graph',
    attrs: {
      role: 'group',
      tabindex: '0',
      'aria-label': `${copy.raftGraph}. ${copy.raftGraphDirection}`,
      'data-raft-election-graph': 'semantic',
      'data-graph-kind': 'raft-election',
      'data-election-phase': raftLab.election.phase,
      'data-election-candidate': candidate ?? '',
      'data-election-quorum': String(raftLab.quorum),
      'data-edge-count': String(
        raftLab.election.preVotesGranted.length +
        raftLab.election.votesGranted.length,
      ),
    },
  })
  const graphHead = element('div', {
    className: 'tidb-machine__raft-card-head',
  },
  element('h3', { text: copy.raftGraph }),
  element('span', {
    className: 'tidb-machine__raft-graph-contract',
    text: copy.raftGraphContract,
  }),
  )
  const direction = element('p', {
    className: 'tidb-machine__raft-direction',
    text: copy.raftGraphDirection,
  })

  const width = 680
  const height = 250
  const peerY = 28
  const peerWidth = 150
  const peerHeight = 58
  const candidateY = 190
  const positions = new Map<string, number>()
  raftLab.peers.forEach((peer, index) => {
    positions.set(peer.storeId, 105 + index * 235)
  })
  const diagram = svgElement('svg', {
    class: 'tidb-machine__raft-election-svg',
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    'data-graph-kind': 'raft-election-visual',
  })
  const defs = svgElement('defs')
  const preVoteMarker = svgElement('marker', {
    id: 'tidb-machine-raft-prevote-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  })
  preVoteMarker.append(svgElement('path', {
    class: 'tidb-machine__raft-prevote-arrow',
    d: 'M 1 1 L 9 5 L 1 9',
  }))
  const voteMarker = svgElement('marker', {
    id: 'tidb-machine-raft-vote-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  })
  voteMarker.append(svgElement('path', {
    class: 'tidb-machine__raft-vote-arrow',
    d: 'M 0 0 L 10 5 L 0 10 z',
  }))
  defs.append(preVoteMarker, voteMarker)
  diagram.append(defs)

  const grants = [
    {
      stage: 'pre_vote',
      label: 'PV',
      stores: raftLab.election.preVotesGranted,
      endX: width / 2 - 26,
      endY: candidateY,
    },
    {
      stage: 'vote',
      label: 'V',
      stores: raftLab.election.votesGranted,
      endX: width / 2 + 26,
      endY: candidateY,
    },
  ] as const
  for (const grant of grants) {
    grant.stores.forEach((storeId, index) => {
      const startX = positions.get(storeId)
      if (startX === undefined || candidate === null) return
      const controlX = (startX + grant.endX) / 2 +
        (grant.stage === 'pre_vote' ? -22 : 22)
      const controlY = 116 + index * 16
      diagram.append(svgElement('path', {
        class: `tidb-machine__raft-grant is-${grant.stage}`,
        d: `M ${startX} ${peerY + peerHeight} Q ${controlX} ${controlY} ${grant.endX} ${grant.endY}`,
        'data-raft-grant': grant.stage,
        'data-grant-from': storeId,
        'data-grant-to': candidate,
        'data-grant-counted': 'true',
        'marker-end': grant.stage === 'pre_vote'
          ? 'url(#tidb-machine-raft-prevote-arrow)'
          : 'url(#tidb-machine-raft-vote-arrow)',
      }))
      appendSvgText(
        diagram,
        `tidb-machine__raft-grant-label is-${grant.stage}`,
        grant.label,
        controlX,
        controlY - 4,
        { 'text-anchor': 'middle' },
      )
    })
  }

  for (const peer of raftLab.peers) {
    const x = positions.get(peer.storeId)
    if (x === undefined) continue
    const node = svgElement('g', {
      class: `tidb-machine__raft-node is-${peer.role} ${peer.healthy ? 'is-healthy' : 'is-down'}`,
      'data-raft-peer-node': peer.storeId,
      'data-peer-role': peer.role,
      'data-peer-health': peer.healthy ? 'healthy' : 'down',
      'data-node-shape': peer.role === 'leader'
        ? 'double'
        : peer.role === 'candidate' || peer.role === 'pre_candidate'
          ? 'notched'
          : peer.role === 'offline'
            ? 'crossed'
            : 'rounded',
    })
    node.append(svgElement('rect', {
      class: 'tidb-machine__raft-node-box',
      x: String(x - peerWidth / 2),
      y: String(peerY),
      width: String(peerWidth),
      height: String(peerHeight),
      rx: peer.role === 'candidate' || peer.role === 'pre_candidate'
        ? '2'
        : '11',
    }))
    appendSvgText(
      node,
      'tidb-machine__raft-node-store',
      `${peer.healthy ? '●' : '×'} ${peer.storeId}`,
      x,
      peerY + 23,
      { 'text-anchor': 'middle' },
    )
    appendSvgText(
      node,
      'tidb-machine__raft-node-role',
      `${RAFT_ROLE_COPY[locale][peer.role]} · term ${peer.currentTerm}`,
      x,
      peerY + 43,
      { 'text-anchor': 'middle' },
    )
    diagram.append(node)
  }

  diagram.append(svgElement('rect', {
    class: 'tidb-machine__raft-candidate-box',
    x: String(width / 2 - 112),
    y: String(candidateY),
    width: '224',
    height: '44',
    rx: '4',
    'data-candidate-shape': 'notched',
  }))
  appendSvgText(
    diagram,
    'tidb-machine__raft-candidate-label',
    `${copy.candidate}: ${candidate ?? copy.pending}`,
    width / 2,
    candidateY + 19,
    { 'text-anchor': 'middle' },
  )
  appendSvgText(
    diagram,
    'tidb-machine__raft-candidate-quorum',
    copy.twoOfThree,
    width / 2,
    candidateY + 35,
    { 'text-anchor': 'middle' },
  )

  const grantList = element('ul', {
    className: 'tidb-machine__raft-grant-list',
    attrs: {
      'aria-label': copy.raftGraph,
      'data-raft-grant-list': 'accessible',
    },
  })
  for (const grant of grants) {
    for (const storeId of grant.stores) {
      grantList.append(element('li', {
        attrs: {
          'data-raft-grant': grant.stage,
          'data-grant-from': storeId,
          'data-grant-to': candidate ?? '',
        },
      },
      element('strong', {
        text: grant.stage === 'pre_vote' ? 'PRE-VOTE' : 'VOTE',
      }),
      element('span', {
        text: `${copy.voter}: ${storeId} → ${copy.candidate}: ${candidate ?? copy.pending}`,
      }),
      element('small', { text: copy.grant }),
      ))
    }
  }
  if (
    raftLab.election.preVotesGranted.length === 0 &&
    raftLab.election.votesGranted.length === 0
  ) {
    grantList.append(element('li', {
      className: 'tidb-machine__raft-empty',
      text: copy.noGrants,
      attrs: { 'data-raft-grant-empty': 'true' },
    }))
  }

  wrapper.append(graphHead, direction, diagram, grantList)
  return wrapper
}

function renderWaitForDiagram(
  lockLab: TraceLockLabSnapshot,
  locale: Locale,
): HTMLDivElement {
  const copy = MACHINE_COPY[locale]
  const wrapper = element('div', {
    className: 'tidb-machine__wait-graph',
    attrs: {
      role: 'group',
      'aria-label': `${copy.waitGraph}. ${copy.waitDirection}`,
      'data-wait-for-graph': 'semantic',
      'data-edge-count': String(lockLab.waitForEdges.length),
      tabindex: '0',
    },
  })
  const graphHead = element('div', { className: 'tidb-machine__lock-card-head' },
    element('h3', { text: copy.waitGraph }),
    element('span', {
      className: 'tidb-machine__graph-contract',
      text: 'WAITER → HOLDER',
    }),
  )
  const direction = element('p', {
    className: 'tidb-machine__graph-direction',
    text: copy.waitDirection,
  })

  const width = 620
  const height = 170
  const centerY = 82
  const transactions = lockLab.transactions
  const positionByTransactionId = new Map<string, number>()
  const diagram = svgElement('svg', {
    class: 'tidb-machine__wait-svg',
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
    'data-graph-kind': 'wait-for',
  })
  const defs = svgElement('defs')
  const marker = svgElement('marker', {
    id: 'tidb-machine-wait-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  })
  marker.append(svgElement('path', {
    class: 'tidb-machine__wait-arrow',
    d: 'M 0 0 L 10 5 L 0 10 z',
  }))
  defs.append(marker)
  diagram.append(defs)

  transactions.forEach((transaction, index) => {
    const x = transactions.length === 1
      ? width / 2
      : 76 + index * ((width - 152) / Math.max(1, transactions.length - 1))
    positionByTransactionId.set(transaction.transactionId, x)
  })

  for (const [index, edge] of lockLab.waitForEdges.entries()) {
    const waiterX = positionByTransactionId.get(edge.waiterTransactionId)
    const holderX = positionByTransactionId.get(edge.holderTransactionId)
    if (waiterX === undefined || holderX === undefined) continue
    const directionSign = holderX >= waiterX ? 1 : -1
    const startX = waiterX + directionSign * 54
    const endX = holderX - directionSign * 54
    const midX = (startX + endX) / 2
    const hasReverse = lockLab.waitForEdges.some((candidate) =>
      candidate.waiterTransactionId === edge.holderTransactionId &&
      candidate.holderTransactionId === edge.waiterTransactionId)
    const controlY = hasReverse
      ? directionSign > 0 ? 19 : 145
      : 42 + (index % 2) * 80
    diagram.append(svgElement('path', {
      class: 'tidb-machine__wait-edge',
      d: `M ${startX} ${centerY} Q ${midX} ${controlY} ${endX} ${centerY}`,
      'data-wait-for-edge': edge.id,
      'data-wait-for-from': edge.waiterTransactionId,
      'data-wait-for-to': edge.holderTransactionId,
      'data-resource-id': edge.resourceId,
      'data-direction': 'waiter-to-holder',
      'marker-end': 'url(#tidb-machine-wait-arrow)',
    }))
    appendSvgText(
      diagram,
      'tidb-machine__wait-resource',
      edge.resourceId,
      midX,
      controlY < centerY ? controlY + 14 : controlY - 8,
      { 'text-anchor': 'middle' },
    )
  }

  for (const transaction of transactions) {
    const x = positionByTransactionId.get(transaction.transactionId)
    if (x === undefined) continue
    const clientLabel = lockAttemptLabel(
      transaction.clientId,
      transaction.attempt,
    )
    const node = svgElement('g', {
      class: `tidb-machine__wait-node is-${transaction.status}`,
      'data-lock-transaction': transaction.transactionId,
      'data-lock-client': transaction.clientId,
      'data-lock-status': transaction.status,
    })
    node.append(svgElement('rect', {
      class: 'tidb-machine__wait-node-box',
      x: String(x - 54),
      y: String(centerY - 24),
      width: '108',
      height: '48',
      rx: '10',
    }))
    appendSvgText(
      node,
      'tidb-machine__wait-node-client',
      clientLabel,
      x,
      centerY - 3,
      { 'text-anchor': 'middle' },
    )
    appendSvgText(
      node,
      'tidb-machine__wait-node-id',
      shortLabel(transaction.transactionId, 18),
      x,
      centerY + 13,
      { 'text-anchor': 'middle' },
    )
    diagram.append(node)
  }

  const edgeList = element('ul', {
    className: 'tidb-machine__wait-list',
    attrs: { 'aria-label': copy.waitGraph },
  })
  for (const edge of lockLab.waitForEdges) {
    edgeList.append(element('li', {
      attrs: {
        'data-wait-for-edge': edge.id,
        'data-wait-for-from': edge.waiterTransactionId,
        'data-wait-for-to': edge.holderTransactionId,
        'data-resource-id': edge.resourceId,
        'data-direction': 'waiter-to-holder',
      },
    },
    element('span', { text: `${copy.waiter}: ${edge.waiterTransactionId}` }),
    element('strong', { text: '→' }),
    element('span', { text: `${copy.holder}: ${edge.holderTransactionId}` }),
    element('small', { text: `${copy.resource}: ${edge.resourceId}` }),
    ))
  }
  if (lockLab.waitForEdges.length === 0) {
    edgeList.append(element('li', {
      className: 'tidb-machine__lock-empty',
      text: copy.noWaitEdges,
      attrs: { 'data-wait-for-empty': 'true' },
    }))
  }

  wrapper.append(graphHead, direction, diagram, edgeList)
  return wrapper
}

function renderLockState(
  event: MachineEvent,
  locale: Locale,
): HTMLElement | null {
  const lockLab = event.snapshot?.lockLab
  if (!lockLab) return null
  const copy = MACHINE_COPY[locale]
  const detector = element('section', {
    className: 'tidb-machine__lock-card',
    attrs: {
      'data-lock-detector': lockLab.detectorLeaderStoreId,
      'data-detector-scope': lockLab.detectorScope,
    },
  },
  element('h3', { text: copy.detector }),
  element('strong', { text: copy.detectorScope }),
  element('p', {
    text: `${copy.detectorLeader}: ${lockLab.detectorLeaderStoreId}`,
  }),
  )

  const deadlock = lockLab.deadlock
  const deadlockCard = element('section', {
    className: 'tidb-machine__lock-card',
    attrs: {
      'data-deadlock-state': deadlock?.resolution ?? 'none',
      'data-deadlock-victim': deadlock?.victimTransactionId ?? '',
      'data-deadlock-retryable': deadlock ? String(deadlock.retryable) : 'not-applicable',
    },
  },
  element('h3', { text: copy.deadlock }),
  )
  if (deadlock) {
    deadlockCard.append(
      element('strong', {
        text: DEADLOCK_RESOLUTION_COPY[locale][deadlock.resolution],
      }),
      element('p', {
        className: 'tidb-machine__deadlock-cycle',
        text: `${copy.cycle}: ${deadlock.cycleTransactionIds.join(' → ')}`,
      }),
      element('p', {
        text: `${copy.victim}: ${deadlock.victimTransactionId ?? copy.pending}`,
      }),
      element('p', {
        className: 'tidb-machine__model-policy',
        text: copy.modelPolicy,
        attrs: {
          'data-selection-policy': 'model-policy',
          'data-policy-contract': deadlock.selectionPolicy,
        },
      }),
      element('p', {
        className: 'tidb-machine__retryable-false',
        text: copy.retryableFalse,
        attrs: { 'data-retryable': 'false' },
      }),
    )
  } else {
    deadlockCard.append(element('p', {
      className: 'tidb-machine__lock-empty',
      text: copy.noDeadlock,
    }))
  }

  const retry = lockLab.applicationRetry
  const retryCard = element('section', {
    className: 'tidb-machine__lock-card',
    attrs: {
      'data-application-retry': retry?.status ?? 'none',
      'data-retry-source': retry?.source ?? 'none',
    },
  },
  element('h3', { text: copy.applicationRetry }),
  )
  if (retry) {
    retryCard.append(
      element('strong', {
        text: APPLICATION_RETRY_STATUS_COPY[locale][retry.status],
      }),
      element('p', { text: copy.retrySource }),
      element('p', { text: `${copy.retryOf}: ${retry.retryOfTransactionId}` }),
      element('p', {
        text: `${copy.newTransaction}: ${retry.newTransactionId ?? copy.pending}`,
      }),
      element('p', {
        text: `${copy.fixedBackoff}: ${retry.fixedBackoffMs} ms`,
      }),
    )
  } else {
    retryCard.append(element('p', {
      className: 'tidb-machine__lock-empty',
      text: copy.noApplicationRetry,
    }))
  }

  const transactionLegend = element('ul', {
    className: 'tidb-machine__lock-transactions',
    attrs: {
      'aria-label': locale === 'ja'
        ? 'Lock Lab transactionの状態'
        : 'Lock Lab transaction states',
    },
  })
  for (const transaction of lockLab.transactions) {
    const clientLabel = lockAttemptLabel(
      transaction.clientId,
      transaction.attempt,
    )
    transactionLegend.append(element('li', {
      attrs: {
        'data-lock-transaction-summary': transaction.transactionId,
        'data-lock-status': transaction.status,
        'data-lock-attempt': String(transaction.attempt),
      },
    },
    element('span', { text: clientLabel }),
    element('code', { text: transaction.transactionId }),
    element('strong', {
      text: LOCK_TRANSACTION_STATUS_COPY[locale][transaction.status],
    }),
    ))
  }

  return element('section', {
    className: 'tidb-machine__lock-state',
    attrs: {
      'aria-labelledby': 'tidb-machine-lock-title',
      'data-lock-lab-state': 'true',
      'data-lock-event-id': event.id,
      'data-lock-event-kind': event.kind ?? '',
      'data-lock-event-branch': event.branchId ?? '',
    },
  },
  element('header', { className: 'tidb-machine__lock-head' },
    element('div', {},
      element('p', {
        className: 'tidb-machine__lock-eyebrow',
        text: copy.lockEyebrow,
      }),
      element('h2', {
        text: copy.lockTitle,
        attrs: { id: 'tidb-machine-lock-title' },
      }),
    ),
    element('span', {
      className: 'tidb-machine__lock-snapshot',
      text: `SNAPSHOT · ${event.id}`,
    }),
  ),
  renderWaitForDiagram(lockLab, locale),
  transactionLegend,
  element('div', { className: 'tidb-machine__lock-grid' },
    detector,
    deadlockCard,
    retryCard,
  ),
  )
}

type ProtocolEdgeState = 'complete' | 'current' | 'future'

interface ProtocolFlowEdge {
  action: string
  label: string
  path: 'critical' | 'background'
  state: ProtocolEdgeState
}

function protocolFact(label: string, value: string): HTMLElement {
  return element('div', {},
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function protocolBoolean(value: boolean, locale: Locale): string {
  return value ? MACHINE_COPY[locale].yes : MACHINE_COPY[locale].no
}

function protocolAtLeast(
  lane: TraceProtocolLaneSnapshot,
  stage: TraceProtocolLaneSnapshot['stage'],
): boolean {
  return PROTOCOL_STAGE_ORDER[lane.stage] >= PROTOCOL_STAGE_ORDER[stage]
}

function protocolEdgeState(
  complete: boolean,
  current: boolean,
): ProtocolEdgeState {
  if (complete) return 'complete'
  return current ? 'current' : 'future'
}

function protocolFlowEdges(
  lane: TraceProtocolLaneSnapshot,
  locale: Locale,
): readonly ProtocolFlowEdge[] {
  const copy = MACHINE_COPY[locale]
  if (lane.id === 'one_pc') {
    return [
      {
        action: 'select_1pc',
        label: copy.selectOnePc,
        path: 'critical',
        state: protocolEdgeState(
          protocolAtLeast(lane, 'latest_ts'),
          lane.stage === 'requested' ||
            lane.stage === 'started' ||
            lane.stage === 'selected',
        ),
      },
      {
        action: 'latest_ts_and_bound',
        label: copy.fetchLatestTs,
        path: 'critical',
        state: protocolEdgeState(
          protocolAtLeast(lane, 'prewriting'),
          lane.stage === 'latest_ts',
        ),
      },
      {
        action: 'one_pc_prewrite_commit',
        label: copy.onePcCommit,
        path: 'critical',
        state: protocolEdgeState(
          lane.clientResponded,
          lane.stage === 'prewriting' || lane.stage === 'committing',
        ),
      },
      {
        action: 'client_commit_response',
        label: copy.returnClient,
        path: 'critical',
        state: protocolEdgeState(
          lane.stage === 'complete',
          lane.stage === 'client_acknowledged',
        ),
      },
    ]
  }
  if (lane.id === 'async_commit') {
    return [
      {
        action: 'select_async_commit',
        label: copy.selectAsync,
        path: 'critical',
        state: protocolEdgeState(
          protocolAtLeast(lane, 'latest_ts'),
          lane.stage === 'requested' ||
            lane.stage === 'started' ||
            lane.stage === 'selected',
        ),
      },
      {
        action: 'latest_ts_and_bound',
        label: copy.fetchLatestTs,
        path: 'critical',
        state: protocolEdgeState(
          protocolAtLeast(lane, 'prewriting'),
          lane.stage === 'latest_ts',
        ),
      },
      {
        action: 'prewrite_all_regions',
        label: copy.prewriteRegions,
        path: 'critical',
        state: protocolEdgeState(
          lane.clientResponded,
          lane.stage === 'prewriting' || lane.stage === 'prewritten',
        ),
      },
      {
        action: 'establish_async_commit',
        label: copy.establishAsyncCommit,
        path: 'critical',
        state: protocolEdgeState(
          lane.clientResponded,
          lane.stage === 'prewritten',
        ),
      },
      {
        action: 'client_commit_response',
        label: copy.returnClient,
        path: 'critical',
        state: protocolEdgeState(
          protocolAtLeast(lane, 'background'),
          lane.stage === 'client_acknowledged',
        ),
      },
      {
        action: 'background_commit_cleanup',
        label: copy.backgroundCommit,
        path: 'background',
        state: protocolEdgeState(
          lane.backgroundComplete,
          lane.stage === 'background',
        ),
      },
    ]
  }
  return [
    {
      action: 'select_regular_2pc',
      label: copy.selectTwoPc,
      path: 'critical',
      state: protocolEdgeState(
        protocolAtLeast(lane, 'prewriting'),
        lane.stage === 'requested' ||
          lane.stage === 'started' ||
          lane.stage === 'selected',
      ),
    },
    {
      action: 'prewrite_all_regions',
      label: copy.prewriteRegions,
      path: 'critical',
      state: protocolEdgeState(
        protocolAtLeast(lane, 'commit_ts'),
        lane.stage === 'prewriting' || lane.stage === 'prewritten',
      ),
    },
    {
      action: 'allocate_pd_commit_ts',
      label: copy.fetchCommitTs,
      path: 'critical',
      state: protocolEdgeState(
        protocolAtLeast(lane, 'committing'),
        lane.stage === 'commit_ts',
      ),
    },
    {
      action: 'commit_primary',
      label: copy.commitPrimary,
      path: 'critical',
      state: protocolEdgeState(
        lane.clientResponded,
        lane.stage === 'committing',
      ),
    },
    {
      action: 'client_commit_response',
      label: copy.returnClient,
      path: 'critical',
      state: protocolEdgeState(
        protocolAtLeast(lane, 'background'),
        lane.stage === 'client_acknowledged',
      ),
    },
    {
      action: 'background_secondary_cleanup',
      label: copy.backgroundCommit,
      path: 'background',
      state: protocolEdgeState(
        lane.backgroundComplete,
        lane.stage === 'background',
      ),
    },
  ]
}

function renderProtocolFlow(
  lane: TraceProtocolLaneSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  const edges = protocolFlowEdges(lane, locale)
  const firstNodeState: ProtocolEdgeState =
    protocolAtLeast(lane, 'latest_ts') ||
      (lane.id === 'two_pc' && protocolAtLeast(lane, 'prewriting'))
      ? 'complete'
      : lane.stage === 'idle'
        ? 'future'
        : 'current'
  const flow = element('div', {
    className: 'tidb-machine__protocol-flow',
    attrs: {
      'data-protocol-flow': lane.id,
      'data-protocol': lane.protocol,
      'data-flow-stage': lane.stage,
      'data-protocol-state-scope': 'exact-event-temporal',
    },
  },
  element('span', {
    className: `tidb-machine__protocol-node is-${firstNodeState}`,
    text: copy.profileNode,
    attrs: {
      'data-protocol-node': 'eligibility',
      'data-node-state': firstNodeState,
    },
  }),
  )
  for (const edge of edges) {
    flow.append(
      element('span', {
        className: `tidb-machine__protocol-edge is-${edge.state} is-${edge.path}`,
        text: edge.path === 'background' ? '⇢' : '→',
        attrs: {
          'data-protocol-edge': `${lane.id}:${edge.action}`,
          'data-protocol': lane.protocol,
          'data-edge-action': edge.action,
          'data-edge-path': edge.path,
          'data-edge-state': edge.state,
        },
      }),
      element('span', {
        className: `tidb-machine__protocol-node is-${edge.state} is-${edge.path}`,
        text: edge.label,
        attrs: {
          'data-protocol-node': edge.action,
          'data-node-state': edge.state,
          'data-node-path': edge.path,
        },
      }),
    )
  }
  return flow
}

function renderProtocolTimestamp(
  label: string,
  kind: string,
  value: number | null,
  source: string,
  sourceLabel: string,
  locale: Locale,
  applicable = true,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  const available = value !== null
  const state = !applicable
    ? 'not-applicable'
    : available
      ? 'allocated'
      : 'pending'
  return element('div', {
    className: `tidb-machine__protocol-timestamp is-${state}`,
    attrs: {
      'data-protocol-timestamp': kind,
      'data-timestamp-source': available ? source : 'none',
      'data-timestamp-value': available ? String(value) : '',
      'data-timestamp-applicable': String(applicable),
    },
  },
  element('dt', { text: label }),
  element('dd', {},
    element('strong', {
      text: !applicable
        ? copy.notApplicable
        : available
          ? String(value)
          : copy.notAllocated,
    }),
    element('small', {
      text: !applicable
        ? copy.notUsedByProtocol
        : available
          ? `${copy.timestampSource}: ${sourceLabel}`
          : copy.futurePath,
    }),
  ),
  )
}

function renderProtocolEligibility(
  lane: TraceProtocolLaneSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  const eligibility = lane.eligibility
  return element('section', {
    className: 'tidb-machine__protocol-card tidb-machine__protocol-eligibility',
    attrs: {
      'data-protocol-eligibility': lane.id,
      'data-protocol-state-scope': 'declared-static',
      'data-profile-visibility': 'comparison-start',
      'data-selected-protocol': eligibility.selected,
      'data-selection-reason': eligibility.selectionReason,
      'data-one-pc-eligible': String(eligibility.onePcEligible),
      'data-async-commit-eligible': String(eligibility.asyncCommitEligible),
      'data-try-one-pc-sent': String(eligibility.tryOnePcSent),
      'data-one-pc-rejected-before-rpc': String(
        eligibility.onePcRejectedBeforeRpc,
      ),
      'data-async-rejected-at-client-precheck': String(
        eligibility.asyncRejectedAtClientPrecheck,
      ),
      'data-runtime-fallback': String(eligibility.runtimeFallback),
      'data-one-pc-decision-point': eligibility.onePcDecisionPoint,
      'data-async-decision-point': eligibility.asyncDecisionPoint,
    },
  },
  element('h4', { text: copy.eligibility }),
  element('dl', { className: 'tidb-machine__protocol-facts' },
    protocolFact(
      copy.selectedProtocol,
      PROTOCOL_LANE_COPY[locale][lane.id],
    ),
    protocolFact(
      copy.selectionReason,
      PROTOCOL_SELECTION_REASON_COPY[locale][eligibility.selectionReason],
    ),
    protocolFact(
      copy.enabledFlags,
      `1PC=${protocolBoolean(eligibility.enable1Pc, locale)} · Async=${protocolBoolean(eligibility.enableAsyncCommit, locale)}`,
    ),
    protocolFact(
      copy.onePcEligible,
      protocolBoolean(eligibility.onePcEligible, locale),
    ),
    protocolFact(
      copy.asyncEligible,
      protocolBoolean(eligibility.asyncCommitEligible, locale),
    ),
    protocolFact(
      copy.mutationProfile,
      `${eligibility.mutationCount} / ${eligibility.regionCount} Region`,
    ),
    protocolFact(copy.totalKeyBytes, String(eligibility.totalKeyBytes)),
    protocolFact(
      copy.limits,
      `${eligibility.asyncKeyCountLimit} mutations · ${eligibility.asyncTotalKeyBytesLimit} bytes`,
    ),
    protocolFact(
      copy.decisionPoint,
      `1PC: ${PROTOCOL_DECISION_POINT_COPY[locale][eligibility.onePcDecisionPoint]} · Async: ${PROTOCOL_DECISION_POINT_COPY[locale][eligibility.asyncDecisionPoint]}`,
    ),
    protocolFact(
      copy.tryOnePc,
      protocolBoolean(eligibility.tryOnePcSent, locale),
    ),
    protocolFact(
      copy.onePcRejectedBeforeRpc,
      protocolBoolean(eligibility.onePcRejectedBeforeRpc, locale),
    ),
    protocolFact(
      copy.asyncRejectedAtPrecheck,
      protocolBoolean(eligibility.asyncRejectedAtClientPrecheck, locale),
    ),
    protocolFact(
      copy.runtimeFallback,
      protocolBoolean(eligibility.runtimeFallback, locale),
    ),
  ),
  )
}

function renderProtocolTimestamps(
  lane: TraceProtocolLaneSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  const commitSource = lane.commitTsSource === null
    ? copy.futurePath
    : PROTOCOL_COMMIT_TS_SOURCE_COPY[locale][lane.commitTsSource]
  return element('section', {
    className: 'tidb-machine__protocol-card',
    attrs: {
      'data-protocol-timestamps': lane.id,
      'data-commit-ts-source': lane.commitTsSource ?? 'none',
      'data-protocol-state-scope': 'exact-event-temporal',
    },
  },
  element('h4', { text: copy.timestampProvenance }),
  element('dl', { className: 'tidb-machine__protocol-timestamps' },
    renderProtocolTimestamp(
      copy.startTs,
      'start_ts',
      lane.startTs,
      'pd',
      'PD TSO',
      locale,
    ),
    renderProtocolTimestamp(
      copy.latestTs,
      'latest_ts',
      lane.latestTs,
      'pd',
      'PD TSO',
      locale,
      lane.protocol !== '2pc',
    ),
    renderProtocolTimestamp(
      copy.requestMinCommitTs,
      'request_min_commit_ts',
      lane.requestMinCommitTs,
      'tidb_model_bound',
      locale === 'ja'
        ? 'TiDB計算（latest_ts + 1）'
        : 'TiDB calculation (latest_ts + 1)',
      locale,
      lane.protocol !== '2pc',
    ),
    renderProtocolTimestamp(
      copy.maxCommitTs,
      'max_commit_ts',
      lane.maxCommitTs,
      'tidb_model_bound',
      locale === 'ja'
        ? 'TiCity代表safe-window MODEL bound'
        : 'TiCity representative safe-window MODEL bound',
      locale,
      lane.protocol !== '2pc',
    ),
    renderProtocolTimestamp(
      copy.commitTs,
      'commit_ts',
      lane.commitTs,
      lane.commitTsSource ?? 'none',
      commitSource,
      locale,
    ),
  ),
  )
}

function renderProtocolRegion(
  lane: TraceProtocolLaneSnapshot,
  region: TraceProtocolRegionSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  const operation = region.raft.operation === null
    ? copy.empty
    : PROTOCOL_RAFT_OPERATION_COPY[locale][region.raft.operation]
  const persisted = region.raft.persistedStoreIds.length === 0
    ? copy.empty
    : region.raft.persistedStoreIds.join(' · ')
  const returnedMinCommitTs = region.returnedMinCommitTs === null
    ? copy.notAllocated
    : String(region.returnedMinCommitTs)
  return element('li', {
    className: `tidb-machine__protocol-region is-${region.raft.stage}`,
    attrs: {
      'data-protocol-region': String(region.regionId),
      'data-protocol': lane.protocol,
      'data-region-role': region.role,
      'data-region-leader': region.leaderStoreId,
      'data-raft-operation': region.raft.operation ?? 'none',
      'data-raft-stage': region.raft.stage,
      'data-raft-quorum': String(region.raft.quorum),
      'data-raft-acknowledgements': String(region.raft.acknowledgements),
      'data-raft-persisted-count': String(region.raft.persistedStoreIds.length),
      'data-mvcc-default-cf': region.mvcc.defaultCf,
      'data-mvcc-lock-cf': region.mvcc.lockCf,
      'data-mvcc-write-cf': region.mvcc.writeCf,
      'data-mvcc-async-commit': String(region.mvcc.asyncCommit),
      'data-returned-min-commit-ts': region.returnedMinCommitTs === null
        ? ''
        : String(region.returnedMinCommitTs),
      'data-returned-min-commit-ts-source': region.returnedMinCommitTs === null
        ? 'none'
        : 'tikv',
      'data-transaction-layer': 'tidb_transaction_commit',
      'data-consensus-layer': 'per_region_raft',
    },
  },
  element('div', { className: 'tidb-machine__protocol-region-head' },
    element('strong', { text: `Region ${region.regionId}` }),
    element('span', {
      text: region.role === 'primary'
        ? copy.primary.toUpperCase()
        : copy.secondary.toUpperCase(),
    }),
  ),
  element('dl', { className: 'tidb-machine__protocol-facts' },
    protocolFact(copy.leader, region.leaderStoreId),
    protocolFact(copy.mutationProfile, `${region.mutationCount} ${copy.mutations}`),
    protocolFact(copy.raftOperation, operation),
    protocolFact(
      copy.raftProgress,
      PROTOCOL_RAFT_STAGE_COPY[locale][region.raft.stage],
    ),
    protocolFact(
      copy.raftQuorum,
      `${region.raft.acknowledgements}/${region.raft.quorum} ${copy.acknowledgements}`,
    ),
    protocolFact(copy.persisted, persisted),
    protocolFact(copy.mvccDefault, region.mvcc.defaultCf),
    protocolFact(copy.mvccLock, region.mvcc.lockCf),
    protocolFact(copy.mvccWrite, region.mvcc.writeCf),
    protocolFact(copy.returnedMinCommitTs, returnedMinCommitTs),
    protocolFact(
      copy.asyncMetadata,
      `${protocolBoolean(region.mvcc.asyncCommit, locale)} · ${copy.secondaryCount}: ${region.mvcc.secondaryCount}`,
    ),
  ),
  )
}

function renderProtocolLane(
  protocolLab: TraceProtocolLabSnapshot,
  lane: TraceProtocolLaneSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  const focused = protocolLab.focusLaneId === lane.id
  return element('article', {
    className: `tidb-machine__protocol-lane is-${lane.id} ${focused ? 'is-focused' : ''}`,
    attrs: {
      'data-protocol-lane': lane.id,
      'data-protocol': lane.protocol,
      'data-protocol-stage': lane.stage,
      'data-protocol-focused': String(focused),
      'data-client-responded': String(lane.clientResponded),
      'data-background-complete': String(lane.backgroundComplete),
      'data-transaction-id': lane.transactionId,
      'data-request-id': lane.requestId,
    },
  },
  element('header', { className: 'tidb-machine__protocol-lane-head' },
    element('div', {},
      element('span', {
        className: 'tidb-machine__protocol-lane-code',
        text: lane.id === 'one_pc'
          ? '1PC'
          : lane.id === 'async_commit'
            ? 'ASYNC'
            : '2PC',
      }),
      element('h3', { text: PROTOCOL_LANE_COPY[locale][lane.id] }),
    ),
    element('span', {
      className: `tidb-machine__protocol-stage is-${lane.stage}`,
      text: PROTOCOL_STAGE_COPY[locale][lane.stage],
      attrs: {
        'aria-label': `${copy.transactionStage}: ${
          PROTOCOL_STAGE_COPY[locale][lane.stage]
        }`,
        'data-stage-state': lane.stage,
        'data-protocol-state-scope': 'exact-event-temporal',
      },
    }),
  ),
  element('dl', {
    className: 'tidb-machine__protocol-lane-identity',
    attrs: {
      'data-protocol-state-scope': 'declared-static',
      'data-profile-visibility': 'comparison-start',
    },
  },
    protocolFact(copy.transactionId, lane.transactionId),
    protocolFact(copy.requestId, lane.requestId),
  ),
  renderProtocolFlow(lane, locale),
  element('div', { className: 'tidb-machine__protocol-details' },
    renderProtocolEligibility(lane, locale),
    renderProtocolTimestamps(lane, locale),
    element('section', {
      className: 'tidb-machine__protocol-card tidb-machine__protocol-regions',
      attrs: {
        'data-protocol-regions': lane.id,
        'data-protocol-state-scope': 'exact-event-temporal',
      },
    },
    element('h4', { text: copy.regionState }),
    element('ul', {
      className: 'tidb-machine__protocol-region-list',
      attrs: { 'aria-label': `${PROTOCOL_LANE_COPY[locale][lane.id]} ${copy.regionState}` },
    },
    ...lane.regions.map((region) =>
      renderProtocolRegion(lane, region, locale)),
    ),
    ),
    element('section', {
      className: 'tidb-machine__protocol-card tidb-machine__protocol-boundary',
      attrs: {
        'data-protocol-client-boundary': lane.id,
        'data-protocol-state-scope': 'exact-event-temporal',
        'data-client-result': lane.clientResponded ? 'committed' : 'pending',
        'data-cleanup-state': lane.protocol === '1pc'
          ? 'not_required'
          : lane.backgroundComplete
            ? 'complete'
            : 'pending',
      },
    },
    element('h4', { text: copy.exactClientResponse }),
    element('strong', {
      text: lane.clientResponded ? copy.responseSent : copy.responsePending,
    }),
    element('p', {
      className: 'tidb-machine__protocol-path-label is-critical',
      text: `● ${copy.criticalPath}`,
    }),
    element('h4', { text: copy.exactCleanup }),
    element('strong', {
      text: lane.protocol === '1pc'
        ? copy.cleanupNotRequired
        : lane.backgroundComplete
          ? copy.cleanupDone
          : copy.cleanupPending,
    }),
    element('p', {
      className: 'tidb-machine__protocol-path-label is-background',
      text: lane.protocol === '1pc'
        ? `◇ ${copy.finishLane}`
        : `⇢ ${copy.backgroundPath}`,
    }),
    ),
  ),
  )
}

function protocolTimestampSummary(
  lane: TraceProtocolLaneSnapshot,
  locale: Locale,
): string {
  const copy = MACHINE_COPY[locale]
  const value = (
    label: string,
    timestamp: number | null,
    source: string,
    applicable = true,
  ) => !applicable
    ? `${label}: ${copy.notApplicable} (${copy.notUsedByProtocol})`
    : `${label}: ${timestamp ?? copy.notAllocated} (${source})`
  return [
    value(copy.startTs, lane.startTs, lane.startTs === null ? copy.futurePath : 'PD TSO'),
    value(
      copy.latestTs,
      lane.latestTs,
      lane.latestTs === null ? copy.futurePath : 'PD TSO',
      lane.protocol !== '2pc',
    ),
    value(
      copy.requestMinCommitTs,
      lane.requestMinCommitTs,
      lane.requestMinCommitTs === null ? copy.futurePath : 'TiDB latest_ts + 1',
      lane.protocol !== '2pc',
    ),
    value(
      copy.maxCommitTs,
      lane.maxCommitTs,
      lane.maxCommitTs === null ? copy.futurePath : 'TiCity MODEL bound',
      lane.protocol !== '2pc',
    ),
    value(
      copy.commitTs,
      lane.commitTs,
      lane.commitTsSource === null
        ? copy.futurePath
        : PROTOCOL_COMMIT_TS_SOURCE_COPY[locale][lane.commitTsSource],
    ),
  ].join('; ')
}

function protocolRegionSummary(
  lane: TraceProtocolLaneSnapshot,
  locale: Locale,
): string {
  const copy = MACHINE_COPY[locale]
  return lane.regions.map((region) => {
    const operation = region.raft.operation === null
      ? copy.empty
      : PROTOCOL_RAFT_OPERATION_COPY[locale][region.raft.operation]
    return [
      `Region ${region.regionId} ${
        region.role === 'primary' ? copy.primary : copy.secondary
      }`,
      `${copy.leader}: ${region.leaderStoreId}`,
      `${copy.raftOperation}: ${operation}`,
      `${copy.raftProgress}: ${PROTOCOL_RAFT_STAGE_COPY[locale][region.raft.stage]}`,
      `${copy.raftQuorum}: ${region.raft.acknowledgements}/${region.raft.quorum}`,
      `${copy.mvccDefault}: ${region.mvcc.defaultCf}`,
      `${copy.mvccLock}: ${region.mvcc.lockCf}`,
      `${copy.mvccWrite}: ${region.mvcc.writeCf}`,
    ].join(', ')
  }).join('; ')
}

function renderProtocolAccessibleMirror(
  protocolLab: TraceProtocolLabSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  const table = element('table', {
    className: 'tidb-machine__protocol-mirror',
    attrs: {
      'data-protocol-mirror': 'accessible',
    },
  },
  element('caption', { text: copy.protocolAccessibleMirror }),
  element('thead', {},
    element('tr', {},
      element('th', { text: copy.protocolLane, attrs: { scope: 'col' } }),
      element('th', { text: copy.transactionStage, attrs: { scope: 'col' } }),
      element('th', { text: copy.eligibility, attrs: { scope: 'col' } }),
      element('th', { text: copy.timestampProvenance, attrs: { scope: 'col' } }),
      element('th', { text: copy.regionState, attrs: { scope: 'col' } }),
      element('th', { text: copy.exactClientResponse, attrs: { scope: 'col' } }),
      element('th', { text: copy.exactCleanup, attrs: { scope: 'col' } }),
    ),
  ),
  )
  const body = element('tbody')
  for (const lane of protocolLab.lanes) {
    const eligibility = lane.eligibility
    body.append(element('tr', {
      attrs: {
        'data-protocol-mirror-lane': lane.id,
        'data-protocol': lane.protocol,
      },
    },
    element('th', {
      text: PROTOCOL_LANE_COPY[locale][lane.id],
      attrs: { scope: 'row' },
    }),
    element('td', {
      text: `${PROTOCOL_STAGE_COPY[locale][lane.stage]}; ${copy.transactionId}: ${lane.transactionId}; ${copy.requestId}: ${lane.requestId}`,
      attrs: { 'data-protocol-state-scope': 'exact-event-temporal' },
    }),
    element('td', {
      text: [
        copy.profileVisibility,
        `${copy.selectedProtocol}: ${lane.protocol}`,
        `${copy.selectionReason}: ${PROTOCOL_SELECTION_REASON_COPY[locale][eligibility.selectionReason]}`,
        `${copy.onePcEligible}: ${protocolBoolean(eligibility.onePcEligible, locale)}`,
        `${copy.asyncEligible}: ${protocolBoolean(eligibility.asyncCommitEligible, locale)}`,
        `${eligibility.mutationCount} mutations / ${eligibility.regionCount} Regions / ${eligibility.totalKeyBytes} bytes`,
        `${copy.runtimeFallback}: ${protocolBoolean(eligibility.runtimeFallback, locale)}`,
      ].join('; '),
      attrs: {
        'data-protocol-state-scope': 'declared-static',
        'data-profile-visibility': 'comparison-start',
      },
    }),
    element('td', {
      text: protocolTimestampSummary(lane, locale),
      attrs: { 'data-protocol-state-scope': 'exact-event-temporal' },
    }),
    element('td', {
      text: protocolRegionSummary(lane, locale),
      attrs: { 'data-protocol-state-scope': 'exact-event-temporal' },
    }),
    element('td', {
      text: lane.clientResponded ? copy.responseSent : copy.responsePending,
      attrs: { 'data-protocol-state-scope': 'exact-event-temporal' },
    }),
    element('td', {
      text: lane.protocol === '1pc'
        ? copy.cleanupNotRequired
        : lane.backgroundComplete
          ? copy.cleanupDone
          : copy.cleanupPending,
      attrs: { 'data-protocol-state-scope': 'exact-event-temporal' },
    }),
    ))
  }
  table.append(body)
  return table
}

function renderProtocolComparisonGraph(
  protocolLab: TraceProtocolLabSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  return element('div', {
    className: 'tidb-machine__protocol-graph',
    attrs: {
      role: 'group',
      tabindex: '0',
      'aria-label': `${copy.protocolGraph}. ${copy.protocolGraphDirection}`,
      'data-protocol-graph': 'semantic',
      'data-graph-kind': 'commit-protocol-comparison',
      'data-protocol-phase': protocolLab.phase,
      'data-focus-lane': protocolLab.focusLaneId ?? '',
      'data-lane-count': String(protocolLab.lanes.length),
      'data-latency-benchmark': 'false',
    },
  },
  element('div', { className: 'tidb-machine__protocol-card-head' },
    element('h3', { text: copy.protocolGraph }),
    element('span', {
      className: 'tidb-machine__protocol-graph-contract',
      text: copy.protocolGraphContract,
    }),
  ),
  element('p', {
    className: 'tidb-machine__protocol-direction',
    text: copy.protocolGraphDirection,
  }),
  element('div', {
    className: 'tidb-machine__protocol-visual',
    attrs: {
      'aria-hidden': 'true',
      'data-protocol-visual': 'matrix',
    },
  },
  ...protocolLab.lanes.map((lane) =>
    renderProtocolLane(protocolLab, lane, locale)),
  ),
  renderProtocolAccessibleMirror(protocolLab, locale),
  )
}

function renderProtocolState(
  event: MachineEvent,
  locale: Locale,
): HTMLElement | null {
  const protocolLab = event.snapshot?.protocolLab
  if (!protocolLab) return null
  const copy = MACHINE_COPY[locale]
  return element('section', {
    className: 'tidb-machine__protocol-state',
    attrs: {
      'aria-labelledby': 'tidb-machine-protocol-title',
      'data-protocol-lab-state': 'true',
      'data-protocol-event-id': event.id,
      'data-protocol-event-kind': event.kind ?? '',
      'data-protocol-event-branch': event.branchId ?? '',
      'data-protocol-phase': protocolLab.phase,
      'data-protocol-focus': protocolLab.focusLaneId ?? '',
      'data-coordinator-layer': protocolLab.coordinatorLayer,
      'data-raft-layer': protocolLab.raftLayer,
      'data-client-boundary': protocolLab.clientBoundary,
      'data-representation': protocolLab.representation,
      'data-transaction-mode': protocolLab.transactionMode,
      'data-transaction-scope': protocolLab.transactionScope,
      'data-safe-window-ms': String(protocolLab.safeWindowMs),
      'data-tikv-async-apply-prewrite': String(
        protocolLab.tikvAsyncApplyPrewrite,
      ),
      'data-background-scheduling': protocolLab.backgroundScheduling,
      'data-max-commit-ts-policy': protocolLab.maxCommitTsPolicy,
      'data-latency-benchmark': 'false',
    },
  },
  element('header', { className: 'tidb-machine__protocol-head' },
    element('div', {},
      element('p', {
        className: 'tidb-machine__protocol-eyebrow',
        text: copy.protocolEyebrow,
      }),
      element('h2', {
        text: copy.protocolTitle,
        attrs: { id: 'tidb-machine-protocol-title' },
      }),
    ),
    element('div', { className: 'tidb-machine__protocol-head-meta' },
      element('span', {
        className: `tidb-machine__protocol-phase is-${protocolLab.phase}`,
        text: `${copy.protocolPhase}: ${
          protocolLab.phase === 'complete'
            ? copy.completeValue
            : protocolLab.phase === 'running'
              ? copy.runningValue
              : copy.idleValue
        }`,
        attrs: { 'data-phase-state': protocolLab.phase },
      }),
      element('span', {
        className: 'tidb-machine__protocol-snapshot',
        text: `SNAPSHOT · ${event.id}`,
      }),
    ),
  ),
  element('dl', { className: 'tidb-machine__protocol-summary' },
    protocolFact(
      copy.protocolFocus,
      protocolLab.focusLaneId === null
        ? copy.focusNone
        : PROTOCOL_LANE_COPY[locale][protocolLab.focusLaneId],
    ),
    protocolFact(copy.consistency, copy.linearizable),
    protocolFact(copy.clientResponse, copy.responseBoundaryNote),
    protocolFact(
      copy.backgroundPath,
      copy.deterministicBackground,
    ),
  ),
  renderProtocolComparisonGraph(protocolLab, locale),
  element('div', { className: 'tidb-machine__protocol-notes' },
    element('p', {
      className: 'tidb-machine__protocol-boundary-note',
      text: copy.transactionRaftBoundary,
      attrs: {
        'data-transaction-raft-boundary': 'separate',
        'data-one-pc-raft-mode': 'false',
        'data-async-commit-raft-mode': 'false',
      },
    }),
    element('p', {
      className: 'tidb-machine__protocol-model-note',
      text: copy.nonBenchmark,
      attrs: {
        'data-model-simulated': 'true',
        'data-latency-benchmark': 'false',
      },
    }),
    element('p', {
      className: 'tidb-machine__protocol-boundary-note',
      text: copy.responseBoundaryNote,
      attrs: { 'data-response-before-cleanup': 'true' },
    }),
    element('p', {
      className: 'tidb-machine__protocol-boundary-note',
      text: copy.eligibilityCaveat,
      attrs: { 'data-region-count-alone-sufficient': 'false' },
    }),
    element('p', {
      className: 'tidb-machine__protocol-boundary-note',
      text: copy.aggregateOnly,
      attrs: { 'data-aggregate-counts-only': 'true' },
    }),
  ),
  )
}

function renderRaftPeerCard(
  peer: TraceRaftLabPeerSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = MACHINE_COPY[locale]
  return element('li', {
    className: 'tidb-machine__raft-peer',
    attrs: {
      'data-raft-peer': peer.storeId,
      'data-peer-role': peer.role,
      'data-peer-health': peer.healthy ? 'healthy' : 'down',
      'data-peer-term': String(peer.currentTerm),
      'data-peer-voted-for': peer.votedFor ?? '',
    },
  },
  element('div', { className: 'tidb-machine__raft-peer-head' },
    element('strong', {
      text: `${peer.healthy ? '●' : '×'} ${peer.storeId}`,
    }),
    element('span', {
      className: 'tidb-machine__raft-role',
      text: RAFT_ROLE_COPY[locale][peer.role],
      attrs: {
        'aria-label': `${copy.raftRole}: ${RAFT_ROLE_COPY[locale][peer.role]}`,
      },
    }),
  ),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.health, peer.healthy ? copy.healthy : copy.down),
    raftFact(copy.currentTerm, String(peer.currentTerm)),
    raftFact(copy.votedFor, peer.votedFor ?? copy.empty),
    raftFact(copy.lastLog, `${peer.lastLogIndex} / ${peer.lastLogTerm}`),
    raftFact(copy.matchIndex, String(peer.matchIndex)),
    raftFact(copy.commitIndex, String(peer.commitIndex)),
    raftFact(copy.appliedIndex, String(peer.appliedIndex)),
  ),
  )
}

function renderRaftState(
  event: MachineEvent,
  locale: Locale,
): HTMLElement | null {
  const raftLab = event.snapshot?.raftLab
  if (!raftLab) return null
  const copy = MACHINE_COPY[locale]
  const election = raftLab.election
  const log = raftLab.log
  const request = raftLab.request
  const pd = raftLab.pd
  const clientResult = request.status === 'completed' ? 'success' : 'pending'
  const logEntry =
    log.entryKind === null || log.index === null || log.term === null
      ? copy.noEntry
      : `${log.entryKind} · index ${log.index} · term ${log.term}`

  const policyCard = element('section', {
    className: 'tidb-machine__raft-card',
    attrs: {
      'data-raft-policy': 'model-policy',
      'data-candidate-policy': election.candidatePolicy,
      'data-prevote-enabled': String(election.prevoteEnabled),
      'data-configured-timeout-min': String(
        election.configuredElectionTimeoutTicks,
      ),
      'data-configured-timeout-max': String(
        election.configuredMaxElectionTimeoutTicks,
      ),
      'data-elapsed-ticks': String(election.elapsedTicks),
    },
  },
  element('h3', { text: copy.electionPolicy }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(
      copy.electionState,
      RAFT_ELECTION_PHASE_COPY[locale][election.phase],
    ),
    raftFact(copy.candidate, election.candidateStoreId ?? copy.pending),
    raftFact(
      copy.preVote,
      election.prevoteEnabled ? copy.enabled : copy.no,
    ),
    raftFact(copy.candidatePolicy, copy.candidatePolicyValue),
    raftFact(
      copy.configuredWindow,
      `${election.configuredElectionTimeoutTicks}–${election.configuredMaxElectionTimeoutTicks} ${copy.ticks}`,
    ),
    raftFact(
      copy.elapsedTicks,
      `${election.elapsedTicks} ${copy.ticks}`,
    ),
  ),
  element('p', {
    className: 'tidb-machine__raft-policy-note',
    text: copy.deterministicPolicy,
    attrs: {
      'data-policy-contract': election.candidatePolicy,
    },
  }),
  )

  const logCard = element('section', {
    className: 'tidb-machine__raft-card',
    attrs: {
      'data-raft-log-entry': log.entryKind ?? 'none',
      'data-raft-log-committed': String(log.committed),
    },
  },
  element('h3', { text: copy.postElectionLog }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.logEntry, logEntry),
    raftFact(
      copy.persistedStores,
      log.persistedStoreIds.length > 0
        ? log.persistedStoreIds.join(' · ')
        : copy.empty,
    ),
    raftFact(copy.committed, log.committed ? copy.yes : copy.no),
    raftFact(
      copy.appliedStores,
      log.appliedStoreIds.length > 0
        ? log.appliedStoreIds.join(' · ')
        : copy.empty,
    ),
  ),
  )

  const pdCard = element('section', {
    className: 'tidb-machine__raft-card is-pd-boundary',
    attrs: {
      'data-pd-role': pd.role,
      'data-pd-votes': 'false',
      'data-pd-route-lookup': String(pd.routeLookupCompleted),
    },
  },
  element('h3', { text: copy.pdBoundary }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.pdRole, copy.pdObserveRouteOnly),
    raftFact(copy.observedLeader, pd.observedLeaderStoreId ?? copy.empty),
    raftFact(
      copy.routeLookup,
      pd.routeLookupCompleted ? copy.completeValue : copy.incompleteValue,
    ),
  ),
  element('p', {
    className: 'tidb-machine__raft-boundary-note',
    text: copy.pdDoesNotVote,
  }),
  )

  const retryCard = element('section', {
    className: 'tidb-machine__raft-card is-retry-boundary',
    attrs: {
      'data-raft-request': request.logicalRequestId,
      'data-retry-source': request.source,
      'data-same-logical-request': 'true',
      'data-application-retry': 'false',
      'data-request-status': request.status,
      'data-request-attempt': String(request.attempt),
      'data-client-visible-error': String(request.clientVisibleError),
      'data-client-result': clientResult,
    },
  },
  element('h3', { text: copy.tidbRetry }),
  element('dl', { className: 'tidb-machine__raft-facts' },
    raftFact(copy.logicalRequest, request.logicalRequestId),
    raftFact(copy.raftRetrySource, copy.tidbInternal),
    raftFact(copy.retryAttempt, String(request.attempt)),
    raftFact(copy.cachedLeader, request.cachedLeaderStoreId ?? copy.empty),
    raftFact(
      copy.cacheState,
      RAFT_CACHE_STATE_COPY[locale][request.cacheState],
    ),
    raftFact(
      copy.requestState,
      RAFT_REQUEST_STATUS_COPY[locale][request.status],
    ),
    raftFact(copy.internalBackoff, `${request.backoffMs} ms`),
    raftFact(copy.clientVisibleError, String(request.clientVisibleError)),
    raftFact(
      copy.clientBoundary,
      clientResult === 'success' ? copy.clientSuccess : copy.clientPending,
    ),
  ),
  element('p', {
    className: 'tidb-machine__raft-boundary-note',
    text: copy.sameLogicalRetry,
  }),
  )

  return element('section', {
    className: 'tidb-machine__raft-state',
    attrs: {
      'aria-labelledby': 'tidb-machine-raft-title',
      'data-raft-lab-state': 'true',
      'data-raft-event-id': event.id,
      'data-raft-event-kind': event.kind ?? '',
      'data-raft-event-branch': event.branchId ?? '',
      'data-raft-phase': raftLab.phase,
      'data-region-id': String(raftLab.regionId),
    },
  },
  element('header', { className: 'tidb-machine__raft-head' },
    element('div', {},
      element('p', {
        className: 'tidb-machine__raft-eyebrow',
        text: copy.raftEyebrow,
      }),
      element('h2', {
        text: copy.raftTitle,
        attrs: { id: 'tidb-machine-raft-title' },
      }),
    ),
    element('div', { className: 'tidb-machine__raft-head-meta' },
      element('span', {
        className: 'tidb-machine__raft-phase',
        text: `${copy.raftPhase}: ${RAFT_PHASE_COPY[locale][raftLab.phase]}`,
        attrs: { 'data-phase-state': raftLab.phase },
      }),
      element('span', {
        className: 'tidb-machine__raft-snapshot',
        text: `SNAPSHOT · ${event.id}`,
      }),
    ),
  ),
  element('dl', { className: 'tidb-machine__raft-summary' },
    raftFact(copy.region, `Region ${raftLab.regionId}`),
    raftFact(
      copy.oldToNewLeader,
      `${raftLab.oldLeaderStoreId} → ${raftLab.leaderStoreId ?? copy.noLeader}`,
    ),
    raftFact(copy.failedStore, raftLab.failedStoreId ?? copy.empty),
    raftFact(copy.liveVoters, `${raftLab.liveVoterCount}/3`),
    raftFact(copy.electionQuorum, copy.twoOfThree),
  ),
  renderRaftElectionGraph(raftLab, locale),
  element('section', {
    className: 'tidb-machine__raft-peers',
    attrs: { 'aria-labelledby': 'tidb-machine-raft-peers-title' },
  },
  element('h3', {
    text: copy.peerStates,
    attrs: { id: 'tidb-machine-raft-peers-title' },
  }),
  element('ul', {
    className: 'tidb-machine__raft-peer-list',
    attrs: { 'aria-label': copy.peerStates },
  },
  ...raftLab.peers.map((peer) => renderRaftPeerCard(peer, locale)),
  ),
  ),
  element('div', { className: 'tidb-machine__raft-grid' },
    policyCard,
    logCard,
    pdCard,
    retryCard,
  ),
  )
}

function gcFact(label: string, value: string): HTMLElement {
  return element('div', {},
    element('dt', { text: label }),
    element('dd', { text: value }),
  )
}

function gcTimestamp(
  value: number | null,
  locale: Locale,
): string {
  return value === null ? GC_MACHINE_COPY[locale].pending : String(value)
}

function gcBoolean(value: boolean, locale: Locale): string {
  const copy = GC_MACHINE_COPY[locale]
  return value ? copy.yes : copy.no
}

function gcCurrentPipelineStage(
  snapshot: TraceGcLabSnapshot,
): GcPipelineStage | null {
  if (snapshot.phase === 'preparing') {
    return snapshot.safePoint.candidate === null ? 'candidate' : 'bound'
  }
  const phaseStage: Partial<Record<TraceGcLabPhase, GcPipelineStage>> = {
    safe_point_bounded: 'mysql_staged',
    resolving_locks: 'resolve_locks',
    caching_safe_point: 'visibility_saved',
    deleting_ranges: 'delete_range',
    publishing_safe_point: 'pd_published',
    tikv_observing: 'tikv_detected',
    compacting: 'compaction_filter',
  }
  return phaseStage[snapshot.phase] ?? null
}

function gcPipelineState(
  snapshot: TraceGcLabSnapshot,
  round: 1 | 2,
  stage: GcPipelineStage,
): GcPipelineState {
  if (round < snapshot.round) return 'complete'
  if (round > snapshot.round) return 'future'
  if (snapshot.phase === 'between_rounds' || snapshot.phase === 'complete') {
    return 'complete'
  }
  const currentStage = gcCurrentPipelineStage(snapshot)
  if (currentStage === null) return 'future'
  const currentIndex = GC_PIPELINE_STAGES.indexOf(currentStage)
  const stageIndex = GC_PIPELINE_STAGES.indexOf(stage)
  if (stageIndex < currentIndex) return 'complete'
  return stageIndex === currentIndex ? 'current' : 'future'
}

function gcDeleteRangeState(
  snapshot: TraceGcLabSnapshot,
): TraceGcLabSnapshot['deleteRanges'][number]['status'] {
  if (snapshot.deleteRanges.every((range) => range.status === 'deleted')) {
    return 'deleted'
  }
  if (snapshot.deleteRanges.some((range) => range.status === 'eligible')) {
    return 'eligible'
  }
  return 'pending'
}

function gcPipelineStageValue(
  snapshot: TraceGcLabSnapshot,
  round: 1 | 2,
  stage: GcPipelineStage,
  locale: Locale,
): string {
  const copy = GC_MACHINE_COPY[locale]
  if (round < snapshot.round) return copy.priorRound
  if (round > snapshot.round) return copy.futureRound
  switch (stage) {
    case 'candidate':
      return gcTimestamp(snapshot.safePoint.candidate, locale)
    case 'bound':
      if (snapshot.safePoint.serviceSafePoint === null) return copy.pending
      return snapshot.safePoint.blocked
        ? `${snapshot.safePoint.globalMinStartTs} - 1 = ${snapshot.safePoint.activeTransactionBound}`
        : String(snapshot.safePoint.serviceSafePoint)
    case 'mysql_staged':
      return String(snapshot.safePoint.staged)
    case 'resolve_locks':
      return `${snapshot.resolveLocks.scannedRegionIds.length} / 2`
    case 'visibility_saved':
      return String(snapshot.safePoint.visibilitySaved)
    case 'delete_range':
      return copy.deleteStates[gcDeleteRangeState(snapshot)]
    case 'pd_published':
      return String(snapshot.safePoint.published)
    case 'tikv_detected': {
      const detected = snapshot.stores.filter((store) =>
        store.detectedSafePoint === snapshot.safePoint.published &&
        snapshot.safePoint.published > snapshot.safePoint.previous).length
      return `${detected} / ${snapshot.stores.length}`
    }
    case 'compaction_filter':
      return `${snapshot.stores.filter((store) =>
        store.compaction === 'complete').length} / ${snapshot.stores.length}`
  }
}

function renderGcPipelineRound(
  snapshot: TraceGcLabSnapshot,
  round: 1 | 2,
  locale: Locale,
): HTMLElement {
  const copy = GC_MACHINE_COPY[locale]
  const rowState = round < snapshot.round ||
    (
      round === snapshot.round &&
      (snapshot.phase === 'between_rounds' || snapshot.phase === 'complete')
    )
    ? 'complete'
    : round === snapshot.round
      ? 'current'
      : 'future'
  return element('article', {
    className: `tidb-machine__gc-round is-${rowState}`,
    attrs: {
      'data-gc-pipeline-round': String(round),
      'data-gc-round-state': rowState,
    },
  },
  element('header', { className: 'tidb-machine__gc-round-head' },
    element('h4', { text: `${copy.round} ${round}` }),
    element('span', {
      className: `tidb-machine__gc-round-state is-${rowState}`,
      text: copy.states[rowState],
    }),
  ),
  element('ol', {
    className: 'tidb-machine__gc-flow',
    attrs: {
      'aria-label': `${copy.round} ${round}: ${copy.graphTitle}`,
    },
  },
  ...GC_PIPELINE_STAGES.map((stage) => {
    const state = gcPipelineState(snapshot, round, stage)
    return element('li', {
      className: `tidb-machine__gc-flow-node is-${state}`,
      attrs: {
        'data-gc-pipeline-stage': stage,
        'data-gc-pipeline-state': state,
        'aria-current': state === 'current' ? 'step' : 'false',
      },
    },
    element('span', { text: copy.stages[stage] }),
    element('strong', {
      text: gcPipelineStageValue(snapshot, round, stage, locale),
    }),
    element('small', { text: copy.states[state] }),
    )
  }),
  ),
  )
}

function renderGcSafePointStores(
  snapshot: TraceGcLabSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = GC_MACHINE_COPY[locale]
  const stores = [
    {
      id: 'mysql_staged',
      title: copy.mysqlStatus,
      label: `${copy.stagedValue} · ${copy.leaderLease}: ${
        snapshot.configuration.gcLeaderLeaseStore
      }`,
      value: snapshot.safePoint.staged,
    },
    {
      id: 'visibility_saved',
      title: copy.visibilityCache,
      label: `${copy.savedValue} · ${copy.cacheBarrier}: ${
        snapshot.configuration.visibilityCacheBarrierSeconds
      } s`,
      value: snapshot.safePoint.visibilitySaved,
    },
    {
      id: 'pd_global',
      title: copy.pdGlobal,
      label: copy.publishedValue,
      value: snapshot.safePoint.published,
    },
  ] as const
  return element('section', {
    className: 'tidb-machine__gc-safe-point-stores',
    attrs: { 'aria-labelledby': 'tidb-machine-gc-safe-point-stores-title' },
  },
  element('h3', {
    text: copy.safePointStores,
    attrs: { id: 'tidb-machine-gc-safe-point-stores-title' },
  }),
  element('p', {
    className: 'tidb-machine__gc-direction',
    text: copy.safePointStoresNote,
  }),
  element('div', {
    className: 'tidb-machine__gc-safe-point-store-list',
    attrs: { role: 'list' },
  },
  ...stores.map((store) => {
    const card = element('article', {
      className: 'tidb-machine__gc-safe-point-store',
      attrs: {
        'data-safe-point-store': store.id,
        'data-safe-point-value': String(store.value),
        ...(store.id === 'mysql_staged'
          ? {
            'data-gc-leader-lease-store':
              snapshot.configuration.gcLeaderLeaseStore,
          }
          : {}),
        ...(store.id === 'visibility_saved'
          ? {
            'data-visibility-cache-barrier-seconds': String(
              snapshot.configuration.visibilityCacheBarrierSeconds,
            ),
          }
          : {}),
      },
    },
    element('h4', { text: store.title }),
    element('span', { text: store.label }),
    element('strong', { text: String(store.value) }),
    )
    card.setAttribute('role', 'listitem')
    return card
  }),
  ),
  )
}

function renderGcResolveLocks(
  snapshot: TraceGcLabSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = GC_MACHINE_COPY[locale]
  return element('section', {
    className: 'tidb-machine__gc-card tidb-machine__gc-resolve',
    attrs: {
      'data-gc-resolve-implementation': snapshot.resolveLocks.implementation,
      'data-resolve-lock-raft-detail': snapshot.configuration
        .resolveLockRaftDetailModeled ? 'modeled' : 'outside-slice',
      'data-resolve-lock-raft-detail-modeled': String(
        snapshot.configuration.resolveLockRaftDetailModeled,
      ),
    },
  },
  element('h3', { text: copy.resolveTitle }),
  element('dl', { className: 'tidb-machine__gc-facts' },
    gcFact(copy.resolveImplementation, snapshot.resolveLocks.implementation),
    gcFact(
      copy.resolveRegions,
      snapshot.resolveLocks.scannedRegionIds.length > 0
        ? snapshot.resolveLocks.scannedRegionIds
          .map((regionId) => `Region ${regionId}`).join(' · ')
        : copy.noRegions,
    ),
  ),
  snapshot.resolveLocks.locks.length > 0
    ? element('ul', {
      className: 'tidb-machine__gc-lock-list',
      attrs: { 'aria-label': copy.resolvedLocks },
    },
    ...snapshot.resolveLocks.locks.map((lock) => {
      const state = lock.status === 'resolved_commit'
        ? copy.committedPrimary
        : lock.status === 'resolved_rollback'
          ? copy.rolledBackPrimary
          : copy.pendingLock
      return element('li', {
        attrs: {
          'data-gc-lock': lock.id,
          'data-gc-lock-state': lock.status,
          'data-primary-state': lock.primaryStatus,
        },
      },
      element('code', { text: lock.id }),
      element('span', { text: `Region ${lock.regionId}` }),
      element('strong', { text: state }),
      )
    }),
    )
    : element('p', {
      className: 'tidb-machine__gc-empty',
      text: copy.noLocks,
    }),
  element('p', {
    className: 'tidb-machine__gc-boundary-note',
    text: copy.resolveBoundary,
  }),
  )
}

function renderGcDeleteRange(
  snapshot: TraceGcLabSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = GC_MACHINE_COPY[locale]
  const rangeState = gcDeleteRangeState(snapshot)
  return element('section', {
    className: 'tidb-machine__gc-card tidb-machine__gc-delete-range',
    attrs: {
      'data-raftstore-mode': snapshot.configuration.raftstoreMode,
      'data-unsafe-destroy-range-raft': String(
        !snapshot.configuration.deleteRangeBypassesRaft,
      ),
      'data-delete-range-state': rangeState,
    },
  },
  element('h3', { text: copy.deleteTitle }),
  element('dl', { className: 'tidb-machine__gc-facts' },
    gcFact(copy.rangeState, copy.deleteStates[rangeState]),
    gcFact(
      copy.unsafeDestroy,
      snapshot.deleteRanges.map((range) => range.id).join(' · '),
    ),
  ),
  element('div', {
    className: 'tidb-machine__gc-unsafe-store-list',
    attrs: { role: 'list' },
  },
  ...snapshot.stores.map((store) => {
    const aggregateComplete = rangeState === 'deleted'
    const card = element('article', {
      className: `tidb-machine__gc-unsafe-store is-${rangeState}`,
      attrs: {
        'data-unsafe-destroy-store': store.storeId,
        'data-unsafe-destroy-request':
          snapshot.configuration.deleteRangeRequest,
        'data-unsafe-destroy-raft-bypass': String(
          snapshot.configuration.deleteRangeBypassesRaft,
        ),
        'data-store-ack': aggregateComplete
          ? 'aggregate_complete'
          : 'not_projected',
      },
    },
    element('strong', { text: store.storeId }),
    element('code', { text: snapshot.configuration.deleteRangeRequest }),
    element('small', {
      text: aggregateComplete ? copy.aggregateComplete : copy.ackNotProjected,
    }),
    )
    card.setAttribute('role', 'listitem')
    return card
  }),
  ),
  element('p', {
    className: 'tidb-machine__gc-boundary-note',
    text: copy.deleteNote,
  }),
  )
}

function renderGcTiKvStores(
  snapshot: TraceGcLabSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = GC_MACHINE_COPY[locale]
  return element('section', {
    className: 'tidb-machine__gc-card tidb-machine__gc-tikv-stores',
  },
  element('h3', { text: copy.storeTitle }),
  element('div', {
    className: 'tidb-machine__gc-tikv-store-list',
    attrs: { role: 'list' },
  },
  ...snapshot.stores.map((store) => {
    const card = element('article', {
      className: `tidb-machine__gc-tikv-store is-${store.compaction}`,
      attrs: {
        'data-gc-tikv-store': store.storeId,
        'data-detected-safe-point': String(store.detectedSafePoint),
        'data-compaction-state': store.compaction,
        'data-filter-active': String(store.filterActive),
      },
    },
    element('h4', { text: store.storeId }),
    element('dl', { className: 'tidb-machine__gc-facts' },
      gcFact(copy.detectedSafePoint, String(store.detectedSafePoint)),
      gcFact(copy.compaction, copy.compactionStates[store.compaction]),
      gcFact(copy.filterActive, gcBoolean(store.filterActive, locale)),
    ),
    )
    card.setAttribute('role', 'listitem')
    return card
  }),
  ),
  )
}

function renderGcStorage(
  snapshot: TraceGcLabSnapshot,
  locale: Locale,
): HTMLElement {
  const copy = GC_MACHINE_COPY[locale]
  const versions = snapshot.keyChains.flatMap((chain) => chain.versions)
  const anchors = versions.filter((version) =>
    version.state === 'retained_anchor' && version.writeType === 'put')
  const deleteChains = snapshot.keyChains.filter((chain) =>
    chain.versions.some((version) =>
      version.writeType === 'delete' && version.state === 'filtered'))
  const defaultDeletes = versions.filter((version) =>
    version.state === 'filtered' &&
    version.writeType === 'put' &&
    version.valueStorage === 'write_and_default_cf')
  return element('section', {
    className: 'tidb-machine__gc-storage',
    attrs: {
      'data-storage-representation': snapshot.storage.representation,
      'data-logical-chains-counted-once': 'true',
      'data-replica-multiplier': '1',
    },
  },
  element('h3', { text: copy.storageTitle }),
  element('p', {
    className: 'tidb-machine__gc-direction',
    text: copy.storageNote,
  }),
  element('dl', { className: 'tidb-machine__gc-storage-summary' },
    gcFact(copy.initialVersions, String(snapshot.storage.initialVersionCount)),
    gcFact(copy.filteredVersions, String(snapshot.storage.filteredVersionCount)),
    gcFact(
      copy.putAnchors,
      anchors.length > 0
        ? `${anchors.length} · ${anchors.map((version) => version.id).join(', ')}`
        : copy.none,
    ),
    gcFact(
      copy.deleteChains,
      deleteChains.length > 0
        ? deleteChains.map((chain) => chain.id).join(', ')
        : copy.none,
    ),
    gcFact(
      copy.defaultDeletes,
      defaultDeletes.length > 0
        ? `${snapshot.storage.deletedDefaultCfValues} · ${defaultDeletes
          .map((version) => version.id).join(', ')}`
        : `0 · ${copy.none}`,
    ),
  ),
  element('div', {
    className: 'tidb-machine__gc-chain-list',
    attrs: { role: 'list' },
  },
  ...snapshot.keyChains.map((chain) => {
    const card = element(
      'article',
      {
        className: 'tidb-machine__gc-chain',
        attrs: {
          'data-gc-chain': chain.id,
          'data-region-id': String(chain.regionId),
        },
      },
      element('header', {},
        element('h4', { text: chain.id }),
        element('span', { text: `${copy.region} ${chain.regionId}` }),
      ),
      element(
        'ol',
        {
          className: 'tidb-machine__gc-version-list',
          attrs: { 'aria-label': chain.id },
        },
        ...chain.versions.map((version) => element(
          'li',
          {
        className: `is-${version.state}`,
        attrs: {
          'data-gc-version': version.id,
          'data-gc-version-state': version.state,
          'data-gc-write-type': version.writeType,
          'data-gc-value-storage': version.valueStorage,
        },
          },
          element('code', { text: version.id }),
          element('span', {
            text: `${copy.writeType}: ${version.writeType}`,
          }),
          element('span', {
            text: `${copy.valueStorage}: ${version.valueStorage}`,
          }),
          element('strong', {
            text: version.state === 'retained_anchor'
              ? copy.retainedAnchor
              : copy[version.state],
          }),
        )),
      ),
    )
    card.setAttribute('role', 'listitem')
    return card
  }),
  ),
  )
}

function renderGcState(
  event: MachineEvent,
  locale: Locale,
): HTMLElement | null {
  const gcLab = event.snapshot?.gcLab
  if (!gcLab) return null
  const copy = GC_MACHINE_COPY[locale]
  const detectedStores = gcLab.stores.filter((store) =>
    store.detectedSafePoint === gcLab.safePoint.published &&
    gcLab.safePoint.published > gcLab.safePoint.previous).length
  const compactedStores = gcLab.stores.filter((store) =>
    store.compaction === 'complete').length

  return element('section', {
    className: 'tidb-machine__gc-state',
    attrs: {
      'aria-labelledby': 'tidb-machine-gc-title',
      'data-gc-machine-state': 'true',
      'data-gc-event-id': event.id,
      'data-gc-event-kind': event.kind ?? '',
      'data-gc-phase': gcLab.phase,
      'data-gc-round': String(gcLab.round),
      'data-gc-model': 'model-6',
    },
  },
  element('header', { className: 'tidb-machine__gc-head' },
    element('div', {},
      element('p', {
        className: 'tidb-machine__gc-eyebrow',
        text: copy.eyebrow,
      }),
      element('h2', {
        text: copy.title,
        attrs: { id: 'tidb-machine-gc-title' },
      }),
    ),
    element('div', { className: 'tidb-machine__gc-head-meta' },
      element('span', {
        className: `tidb-machine__gc-phase is-${gcLab.phase}`,
        text: `${copy.phase}: ${copy.phaseNames[gcLab.phase]}`,
      }),
      element('span', {
        className: 'tidb-machine__gc-snapshot',
        text: `${copy.snapshot} · ${event.id}`,
      }),
    ),
  ),
  element('dl', { className: 'tidb-machine__gc-summary' },
    gcFact(copy.round, `${gcLab.round} / 2`),
    gcFact(copy.previous, String(gcLab.safePoint.previous)),
    gcFact(copy.candidate, gcTimestamp(gcLab.safePoint.candidate, locale)),
    gcFact(
      copy.globalMinStartTs,
      gcTimestamp(gcLab.safePoint.globalMinStartTs, locale),
    ),
    gcFact(
      copy.activeBound,
      gcTimestamp(gcLab.safePoint.activeTransactionBound, locale),
    ),
    gcFact(
      copy.serviceBound,
      gcTimestamp(gcLab.safePoint.serviceSafePoint, locale),
    ),
    gcFact(copy.blocked, gcBoolean(gcLab.safePoint.blocked, locale)),
    gcFact(
      copy.blocker,
      `${gcLab.blocker.transactionId} · ${
        gcLab.blocker.status === 'active' ? copy.active : copy.completed
      }`,
    ),
    gcFact(
      copy.scanned,
      String(gcLab.resolveLocks.scannedRegionIds.length),
    ),
    gcFact(copy.detected, `${detectedStores} / ${gcLab.stores.length}`),
    gcFact(copy.compacted, `${compactedStores} / ${gcLab.stores.length}`),
  ),
  element('section', {
    className: 'tidb-machine__gc-graph',
    attrs: {
      tabindex: '0',
      'aria-label': copy.graphTitle,
      'data-gc-semantic-graph': 'pipeline',
      'data-causal-dag-replaced': 'false',
    },
  },
  element('div', { className: 'tidb-machine__gc-graph-head' },
    element('h3', { text: copy.graphTitle }),
    element('span', {
      className: 'tidb-machine__gc-graph-contract',
      text: copy.graphContract,
    }),
  ),
  element('p', {
    className: 'tidb-machine__gc-direction',
    text: copy.graphDirection,
  }),
  element('div', { className: 'tidb-machine__gc-graph-scroll' },
    renderGcPipelineRound(gcLab, 1, locale),
    renderGcPipelineRound(gcLab, 2, locale),
  ),
  ),
  renderGcSafePointStores(gcLab, locale),
  element('div', { className: 'tidb-machine__gc-detail-grid' },
    renderGcResolveLocks(gcLab, locale),
    renderGcDeleteRange(gcLab, locale),
    renderGcTiKvStores(gcLab, locale),
  ),
  renderGcStorage(gcLab, locale),
  element('section', {
    className: 'tidb-machine__gc-boundaries',
    attrs: {
      'data-compaction-filter-raft-entry': 'false',
      'data-raft-log-gc-modeled': 'false',
      'data-real-key-material': 'false',
    },
  },
  element('h3', { text: copy.boundaries }),
  element('p', {
    className: 'tidb-machine__gc-boundary-note is-compaction',
    text: copy.compactionBoundary,
  }),
  element('p', {
    className: 'tidb-machine__gc-boundary-note',
    text: copy.separateBoundary,
  }),
  element('p', {
    className: 'tidb-machine__gc-privacy',
    text: copy.privacy,
  }),
  ),
  )
}

function renderTiFlashMppState(
  event: MachineEvent,
  locale: Locale,
): HTMLElement | null {
  const lab = event.snapshot?.tiflashMppLab
  if (!lab) return null
  const copy = TIFLASH_MPP_MACHINE_COPY[locale]
  const taskById = new Map(lab.tasks.map((task) => [task.id, task]))

  const learnerRail = element('section', {
    className: 'tidb-machine__tiflash-rail is-persistent',
    attrs: {
      'data-tiflash-plane': lab.configuration.replicationPlane,
      'data-initial-snapshot-modeled': String(
        lab.configuration.initialSnapshotTransferModeled,
      ),
    },
  },
  element('header', {},
    element('h3', { text: copy.learners }),
    element('span', { text: copy.persistent }),
  ),
  element('div', {
    className: 'tidb-machine__tiflash-card-grid',
    attrs: { role: 'list' },
  },
  ...lab.learners.map((learner) => {
    const card = element('article', {
      className: `tidb-machine__tiflash-card is-${learner.readGate}`,
      attrs: {
        role: 'listitem',
        'data-tiflash-learner-region': String(learner.regionId),
        'data-tiflash-learner-store': learner.learnerStoreId,
        'data-tiflash-learner-role': learner.role,
        'data-tiflash-learner-voter': String(learner.voter),
        'data-tiflash-read-gate': learner.readGate,
        'data-tiflash-gate-reason': learner.gateReason ?? '',
        'data-required-read-index':
          learner.requiredReadIndex === null
            ? ''
            : String(learner.requiredReadIndex),
        'data-applied-index': String(learner.learnerAppliedIndex),
      },
    },
    element('h4', { text: `${copy.region} ${learner.regionId}` }),
    element('strong', {
      text: `${copy.learner}: ${learner.learnerStoreId}`,
    }),
    element('span', {
      text:
        `${copy.indexes}: ${learner.leaderCommitIndex} / ` +
        `${learner.learnerReceivedIndex} / ` +
        `${learner.deltaMergeFlushedIndex} / ` +
        `${learner.learnerAppliedIndex} / ` +
        `${learner.requiredReadIndex ?? '—'}`,
    }),
    element('span', {
      text: `${copy.gate}: ${learner.readGate}` +
        `${learner.gateReason ? ` · ${learner.gateReason}` : ''}`,
    }),
    )
    return card
  }),
  ),
  )

  const fragmentGraph = element('section', {
    className: 'tidb-machine__tiflash-graph',
    attrs: {
      tabindex: '0',
      'aria-label': copy.graphTitle,
      'data-tiflash-mpp-semantic-graph': 'fragment-task',
      'data-causal-dag-replaced': 'false',
      'data-fragment-count': String(lab.fragments.length),
      'data-task-count': String(lab.tasks.length),
      'data-tunnel-count': String(lab.tunnels.length),
    },
  },
  element('header', {},
    element('div', {},
      element('h3', { text: copy.graphTitle }),
      element('p', { text: copy.graphDirection }),
    ),
    element('span', { text: copy.ephemeral }),
  ),
  element('div', {
    className: 'tidb-machine__tiflash-fragments',
    attrs: { role: 'list' },
  },
  ...lab.fragments.map((fragment) => {
    const fragmentTasks = fragment.taskIds
      .map((taskId) => taskById.get(taskId))
      .filter((task): task is NonNullable<typeof task> => task !== undefined)
    return element('article', {
      className: 'tidb-machine__tiflash-fragment',
      attrs: {
        role: 'listitem',
        'data-mpp-fragment': fragment.id,
        'data-mpp-fragment-kind': fragment.kind,
      },
    },
    element('h4', { text: `${copy.fragment}: ${fragment.id}` }),
    element('p', { text: fragment.operatorTokens.join(' → ') }),
    element('ul', {},
      ...fragmentTasks.map((task) => element('li', {
        attrs: {
          'data-mpp-task': task.id,
          'data-mpp-task-stage': task.stage,
          'data-mpp-task-store': task.storeId,
          'data-mpp-task-feeds-root': String(task.feedsTiDBRoot),
        },
      },
      element('strong', { text: task.id }),
      element('span', { text: `${copy.store}: ${task.storeId}` }),
      element('span', {
        text: `${copy.region}: ${
          task.regionIds.length > 0 ? task.regionIds.join(', ') : '—'
        }`,
      }),
      element('span', { text: `${copy.stage}: ${task.stage}` }),
      )),
    ),
    )
  }),
  ),
  element('section', { className: 'tidb-machine__tiflash-tunnels' },
    element('h3', { text: copy.tunnels }),
    element('ul', { attrs: { role: 'list' } },
      ...lab.tunnels.map((tunnel) => element('li', {
        attrs: {
          role: 'listitem',
          'data-mpp-tunnel': tunnel.id,
          'data-mpp-exchange': tunnel.exchangeType,
          'data-mpp-tunnel-state': tunnel.status,
          'data-mpp-tunnel-locality': tunnel.locality,
          'data-mpp-persistent': 'false',
        },
      },
      element('code', { text: tunnel.id }),
      element('span', {
        text: `${tunnel.sourceTaskId} → ${tunnel.targetTaskId}`,
      }),
      element('strong', {
        text:
          `${tunnel.exchangeType} · ${tunnel.locality} · ` +
          `${copy.packets} ${tunnel.packetCount}`,
      }),
      )),
    ),
  ),
  )

  return element('section', {
    className: 'tidb-machine__tiflash-state',
    attrs: {
      'aria-labelledby': 'tidb-machine-tiflash-mpp-title',
      'data-tiflash-mpp-machine-state': 'true',
      'data-tiflash-mpp-event-id': event.id,
      'data-tiflash-mpp-event-kind': event.kind ?? '',
      'data-tiflash-mpp-phase': lab.phase,
      'data-tiflash-mpp-model': 'model-7',
    },
  },
  element('header', { className: 'tidb-machine__tiflash-head' },
    element('div', {},
      element('p', {
        className: 'tidb-machine__tiflash-eyebrow',
        text: copy.eyebrow,
      }),
      element('h2', {
        text: copy.title,
        attrs: { id: 'tidb-machine-tiflash-mpp-title' },
      }),
    ),
    element('div', { className: 'tidb-machine__tiflash-head-meta' },
      element('span', {
        text: `${copy.phase}: ${lab.phase}`,
        attrs: { 'data-mpp-phase-state': lab.phase },
      }),
      element('span', { text: `${copy.snapshot} · ${event.id}` }),
    ),
  ),
  element('section', {
    className: 'tidb-machine__tiflash-provisioning',
    attrs: {
      'data-provisioning-available': String(
        lab.configuration.provisioningAvailable,
      ),
      'data-provisioning-progress': String(
        lab.configuration.provisioningProgress,
      ),
      'data-provisioning-means-read-ready': 'false',
    },
  },
  element('h3', { text: copy.provisioning }),
  element('p', { text: copy.provisioningNote }),
  ),
  learnerRail,
  fragmentGraph,
  element('section', {
    className: 'tidb-machine__tiflash-root',
    attrs: {
      'data-mpp-root-task': lab.result.taskId,
      'data-mpp-result-stage': lab.result.stage,
      'data-mpp-root-stream-count': String(lab.result.rootStreamCount),
      'data-mpp-client-complete': String(lab.result.clientComplete),
      'data-mpp-retry-count': String(lab.retry.retryCount),
      'data-mpp-fallback': String(lab.retry.fallbackToTiKV),
    },
  },
  element('h3', { text: copy.root }),
  element('dl', {},
    gcFact(copy.result, lab.result.stage),
    gcFact(copy.packets, String(lab.result.chunksDecoded)),
    gcFact(copy.retry,
      `${lab.retry.retryCount} / ${String(lab.retry.fallbackToTiKV)}`),
  ),
  ),
  element('footer', { className: 'tidb-machine__tiflash-boundary' },
    element('p', { text: copy.boundary }),
    element('p', { text: copy.privacy }),
  ),
  )
}

export function adaptTraceReceipt(source: unknown): MachineReceipt {
  const receipt = record(source)
  const rawEvents = Array.isArray(receipt.events) ? receipt.events : []
  const events: MachineEvent[] = []
  for (let index = 0; index < rawEvents.length; index += 1) {
    const raw = record(rawEvents[index])
    const domain = machineDomain(raw.domain)
    if (!domain) continue
    events.push({
      id: asString(raw.id, `event-${index + 1}`),
      atMs: asNumber(raw.atMs, asNumber(raw.at, index)),
      durationMs: asNumber(raw.durationMs, asNumber(raw.duration, 0)),
      domain,
      kind: asString(raw.kind) || undefined,
      label: asString(raw.label, asString(raw.kind, domain)),
      detail: asString(raw.detail),
      source: asString(raw.source) || undefined,
      target: asString(raw.target) || undefined,
      status: asString(raw.status) || undefined,
      dependsOn: asStringArray(raw.dependsOn),
      criticalPath: typeof raw.criticalPath === 'boolean'
        ? raw.criticalPath
        : raw.path === 'background'
          ? false
          : raw.path === 'critical'
            ? true
            : undefined,
      regionId: typeof raw.regionId === 'number' && Number.isInteger(raw.regionId)
        ? raw.regionId
        : undefined,
      transactionId: asString(raw.transactionId) || undefined,
      branchId: asString(raw.branchId) || undefined,
      snapshot: asTraceSnapshot(raw.snapshot),
    })
  }
  /*
   * Canonical receipt order is also snapshot order. Parallel branches can
   * share or revisit model-time positions, so sorting here would detach a URL
   * cursor from the immutable post-event projection that it names.
   */
  return { id: asString(receipt.id, 'trace'), events }
}

export function resolveMachineEventIndex(
  receipt: MachineReceipt,
  eventId: string | undefined,
  fallbackIndex = 0,
): number {
  if (receipt.events.length === 0) return -1
  if (eventId) {
    const requestedIndex = receipt.events.findIndex((event) => event.id === eventId)
    if (requestedIndex >= 0) return requestedIndex
  }
  return Math.max(0, Math.min(receipt.events.length - 1, fallbackIndex))
}

function renderTimeline(
  receipt: MachineReceipt,
  locale: Locale,
  currentIndex: number,
): SVGSVGElement {
  const width = 1120
  const plotLeft = 210
  const plotRight = width - 28
  const top = 72
  const laneHeight = 68
  const height = top + MACHINE_LANES.length * laneHeight + 42
  const maxAt = receiptEndMs(receipt)
  const xOf = (atMs: number) => {
    const ratio = Math.max(0, Math.min(maxAt, atMs)) / maxAt
    return plotLeft + ratio * (plotRight - plotLeft)
  }
  const svg = svgElement('svg', {
    class: 'tidb-machine__svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'group',
    'aria-label': locale === 'ja' ? 'TiDB traceの層別タイムライン' : 'Layered TiDB trace timeline',
  })

  const defs = svgElement('defs')
  const arrow = svgElement('marker', {
    id: 'tidb-machine-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '6',
    markerHeight: '6',
    orient: 'auto-start-reverse',
  })
  arrow.append(svgElement('path', {
    class: 'tidb-machine__arrow',
    d: 'M 0 0 L 10 5 L 0 10 z',
  }))
  defs.append(arrow)
  svg.append(
    defs,
    svgElement('rect', {
      class: 'tidb-machine__backdrop',
      x: '0',
      y: '0',
      width: String(width),
      height: String(height),
      rx: '14',
    }),
  )

  appendSvgText(svg, 'tidb-machine__plot-eyebrow', MACHINE_COPY[locale].eyebrow, 18, 28)
  appendSvgText(
    svg,
    'tidb-machine__time-title',
    `${MACHINE_COPY[locale].modelTime.toUpperCase()} / ms`,
    plotLeft,
    28,
  )

  const tickCount = 5
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const value = (maxAt * tick) / tickCount
    const x = xOf(value)
    svg.append(svgElement('line', {
      class: 'tidb-machine__gridline',
      x1: String(x),
      x2: String(x),
      y1: '48',
      y2: String(top + MACHINE_LANES.length * laneHeight),
      'data-time-tick': String(tick),
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__tick-label',
      tick === 0 ? '0' : String(Math.round(value * 10) / 10),
      x,
      53,
      { 'text-anchor': tick === 0 ? 'start' : tick === tickCount ? 'end' : 'middle' },
    )
  }

  MACHINE_LANES.forEach((lane, laneIndex) => {
    const y = top + laneIndex * laneHeight
    const eventCount = receipt.events.filter((event) => event.domain === lane).length
    const group = svgElement('g', {
      class: 'tidb-machine__lane',
      'data-lane': lane,
      role: 'group',
      'aria-label': LANE_LABELS[locale][lane],
    })
    const background = svgElement('rect', {
      class: 'tidb-machine__lane-bg',
      x: '8',
      y: String(y + 2),
      width: String(width - 16),
      height: String(laneHeight - 4),
      rx: '8',
    })
    const accent = svgElement('rect', {
      class: 'tidb-machine__lane-accent',
      x: '8',
      y: String(y + 12),
      width: '3',
      height: String(laneHeight - 24),
      rx: '1.5',
    })
    const axis = svgElement('line', {
      class: 'tidb-machine__axis',
      x1: String(plotLeft),
      x2: String(plotRight),
      y1: String(y + laneHeight / 2),
      y2: String(y + laneHeight / 2),
    })
    group.append(background, accent)
    appendSvgText(group, 'tidb-machine__lane-code', LANE_CODES[lane], 24, y + 28)
    appendSvgText(group, 'tidb-machine__lane-label', LANE_LABELS[locale][lane], 24, y + 47)
    appendSvgText(
      group,
      'tidb-machine__lane-count',
      String(eventCount).padStart(2, '0'),
      186,
      y + 38,
      { 'text-anchor': 'end', 'aria-label': `${eventCount} events` },
    )
    group.append(axis)
    svg.append(group)
  })

  const lastPlacement = new Map<MachineLane, { x: number; level: number }>()
  const layouts: TimelineEventLayout[] = receipt.events.map((event, index) => {
    const laneIndex = MACHINE_LANES.indexOf(event.domain)
    const x = xOf(event.atMs)
    const previousPlacement = lastPlacement.get(event.domain)
    const level = previousPlacement && x - previousPlacement.x < 30
      ? (previousPlacement.level + 1) % 3
      : 0
    lastPlacement.set(event.domain, { x, level })
    const yOffset = [0, -12, 12][level] ?? 0
    return {
      event,
      index,
      x,
      endX: xOf(event.atMs + Math.max(0, event.durationMs)),
      y: top + laneIndex * laneHeight + laneHeight / 2 + yOffset,
      state: index === currentIndex ? 'current' : index < currentIndex ? 'complete' : 'future',
      status: machineStatus(event.status),
    }
  })

  const durationLayer = svgElement('g', {
    class: 'tidb-machine__duration-layer',
    'aria-hidden': 'true',
  })
  for (const layout of layouts) {
    durationLayer.append(svgElement('rect', {
      class: `tidb-machine__duration is-${layout.state} is-${layout.status}`,
      x: String(layout.x),
      y: String(layout.y - 4),
      width: String(Math.max(10, layout.endX - layout.x)),
      height: '8',
      rx: '4',
      'data-event-duration': String(layout.event.durationMs),
      'data-duration-domain': layout.event.domain,
    }))
  }
  svg.append(durationLayer)

  const causalLayer = svgElement('g', {
    class: 'tidb-machine__causal-layer',
    'aria-hidden': 'true',
    'data-graph-kind': 'causal-dag',
  })
  const layoutById = new Map(layouts.map((layout) => [layout.event.id, layout]))
  for (let index = 0; index < layouts.length; index += 1) {
    const layout = layouts[index]
    if (!layout) continue
    const parentIds = layout.event.dependsOn
      ?? (index > 0 ? [layouts[index - 1].event.id] : [])
    for (const parentId of parentIds) {
      const previous = layoutById.get(parentId)
      if (!previous || previous === layout) continue
      const horizontal = Math.max(0, layout.x - previous.x)
      const distance = Math.max(26, horizontal * 0.42)
      causalLayer.append(svgElement('path', {
        class: `tidb-machine__causal is-${layout.state}`,
        d: [
          `M ${previous.x} ${previous.y}`,
          `C ${previous.x + distance} ${previous.y}`,
          `${layout.x - distance} ${layout.y}`,
          `${layout.x} ${layout.y}`,
        ].join(' '),
        'data-causal-from': previous.event.id,
        'data-causal-to': layout.event.id,
        'data-causal-domain': layout.event.domain,
        'data-causal-path': layout.event.criticalPath === false ? 'background' : 'critical',
        'marker-end': 'url(#tidb-machine-arrow)',
      }))
    }
  }
  svg.append(causalLayer)

  const currentLayout = currentIndex >= 0 ? layouts[currentIndex] : undefined
  if (currentLayout) {
    svg.append(svgElement('line', {
      class: 'tidb-machine__cursor',
      x1: String(currentLayout.x),
      x2: String(currentLayout.x),
      y1: '48',
      y2: String(top + MACHINE_LANES.length * laneHeight + 14),
      'aria-hidden': 'true',
    }))
    const cursorLabelWidth = 74
    const cursorLabelX = Math.max(
      plotLeft,
      Math.min(plotRight - cursorLabelWidth, currentLayout.x - cursorLabelWidth / 2),
    )
    svg.append(svgElement('rect', {
      class: 'tidb-machine__cursor-badge',
      x: String(cursorLabelX),
      y: String(height - 28),
      width: String(cursorLabelWidth),
      height: '21',
      rx: '10.5',
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__cursor-label',
      formatModelTime(currentLayout.event.atMs),
      cursorLabelX + cursorLabelWidth / 2,
      height - 14,
      { 'text-anchor': 'middle' },
    )
  }

  for (const layout of layouts) {
    const { event, index, state, status, x, y } = layout
    const accessibleName = [
      `${CATALOG[locale].event} ${index + 1}`,
      LANE_LABELS[locale][event.domain],
      event.label,
      formatModelTime(event.atMs),
      `${MACHINE_COPY[locale].duration}: ${formatModelTime(Math.max(0, event.durationMs))}`,
      `status: ${status}`,
    ].join(', ')
    const eventNode = svgElement('g', {
      class: `tidb-machine__event is-${status} is-${state}`,
      tabindex: '0',
      role: 'button',
      'aria-label': accessibleName,
      'aria-current': state === 'current' ? 'step' : 'false',
      'data-event-id': event.id,
      'data-event-index': String(index),
      'data-event-domain': event.domain,
      'data-event-kind': event.kind ?? '',
      'data-event-branch': event.branchId ?? '',
      'data-event-transaction': event.transactionId ?? '',
      'data-event-has-lock-snapshot': event.snapshot?.lockLab ? 'true' : 'false',
      'data-event-has-raft-snapshot': event.snapshot?.raftLab ? 'true' : 'false',
      'data-event-has-protocol-snapshot': event.snapshot?.protocolLab ? 'true' : 'false',
      'data-event-has-gc-snapshot': event.snapshot?.gcLab ? 'true' : 'false',
      'data-event-has-tiflash-mpp-snapshot':
        event.snapshot?.tiflashMppLab ? 'true' : 'false',
      'data-event-status': status,
      'data-event-state': state,
    })
    const title = svgElement('title')
    title.textContent = accessibleName
    eventNode.append(
      title,
      svgElement('circle', {
        class: 'tidb-machine__event-hit',
        cx: String(x),
        cy: String(y),
        r: '19',
      }),
      svgElement('circle', {
        class: 'tidb-machine__event-halo',
        cx: String(x),
        cy: String(y),
        r: state === 'current' ? '14' : '12',
      }),
      svgElement('circle', {
        class: 'tidb-machine__event-core',
        cx: String(x),
        cy: String(y),
        r: state === 'current' ? '8.5' : '7',
      }),
    )
    appendSvgText(
      eventNode,
      'tidb-machine__event-glyph',
      status === 'failed' ? '×' : status === 'warning' ? '!' : String(index + 1),
      x,
      y + 3.25,
      { 'text-anchor': 'middle', 'aria-hidden': 'true' },
    )
    svg.append(eventNode)
  }

  if (currentLayout) {
    const calloutWidth = 238
    const calloutHeight = 28
    const calloutOnLeft = currentLayout.x > width - calloutWidth - 46
    const calloutX = calloutOnLeft
      ? currentLayout.x - calloutWidth - 20
      : currentLayout.x + 20
    const calloutY = currentLayout.y - calloutHeight / 2
    svg.append(svgElement('line', {
      class: 'tidb-machine__callout-leader',
      x1: String(currentLayout.x + (calloutOnLeft ? -10 : 10)),
      x2: String(calloutOnLeft ? calloutX + calloutWidth : calloutX),
      y1: String(currentLayout.y),
      y2: String(currentLayout.y),
      'aria-hidden': 'true',
    }))
    svg.append(svgElement('rect', {
      class: 'tidb-machine__callout',
      x: String(calloutX),
      y: String(calloutY),
      width: String(calloutWidth),
      height: String(calloutHeight),
      rx: '7',
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__event-label',
      `${String(currentLayout.index + 1).padStart(2, '0')}  ${shortLabel(currentLayout.event.label)}`,
      calloutX + 11,
      currentLayout.y + 4,
      { 'aria-hidden': 'true' },
    )
  }
  return svg
}

export function mountMachine(root: HTMLElement, options: MachineOptions): void {
  const locale = options.locale ?? resolveLocale(options.search)
  const copy = MACHINE_COPY[locale]
  const receipt = options.adaptReceipt
    ? options.adaptReceipt(options.receipt)
    : adaptTraceReceipt(options.receipt)
  const total = receipt.events.length
  const maxAt = receiptEndMs(receipt)
  installCityUiStyles(root.ownerDocument ?? document)
  installMachineStyles(root.ownerDocument ?? document)

  let current = resolveMachineEventIndex(
    receipt,
    options.initialEventId,
    options.initialIndex ?? 0,
  )
  let timer: ReturnType<typeof setInterval> | null = null
  const frame = element('div', { className: 'tidb-machine__frame' })
  const hasLockSnapshots = receipt.events.some((event) => Boolean(event.snapshot?.lockLab))
  const lockSlot = element('div', { className: 'tidb-machine__lock-slot' })
  const hasRaftSnapshots = receipt.events.some((event) => Boolean(event.snapshot?.raftLab))
  const raftSlot = element('div', { className: 'tidb-machine__raft-slot' })
  const hasProtocolSnapshots = receipt.events.some((event) =>
    Boolean(event.snapshot?.protocolLab))
  const protocolSlot = element('div', {
    className: 'tidb-machine__protocol-slot',
  })
  const hasGcSnapshots = receipt.events.some((event) =>
    Boolean(event.snapshot?.gcLab))
  const gcSlot = element('div', {
    className: 'tidb-machine__gc-slot',
  })
  const hasTiFlashMppSnapshots = receipt.events.some((event) =>
    Boolean(event.snapshot?.tiflashMppLab))
  const tiflashMppSlot = element('div', {
    className: 'tidb-machine__tiflash-slot',
  })
  const detail = element('section', {
    className: 'tidb-machine__detail',
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
  })
  const play = element('button', {
    className: 'tidb-button tidb-button--primary',
    text: CATALOG[locale].play,
    attrs: {
      type: 'button',
      'data-action': 'play',
      'aria-pressed': 'false',
    },
  })
  const step = element('button', {
    className: 'tidb-button',
    text: CATALOG[locale].step,
    attrs: { type: 'button', 'data-action': 'step' },
  })
  const reset = element('button', {
    className: 'tidb-button',
    text: CATALOG[locale].reset,
    attrs: { type: 'button', 'data-action': 'reset' },
  })
  if (total === 0) {
    play.setAttribute('disabled', '')
    step.setAttribute('disabled', '')
    reset.setAttribute('disabled', '')
  }

  const createMetric = (label: string) => {
    const value = element('strong', { className: 'tidb-machine__metric-value', text: copy.empty })
    return {
      value,
      node: element('div', { className: 'tidb-machine__metric' },
        element('span', { className: 'tidb-machine__metric-label', text: label }),
        value,
      ),
    }
  }
  const stepMetric = createMetric(copy.step)
  const timeMetric = createMetric(copy.modelTime)
  const layerMetric = createMetric(copy.activeLayer)
  const windowMetric = createMetric(copy.timeWindow)
  windowMetric.value.textContent = total > 0 ? formatModelTime(maxAt) : copy.empty
  const overview = element('section', {
    className: 'tidb-machine__overview',
    attrs: { 'aria-label': copy.summary },
  },
  stepMetric.node,
  timeMetric.node,
  layerMetric.node,
  windowMetric.node,
  )
  const progressText = element('span', {
    className: 'tidb-machine__progress-text',
    text: total > 0 ? `1 / ${total}` : `0 / 0`,
  })
  const progress = element('progress', {
    className: 'tidb-machine__progress',
    attrs: {
      max: String(Math.max(1, total)),
      value: total > 0 ? '1' : '0',
      'aria-label': copy.progress,
    },
  })
  const transport = element('div', { className: 'tidb-machine__transport' },
    element('div', { className: 'tidb-machine__controls' }, play, step, reset),
    element('div', { className: 'tidb-machine__progress-wrap' },
      element('div', { className: 'tidb-machine__progress-label' },
        element('span', { text: copy.progress }),
        progressText,
      ),
      progress,
    ),
  )

  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
    play.textContent = CATALOG[locale].play
    play.setAttribute('aria-pressed', 'false')
  }
  const sync = () => {
    frame.replaceChildren(renderTimeline(receipt, locale, current))
    const event = current >= 0 ? receipt.events[current] : null
    const position = event ? current + 1 : 0
    stepMetric.value.textContent = event ? `${position} / ${total}` : copy.empty
    timeMetric.value.textContent = event ? formatModelTime(event.atMs) : copy.empty
    layerMetric.value.textContent = event
      ? `${LANE_CODES[event.domain]} · ${LANE_LABELS[locale][event.domain]}`
      : copy.empty
    progress.setAttribute('value', String(position))
    progress.setAttribute('aria-valuetext', `${position} / ${total}`)
    progressText.textContent = `${position} / ${total}`

    if (event) {
      const route = [event.source, event.target].filter(Boolean).join(' → ')
      const status = machineStatus(event.status)
      detail.setAttribute('data-current-domain', event.domain)
      detail.setAttribute('data-current-status', status)
      detail.setAttribute('data-current-event-id', event.id)
      detail.setAttribute('data-current-event-kind', event.kind ?? '')
      detail.setAttribute('data-current-event-branch', event.branchId ?? '')
      const eventMeta = element('dl', { className: 'tidb-machine__detail-meta' },
        element('div', {},
          element('dt', { text: copy.modelTime }),
          element('dd', { text: formatModelTime(event.atMs) }),
        ),
        element('div', {},
          element('dt', { text: copy.activeLayer }),
          element('dd', { text: LANE_LABELS[locale][event.domain] }),
        ),
        element('div', {},
          element('dt', { text: copy.duration }),
          element('dd', { text: formatModelTime(Math.max(0, event.durationMs)) }),
        ),
      )
      if (event.kind) {
        eventMeta.append(element('div', {
          attrs: { 'data-detail-event-kind': event.kind },
        },
        element('dt', { text: copy.eventKind }),
        element('dd', { text: event.kind }),
        ))
      }
      if (event.branchId) {
        eventMeta.append(element('div', {
          attrs: { 'data-detail-event-branch': event.branchId },
        },
        element('dt', { text: copy.branch }),
        element('dd', { text: event.branchId }),
        ))
      }
      const detailNodes: Node[] = [
        element('div', { className: 'tidb-machine__detail-head' },
          element('p', {
            className: 'tidb-machine__detail-eyebrow',
            text: `${copy.current} · ${CATALOG[locale].event} ${position} / ${total}`,
          }),
          element('p', {
            className: `tidb-machine__status is-${status}`,
            text: `status: ${status}`,
          }),
        ),
        element('h2', { text: event.label }),
        eventMeta,
      ]
      if (event.detail) {
        detailNodes.push(element('p', { className: 'tidb-machine__detail-copy', text: event.detail }))
      }
      if (route) {
        detailNodes.push(element('p', { className: 'tidb-machine__route' },
          element('strong', { text: `${copy.route}: ` }),
          element('span', { text: route }),
        ))
      }
      detail.replaceChildren(...detailNodes)
    } else {
      detail.removeAttribute('data-current-domain')
      detail.removeAttribute('data-current-status')
      detail.removeAttribute('data-current-event-id')
      detail.removeAttribute('data-current-event-kind')
      detail.removeAttribute('data-current-event-branch')
      detail.replaceChildren(element('p', { className: 'tidb-machine__empty', text: CATALOG[locale].emptyTrace }))
    }
    if (hasLockSnapshots) {
      const lockState = event ? renderLockState(event, locale) : null
      lockSlot.hidden = lockState === null
      lockSlot.setAttribute('aria-hidden', lockState === null ? 'true' : 'false')
      if (lockState) lockSlot.replaceChildren(lockState)
      else lockSlot.replaceChildren()
    }
    if (hasRaftSnapshots) {
      const raftState = event ? renderRaftState(event, locale) : null
      raftSlot.hidden = raftState === null
      raftSlot.setAttribute('aria-hidden', raftState === null ? 'true' : 'false')
      if (raftState) raftSlot.replaceChildren(raftState)
      else raftSlot.replaceChildren()
    }
    if (hasProtocolSnapshots) {
      const protocolState = event ? renderProtocolState(event, locale) : null
      protocolSlot.hidden = protocolState === null
      protocolSlot.setAttribute(
        'aria-hidden',
        protocolState === null ? 'true' : 'false',
      )
      if (protocolState) protocolSlot.replaceChildren(protocolState)
      else protocolSlot.replaceChildren()
    }
    if (hasGcSnapshots) {
      const gcState = event ? renderGcState(event, locale) : null
      gcSlot.hidden = gcState === null
      gcSlot.setAttribute(
        'aria-hidden',
        gcState === null ? 'true' : 'false',
      )
      if (gcState) gcSlot.replaceChildren(gcState)
      else gcSlot.replaceChildren()
    }
    if (hasTiFlashMppSnapshots) {
      const tiflashMppState = event
        ? renderTiFlashMppState(event, locale)
        : null
      tiflashMppSlot.hidden = tiflashMppState === null
      tiflashMppSlot.setAttribute(
        'aria-hidden',
        tiflashMppState === null ? 'true' : 'false',
      )
      if (tiflashMppState) {
        tiflashMppSlot.replaceChildren(tiflashMppState)
      } else {
        tiflashMppSlot.replaceChildren()
      }
    }
    options.onSeek?.(event, current)

    for (const marker of frame.querySelectorAll<SVGElement>('[data-event-index]')) {
      marker.addEventListener('click', () => {
        current = Number(marker.dataset.eventIndex)
        stop()
        sync()
      })
      marker.addEventListener('keydown', (rawEvent) => {
        const keyboardEvent = rawEvent as KeyboardEvent
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
        keyboardEvent.preventDefault()
        const selectedIndex = Number(marker.dataset.eventIndex)
        if (!Number.isInteger(selectedIndex)) return
        current = selectedIndex
        stop()
        sync()
        frame.querySelector<SVGElement>(`[data-event-index="${selectedIndex}"]`)?.focus()
      })
    }
  }

  play.addEventListener('click', () => {
    if (timer !== null) {
      stop()
      return
    }
    if (total === 0) return
    play.textContent = CATALOG[locale].pause
    play.setAttribute('aria-pressed', 'true')
    timer = setInterval(() => {
      if (current >= total - 1) {
        stop()
        return
      }
      current += 1
      sync()
    }, Math.max(100, options.stepIntervalMs ?? 750))
  })
  step.addEventListener('click', () => {
    stop()
    if (total > 0) current = Math.min(total - 1, current + 1)
    sync()
  })
  reset.addEventListener('click', () => {
    stop()
    current = total > 0 ? 0 : -1
    sync()
  })

  root.classList.add('tidb-surface', 'tidb-machine')
  root.setAttribute('lang', locale)
  root.replaceChildren(
    element('header', { className: 'tidb-machine__head' },
      element('div', {},
        element('h1', { text: CATALOG[locale].machineTitle }),
        element('p', { text: CATALOG[locale].machineSubtitle }),
      ),
      createModelBadge(locale),
    ),
    overview,
    transport,
    frame,
    ...(hasLockSnapshots ? [lockSlot] : []),
    ...(hasRaftSnapshots ? [raftSlot] : []),
    ...(hasProtocolSnapshots ? [protocolSlot] : []),
    ...(hasGcSnapshots ? [gcSlot] : []),
    ...(hasTiFlashMppSnapshots ? [tiflashMppSlot] : []),
    detail,
    element('p', { className: 'tidb-machine__note', text: CATALOG[locale].simulatedTiming }),
  )
  sync()
  if (options.autoplay) play.click()
}

export type {
  TraceDomain,
  TraceEvent,
  TraceReceipt,
}
