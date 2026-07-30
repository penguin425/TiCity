// SPDX-License-Identifier: Apache-2.0

import type { TiCityState } from '../model/types'
import { CATALOG, resolveLocale, type Locale } from '../ui/catalog'
import { element, svgElement } from '../ui/dom'
import { createModelBadge } from '../ui/legal'
import { installCityUiStyles } from '../ui/styles'
import { installDiagnoseStyles } from './styles'

export { DIAGNOSE_CSS, installDiagnoseStyles } from './styles'

export const DIAGNOSE_SECTIONS = [
  'cluster',
  'raft-peers',
  'raft-election',
  'region-request-retry',
  'protocol-selection',
  'protocol-client-path',
  'protocol-region-state',
  'gc-safe-point-stores',
  'gc-coordinator-path',
  'gc-resolve-locks',
  'gc-delete-ranges',
  'gc-store-compaction',
  'gc-mvcc-chains',
  'tiflash-replication',
  'tiflash-read-gates',
  'tiflash-mpp-tasks',
  'tiflash-mpp-tunnels',
  'tiflash-mpp-root',
  'transactions',
  'lock-waits',
  'deadlocks',
  'application-retry',
  'hot-regions',
  'regions',
  'gc',
  'tiflash',
] as const
export type DiagnoseSection = (typeof DIAGNOSE_SECTIONS)[number]

const GC_DETAIL_SECTIONS = new Set<DiagnoseSection>([
  'gc-safe-point-stores',
  'gc-coordinator-path',
  'gc-resolve-locks',
  'gc-delete-ranges',
  'gc-store-compaction',
  'gc-mvcc-chains',
])

const TIFLASH_MPP_DETAIL_SECTIONS = new Set<DiagnoseSection>([
  'tiflash-replication',
  'tiflash-read-gates',
  'tiflash-mpp-tasks',
  'tiflash-mpp-tunnels',
  'tiflash-mpp-root',
])

export const DIAGNOSE_SUMMARY_SECTIONS = [
  'cluster',
  'regions',
  'hot-regions',
  'transactions',
  'gc',
  'tiflash',
] as const satisfies readonly DiagnoseSection[]
type DiagnoseSummarySection = (typeof DIAGNOSE_SUMMARY_SECTIONS)[number]

export type DiagnosticRow = Readonly<Record<string, string>>

export interface DiagnosticProjection {
  id: DiagnoseSection
  label: 'MODEL / SIMULATED'
  rows: readonly DiagnosticRow[]
}

export interface SymptomGuide {
  id: string
  ja: { symptom: string; guidance: string }
  en: { symptom: string; guidance: string }
  sql: string
}

export const SYMPTOM_GUIDES: readonly SymptomGuide[] = [
  {
    id: 'slow-query',
    ja: {
      symptom: 'queryが急に遅い',
      guidance: 'slow query、実行計画、TiKV/TiFlashのtask時間を同じ時間帯で確認します。',
    },
    en: {
      symptom: 'Queries suddenly became slow',
      guidance: 'Correlate slow queries, plans, and TiKV or TiFlash task time in the same interval.',
    },
    sql: `SELECT time, query_time, digest, query
FROM INFORMATION_SCHEMA.CLUSTER_SLOW_QUERY
ORDER BY time DESC LIMIT 20;`,
  },
  {
    id: 'lock-wait',
    ja: {
      symptom: 'transactionがlock待ちになる',
      guidance: 'waiting transaction、blocking transaction、primary keyを特定して長時間transactionを調べます。',
    },
    en: {
      symptom: 'Transactions are waiting on locks',
      guidance: 'Identify waiting and blocking transactions and their primary keys, then inspect long transactions.',
    },
    sql: `SELECT * FROM INFORMATION_SCHEMA.DATA_LOCK_WAITS
ORDER BY KEY_INFO LIMIT 50;`,
  },
  {
    id: 'hot-region',
    ja: {
      symptom: '一部のTiKVだけが高負荷',
      guidance: 'hot Regionとleader分布を確認し、順序keyや偏ったaccess patternを疑います。',
    },
    en: {
      symptom: 'Only some TiKV stores are overloaded',
      guidance: 'Inspect hot Regions and leader distribution, then look for sequential keys or skewed access.',
    },
    sql: `SELECT h.TABLE_NAME, h.INDEX_NAME, h.REGION_ID, p.STORE_ID,
       h.TYPE, h.MAX_HOT_DEGREE, h.FLOW_BYTES
FROM INFORMATION_SCHEMA.TIDB_HOT_REGIONS AS h
LEFT JOIN INFORMATION_SCHEMA.TIKV_REGION_PEERS AS p
  ON p.REGION_ID = h.REGION_ID AND p.IS_LEADER = 1
ORDER BY h.FLOW_BYTES DESC LIMIT 50;`,
  },
  {
    id: 'region-health',
    ja: {
      symptom: 'writeが止まる、Regionが利用不能',
      guidance: '各peerのleader、learner、稼働状態、down時間を確認します。voterのquorum喪失中は安全なwriteを続行できません。',
    },
    en: {
      symptom: 'Writes stop or a Region is unavailable',
      guidance: 'Inspect each peer’s leader, learner, status, and down time. Safe writes cannot continue without a voter quorum.',
    },
    sql: `SELECT r.REGION_ID, r.START_KEY, r.END_KEY, r.APPROXIMATE_SIZE,
       p.PEER_ID, p.STORE_ID, p.IS_LEARNER, p.IS_LEADER,
       p.STATUS, p.DOWN_SECONDS
FROM INFORMATION_SCHEMA.TIKV_REGION_STATUS AS r
JOIN INFORMATION_SCHEMA.TIKV_REGION_PEERS AS p
  ON p.REGION_ID = r.REGION_ID
ORDER BY r.REGION_ID, p.IS_LEADER DESC, p.STORE_ID
LIMIT 300;`,
  },
  {
    id: 'gc-backlog',
    ja: {
      symptom: 'MVCC versionとstorage使用量が増える',
      guidance: 'GC safe point、retention、最大待機時間と長時間transactionを確認し、古いsnapshotが進行を止めていないか調べます。',
    },
    en: {
      symptom: 'MVCC versions and storage keep growing',
      guidance: 'Check the GC safe point, retention, maximum wait, and long transactions for an old snapshot holding back progress.',
    },
    sql: `SELECT
  @@GLOBAL.tidb_gc_life_time AS GC_LIFE_TIME,
  @@GLOBAL.tidb_gc_max_wait_time AS GC_MAX_WAIT_TIME,
  VARIABLE_VALUE AS GC_SAFE_POINT
FROM mysql.tidb
WHERE VARIABLE_NAME = 'tikv_gc_safe_point';`,
  },
  {
    id: 'tiflash-lag',
    ja: {
      symptom: 'TiFlashが選ばれない、分析queryが待機・timeoutする',
      guidance: 'AVAILABLEとPROGRESSはreplica配置の状態で、任意snapshotの即時read readinessではありません。Region別のsafe-ts／ReadIndex／learner applied indexとtask時間を確認します。遅れは古い結果ではなく待機やtimeoutとして現れます。',
    },
    en: {
      symptom: 'TiFlash is not chosen, or analytical queries wait or time out',
      guidance: 'AVAILABLE and PROGRESS describe replica provisioning, not immediate readiness for the requested snapshot. Inspect each Region’s safe-ts, ReadIndex, learner applied index, and task time. Lag appears as waiting or timeout, not stale results.',
    },
    sql: `SELECT TABLE_SCHEMA, TABLE_NAME, REPLICA_COUNT, LOCATION_LABELS, AVAILABLE, PROGRESS
FROM INFORMATION_SCHEMA.TIFLASH_REPLICA
ORDER BY TABLE_SCHEMA, TABLE_NAME;`,
  },
] as const

const SECTION_TITLES: Record<Locale, Record<DiagnoseSection, string>> = {
  ja: {
    cluster: 'Cluster topology',
    'raft-peers': 'Raft voter peers',
    'raft-election': 'Raft leader選出',
    'region-request-retry': 'TiDB Region request再試行',
    'protocol-selection': '宣言済みfixture profile / outcome（固定）',
    'protocol-client-path': 'Exact-event client応答 / timestamp',
    'protocol-region-state': 'Exact-event Region Raft / MVCC状態',
    'gc-safe-point-stores': 'Exact-event GC safe point / 保存先',
    'gc-coordinator-path': 'GC coordinator順序',
    'gc-resolve-locks': 'Region ScanLock / ResolveLock',
    'gc-delete-ranges': 'Delete Ranges / Store fan-out',
    'gc-store-compaction': 'TiKV検出 / Compaction Filter',
    'gc-mvcc-chains': '代表MVCC chain cleanup',
    'tiflash-replication': 'TiFlash learner複製',
    'tiflash-read-gates': 'Region別snapshot gate',
    'tiflash-mpp-tasks': 'MPP fragments / tasks',
    'tiflash-mpp-tunnels': 'MPP Exchange tunnels',
    'tiflash-mpp-root': 'TiDB root stream / 境界',
    transactions: 'Transactions / locks',
    'lock-waits': '現在のロック待機',
    deadlocks: 'デッドロック履歴',
    'application-retry': 'アプリケーション再試行',
    'hot-regions': 'Hot Regions',
    regions: 'Regions / stores',
    gc: 'MVCC / GC',
    tiflash: 'TiFlash replicas',
  },
  en: {
    cluster: 'Cluster topology',
    'raft-peers': 'Raft voter peers',
    'raft-election': 'Raft leader election',
    'region-request-retry': 'TiDB Region request retry',
    'protocol-selection': 'Declared fixture profile / outcome (static)',
    'protocol-client-path': 'Exact-event client path and timestamps',
    'protocol-region-state': 'Exact-event Region Raft / MVCC state',
    'gc-safe-point-stores': 'Exact-event GC safe point / stores',
    'gc-coordinator-path': 'GC coordinator order',
    'gc-resolve-locks': 'Region ScanLock / ResolveLock',
    'gc-delete-ranges': 'Delete Ranges / Store fan-out',
    'gc-store-compaction': 'TiKV detection / Compaction Filter',
    'gc-mvcc-chains': 'Representative MVCC chain cleanup',
    'tiflash-replication': 'TiFlash learner replication',
    'tiflash-read-gates': 'Per-Region snapshot gates',
    'tiflash-mpp-tasks': 'MPP fragments and tasks',
    'tiflash-mpp-tunnels': 'MPP Exchange tunnels',
    'tiflash-mpp-root': 'TiDB root stream and boundaries',
    transactions: 'Transactions / locks',
    'lock-waits': 'Active lock waits',
    deadlocks: 'Deadlock history',
    'application-retry': 'Application retry',
    'hot-regions': 'Hot Regions',
    regions: 'Regions / stores',
    gc: 'MVCC / GC',
    tiflash: 'TiFlash replicas',
  },
}

type SummaryTone = 'healthy' | 'attention' | 'critical' | 'neutral'

interface DiagnoseCopy {
  eyebrow: string
  summaryTitle: string
  summaryStatus: Record<Exclude<SummaryTone, 'neutral'>, string>
  row: string
  rows: string
  table: string
  sqlCheck: string
  metrics: {
    nodes: string
    regions: string
    hotRegions: string
    transactions: string
    gcBacklog: string
    tiflash: string
  }
  detail: {
    up: string
    attention: string
    healthy: string
    active: string
    conflicts: string
    lockWaits: string
    peak: string
    safePoint: string
    blocked: string
    available: string
    waiting: string
    lag: string
  }
  charts: {
    nodes: string
    regions: string
    hotRegions: string
    transactions: string
    gc: string
    tiflash: string
  }
}

const DIAGNOSE_COPY: Record<Locale, DiagnoseCopy> = {
  ja: {
    eyebrow: 'TiDB オペレーション・ビュー',
    summaryTitle: 'モデル・ヘルスサマリー',
    summaryStatus: {
      healthy: '安定',
      attention: '要確認',
      critical: '重要',
    },
    row: '行',
    rows: '行',
    table: 'テーブル',
    sqlCheck: '実クラスタ確認SQLを表示',
    metrics: {
      nodes: 'ノード稼働',
      regions: 'Region健全性',
      hotRegions: 'Hot Regions',
      transactions: 'Transactions',
      gcBacklog: 'GC backlog',
      tiflash: 'TiFlash',
    },
    detail: {
      up: '稼働',
      attention: '要確認',
      healthy: '健全',
      active: '進行中',
      conflicts: '競合',
      lockWaits: 'ロック待機',
      peak: '最大スコア',
      safePoint: 'safe point',
      blocked: 'ブロック中',
      available: '利用可能',
      waiting: '追従待ち',
      lag: 'lag',
    },
    charts: {
      nodes: 'モデル内ノードの状態分布',
      regions: 'モデル内Regionの健全性分布',
      hotRegions: 'Hot Regionスコア',
      transactions: 'transaction状態',
      gc: 'GC version数の比較',
      tiflash: 'TiFlash複製進捗',
    },
  },
  en: {
    eyebrow: 'TiDB operations view',
    summaryTitle: 'Model health summary',
    summaryStatus: {
      healthy: 'Stable',
      attention: 'Review',
      critical: 'Critical',
    },
    row: 'row',
    rows: 'rows',
    table: 'table',
    sqlCheck: 'Show real-cluster check SQL',
    metrics: {
      nodes: 'Node availability',
      regions: 'Region health',
      hotRegions: 'Hot Regions',
      transactions: 'Transactions',
      gcBacklog: 'GC backlog',
      tiflash: 'TiFlash',
    },
    detail: {
      up: 'up',
      attention: 'attention',
      healthy: 'healthy',
      active: 'active',
      conflicts: 'conflicts',
      lockWaits: 'lock waits',
      peak: 'peak score',
      safePoint: 'safe point',
      blocked: 'blocked',
      available: 'Available',
      waiting: 'Catching up',
      lag: 'lag',
    },
    charts: {
      nodes: 'Modeled node status distribution',
      regions: 'Modeled Region health distribution',
      hotRegions: 'Hot Region scores',
      transactions: 'Transaction states',
      gc: 'GC version count comparison',
      tiflash: 'TiFlash replication progress',
    },
  },
}

const COLUMN_TITLES: Record<Locale, Readonly<Record<string, string>>> = {
  ja: {
    client: 'client',
    attempt: '試行',
    phase: '状態',
    startTs: 'start_ts',
    commitTs: 'commit_ts',
    retryOf: '再試行元',
    heldResources: '保持resource',
    waitingFor: '待機resource',
    edge: 'edge',
    waiter: '待機transaction',
    holder: '保持transaction',
    direction: '向き',
    resource: 'resource',
    region: 'Region',
    queuePosition: 'queue位置',
    detectorScope: 'detector範囲',
    detectorLeader: 'detector leader',
    cycle: 'cycle',
    victim: 'victim',
    selectionPolicy: '選択policy',
    internalRetryable: 'TiDB内部retry可否',
    clientError: 'client返却error',
    lockWaitTimeout: 'lock待機timeout',
    resolution: '解決状態',
    source: '再試行元',
    fixedBackoffMs: '固定backoff (ms)',
    newTransaction: '新transaction',
    newStartTs: '新start_ts',
    boundary: '再試行境界',
    store: 'Store',
    raftRole: 'Raft role',
    peerHealth: 'peer状態',
    currentTerm: 'current term',
    votedFor: '投票先',
    lastLog: 'last log (index/term)',
    matchIndex: 'match index',
    peerCommitIndex: 'commit index',
    peerAppliedIndex: 'apply index',
    oldLeader: '旧Leader',
    currentLeader: '現在Leader',
    electionPhase: '選出phase',
    candidate: '候補',
    preVotesGranted: 'Pre-Vote獲得',
    votesGranted: 'Vote獲得',
    electionQuorum: '選出quorum',
    liveVoters: '稼働voter',
    prevoteEnabled: 'Pre-Vote',
    configuredTimeout: '設定timeout範囲',
    teachingElapsed: 'teaching経過',
    candidatePolicy: '候補policy',
    failedStore: '障害Store',
    pdRole: 'PD role',
    pdObservedLeader: 'PD観測Leader',
    pdRouteLookup: 'PD route lookup',
    logicalRequest: 'logical request',
    retrySource: 'retry source',
    internalAttempt: '内部試行',
    cachedLeader: 'cache上Leader',
    cacheState: 'Region cache',
    requestStatus: 'request状態',
    clientVisibleError: 'client返却error',
    applicationRetry: 'application retry',
    lane: '比較lane',
    profileScope: 'profile / 時間境界',
    selected: '宣言済みprotocol outcome',
    selectionReason: '宣言済みoutcomeの根拠',
    onePcEnabled: '宣言済み1PC feature',
    asyncCommitEnabled: '宣言済みAsync Commit feature',
    consistency: '宣言済み一貫性',
    onePcEligible: '宣言済み1PC eligibility',
    asyncCommitEligible: '宣言済みAsync Commit eligibility',
    regionCount: 'Region数',
    mutationCount: 'mutation数',
    totalKeyBytes: 'key合計byte',
    onePcDecisionPoint: '宣言済み1PC判定点',
    asyncDecisionPoint: '宣言済みAsync判定点',
    onePcRejectedBeforeRpc: '宣言済み1PC RPC前除外',
    asyncRejectedAtClientPrecheck: '宣言済みAsync client事前除外',
    tryOnePcSent: '宣言済みTryOnePc request flag',
    asyncKeyCountLimit: 'Async key数上限',
    asyncTotalKeyBytesLimit: 'Async key byte上限',
    runtimeFallback: '宣言済みruntime fallback outcome',
    representation: '投影方式',
    request: '合成request',
    transaction: '合成transaction',
    stage: 'exact-event stage',
    startTsSource: 'start_ts由来',
    latestTs: 'latest_ts',
    latestTsSource: 'latest_ts由来',
    requestMinCommitTs: 'request min_commit_ts',
    requestMinCommitTsSource: 'request min_commit_ts由来',
    maxCommitTs: 'max_commit_ts',
    maxCommitTsSource: 'max_commit_ts由来',
    commitTsSource: 'commit_ts由来',
    clientResponded: 'client応答済み',
    backgroundState: '応答後cleanup',
    clientBoundary: 'client境界',
    backgroundScheduling: 'background順序',
    protocol: 'protocol',
    role: '役割',
    leader: 'Leader',
    voterCount: 'voter数',
    persistedVoters: '永続化voter',
    raftOperation: 'Raft operation',
    raftStage: 'Raft stage',
    raftIndex: 'Raft index',
    raftAcks: 'Raft ack',
    coordinatorLayer: 'transaction層',
    raftLayer: 'Raft層',
    cfDefault: 'cfDefault',
    cfLock: 'cfLock',
    cfWrite: 'cfWrite',
    asyncCommit: 'Async lock metadata',
    secondaryCount: 'secondary数',
    returnedMinCommitTs: '返却min_commit_ts',
    returnedMinCommitTsSource: '返却min_commit_ts由来',
    asyncApplyPrewrite: 'async apply prewrite',
    round: 'round',
    candidateSafePoint: 'candidate',
    globalMinStartTs: 'global minStartTS',
    transactionBound: 'minStartTS - 1',
    boundRule: 'safe pointの境界',
    serviceSafePoint: 'PD service minimum',
    mysqlStagedSafePoint: 'mysql.tidb staged',
    visibilitySafePoint: 'TiDB visibility保存値',
    visibilityStore: 'visibility保存先',
    cacheBarrier: 'cache barrier',
    gcLeaderLeaseStore: 'GC leader lease',
    pdGlobalSafePoint: 'PD global safe point',
    globalStore: 'global保存先',
    blockerStatus: 'blocker状態',
    maxWaitBoundary: 'max wait境界',
    order: '順序',
    coordinatorStep: 'coordinator step',
    pipelineState: 'exact-event状態',
    stateStore: '状態保存先',
    semanticBoundary: '実装境界',
    implementation: '実装',
    scanState: 'scan状態',
    pendingLocks: '未解決lock',
    resolvedCommit: 'commit解決',
    resolvedRollback: 'rollback解決',
    command: 'ResolveLock command',
    raftBoundary: 'Raft境界',
    rangeSlot: '合成DDL range',
    rangeStatus: 'range状態',
    eligibility: '適格条件',
    fanout: 'fan-out',
    raftstoreMode: 'raftstore',
    privacyBoundary: 'privacy境界',
    detectedSafePoint: 'TiKV検出safe point',
    publishedSafePoint: 'PD公開safe point',
    detectionState: '検出状態',
    compaction: 'compaction',
    filterActive: 'filter稼働',
    storagePath: 'storage path',
    legacyRegionGc: 'legacy Region GC',
    timingBoundary: '時間境界',
    chainSlot: '合成chain',
    versions: 'version数',
    filtered: 'filter済み',
    anchors: '保持anchor',
    present: '残存',
    defaultCfDeletes: 'Default CF削除',
    anchorRule: 'Put anchor規則',
    deleteRule: 'Delete規則',
    compactionLevel: 'compaction level',
  },
  en: {
    client: 'client',
    attempt: 'attempt',
    phase: 'state',
    startTs: 'start_ts',
    commitTs: 'commit_ts',
    retryOf: 'retry of',
    heldResources: 'held resources',
    waitingFor: 'waiting for',
    edge: 'edge',
    waiter: 'waiting transaction',
    holder: 'holding transaction',
    direction: 'direction',
    resource: 'resource',
    region: 'Region',
    queuePosition: 'queue position',
    detectorScope: 'detector scope',
    detectorLeader: 'detector leader',
    cycle: 'cycle',
    victim: 'victim',
    selectionPolicy: 'selection policy',
    internalRetryable: 'TiDB internal retryable',
    clientError: 'client error returned',
    lockWaitTimeout: 'lock-wait timeout',
    resolution: 'resolution',
    source: 'retry source',
    fixedBackoffMs: 'fixed backoff (ms)',
    newTransaction: 'new transaction',
    newStartTs: 'new start_ts',
    boundary: 'retry boundary',
    store: 'Store',
    raftRole: 'Raft role',
    peerHealth: 'peer health',
    currentTerm: 'current term',
    votedFor: 'voted for',
    lastLog: 'last log (index/term)',
    matchIndex: 'match index',
    peerCommitIndex: 'commit index',
    peerAppliedIndex: 'apply index',
    oldLeader: 'old leader',
    currentLeader: 'current leader',
    electionPhase: 'election phase',
    candidate: 'candidate',
    preVotesGranted: 'Pre-Votes granted',
    votesGranted: 'Votes granted',
    electionQuorum: 'election quorum',
    liveVoters: 'live voters',
    prevoteEnabled: 'Pre-Vote',
    configuredTimeout: 'configured timeout window',
    teachingElapsed: 'teaching elapsed',
    candidatePolicy: 'candidate policy',
    failedStore: 'failed store',
    pdRole: 'PD role',
    pdObservedLeader: 'leader observed by PD',
    pdRouteLookup: 'PD route lookup',
    logicalRequest: 'logical request',
    retrySource: 'retry source',
    internalAttempt: 'internal attempt',
    cachedLeader: 'cached leader',
    cacheState: 'Region cache',
    requestStatus: 'request status',
    clientVisibleError: 'client-visible error',
    applicationRetry: 'application retry',
    lane: 'comparison lane',
    profileScope: 'profile / time boundary',
    selected: 'declared protocol outcome',
    selectionReason: 'declared outcome rationale',
    onePcEnabled: 'declared 1PC feature',
    asyncCommitEnabled: 'declared Async Commit feature',
    consistency: 'declared consistency',
    onePcEligible: 'declared 1PC eligibility',
    asyncCommitEligible: 'declared Async Commit eligibility',
    regionCount: 'Regions',
    mutationCount: 'mutations',
    totalKeyBytes: 'total key bytes',
    onePcDecisionPoint: 'declared 1PC decision point',
    asyncDecisionPoint: 'declared Async decision point',
    onePcRejectedBeforeRpc: 'declared pre-RPC 1PC exclusion',
    asyncRejectedAtClientPrecheck:
      'declared Async client-precheck exclusion',
    tryOnePcSent: 'declared TryOnePc request flag',
    asyncKeyCountLimit: 'Async key-count limit',
    asyncTotalKeyBytesLimit: 'Async key-byte limit',
    runtimeFallback: 'declared runtime-fallback outcome',
    representation: 'projection',
    request: 'synthetic request',
    transaction: 'synthetic transaction',
    stage: 'exact-event stage',
    startTsSource: 'start_ts source',
    latestTs: 'latest_ts',
    latestTsSource: 'latest_ts source',
    requestMinCommitTs: 'request min_commit_ts',
    requestMinCommitTsSource: 'request min_commit_ts source',
    maxCommitTs: 'max_commit_ts',
    maxCommitTsSource: 'max_commit_ts source',
    commitTsSource: 'commit_ts source',
    clientResponded: 'client responded',
    backgroundState: 'post-response cleanup',
    clientBoundary: 'client boundary',
    backgroundScheduling: 'background ordering',
    protocol: 'protocol',
    role: 'role',
    leader: 'leader',
    voterCount: 'voters',
    persistedVoters: 'persisted voters',
    raftOperation: 'Raft operation',
    raftStage: 'Raft stage',
    raftIndex: 'Raft index',
    raftAcks: 'Raft acknowledgements',
    coordinatorLayer: 'transaction layer',
    raftLayer: 'Raft layer',
    cfDefault: 'cfDefault',
    cfLock: 'cfLock',
    cfWrite: 'cfWrite',
    asyncCommit: 'Async lock metadata',
    secondaryCount: 'secondary count',
    returnedMinCommitTs: 'returned min_commit_ts',
    returnedMinCommitTsSource: 'returned min_commit_ts source',
    asyncApplyPrewrite: 'async apply prewrite',
    round: 'round',
    candidateSafePoint: 'candidate',
    globalMinStartTs: 'global minStartTS',
    transactionBound: 'minStartTS - 1',
    boundRule: 'safe-point bound',
    serviceSafePoint: 'PD service minimum',
    mysqlStagedSafePoint: 'mysql.tidb staged',
    visibilitySafePoint: 'TiDB visibility saved',
    visibilityStore: 'visibility store',
    cacheBarrier: 'cache barrier',
    gcLeaderLeaseStore: 'GC leader lease',
    pdGlobalSafePoint: 'PD global safe point',
    globalStore: 'global store',
    blockerStatus: 'blocker status',
    maxWaitBoundary: 'max-wait boundary',
    order: 'order',
    coordinatorStep: 'coordinator step',
    pipelineState: 'exact-event state',
    stateStore: 'state store',
    semanticBoundary: 'implementation boundary',
    implementation: 'implementation',
    scanState: 'scan state',
    pendingLocks: 'pending locks',
    resolvedCommit: 'resolved commit',
    resolvedRollback: 'resolved rollback',
    command: 'ResolveLock command',
    raftBoundary: 'Raft boundary',
    rangeSlot: 'synthetic DDL range',
    rangeStatus: 'range state',
    eligibility: 'eligibility',
    fanout: 'fan-out',
    raftstoreMode: 'raftstore',
    privacyBoundary: 'privacy boundary',
    detectedSafePoint: 'TiKV detected safe point',
    publishedSafePoint: 'PD published safe point',
    detectionState: 'detection state',
    compaction: 'compaction',
    filterActive: 'filter active',
    storagePath: 'storage path',
    legacyRegionGc: 'legacy Region GC',
    timingBoundary: 'timing boundary',
    chainSlot: 'synthetic chain',
    versions: 'versions',
    filtered: 'filtered',
    anchors: 'retained anchors',
    present: 'present',
    defaultCfDeletes: 'Default CF deletes',
    anchorRule: 'Put-anchor rule',
    deleteRule: 'Delete rule',
    compactionLevel: 'compaction level',
  },
}

const CELL_VALUE_COPY: Record<Locale, Readonly<Record<string, string>>> = {
  ja: {
    'direction:waiter → holder': '待機transaction → 保持transaction',
    'selectionPolicy:MODEL POLICY: cycle-closing waiter': 'MODEL POLICY：cycleを閉じた待機transaction',
    'lockWaitTimeout:Error 1205 separate / not modeled': 'Error 1205（別経路／未モデル化）',
    'detectorScope:cluster_wide': 'クラスタ全体',
    'boundary:whole transaction': 'transaction全体',
    'source:application': 'アプリケーション',
    'resolution:detected': '検出',
    'resolution:rolling_back': 'rollback中',
    'resolution:resolved': '解決済み',
    'status:backoff': 'backoff中',
    'status:started': '開始済み',
    'status:completed': '完了',
    'phase:active': '実行中',
    'phase:waiting': '待機中',
    'phase:victim': 'victim',
    'phase:rolled_back': 'rollback済み',
    'phase:commit_handoff': 'commit modelへ引き渡し',
    'phase:completed': '完了',
    'internalRetryable:false': 'false（TiDB内部retryなし）',
    'clientError:not_returned_yet': '未返却',
    'candidatePolicy:MODEL POLICY: lowest live up-to-date Store ID':
      'MODEL POLICY：稼働中でlogが最新のStore ID最小',
    'retrySource:tidb_internal': 'TiDB内部',
    'boundary:same logical Region request': '同じlogical Region request',
    'raftRole:pre_candidate': 'Pre-Candidate',
    'peerHealth:down': '停止',
    'peerHealth:up': '稼働',
    'requestStatus:transport_error': 'transport error',
    'requestStatus:backoff': '内部backoff',
    'requestStatus:retrying': '内部retry中',
    'requestStatus:served': 'TiKVで処理済み',
    'requestStatus:completed': '完了',
    'cacheState:cached': 'cache済み',
    'cacheState:invalidated': '無効化',
    'cacheState:refreshed': '更新済み',
    'pdRole:observer_and_routing_only': '観測とroute metadataのみ',
    'lane:one_pc': '1PC',
    'lane:async_commit': 'Async Commit',
    'lane:two_pc': '通常2PC',
    'profileScope:declared_fixture_profile_visible_from_comparison_start':
      '宣言済みの代表profile / outcome（比較開始時から表示）',
    'selected:1pc': '1PC',
    'selected:async_commit': 'Async Commit',
    'selected:2pc': '通常2PC',
    'protocol:1pc': '1PC',
    'protocol:async_commit': 'Async Commit',
    'protocol:2pc': '通常2PC',
    'selectionReason:single_region_one_pc_model_case':
      '単一Regionの代表ケース（1PC優先）',
    'selectionReason:multi_region_async_commit_model_case':
      '複数RegionかつAsync制限内の代表ケース',
    'selectionReason:async_key_count_limit_model_case':
      '257 mutationsがAsync上限256を超過',
    'consistency:linearizable': 'linear consistency',
    'onePcDecisionPoint:region_batching': 'TiDB Region batching',
    'onePcDecisionPoint:tikv_prewrite': 'TiKV Prewrite応答',
    'asyncDecisionPoint:client_precheck': 'TiDB client事前判定',
    'asyncDecisionPoint:tikv_prewrite': 'TiKV Prewrite応答',
    'representation:aggregate_counts_only':
      '集計数のみ（SQL・key・value・rowなし）',
    'stage:idle': '待機',
    'stage:requested': 'request受付',
    'stage:started': 'transaction開始',
    'stage:selected': 'protocol選択済み',
    'stage:latest_ts': 'timestamp floor計算済み',
    'stage:prewriting': 'Prewrite中',
    'stage:prewritten': 'Prewrite完了',
    'stage:commit_ts': 'commit_ts取得済み',
    'stage:committing': 'Commit中',
    'stage:client_acknowledged': 'client応答済み',
    'stage:background': '応答後cleanup中',
    'stage:complete': '完了',
    'startTsSource:pd_tso': 'PD TSO',
    'latestTsSource:pd_tso': 'PD TSO',
    'requestMinCommitTsSource:latest_ts_plus_one':
      'TiDB算出：latest_ts + 1',
    'maxCommitTsSource:representative_safe_window_model_bound':
      'MODEL POLICY：代表safe-window上限',
    'commitTsSource:tikv_one_pc_result': 'TiKV one_pc_commit_ts',
    'commitTsSource:max_prewrite_min_commit_ts':
      'TiKV返却min_commit_tsの最大値',
    'commitTsSource:pd_tso_after_prewrite': '全Prewrite後のPD TSO',
    'backgroundState:not_required': '不要',
    'backgroundState:not_started': '未開始',
    'backgroundState:in_progress_after_response': 'client応答後に進行中',
    'backgroundState:complete': '完了',
    'clientBoundary:response_before_cleanup_completion':
      'client応答後にcleanup完了',
    'backgroundScheduling:deterministic_after_client_boundary_model_policy':
      'MODEL POLICY：client応答後の固定表示順',
    'role:primary': 'primary',
    'role:secondary': 'secondary',
    'raftOperation:one_pc_prewrite': '1PC Prewrite',
    'raftOperation:commit_primary': 'primary Commit',
    'raftOperation:commit_secondary': 'secondary Commit',
    'raftOperation:commit_async': 'Async background Commit',
    'raftStage:idle': '待機',
    'raftStage:proposed': '提案済み',
    'raftStage:persisted_quorum': 'quorum永続化済み',
    'raftStage:committed': 'Raft commit済み',
    'raftStage:applied': 'MVCC apply済み',
    'coordinatorLayer:tidb_transaction_commit': 'TiDB transaction commit',
    'raftLayer:per_region_consensus': 'Regionごとのconsensus',
    'cfDefault:empty': '空',
    'cfDefault:value': '代表value',
    'cfLock:empty': '空',
    'cfLock:prewrite': 'Prewrite lock',
    'cfWrite:empty': '空',
    'cfWrite:commit': 'commit record',
    'returnedMinCommitTsSource:tikv_prewrite_result': 'TiKV Prewrite応答',
    'boundRule:min_candidate_transaction_bound_service_minimum':
      'candidate・minStartTS - 1・PD service minimumの最小値',
    'maxWaitBoundary:within_max_wait_reported_not_killed':
      '30秒ごとの報告対象内。GCはtransactionをkillしない',
    'maxWaitBoundary:fixture_completed_not_max_wait_or_kill':
      'fixtureが明示的に完了。max wait到達でもGCによるkillでもない',
    'coordinatorStep:stage_mysql_tidb_status':
      'mysql.tidbへhuman-readable statusをstage',
    'coordinatorStep:resolve_locks': 'Region ScanLock後にResolveLock',
    'coordinatorStep:save_visibility_and_cross_100_second_barrier':
      'visibility safe pointを保存し100秒barrierを通過',
    'coordinatorStep:delete_ranges': 'DDL whole-range taskをDelete Ranges',
    'coordinatorStep:publish_pd_global_safe_point':
      'PD global safe pointを公開',
    'pipelineState:pending': '未到達',
    'pipelineState:active': '進行中',
    'pipelineState:complete': '完了',
    'semanticBoundary:human_readable_status_not_pd_global':
      'human-readable status。PD global値ではない',
    'semanticBoundary:region_scan_then_resolve_lock':
      'Region単位でScanLock後にold lockを解決',
    'semanticBoundary:saved_after_resolve_locks_before_delete_ranges':
      'Resolve Locks後・Delete Ranges前に保存',
    'semanticBoundary:ddl_whole_ranges_only':
      'DDL whole-range recordのみ。per-key MVCC filterとは別',
    'semanticBoundary:coordinator_ends_storage_cleanup_async':
      '公開後coordinatorは完了。storage cleanupは非同期',
    'implementation:REGION_SCAN_LOCK': 'Region ScanLock',
    'scanState:not_scanned': '未scan',
    'scanState:scanned': 'scan済み',
    'command:normal_tikv_write_command': '通常のTiKV write command',
    'raftBoundary:resolve_lock_raft_detail_outside_slice':
      'ResolveLockのRaft detailはこのslice外（no-Raftとはしない）',
    'rangeStatus:pending': '未適格',
    'rangeStatus:eligible': 'direct fan-out適格',
    'rangeStatus:deleted': '全Store完了',
    'eligibility:record_drop_ts_below_safe_point':
      'DDL recordのdrop_tsがsafe point未満',
    'fanout:every_relevant_store': '関連する各Storeへ個別送信',
    'raftstoreMode:v1_classic': 'classic raftstore-v1',
    'raftBoundary:unsafe_destroy_range_bypasses_region_raft':
      'このclassic fixtureのUnsafeDestroyRangeはRegion Raftを迂回',
    'privacyBoundary:no_range_boundaries_retained':
      '実key range boundaryを保持しない',
    'detectionState:pending': 'PD値の検出待ち',
    'detectionState:observed': 'PD公開値を検出済み',
    'storagePath:pd_poll_then_rocksdb_compaction_filter':
      'PDをpoll後、RocksDB Compaction Filter',
    'legacyRegionGc:not_scheduled_when_compaction_filter_enabled':
      'Compaction Filter有効時はscheduleしない',
    'raftBoundary:compaction_filter_creates_no_raft_entry':
      'Compaction Filter自体はRaft entryを作らない',
    'timingBoundary:deterministic_bottommost_fixture_not_live_timing':
      'bottommostの固定教材。live compaction時刻の保証ではない',
    'eligibility:commit_ts_at_or_below_published_safe_point':
      'commit_ts <= 公開safe point',
    'anchorRule:newest_put_at_or_below_safe_point_retained':
      'safe point以下の最新Putをsnapshot anchorとして保持',
    'deleteRule:newest_delete_can_remove_older_chain':
      '最新Deleteならそれ以前のchain全体を削除可能',
    'compactionLevel:bottommost_model_fixture':
      'bottommost（MODEL fixture）',
    'representation:logical_chains_counted_once':
      'logical chainを1回だけ集計（replica倍しない）',
  },
  en: {
    'detectorScope:cluster_wide': 'cluster-wide',
    'resolution:rolling_back': 'rolling back',
    'internalRetryable:false': 'false (no TiDB internal retry)',
    'clientError:not_returned_yet': 'Not returned yet',
    'candidatePolicy:MODEL POLICY: lowest live up-to-date Store ID':
      'MODEL POLICY: lowest live, up-to-date Store ID',
    'retrySource:tidb_internal': 'TiDB internal',
    'boundary:same logical Region request': 'same logical Region request',
    'pdRole:observer_and_routing_only': 'Observe and route metadata only',
    'lane:one_pc': '1PC',
    'lane:async_commit': 'Async Commit',
    'lane:two_pc': 'regular 2PC',
    'profileScope:declared_fixture_profile_visible_from_comparison_start':
      'Declared representative profile / outcome; visible from comparison start',
    'selected:1pc': '1PC',
    'selected:async_commit': 'Async Commit',
    'selected:2pc': 'regular 2PC',
    'protocol:1pc': '1PC',
    'protocol:async_commit': 'Async Commit',
    'protocol:2pc': 'regular 2PC',
    'selectionReason:single_region_one_pc_model_case':
      'representative single-Region case (1PC precedence)',
    'selectionReason:multi_region_async_commit_model_case':
      'representative multi-Region case within Async limits',
    'selectionReason:async_key_count_limit_model_case':
      '257 mutations exceed the Async limit of 256',
    'consistency:linearizable': 'linear consistency',
    'onePcDecisionPoint:region_batching': 'TiDB Region batching',
    'onePcDecisionPoint:tikv_prewrite': 'TiKV Prewrite response',
    'asyncDecisionPoint:client_precheck': 'TiDB client precheck',
    'asyncDecisionPoint:tikv_prewrite': 'TiKV Prewrite response',
    'representation:aggregate_counts_only':
      'aggregate counts only (no SQL, keys, values, or rows)',
    'stage:idle': 'idle',
    'stage:requested': 'request received',
    'stage:started': 'transaction started',
    'stage:selected': 'protocol selected',
    'stage:latest_ts': 'timestamp floor ready',
    'stage:prewriting': 'prewriting',
    'stage:prewritten': 'prewritten',
    'stage:commit_ts': 'commit_ts ready',
    'stage:committing': 'committing',
    'stage:client_acknowledged': 'client acknowledged',
    'stage:background': 'post-response cleanup',
    'stage:complete': 'complete',
    'startTsSource:pd_tso': 'PD TSO',
    'latestTsSource:pd_tso': 'PD TSO',
    'requestMinCommitTsSource:latest_ts_plus_one':
      'TiDB-derived: latest_ts + 1',
    'maxCommitTsSource:representative_safe_window_model_bound':
      'MODEL POLICY: representative safe-window bound',
    'commitTsSource:tikv_one_pc_result': 'TiKV one_pc_commit_ts',
    'commitTsSource:max_prewrite_min_commit_ts':
      'maximum TiKV-returned min_commit_ts',
    'commitTsSource:pd_tso_after_prewrite': 'PD TSO after all prewrites',
    'backgroundState:not_required': 'not required',
    'backgroundState:not_started': 'not started',
    'backgroundState:in_progress_after_response':
      'running after client response',
    'backgroundState:complete': 'complete',
    'clientBoundary:response_before_cleanup_completion':
      'response before cleanup completion',
    'backgroundScheduling:deterministic_after_client_boundary_model_policy':
      'MODEL POLICY: fixed display order after client response',
    'raftOperation:one_pc_prewrite': '1PC Prewrite',
    'raftOperation:commit_primary': 'primary Commit',
    'raftOperation:commit_secondary': 'secondary Commit',
    'raftOperation:commit_async': 'Async background Commit',
    'raftStage:persisted_quorum': 'persisted by quorum',
    'raftStage:committed': 'Raft committed',
    'raftStage:applied': 'MVCC applied',
    'coordinatorLayer:tidb_transaction_commit': 'TiDB transaction commit',
    'raftLayer:per_region_consensus': 'per-Region consensus',
    'cfDefault:value': 'representative value',
    'cfLock:prewrite': 'Prewrite lock',
    'cfWrite:commit': 'commit record',
    'returnedMinCommitTsSource:tikv_prewrite_result': 'TiKV Prewrite response',
    'boundRule:min_candidate_transaction_bound_service_minimum':
      'minimum of candidate, minStartTS - 1, and PD service minimum',
    'maxWaitBoundary:within_max_wait_reported_not_killed':
      'reported every 30 s while eligible; GC does not kill the transaction',
    'maxWaitBoundary:fixture_completed_not_max_wait_or_kill':
      'fixture completed explicitly; not a max-wait expiry or GC kill',
    'coordinatorStep:stage_mysql_tidb_status':
      'stage human-readable status in mysql.tidb',
    'coordinatorStep:resolve_locks': 'Region ScanLock, then ResolveLock',
    'coordinatorStep:save_visibility_and_cross_100_second_barrier':
      'save visibility safe point and cross the 100-second barrier',
    'coordinatorStep:delete_ranges': 'Delete Ranges for DDL whole-range tasks',
    'coordinatorStep:publish_pd_global_safe_point':
      'publish the PD global safe point',
    'pipelineState:pending': 'pending',
    'pipelineState:active': 'active',
    'pipelineState:complete': 'complete',
    'semanticBoundary:human_readable_status_not_pd_global':
      'human-readable status, not the PD global value',
    'semanticBoundary:region_scan_then_resolve_lock':
      'scan each Region, then resolve its old locks',
    'semanticBoundary:saved_after_resolve_locks_before_delete_ranges':
      'saved after Resolve Locks and before Delete Ranges',
    'semanticBoundary:ddl_whole_ranges_only':
      'DDL whole-range records only; separate from per-key MVCC filtering',
    'semanticBoundary:coordinator_ends_storage_cleanup_async':
      'coordinator ends after publication; storage cleanup is asynchronous',
    'implementation:REGION_SCAN_LOCK': 'Region ScanLock',
    'scanState:not_scanned': 'not scanned',
    'scanState:scanned': 'scanned',
    'command:normal_tikv_write_command': 'normal TiKV write command',
    'raftBoundary:resolve_lock_raft_detail_outside_slice':
      'ResolveLock Raft detail is outside this slice; this is not a no-Raft claim',
    'rangeStatus:pending': 'not eligible',
    'rangeStatus:eligible': 'eligible for direct fan-out',
    'rangeStatus:deleted': 'completed on all stores',
    'eligibility:record_drop_ts_below_safe_point':
      'DDL record drop_ts is below the safe point',
    'fanout:every_relevant_store': 'sent separately to every relevant store',
    'raftstoreMode:v1_classic': 'classic raftstore-v1',
    'raftBoundary:unsafe_destroy_range_bypasses_region_raft':
      'UnsafeDestroyRange bypasses Region Raft in this classic fixture',
    'privacyBoundary:no_range_boundaries_retained':
      'no real key-range boundaries retained',
    'detectionState:pending': 'waiting to detect the PD value',
    'detectionState:observed': 'PD published value observed',
    'storagePath:pd_poll_then_rocksdb_compaction_filter':
      'poll PD, then RocksDB Compaction Filter',
    'legacyRegionGc:not_scheduled_when_compaction_filter_enabled':
      'not scheduled while Compaction Filter is enabled',
    'raftBoundary:compaction_filter_creates_no_raft_entry':
      'Compaction Filter itself creates no Raft entry',
    'timingBoundary:deterministic_bottommost_fixture_not_live_timing':
      'deterministic bottommost fixture, not a live compaction-time guarantee',
    'eligibility:commit_ts_at_or_below_published_safe_point':
      'commit_ts <= published safe point',
    'anchorRule:newest_put_at_or_below_safe_point_retained':
      'retain the newest Put at or below the safe point as snapshot anchor',
    'deleteRule:newest_delete_can_remove_older_chain':
      'a newest Delete can remove its entire older chain',
    'compactionLevel:bottommost_model_fixture':
      'bottommost (MODEL fixture)',
    'representation:logical_chains_counted_once':
      'logical chains counted once, not multiplied by replicas',
  },
}

function localizedColumnTitle(locale: Locale, column: string): string {
  return COLUMN_TITLES[locale][column] ?? column
}

function localizedCellValue(
  locale: Locale,
  column: string,
  raw: string,
): string {
  return CELL_VALUE_COPY[locale][`${column}:${raw}`] ?? raw
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function value(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number' && !Number.isFinite(value)) return '—'
  return String(value)
}

function pick(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key]
  }
  return undefined
}

function clusterRows(state: Record<string, unknown>): DiagnosticRow[] {
  const topology = record(state.topology)
  const listed = array(topology.nodes)
  const nodes = listed.length > 0
    ? listed
    : ['tiproxy', 'tidb', 'pd', 'tikv', 'tiflash'].flatMap((kind) => array(topology[kind]))
  return nodes.map((entry) => {
    const node = record(entry)
    return {
      id: value(node.id),
      kind: value(node.kind),
      status: value(node.status),
      role: value(node.role ?? (node.leader === true ? 'leader' : 'member')),
      zone: value(node.zone),
    }
  })
}

function raftLabState(state: Record<string, unknown>): Record<string, unknown> {
  return record(state.raftLab)
}

function raftPeerRows(state: Record<string, unknown>): DiagnosticRow[] {
  const raftLab = raftLabState(state)
  if (Object.keys(raftLab).length === 0) return []
  return array(raftLab.peers).map((entry) => {
    const peer = record(entry)
    return {
      store: value(peer.storeId),
      raftRole: value(peer.role),
      peerHealth: peer.healthy === false ? 'down' : 'up',
      currentTerm: value(peer.currentTerm),
      votedFor: value(peer.votedFor),
      lastLog: `${value(peer.lastLogIndex)} / ${value(peer.lastLogTerm)}`,
      matchIndex: value(peer.matchIndex),
      peerCommitIndex: value(peer.commitIndex),
      peerAppliedIndex: value(peer.appliedIndex),
      oldLeader: value(peer.storeId === raftLab.oldLeaderStoreId),
      currentLeader: value(peer.storeId === raftLab.leaderStoreId),
    }
  })
}

function raftElectionRows(state: Record<string, unknown>): DiagnosticRow[] {
  const raftLab = raftLabState(state)
  if (Object.keys(raftLab).length === 0) return []
  const election = record(raftLab.election)
  const pd = record(raftLab.pd)
  const preVotes = array(election.preVotesGranted)
  const votes = array(election.votesGranted)
  return [{
    region: value(raftLab.regionId),
    electionPhase: value(election.phase),
    candidate: value(election.candidateStoreId),
    preVotesGranted: value(preVotes),
    votesGranted: value(votes),
    electionQuorum: `${votes.length}/${value(raftLab.quorum)}`,
    liveVoters: `${value(raftLab.liveVoterCount)}/3`,
    prevoteEnabled: value(election.prevoteEnabled),
    configuredTimeout:
      `${value(election.configuredElectionTimeoutTicks)}–` +
      `${value(election.configuredMaxElectionTimeoutTicks)} ticks`,
    teachingElapsed: `${value(election.elapsedTicks)} ticks · MODEL POLICY`,
    candidatePolicy: election.candidatePolicy ===
      'lowest_live_up_to_date_store_id_model_policy'
      ? 'MODEL POLICY: lowest live up-to-date Store ID'
      : value(election.candidatePolicy),
    oldLeader: value(raftLab.oldLeaderStoreId),
    currentLeader: value(raftLab.leaderStoreId),
    failedStore: value(raftLab.failedStoreId),
    pdRole: value(pd.role),
    pdObservedLeader: value(pd.observedLeaderStoreId),
    pdRouteLookup: value(pd.routeLookupCompleted),
  }]
}

function regionRequestRetryRows(state: Record<string, unknown>): DiagnosticRow[] {
  const raftLab = raftLabState(state)
  if (Object.keys(raftLab).length === 0) return []
  const request = record(raftLab.request)
  return [{
    logicalRequest: value(request.logicalRequestId),
    retrySource: value(request.source),
    internalAttempt: value(request.attempt),
    cachedLeader: value(request.cachedLeaderStoreId),
    cacheState: value(request.cacheState),
    requestStatus: value(request.status),
    fixedBackoffMs: value(request.backoffMs),
    clientVisibleError: value(request.clientVisibleError),
    applicationRetry: 'false',
    boundary: 'same logical Region request',
  }]
}

function protocolLabState(state: Record<string, unknown>): Record<string, unknown> {
  return record(state.protocolLab)
}

function protocolLaneRows(
  state: Record<string, unknown>,
): Record<string, unknown>[] {
  return array(protocolLabState(state).lanes).map(record)
}

function protocolSelectionRows(state: Record<string, unknown>): DiagnosticRow[] {
  const protocolLab = protocolLabState(state)
  if (Object.keys(protocolLab).length === 0) return []
  return protocolLaneRows(state).map((lane) => {
    const eligibility = record(lane.eligibility)
    return {
      lane: value(lane.id),
      profileScope:
        'declared_fixture_profile_visible_from_comparison_start',
      selected: value(eligibility.selected),
      selectionReason: value(eligibility.selectionReason),
      onePcEnabled: value(eligibility.enable1Pc),
      asyncCommitEnabled: value(eligibility.enableAsyncCommit),
      consistency: value(eligibility.consistency),
      onePcEligible: value(eligibility.onePcEligible),
      asyncCommitEligible: value(eligibility.asyncCommitEligible),
      regionCount: value(eligibility.regionCount),
      mutationCount: value(eligibility.mutationCount),
      totalKeyBytes: value(eligibility.totalKeyBytes),
      onePcDecisionPoint: value(eligibility.onePcDecisionPoint),
      asyncDecisionPoint: value(eligibility.asyncDecisionPoint),
      onePcRejectedBeforeRpc: value(eligibility.onePcRejectedBeforeRpc),
      asyncRejectedAtClientPrecheck:
        value(eligibility.asyncRejectedAtClientPrecheck),
      tryOnePcSent: value(eligibility.tryOnePcSent),
      asyncKeyCountLimit: value(eligibility.asyncKeyCountLimit),
      asyncTotalKeyBytesLimit: value(eligibility.asyncTotalKeyBytesLimit),
      runtimeFallback: value(eligibility.runtimeFallback),
      representation: value(protocolLab.representation),
    }
  })
}

function present(raw: unknown): boolean {
  return raw !== null && raw !== undefined
}

function protocolBackgroundState(lane: Record<string, unknown>): string {
  if (lane.protocol === '1pc') return 'not_required'
  if (lane.backgroundComplete === true) return 'complete'
  if (lane.clientResponded === true) return 'in_progress_after_response'
  return 'not_started'
}

function protocolClientPathRows(state: Record<string, unknown>): DiagnosticRow[] {
  const protocolLab = protocolLabState(state)
  if (Object.keys(protocolLab).length === 0) return []
  return protocolLaneRows(state).map((lane) => ({
    lane: value(lane.id),
    protocol: value(lane.protocol),
    request: value(lane.requestId),
    transaction: value(lane.transactionId),
    stage: value(lane.stage),
    startTs: value(lane.startTs),
    startTsSource: present(lane.startTs) ? 'pd_tso' : '—',
    latestTs: value(lane.latestTs),
    latestTsSource: present(lane.latestTs) ? 'pd_tso' : '—',
    requestMinCommitTs: value(lane.requestMinCommitTs),
    requestMinCommitTsSource: present(lane.requestMinCommitTs)
      ? 'latest_ts_plus_one'
      : '—',
    maxCommitTs: value(lane.maxCommitTs),
    maxCommitTsSource: present(lane.maxCommitTs)
      ? value(protocolLab.maxCommitTsPolicy)
      : '—',
    commitTs: value(lane.commitTs),
    commitTsSource: value(lane.commitTsSource),
    clientResponded: value(lane.clientResponded),
    backgroundState: protocolBackgroundState(lane),
    clientBoundary: value(protocolLab.clientBoundary),
    backgroundScheduling: value(protocolLab.backgroundScheduling),
  }))
}

function protocolRegionRows(state: Record<string, unknown>): DiagnosticRow[] {
  const protocolLab = protocolLabState(state)
  if (Object.keys(protocolLab).length === 0) return []
  return protocolLaneRows(state).flatMap((lane) =>
    array(lane.regions).map((entry) => {
      const region = record(entry)
      const raft = record(region.raft)
      const mvcc = record(region.mvcc)
      const voters = array(region.voterStoreIds)
      return {
        lane: value(lane.id),
        protocol: value(lane.protocol),
        region: value(region.regionId),
        role: value(region.role),
        mutationCount: value(region.mutationCount),
        leader: value(region.leaderStoreId),
        voterCount: value(voters.length),
        raftOperation: value(raft.operation),
        raftStage: value(raft.stage),
        raftIndex: value(raft.index),
        raftAcks: `${value(raft.acknowledgements)}/${value(raft.quorum)}`,
        persistedVoters: value(raft.persistedStoreIds),
        coordinatorLayer: value(protocolLab.coordinatorLayer),
        raftLayer: value(protocolLab.raftLayer),
        cfDefault: value(mvcc.defaultCf),
        cfLock: value(mvcc.lockCf),
        cfWrite: value(mvcc.writeCf),
        asyncCommit: value(mvcc.asyncCommit),
        secondaryCount: value(mvcc.secondaryCount),
        returnedMinCommitTs: value(region.returnedMinCommitTs),
        returnedMinCommitTsSource: present(region.returnedMinCommitTs)
          ? 'tikv_prewrite_result'
          : '—',
        asyncApplyPrewrite: value(protocolLab.tikvAsyncApplyPrewrite),
      }
    }),
  )
}

const GC_PHASE_ORDER = [
  'idle',
  'preparing',
  'safe_point_bounded',
  'resolving_locks',
  'caching_safe_point',
  'deleting_ranges',
  'publishing_safe_point',
  'tikv_observing',
  'compacting',
  'between_rounds',
  'complete',
] as const

function gcLabState(state: Record<string, unknown>): Record<string, unknown> {
  return record(state.gcLab)
}

function gcPhaseRank(gcLab: Record<string, unknown>): number {
  const index = GC_PHASE_ORDER.indexOf(
    value(gcLab.phase) as (typeof GC_PHASE_ORDER)[number],
  )
  return index < 0 ? 0 : index
}

function gcSafePointStoreRows(
  state: Record<string, unknown>,
): DiagnosticRow[] {
  const gcLab = gcLabState(state)
  if (Object.keys(gcLab).length === 0) return []
  const safePoint = record(gcLab.safePoint)
  const blocker = record(gcLab.blocker)
  const configuration = record(gcLab.configuration)
  return [{
    round: value(gcLab.round),
    phase: value(gcLab.phase),
    candidateSafePoint: value(safePoint.candidate),
    globalMinStartTs: value(safePoint.globalMinStartTs),
    transactionBound: value(safePoint.activeTransactionBound),
    boundRule: 'min_candidate_transaction_bound_service_minimum',
    serviceSafePoint: value(safePoint.serviceSafePoint),
    mysqlStagedSafePoint: value(safePoint.staged),
    visibilitySafePoint: value(safePoint.visibilitySaved),
    visibilityStore: '/tidb/store/gcworker/saved_safe_point',
    cacheBarrier:
      `${value(configuration.visibilityCacheBarrierSeconds)} s · implementation barrier`,
    gcLeaderLeaseStore: value(configuration.gcLeaderLeaseStore),
    pdGlobalSafePoint: value(safePoint.published),
    globalStore: 'PD gc/safe_point',
    blockerStatus: value(blocker.status),
    maxWaitBoundary: blocker.status === 'completed'
      ? 'fixture_completed_not_max_wait_or_kill'
      : 'within_max_wait_reported_not_killed',
  }]
}

type GcPipelineState = 'pending' | 'active' | 'complete'

function gcCoordinatorRows(state: Record<string, unknown>): DiagnosticRow[] {
  const gcLab = gcLabState(state)
  if (Object.keys(gcLab).length === 0) return []
  const safePoint = record(gcLab.safePoint)
  const phase = value(gcLab.phase)
  const phaseRank = gcPhaseRank(gcLab)
  const serviceSafePoint = safePoint.serviceSafePoint
  const atServicePoint = (
    candidate: unknown
  ): boolean => serviceSafePoint !== null &&
    serviceSafePoint !== undefined &&
    candidate === serviceSafePoint
  const locks = array(record(gcLab.resolveLocks).locks).map(record)
  const scannedRegionIds = array(record(gcLab.resolveLocks).scannedRegionIds)
  const expectedRegionIds = new Set(locks.map((lock) => lock.regionId))
  const resolveComplete = expectedRegionIds.size > 0 &&
    [...expectedRegionIds].every((regionId) =>
      scannedRegionIds.includes(regionId)) &&
    locks.every((lock) => lock.status !== 'pending')
  const ranges = array(gcLab.deleteRanges).map(record)
  const deleteComplete = phaseRank > GC_PHASE_ORDER.indexOf('deleting_ranges') ||
    (
      phase === 'deleting_ranges' &&
      ranges.every((range) => range.status === 'deleted')
    )

  function phaseState(
    activePhase: (typeof GC_PHASE_ORDER)[number],
    complete: boolean,
  ): GcPipelineState {
    if (complete) return 'complete'
    const activeRank = GC_PHASE_ORDER.indexOf(activePhase)
    if (phaseRank === activeRank) return 'active'
    return phaseRank > activeRank ? 'complete' : 'pending'
  }

  return [
    {
      order: '0',
      coordinatorStep: 'stage_mysql_tidb_status',
      pipelineState: atServicePoint(safePoint.staged) ? 'complete' : 'pending',
      stateStore: 'mysql.tidb / tikv_gc_safe_point',
      semanticBoundary: 'human_readable_status_not_pd_global',
    },
    {
      order: '1',
      coordinatorStep: 'resolve_locks',
      pipelineState: phaseState('resolving_locks', resolveComplete),
      stateStore: value(record(gcLab.resolveLocks).implementation),
      semanticBoundary: 'region_scan_then_resolve_lock',
    },
    {
      order: '2',
      coordinatorStep: 'save_visibility_and_cross_100_second_barrier',
      pipelineState: phaseState(
        'caching_safe_point',
        phaseRank >= GC_PHASE_ORDER.indexOf('caching_safe_point') &&
          atServicePoint(safePoint.visibilitySaved),
      ),
      stateStore: '/tidb/store/gcworker/saved_safe_point',
      semanticBoundary:
        'saved_after_resolve_locks_before_delete_ranges',
    },
    {
      order: '3',
      coordinatorStep: 'delete_ranges',
      pipelineState: phaseState('deleting_ranges', deleteComplete),
      stateStore: 'DDL delete-range records',
      semanticBoundary: 'ddl_whole_ranges_only',
    },
    {
      order: '4',
      coordinatorStep: 'publish_pd_global_safe_point',
      pipelineState: phaseState(
        'publishing_safe_point',
        phaseRank >= GC_PHASE_ORDER.indexOf('publishing_safe_point') &&
          atServicePoint(safePoint.published),
      ),
      stateStore: 'PD gc/safe_point',
      semanticBoundary: 'coordinator_ends_storage_cleanup_async',
    },
  ]
}

function gcResolveLockRows(state: Record<string, unknown>): DiagnosticRow[] {
  const gcLab = gcLabState(state)
  if (Object.keys(gcLab).length === 0) return []
  const resolveLocks = record(gcLab.resolveLocks)
  const configuration = record(gcLab.configuration)
  const locks = array(resolveLocks.locks).map(record)
  const scanned = new Set(array(resolveLocks.scannedRegionIds))
  const regionIds = [...new Set([
    ...locks.map((lock) => lock.regionId),
    ...scanned,
  ])].sort((a, b) => Number(a) - Number(b))
  return regionIds.map((regionId) => {
    const regionLocks = locks.filter((lock) => lock.regionId === regionId)
    return {
      implementation: value(resolveLocks.implementation),
      region: value(regionId),
      scanState: scanned.has(regionId) ? 'scanned' : 'not_scanned',
      pendingLocks: value(regionLocks.filter((lock) =>
        lock.status === 'pending').length),
      resolvedCommit: value(regionLocks.filter((lock) =>
        lock.status === 'resolved_commit').length),
      resolvedRollback: value(regionLocks.filter((lock) =>
        lock.status === 'resolved_rollback').length),
      command: 'normal_tikv_write_command',
      raftBoundary: configuration.resolveLockRaftDetailModeled === false
        ? 'resolve_lock_raft_detail_outside_slice'
        : '—',
    }
  })
}

function gcDeleteRangeRows(state: Record<string, unknown>): DiagnosticRow[] {
  const gcLab = gcLabState(state)
  if (Object.keys(gcLab).length === 0) return []
  const stores = array(gcLab.stores).map(record)
  const configuration = record(gcLab.configuration)
  return array(gcLab.deleteRanges).map(record).flatMap((range, rangeIndex) =>
    stores.map((store) => ({
      rangeSlot: `synthetic-ddl-range-${rangeIndex + 1}`,
      store: value(store.storeId),
      rangeStatus: value(range.status),
      eligibility: 'record_drop_ts_below_safe_point',
      request: value(configuration.deleteRangeRequest),
      fanout: 'every_relevant_store',
      raftstoreMode: value(record(gcLab.configuration).raftstoreMode),
      raftBoundary: configuration.deleteRangeBypassesRaft === true
        ? 'unsafe_destroy_range_bypasses_region_raft'
        : '—',
      privacyBoundary: 'no_range_boundaries_retained',
    })),
  )
}

function gcStoreCompactionRows(
  state: Record<string, unknown>,
): DiagnosticRow[] {
  const gcLab = gcLabState(state)
  if (Object.keys(gcLab).length === 0) return []
  const safePoint = record(gcLab.safePoint)
  const configuration = record(gcLab.configuration)
  const serviceSafePoint = safePoint.serviceSafePoint
  const currentPointPublished = serviceSafePoint !== null &&
    serviceSafePoint !== undefined &&
    safePoint.published === serviceSafePoint
  return array(gcLab.stores).map((entry) => {
    const store = record(entry)
    const observed = currentPointPublished &&
      store.detectedSafePoint === safePoint.published
    return {
      store: value(store.storeId),
      detectedSafePoint: value(store.detectedSafePoint),
      publishedSafePoint: value(safePoint.published),
      detectionState: observed ? 'observed' : 'pending',
      compaction: value(store.compaction),
      filterActive: value(store.filterActive),
      storagePath: 'pd_poll_then_rocksdb_compaction_filter',
      legacyRegionGc: configuration.compactionFilterEnabled === true
        ? 'not_scheduled_when_compaction_filter_enabled'
        : '—',
      raftBoundary: 'compaction_filter_creates_no_raft_entry',
      timingBoundary:
        'deterministic_bottommost_fixture_not_live_timing',
    }
  })
}

function gcMvccChainRows(state: Record<string, unknown>): DiagnosticRow[] {
  const gcLab = gcLabState(state)
  if (Object.keys(gcLab).length === 0) return []
  const storage = record(gcLab.storage)
  return array(gcLab.keyChains).map((entry, chainIndex) => {
    const chain = record(entry)
    const versions = array(chain.versions).map(record)
    const filtered = versions.filter((version) => version.state === 'filtered')
    return {
      chainSlot: `synthetic-chain-${chainIndex + 1}`,
      region: value(chain.regionId),
      versions: value(versions.length),
      filtered: value(filtered.length),
      anchors: value(versions.filter((version) =>
        version.state === 'retained_anchor').length),
      present: value(versions.filter((version) =>
        version.state !== 'filtered').length),
      defaultCfDeletes: value(filtered.filter((version) =>
        version.writeType === 'put' &&
        version.valueStorage === 'write_and_default_cf').length),
      eligibility: 'commit_ts_at_or_below_published_safe_point',
      anchorRule: 'newest_put_at_or_below_safe_point_retained',
      deleteRule: 'newest_delete_can_remove_older_chain',
      compactionLevel: value(storage.compactionLevel),
      representation: value(storage.representation),
      timingBoundary:
        'deterministic_bottommost_fixture_not_live_timing',
    }
  })
}

function tiflashMppLabState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  return record(state.tiflashMppLab)
}

function tiflashReplicationRows(
  state: Record<string, unknown>,
): DiagnosticRow[] {
  const lab = tiflashMppLabState(state)
  if (Object.keys(lab).length === 0) return []
  const configuration = record(lab.configuration)
  return array(lab.learners).map((entry) => {
    const learner = record(entry)
    return {
      region: value(learner.regionId),
      leaderStore: value(learner.leaderStoreId),
      learnerStore: value(learner.learnerStoreId),
      role: value(learner.role),
      voter: value(learner.voter),
      replicationMode: value(learner.replicationMode),
      leaderCommitIndex: value(learner.leaderCommitIndex),
      learnerReceivedIndex: value(learner.learnerReceivedIndex),
      learnerRaftCommandIndex: value(learner.learnerRaftCommandIndex),
      deltaMergeCommittedIndex: value(learner.deltaMergeFlushedIndex),
      learnerAppliedIndex: value(learner.learnerAppliedIndex),
      replicationPlane: value(configuration.replicationPlane),
      initialSnapshotTransferModeled:
        value(configuration.initialSnapshotTransferModeled),
      exchangeMutation: 'false',
    }
  })
}

function tiflashReadGateRows(
  state: Record<string, unknown>,
): DiagnosticRow[] {
  const lab = tiflashMppLabState(state)
  if (Object.keys(lab).length === 0) return []
  const configuration = record(lab.configuration)
  return array(lab.learners).map((entry) => {
    const learner = record(entry)
    return {
      region: value(learner.regionId),
      learnerStore: value(learner.learnerStoreId),
      snapshotTs: value(lab.snapshotTs),
      leaderSafeTs: value(learner.leaderSafeTs),
      selfSafeTs: value(learner.selfSafeTs),
      safeTsLagBucket: value(learner.safeTsLagBucket),
      gateState: value(learner.readGate),
      gateReason: value(learner.gateReason),
      readIndexSkipped: value(learner.readIndexSkipped),
      requiredReadIndex: value(learner.requiredReadIndex),
      learnerAppliedIndex: value(learner.learnerAppliedIndex),
      lockCount: value(learner.lockCount),
      postReadValidated: value(learner.postReadValidated),
      staleRead: value(configuration.staleRead),
      readinessBoundary: 'per_region_not_node_global_resolved_ts',
    }
  })
}

function tiflashMppTaskRows(
  state: Record<string, unknown>,
): DiagnosticRow[] {
  const lab = tiflashMppLabState(state)
  if (Object.keys(lab).length === 0) return []
  const fragments = new Map(
    array(lab.fragments).map((entry) => {
      const fragment = record(entry)
      return [fragment.id, fragment] as const
    }),
  )
  return array(lab.tasks).map((entry) => {
    const task = record(entry)
    const fragment = fragments.get(task.fragmentId)
    return {
      task: value(task.id),
      fragment: value(task.fragmentId),
      fragmentKind: value(fragment?.kind),
      operators: value(fragment?.operatorTokens),
      store: value(task.storeId),
      regions: value(task.regionIds),
      stage: value(task.stage),
      rootTask: value(task.root),
      feedsTiDBRoot: value(task.feedsTiDBRoot),
      taskBoundary: 'tasks_group_regions_by_tiflash_address',
    }
  })
}

function tiflashMppTunnelRows(
  state: Record<string, unknown>,
): DiagnosticRow[] {
  const lab = tiflashMppLabState(state)
  if (Object.keys(lab).length === 0) return []
  const configuration = record(lab.configuration)
  return array(lab.tunnels).map((entry) => {
    const tunnel = record(entry)
    return {
      tunnel: value(tunnel.id),
      exchangeType: value(tunnel.exchangeType),
      sourceTask: value(tunnel.sourceTaskId),
      targetTask: value(tunnel.targetTaskId),
      state: value(tunnel.status),
      packetCount: value(tunnel.packetCount),
      bytesBucket: value(tunnel.bytesBucket),
      persistence: value(tunnel.persistence),
      exchangePlane: value(configuration.exchangePlane),
      raftOrMvccMutation: 'false',
    }
  })
}

function tiflashMppRootRows(
  state: Record<string, unknown>,
): DiagnosticRow[] {
  const lab = tiflashMppLabState(state)
  if (Object.keys(lab).length === 0) return []
  const configuration = record(lab.configuration)
  const result = record(lab.result)
  const retry = record(lab.retry)
  const pins = record(lab.pins)
  return [{
    phase: value(lab.phase),
    queryToken: value(configuration.queryToken),
    tableToken: value(configuration.tableToken),
    optimizerChoice: value(configuration.optimizerChoice),
    provisioningAvailable: value(configuration.provisioningAvailable),
    provisioningProgress: value(configuration.provisioningProgress),
    provisioningMeaning: value(configuration.provisioningMeaning),
    rootTask: value(result.taskId),
    resultStage: value(result.stage),
    rootStreams: value(result.rootStreamCount),
    chunksDecoded: value(result.chunksDecoded),
    columnsSent: value(result.columnsSent),
    rowsBucket: value(result.rowsBucket),
    clientComplete: value(result.clientComplete),
    retryCount: value(retry.retryCount),
    fallbackToTiKV: value(retry.fallbackToTiKV),
    failureCode: value(retry.failureCode),
    failureRetryModeled: value(configuration.failureRetryModeled),
    tiflashPin: value(pins.tiflash),
    tiflashProxyPin: value(pins.tiflashProxy),
    tidbPin: value(pins.tidb),
    tikvPin: value(pins.tikv),
    provisioningBoundary:
      'AVAILABLE_and_PROGRESS_do_not_guarantee_snapshot_readiness',
    fallbackBoundary:
      'query_level_before_client_output_not_partial_task_resume',
  }]
}

function lockLabState(state: Record<string, unknown>): Record<string, unknown> {
  return record(state.lockLab)
}

function transactionRows(state: Record<string, unknown>): DiagnosticRow[] {
  const lockLab = lockLabState(state)
  const lockTransactions = array(lockLab.transactions)
  if (lockTransactions.length > 0) {
    return lockTransactions.map((entry) => {
      const transaction = record(entry)
      return {
        id: value(transaction.transactionId),
        client: value(transaction.clientId),
        attempt: value(transaction.attempt),
        phase: value(transaction.status),
        startTs: value(transaction.startTs),
        commitTs: value(transaction.commitTs),
        retryOf: value(transaction.retryOfTransactionId),
        heldResources: value(transaction.heldResourceIds),
        waitingFor: value(transaction.waitingForResourceId),
      }
    })
  }
  const listed = array(state.transactions)
  const transactions = listed.length > 0
    ? listed
    : Object.keys(record(state.transaction)).length > 0
      ? [state.transaction]
      : []
  return transactions.map((entry) => {
    const transaction = record(entry)
    return {
      id: value(transaction.id),
      mode: value(transaction.mode),
      phase: value(pick(transaction, 'phase', 'stage', 'state')),
      protocol: value(transaction.protocol),
      startTs: value(transaction.startTs),
      commitTs: value(transaction.commitTs),
      regions: value(pick(transaction, 'regionIds', 'regions')),
      primaryRegion: value(pick(transaction, 'primaryRegionId', 'primaryRegion')),
      lockAgeMs: value(transaction.lockAgeMs),
      conflict: value(transaction.conflict),
    }
  })
}

function lockWaitRows(state: Record<string, unknown>): DiagnosticRow[] {
  const lockLab = lockLabState(state)
  const resources = array(lockLab.resources).map(record)
  const detectorLeader = value(lockLab.detectorLeaderStoreId)
  return array(lockLab.waitForEdges).map((entry) => {
    const edge = record(entry)
    const resource = resources.find((candidate) => candidate.id === edge.resourceId)
    const queuePosition = resource
      ? array(resource.waiterTransactionIds).findIndex((id) =>
          id === edge.waiterTransactionId)
      : -1
    return {
      edge: value(edge.id),
      waiter: value(edge.waiterTransactionId),
      holder: value(edge.holderTransactionId),
      direction: 'waiter → holder',
      resource: value(edge.resourceId),
      region: value(edge.regionId),
      queuePosition: queuePosition < 0 ? '—' : String(queuePosition + 1),
      detectorScope: value(lockLab.detectorScope),
      detectorLeader,
    }
  })
}

function deadlockRows(state: Record<string, unknown>): DiagnosticRow[] {
  const lockLab = lockLabState(state)
  const deadlock = record(lockLab.deadlock)
  if (Object.keys(deadlock).length === 0) return []
  const clientErrorCode = deadlock.clientErrorCode
  return [{
    id: value(deadlock.id),
    cycle: value(deadlock.cycleTransactionIds),
    victim: value(deadlock.victimTransactionId),
    selectionPolicy: deadlock.selectionPolicy === 'cycle_closing_waiter_model_policy'
      ? 'MODEL POLICY: cycle-closing waiter'
      : value(deadlock.selectionPolicy),
    internalRetryable: value(deadlock.retryable),
    clientError: clientErrorCode === 1213
      ? 'Error 1213'
      : 'not_returned_yet',
    lockWaitTimeout: 'Error 1205 separate / not modeled',
    resolution: value(deadlock.resolution),
    detectorScope: value(lockLab.detectorScope),
    detectorLeader: value(lockLab.detectorLeaderStoreId),
  }]
}

function applicationRetryRows(state: Record<string, unknown>): DiagnosticRow[] {
  const lockLab = lockLabState(state)
  const retry = record(lockLab.applicationRetry)
  if (Object.keys(retry).length === 0) return []
  const newTransactionId = retry.newTransactionId
  const newTransaction = array(lockLab.transactions)
    .map(record)
    .find((transaction) => transaction.transactionId === newTransactionId)
  return [{
    source: value(retry.source),
    client: value(retry.clientId),
    retryOf: value(retry.retryOfTransactionId),
    status: value(retry.status),
    fixedBackoffMs: value(retry.fixedBackoffMs),
    newTransaction: value(newTransactionId),
    newStartTs: value(newTransaction?.startTs),
    boundary: 'whole transaction',
  }]
}

function regionSource(state: Record<string, unknown>): Record<string, unknown>[] {
  return array(state.regions).map(record)
}

function hotRegionRows(state: Record<string, unknown>): DiagnosticRow[] {
  return regionSource(state)
    .filter((region) => Number(region.hotScore ?? 0) > 0)
    .sort((a, b) => Number(b.hotScore ?? 0) - Number(a.hotScore ?? 0))
    .map((region) => ({
      id: value(region.id),
      leader: value(pick(region, 'leaderStoreId', 'leader')),
      sizeMiB: value(region.sizeMiB),
      hotScore: value(region.hotScore),
      health: value(region.health),
    }))
}

function regionRows(state: Record<string, unknown>): DiagnosticRow[] {
  return regionSource(state).map((region) => {
    const peerIds = array(pick(region, 'peerStoreIds', 'peers')).map((peer) => {
      const peerRecord = record(peer)
      return peerRecord.storeId === undefined ? value(peer) : value(peerRecord.storeId)
    })
    const range = region.startKey !== undefined || region.endKey !== undefined
      ? `[${value(region.startKey)}, ${value(region.endKey)})`
      : '—'
    const row: Record<string, string> = {
      id: value(region.id),
      range,
      leader: value(pick(region, 'leaderStoreId', 'leader')),
      peers: peerIds.join(', ') || '—',
      term: value(region.term),
      commitIndex: value(region.commitIndex),
      appliedIndex: value(region.appliedIndex),
      epoch: value(region.epoch),
      health: value(region.health),
    }
    const mvcc = record(region.mvcc)
    const pessimisticLock = record(region.pessimisticLock)
    if (
      region.proposedIndex !== undefined ||
      region.acknowledgements !== undefined ||
      Object.keys(mvcc).length > 0 ||
      region.pessimisticLock !== undefined
    ) {
      row.proposedIndex = value(region.proposedIndex)
      row.raftAcks = region.acknowledgements === undefined
        ? '—'
        : `${value(region.acknowledgements)}/${value(region.quorum)}`
      row.pessimisticLock = region.pessimisticLock === null
        ? 'none'
        : value(pick(pessimisticLock, 'storage'))
      row.cfLock = value(mvcc.lockCf)
      row.cfDefault = value(mvcc.defaultCf)
      row.cfWrite = value(mvcc.writeCf)
      row.primary = value(mvcc.primary)
    }
    return row
  })
}

function gcRows(state: Record<string, unknown>): DiagnosticRow[] {
  const gc = record(state.gc)
  if (Object.keys(gc).length === 0) return []
  return [{
    safePoint: value(gc.safePoint),
    blockedBy: value(pick(gc, 'blockedBy', 'blockedByStartTs')),
    backlog: value(pick(gc, 'backlog', 'backlogVersions')),
    obsoleteVersions: value(gc.obsoleteVersions),
    collectedVersions: value(gc.collectedVersions),
  }]
}

function tiflashRows(state: Record<string, unknown>): DiagnosticRow[] {
  const tiflash = record(state.tiflash)
  if (Object.keys(tiflash).length === 0) return []
  return [{
    available: value(pick(tiflash, 'available', 'ready')),
    resolvedTs: value(tiflash.resolvedTs),
    targetTs: value(tiflash.targetTs),
    lagSeconds: value(pick(tiflash, 'lagSeconds', 'lagMs')),
    progress: value(tiflash.progress),
    pendingVersions: value(tiflash.pendingVersions),
    mppQueries: value(tiflash.mppQueries),
  }]
}

export function projectDiagnostics(snapshot: TiCityState | unknown): DiagnosticProjection[] {
  const state = record(snapshot)
  const sources: Record<DiagnoseSection, () => DiagnosticRow[]> = {
    cluster: () => clusterRows(state),
    'raft-peers': () => raftPeerRows(state),
    'raft-election': () => raftElectionRows(state),
    'region-request-retry': () => regionRequestRetryRows(state),
    'protocol-selection': () => protocolSelectionRows(state),
    'protocol-client-path': () => protocolClientPathRows(state),
    'protocol-region-state': () => protocolRegionRows(state),
    'gc-safe-point-stores': () => gcSafePointStoreRows(state),
    'gc-coordinator-path': () => gcCoordinatorRows(state),
    'gc-resolve-locks': () => gcResolveLockRows(state),
    'gc-delete-ranges': () => gcDeleteRangeRows(state),
    'gc-store-compaction': () => gcStoreCompactionRows(state),
    'gc-mvcc-chains': () => gcMvccChainRows(state),
    'tiflash-replication': () => tiflashReplicationRows(state),
    'tiflash-read-gates': () => tiflashReadGateRows(state),
    'tiflash-mpp-tasks': () => tiflashMppTaskRows(state),
    'tiflash-mpp-tunnels': () => tiflashMppTunnelRows(state),
    'tiflash-mpp-root': () => tiflashMppRootRows(state),
    transactions: () => transactionRows(state),
    'lock-waits': () => lockWaitRows(state),
    deadlocks: () => deadlockRows(state),
    'application-retry': () => applicationRetryRows(state),
    'hot-regions': () => hotRegionRows(state),
    regions: () => regionRows(state),
    gc: () => gcRows(state),
    tiflash: () => tiflashRows(state),
  }
  return DIAGNOSE_SECTIONS.map((id) => ({
    id,
    label: 'MODEL / SIMULATED',
    rows: sources[id](),
  }))
}

interface ChartDatum {
  value: number
  tone: SummaryTone
}

interface SummaryMetric {
  id: DiagnoseSummarySection
  label: string
  value: string
  detail: string
  tone: SummaryTone
  chart: readonly ChartDatum[]
  chartLabel: string
  meter?: boolean
}

interface DiagnosticSummary {
  tone: Exclude<SummaryTone, 'neutral'>
  metrics: readonly SummaryMetric[]
}

const TONE_WEIGHT: Record<SummaryTone, number> = {
  neutral: 0,
  healthy: 1,
  attention: 2,
  critical: 3,
}

function strongerTone(a: SummaryTone, b: SummaryTone): SummaryTone {
  return TONE_WEIGHT[a] >= TONE_WEIGHT[b] ? a : b
}

function numberValue(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '' || raw === '—') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function booleanValue(raw: string | undefined): boolean | undefined {
  const normalized = raw?.trim().toLowerCase()
  if (normalized === 'true' || normalized === 'yes' || normalized === 'up' || normalized === 'available') {
    return true
  }
  if (normalized === 'false' || normalized === 'no' || normalized === 'down' || normalized === 'unavailable') {
    return false
  }
  return undefined
}

function hasValue(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const normalized = raw.trim().toLowerCase()
  return normalized !== '' && normalized !== '—' && normalized !== 'null' && normalized !== 'false'
}

function rowTone(section: DiagnoseSection, row: DiagnosticRow): SummaryTone {
  if (section === 'cluster') {
    const status = row.status?.toLowerCase()
    if (status === 'down') return 'critical'
    if (status === 'degraded') return 'attention'
    return status === 'up' ? 'healthy' : 'neutral'
  }
  if (section === 'raft-peers') {
    if (row.peerHealth?.toLowerCase() === 'down') return 'attention'
    return row.raftRole?.toLowerCase() === 'leader' ? 'healthy' : 'neutral'
  }
  if (section === 'raft-election') {
    const phase = row.electionPhase?.toLowerCase()
    if (phase === 'timeout' || phase === 'pre_vote' || phase === 'vote') {
      return 'attention'
    }
    return phase === 'elected' || phase === 'idle' ? 'healthy' : 'neutral'
  }
  if (section === 'region-request-retry') {
    if (booleanValue(row.clientVisibleError) === true) return 'critical'
    const status = row.requestStatus?.toLowerCase()
    if (
      status === 'transport_error' ||
      status === 'backoff' ||
      status === 'retrying'
    ) {
      return 'attention'
    }
    return status === 'served' || status === 'completed' ? 'healthy' : 'neutral'
  }
  if (section === 'transactions') {
    if (booleanValue(row.conflict) === true) return 'attention'
    const phase = row.phase?.toLowerCase()
    if (phase === 'victim') return 'critical'
    if (phase === 'rolled_back') return 'attention'
    if (phase === 'waiting') return 'attention'
    return phase === 'committed' || phase === 'completed' ? 'healthy' : 'neutral'
  }
  if (section === 'lock-waits') {
    return 'attention'
  }
  if (section === 'deadlocks') {
    return row.resolution?.toLowerCase() === 'resolved' ? 'attention' : 'critical'
  }
  if (section === 'application-retry') {
    return row.status?.toLowerCase() === 'completed' ? 'healthy' : 'attention'
  }
  if (
    section === 'protocol-selection' ||
    section === 'protocol-client-path' ||
    section === 'protocol-region-state' ||
    section === 'gc-safe-point-stores' ||
    section === 'gc-coordinator-path' ||
    section === 'gc-resolve-locks' ||
    section === 'gc-delete-ranges' ||
    section === 'gc-store-compaction' ||
    section === 'gc-mvcc-chains'
  ) {
    // Detailed labs explain valid paths; intermediate states are not warnings.
    return 'neutral'
  }
  if (section === 'hot-regions') {
    const score = numberValue(row.hotScore) ?? 0
    return score > 0 ? 'attention' : 'healthy'
  }
  if (section === 'regions') {
    const health = row.health?.toLowerCase()
    if (health === 'unavailable') return 'critical'
    if (health === 'degraded') return 'attention'
    return health === 'healthy' ? 'healthy' : 'neutral'
  }
  if (section === 'gc') {
    if (hasValue(row.blockedBy)) return 'critical'
    return (numberValue(row.backlog) ?? 0) > 0 ? 'attention' : 'healthy'
  }
  const available = booleanValue(row.available)
  if (available === false) return 'attention'
  return (numberValue(row.lagSeconds) ?? 0) > 0 ? 'attention' : available === true ? 'healthy' : 'neutral'
}

function projectionTone(projection: DiagnosticProjection): SummaryTone {
  let tone: SummaryTone = 'neutral'
  for (const row of projection.rows) tone = strongerTone(tone, rowTone(projection.id, row))
  return tone
}

function detailPair(first: string, second: string): string {
  return `${first} · ${second}`
}

function chartDatum(value: number, tone: SummaryTone): ChartDatum {
  return { value: Math.max(0, Number.isFinite(value) ? value : 0), tone }
}

function createDiagnosticSummary(
  locale: Locale,
  projections: readonly DiagnosticProjection[],
): DiagnosticSummary {
  const copy = DIAGNOSE_COPY[locale]
  const byId = new Map(projections.map((projection) => [projection.id, projection]))
  const clusterRows = byId.get('cluster')?.rows ?? []
  const regionRows = byId.get('regions')?.rows ?? []
  const hotRows = byId.get('hot-regions')?.rows ?? []
  const transactionRows = byId.get('transactions')?.rows ?? []
  const lockWaitRows = byId.get('lock-waits')?.rows ?? []
  const deadlockRows = byId.get('deadlocks')?.rows ?? []
  const applicationRetryRows = byId.get('application-retry')?.rows ?? []
  const gcRow = byId.get('gc')?.rows[0]
  const tiflashRow = byId.get('tiflash')?.rows[0]

  const nodeTones = clusterRows.map((row) => rowTone('cluster', row))
  const nodesUp = clusterRows.filter((row) => row.status?.toLowerCase() === 'up').length
  const nodesAttention = nodeTones.filter((tone) => tone === 'attention' || tone === 'critical').length
  const nodeTone = nodeTones.reduce(strongerTone, 'neutral' as SummaryTone)

  const regionTones = regionRows.map((row) => rowTone('regions', row))
  const regionsHealthy = regionRows.filter((row) => row.health?.toLowerCase() === 'healthy').length
  const regionsAttention = regionTones.filter((tone) => tone === 'attention' || tone === 'critical').length
  const regionTone = regionTones.reduce(strongerTone, 'neutral' as SummaryTone)

  const hotScores = hotRows.map((row) => numberValue(row.hotScore) ?? 0)
  const peakHotScore = hotScores.length > 0 ? Math.max(...hotScores) : 0
  const hotTone: SummaryTone = hotRows.length > 0 ? 'attention' : 'healthy'

  const activePhases = new Set([
    'active',
    'waiting',
    'prewriting',
    'committing',
    'commit_handoff',
  ])
  const activeTransactions = transactionRows.filter((row) =>
    activePhases.has(row.phase?.toLowerCase() ?? '')).length
  const isLockLab = lockWaitRows.length > 0 ||
    deadlockRows.length > 0 ||
    applicationRetryRows.length > 0 ||
    transactionRows.some((row) => row.client !== undefined && row.attempt !== undefined)
  const currentLockConflictIds = new Set(
    lockWaitRows
      .map((row) => row.waiter)
      .filter((id): id is string => hasValue(id)),
  )
  for (const row of transactionRows) {
    if (row.phase?.toLowerCase() === 'victim' && hasValue(row.id)) {
      currentLockConflictIds.add(row.id)
    }
  }
  const conflicts = isLockLab
    ? currentLockConflictIds.size
    : transactionRows.filter((row) => booleanValue(row.conflict) === true).length
  const transactionRowsTone = transactionRows
    .map((row) => rowTone('transactions', row))
    .reduce(strongerTone, 'healthy' as SummaryTone)
  const lockDiagnosticTone = [
    ...lockWaitRows.map((row) => rowTone('lock-waits', row)),
    ...deadlockRows.map((row) => rowTone('deadlocks', row)),
    ...applicationRetryRows.map((row) => rowTone('application-retry', row)),
  ].reduce(strongerTone, 'neutral' as SummaryTone)
  const transactionTone = strongerTone(transactionRowsTone, lockDiagnosticTone)

  const backlog = numberValue(gcRow?.backlog) ?? 0
  const gcBlocked = hasValue(gcRow?.blockedBy)
  const gcTone: SummaryTone = gcBlocked ? 'critical' : backlog > 0 ? 'attention' : 'healthy'
  const gcNumbers = [
    numberValue(gcRow?.obsoleteVersions) ?? 0,
    backlog,
    numberValue(gcRow?.collectedVersions) ?? 0,
  ]

  const tiflashAvailable = booleanValue(tiflashRow?.available)
  const tiflashLag = numberValue(tiflashRow?.lagSeconds) ?? 0
  const explicitProgress = numberValue(tiflashRow?.progress)
  const resolvedTs = numberValue(tiflashRow?.resolvedTs)
  const targetTs = numberValue(tiflashRow?.targetTs)
  const progress = explicitProgress !== undefined
    ? Math.max(0, Math.min(1, explicitProgress > 1 ? explicitProgress / 100 : explicitProgress))
    : resolvedTs !== undefined && targetTs !== undefined && targetTs > 0
      ? Math.max(0, Math.min(1, resolvedTs / targetTs))
      : tiflashAvailable === true
        ? 1
        : 0
  const tiflashTone: SummaryTone = tiflashAvailable === false || tiflashLag > 0
    ? 'attention'
    : tiflashAvailable === true
      ? 'healthy'
      : 'neutral'

  const metrics: SummaryMetric[] = [
    {
      id: 'cluster',
      label: copy.metrics.nodes,
      value: clusterRows.length > 0 ? `${nodesUp}/${clusterRows.length}` : '—',
      detail: detailPair(`${nodesUp} ${copy.detail.up}`, `${nodesAttention} ${copy.detail.attention}`),
      tone: nodeTone,
      chart: nodeTones.map((tone) => chartDatum(1, tone)),
      chartLabel: copy.charts.nodes,
    },
    {
      id: 'regions',
      label: copy.metrics.regions,
      value: regionRows.length > 0 ? `${regionsHealthy}/${regionRows.length}` : '—',
      detail: detailPair(`${regionsHealthy} ${copy.detail.healthy}`, `${regionsAttention} ${copy.detail.attention}`),
      tone: regionTone,
      chart: regionTones.map((tone) => chartDatum(1, tone)),
      chartLabel: copy.charts.regions,
    },
    {
      id: 'hot-regions',
      label: copy.metrics.hotRegions,
      value: String(hotRows.length),
      detail: `${copy.detail.peak} ${peakHotScore}`,
      tone: hotTone,
      chart: hotScores.map((score) => chartDatum(score, 'attention')),
      chartLabel: copy.charts.hotRegions,
    },
    {
      id: 'transactions',
      label: copy.metrics.transactions,
      value: String(transactionRows.length),
      detail: detailPair(
        `${activeTransactions} ${copy.detail.active}`,
        `${conflicts} ${isLockLab ? copy.detail.lockWaits : copy.detail.conflicts}`,
      ),
      tone: transactionTone,
      chart: transactionRows.map((row) => chartDatum(
        currentLockConflictIds.has(row.id) || booleanValue(row.conflict) === true
          ? 1
          : activePhases.has(row.phase?.toLowerCase() ?? '')
            ? 0.72
            : 0.36,
        rowTone('transactions', row),
      )),
      chartLabel: copy.charts.transactions,
    },
    {
      id: 'gc',
      label: copy.metrics.gcBacklog,
      value: gcRow ? String(backlog) : '—',
      detail: gcBlocked
        ? copy.detail.blocked
        : `${copy.detail.safePoint} ${gcRow?.safePoint ?? '—'}`,
      tone: gcTone,
      chart: gcNumbers.map((count) => chartDatum(count, count > 0 ? gcTone : 'neutral')),
      chartLabel: copy.charts.gc,
    },
    {
      id: 'tiflash',
      label: copy.metrics.tiflash,
      value: tiflashRow
        ? tiflashAvailable === true
          ? copy.detail.available
          : copy.detail.waiting
        : '—',
      detail: `${tiflashLag} ${copy.detail.lag}`,
      tone: tiflashTone,
      chart: [chartDatum(progress, tiflashTone)],
      chartLabel: copy.charts.tiflash,
      meter: true,
    },
  ]

  let tone: SummaryTone = 'healthy'
  for (const metric of metrics) tone = strongerTone(tone, metric.tone)
  for (const projection of projections) {
    tone = strongerTone(tone, projectionTone(projection))
  }
  return {
    tone: tone === 'critical' ? 'critical' : tone === 'attention' ? 'attention' : 'healthy',
    metrics,
  }
}

function miniChart(metric: SummaryMetric): SVGSVGElement {
  const svg = svgElement('svg', {
    class: 'tidb-diagnose__spark',
    viewBox: '0 0 144 36',
    role: 'img',
    'aria-label': metric.chartLabel,
    focusable: 'false',
    preserveAspectRatio: 'none',
  })
  const baseline = svgElement('line', {
    class: 'tidb-diagnose__spark-baseline',
    x1: '0',
    y1: '35',
    x2: '144',
    y2: '35',
  })
  svg.append(baseline)

  if (metric.meter) {
    const track = svgElement('rect', {
      class: 'tidb-diagnose__spark-track',
      x: '0',
      y: '14',
      width: '144',
      height: '8',
      rx: '4',
    })
    const ratio = Math.max(0, Math.min(1, metric.chart[0]?.value ?? 0))
    const fill = svgElement('rect', {
      class: `tidb-diagnose__spark-fill tidb-diagnose__spark-fill--${metric.chart[0]?.tone ?? 'neutral'}`,
      x: '0',
      y: '14',
      width: String(144 * ratio),
      height: '8',
      rx: '4',
    })
    svg.append(track, fill)
    return svg
  }

  const data = metric.chart.slice(0, 36)
  if (data.length === 0) {
    const empty = svgElement('line', {
      class: 'tidb-diagnose__spark-empty',
      x1: '4',
      y1: '18',
      x2: '140',
      y2: '18',
    })
    svg.append(empty)
    return svg
  }

  const max = Math.max(1, ...data.map((datum) => datum.value))
  const gap = data.length > 24 ? 1 : 2
  const width = (144 - gap * Math.max(0, data.length - 1)) / data.length
  for (let index = 0; index < data.length; index++) {
    const datum = data[index]
    const height = Math.max(3, Math.min(30, datum.value / max * 30))
    const bar = svgElement('rect', {
      class: `tidb-diagnose__spark-bar tidb-diagnose__spark-bar--${datum.tone}`,
      x: String(index * (width + gap)),
      y: String(34 - height),
      width: String(Math.max(1, width)),
      height: String(height),
      rx: String(Math.min(2, width / 2)),
    })
    svg.append(bar)
  }
  return svg
}

function summaryCard(locale: Locale, metric: SummaryMetric): HTMLElement {
  const copy = DIAGNOSE_COPY[locale]
  const state = metric.tone === 'neutral' ? null : copy.summaryStatus[metric.tone]
  return element('article', {
    className: 'tidb-diagnose__metric',
    attrs: {
      'data-summary-metric': metric.id,
      'data-tone': metric.tone,
    },
  },
    element('div', { className: 'tidb-diagnose__metric-head' },
      element('p', { className: 'tidb-diagnose__metric-label', text: metric.label }),
      state
        ? element('span', { className: 'tidb-diagnose__metric-state', text: state })
        : null,
    ),
    element('strong', { className: 'tidb-diagnose__metric-value', text: metric.value }),
    element('p', { className: 'tidb-diagnose__metric-detail', text: metric.detail }),
    miniChart(metric),
  )
}

function summarySection(
  locale: Locale,
  projections: readonly DiagnosticProjection[],
): HTMLElement {
  const copy = DIAGNOSE_COPY[locale]
  const summary = createDiagnosticSummary(locale, projections)
  const metrics = element('div', {
    className: 'tidb-diagnose__metrics',
    attrs: { role: 'list' },
  })
  for (const metric of summary.metrics) {
    const card = summaryCard(locale, metric)
    card.setAttribute('role', 'listitem')
    metrics.append(card)
  }
  return element('section', {
    className: 'tidb-diagnose__summary',
    attrs: {
      'data-tone': summary.tone,
      'aria-labelledby': 'tidb-diagnose-summary-title',
    },
  },
    element('div', { className: 'tidb-diagnose__summary-head' },
      element('h2', {
        attrs: { id: 'tidb-diagnose-summary-title' },
        text: copy.summaryTitle,
      }),
      element('div', { className: 'tidb-diagnose__summary-state' },
        element('span', {
          className: 'tidb-diagnose__summary-status',
          text: copy.summaryStatus[summary.tone],
        }),
        createModelBadge(locale),
      ),
    ),
    metrics,
  )
}

export interface DiagnoseOptions {
  snapshot: TiCityState | unknown
  locale?: Locale
  search?: string
  project?: (snapshot: unknown) => readonly DiagnosticProjection[]
}

function cellTone(
  row: DiagnosticRow,
  column: string,
): SummaryTone {
  const raw = row[column]
  if (column === 'status') {
    const status = raw?.toLowerCase()
    if (status === 'down') return 'critical'
    if (status === 'degraded') return 'attention'
    if (status === 'backoff' || status === 'started') return 'attention'
    return status === 'up' || status === 'completed' ? 'healthy' : 'neutral'
  }
  if (column === 'phase') {
    const phase = raw?.toLowerCase()
    if (phase === 'victim') return 'critical'
    if (phase === 'rolled_back') return 'attention'
    if (phase === 'waiting') return 'attention'
    return phase === 'completed' || phase === 'committed' ? 'healthy' : 'neutral'
  }
  if (column === 'health') {
    const health = raw?.toLowerCase()
    if (health === 'unavailable') return 'critical'
    if (health === 'degraded') return 'attention'
    return health === 'healthy' ? 'healthy' : 'neutral'
  }
  if (column === 'available') {
    const available = booleanValue(raw)
    return available === true ? 'healthy' : available === false ? 'attention' : 'neutral'
  }
  if (column === 'conflict') {
    const conflict = booleanValue(raw)
    return conflict === true ? 'attention' : conflict === false ? 'healthy' : 'neutral'
  }
  if (column === 'hotScore') {
    const score = numberValue(raw) ?? 0
    return score > 0 ? 'attention' : 'neutral'
  }
  if (column === 'backlog' || column === 'lagSeconds' || column === 'pendingVersions') {
    return (numberValue(raw) ?? 0) > 0 ? 'attention' : 'neutral'
  }
  if (column === 'blockedBy') return hasValue(raw) ? 'critical' : 'neutral'
  if (column === 'resolution') {
    return raw?.toLowerCase() === 'resolved' ? 'attention' : 'critical'
  }
  if (column === 'internalRetryable') {
    return booleanValue(raw) === false ? 'attention' : 'neutral'
  }
  if (column === 'clientError') {
    return raw === 'not_returned_yet' || !hasValue(raw) ? 'neutral' : 'critical'
  }
  if (column === 'victim') {
    return hasValue(raw) ? 'critical' : 'neutral'
  }
  return 'neutral'
}

function meterPercent(column: string, raw: string): number | undefined {
  const numeric = numberValue(raw)
  if (numeric === undefined) return undefined
  if (column === 'hotScore') return Math.max(0, Math.min(100, numeric))
  if (column === 'progress') {
    const normalized = numeric > 1 ? numeric : numeric * 100
    return Math.max(0, Math.min(100, normalized))
  }
  return undefined
}

function projectionCell(
  locale: Locale,
  row: DiagnosticRow,
  column: string,
): HTMLTableCellElement {
  const raw = row[column] ?? '—'
  const display = localizedCellValue(locale, column, raw)
  const tone = cellTone(row, column)
  const td = element('td', {
    attrs: {
      'data-column': column,
      'data-tone': tone,
    },
  })
  const percent = meterPercent(column, raw)
  if (percent !== undefined) {
    const fill = element('span', {
      className: 'tidb-diagnose__cell-meter-fill',
      attrs: {
        'aria-hidden': 'true',
        style: `--meter:${percent}%`,
      },
    })
    td.append(
      element('span', { className: 'tidb-diagnose__cell-meter' },
        element('span', { className: 'tidb-diagnose__cell-value', text: display }),
        element('span', {
          className: 'tidb-diagnose__cell-meter-track',
          attrs: { 'aria-hidden': 'true' },
        }, fill),
      ),
    )
    return td
  }

  const stateColumn = column === 'status'
    || column === 'phase'
    || column === 'health'
    || column === 'available'
    || column === 'conflict'
    || column === 'resolution'
    || column === 'internalRetryable'
    || column === 'clientError'
  if (stateColumn && raw !== '—') {
    td.append(
      element('span', {
        className: 'tidb-diagnose__state',
        attrs: { 'data-tone': tone },
      },
        element('span', {
          className: 'tidb-diagnose__state-dot',
          attrs: { 'aria-hidden': 'true' },
        }),
        element('span', { text: display }),
      ),
    )
    return td
  }

  td.textContent = display
  return td
}

function projectionTable(
  locale: Locale,
  projection: DiagnosticProjection,
): HTMLElement {
  const copy = DIAGNOSE_COPY[locale]
  const title = SECTION_TITLES[locale][projection.id]
  const titleId = `tidb-diagnose-${projection.id}-title`
  const tone = projectionTone(projection)
  const panel = element('section', {
    className: 'tidb-diagnose__panel',
    attrs: {
      'data-diagnose-section': projection.id,
      'data-tone': tone,
      'aria-labelledby': titleId,
      ...(projection.rows.length > 0 &&
      (
        GC_DETAIL_SECTIONS.has(projection.id) ||
        TIFLASH_MPP_DETAIL_SECTIONS.has(projection.id)
      )
        ? { 'data-privacy-boundary': 'synthetic-aggregate-only' }
        : {}),
    },
  })
  panel.append(
    element('div', { className: 'tidb-diagnose__panel-head' },
      element('div', { className: 'tidb-diagnose__panel-title' },
        element('h2', {
          attrs: { id: titleId },
          text: title,
        }),
        element('span', {
          className: 'tidb-diagnose__row-count',
          text: `${projection.rows.length} ${projection.rows.length === 1 ? copy.row : copy.rows}`,
        }),
      ),
      createModelBadge(locale),
    ),
  )
  if (projection.rows.length === 0) {
    panel.append(
      element('div', { className: 'tidb-diagnose__empty' },
        element('span', {
          className: 'tidb-diagnose__empty-mark',
          attrs: { 'aria-hidden': 'true' },
          text: '∅',
        }),
        element('p', { text: CATALOG[locale].noRows }),
      ),
    )
    return panel
  }

  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of projection.rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  const head = element('tr')
  for (const column of columns) {
    head.append(element('th', {
      text: localizedColumnTitle(locale, column),
      attrs: { scope: 'col' },
    }))
  }
  const body = element('tbody')
  for (const row of projection.rows) {
    const tone = rowTone(projection.id, row)
    const line = element('tr', { attrs: { 'data-tone': tone } })
    for (const column of columns) line.append(projectionCell(locale, row, column))
    body.append(line)
  }
  panel.append(element('div', {
    className: 'tidb-diagnose__scroll',
    attrs: {
      tabindex: '0',
      role: 'region',
      'aria-label': `${title} ${copy.table}`,
    },
  },
    element('table', {
      className: 'tidb-diagnose__table',
      attrs: { 'data-table-section': projection.id },
    },
      element('caption', {
        className: 'visually-hidden',
        text: `${title} — ${projection.label}`,
      }),
      element('thead', {}, head),
      body,
    ),
  ))
  return panel
}

export function mountDiagnose(root: HTMLElement, options: DiagnoseOptions): void {
  const locale = options.locale ?? resolveLocale(options.search)
  const copy = DIAGNOSE_COPY[locale]
  const projections = options.project
    ? options.project(options.snapshot)
    : projectDiagnostics(options.snapshot)
  const hasRaftDetail = projections.some((projection) =>
    (
      projection.id === 'raft-peers' ||
      projection.id === 'raft-election' ||
      projection.id === 'region-request-retry'
    ) &&
    projection.rows.length > 0
  )
  const hasProtocolDetail = projections.some((projection) =>
    (
      projection.id === 'protocol-selection' ||
      projection.id === 'protocol-client-path' ||
      projection.id === 'protocol-region-state'
    ) &&
    projection.rows.length > 0
  )
  const hasGcDetail = projections.some((projection) =>
    GC_DETAIL_SECTIONS.has(projection.id) && projection.rows.length > 0
  )
  const hasTiFlashMppDetail = projections.some((projection) =>
    TIFLASH_MPP_DETAIL_SECTIONS.has(projection.id) &&
    projection.rows.length > 0
  )
  installCityUiStyles(root.ownerDocument ?? document)
  installDiagnoseStyles(root.ownerDocument ?? document)

  const grid = element('div', { className: 'tidb-diagnose__grid' })
  for (const projection of projections) grid.append(projectionTable(locale, projection))

  const guideGrid = element('div', { className: 'tidb-diagnose__guide-grid' })
  for (const [index, guide] of SYMPTOM_GUIDES.entries()) {
    const copy = guide[locale]
    const sql = element('details', { className: 'tidb-diagnose__guide-sql' },
      element('summary', { text: DIAGNOSE_COPY[locale].sqlCheck }),
      element('pre', {
        attrs: {
          tabindex: '0',
          role: 'region',
          'aria-label': `${copy.symptom} SQL`,
        },
      }, element('code', { text: guide.sql })),
    )
    guideGrid.append(
      element('article', {
        className: 'tidb-diagnose__guide',
        attrs: {
          'data-guide': guide.id,
          role: 'listitem',
        },
      },
        element('div', { className: 'tidb-diagnose__guide-head' },
          element('span', {
            className: 'tidb-diagnose__guide-index',
            attrs: { 'aria-hidden': 'true' },
            text: String(index + 1).padStart(2, '0'),
          }),
          element('h3', { text: copy.symptom }),
        ),
        element('p', { className: 'tidb-diagnose__guide-copy', text: copy.guidance }),
        element('p', {
          className: 'tidb-diagnose__real-check',
          text: CATALOG[locale].realClusterCheck,
        }),
        sql,
      ),
    )
  }
  guideGrid.setAttribute('role', 'list')

  root.classList.add('tidb-surface', 'tidb-diagnose')
  root.setAttribute('lang', locale)
  root.dataset.activeLab = hasTiFlashMppDetail
    ? 'tiflash-mpp'
    : hasGcDetail
      ? 'gc-storage'
      : hasProtocolDetail
        ? 'protocol'
        : hasRaftDetail
          ? 'raft'
          : 'none'
  root.replaceChildren(
    element('header', { className: 'tidb-diagnose__head' },
      element('div', { className: 'tidb-diagnose__head-copy' },
        element('p', { className: 'tidb-diagnose__eyebrow', text: copy.eyebrow }),
        element('h1', { text: CATALOG[locale].diagnoseTitle }),
        element('p', { text: CATALOG[locale].diagnoseSubtitle }),
      ),
      element('div', { className: 'tidb-diagnose__head-meta' },
        element('span', {
          className: 'tidb-diagnose__head-pulse',
          attrs: { 'aria-hidden': 'true' },
        }),
        createModelBadge(locale),
      ),
    ),
    summarySection(locale, projections),
    grid,
    element('section', { className: 'tidb-diagnose__guides' },
      element('div', { className: 'tidb-diagnose__guides-head' },
        element('h2', { text: CATALOG[locale].symptomGuides }),
        element('span', {
          className: 'tidb-diagnose__guide-count',
          text: String(SYMPTOM_GUIDES.length).padStart(2, '0'),
        }),
      ),
      guideGrid,
    ),
  )
}
