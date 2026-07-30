/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * TiCity model contracts. The model owns these values; presentation layers
 * receive them as projections and must not invent alternate simulation state.
 */

export const TIDB_MODEL_VERSION = 'tidb-v8.5-model-6'

export type NodeStatus = 'up' | 'down' | 'degraded'
export type NodeKind = 'tiproxy' | 'tidb' | 'pd' | 'tikv' | 'tiflash'
export type StoreId = 'tikv-1' | 'tikv-2' | 'tikv-3'
export type CommitProtocol = 'auto' | '1pc' | 'async_commit' | '2pc'
export type ResolvedCommitProtocol = Exclude<CommitProtocol, 'auto'>
export type TraceOutcome = 'succeeded' | 'committed' | 'rolled_back' | 'failed'
export type TransactionMode = 'pessimistic' | 'optimistic'
export type KeyDistribution = 'uniform' | 'sequential'
export type ReadPolicy = 'leader' | 'follower'
export type PlaybackMode = 'step' | 'slow' | 'live'

export type ScenarioId =
  | 'point-read'
  | 'cross-region-transaction'
  | 'optimistic-conflict'
  | 'lock-deadlock'
  | 'commit-protocols'
  | 'hotspot-split'
  | 'tikv-failover'
  | 'gc-safe-point'
  | 'tiflash-mpp'

export interface ClusterNode {
  id: string
  kind: NodeKind
  label: string
  zone: 'zone-a' | 'zone-b' | 'zone-c'
  status: NodeStatus
  leader: boolean
}

export interface TiDBTopology {
  tiproxy: ClusterNode[]
  tidb: ClusterNode[]
  pd: ClusterNode[]
  tikv: ClusterNode[]
  tiflash: ClusterNode[]
}

export type PeerRaftRole = 'leader' | 'follower'

export interface RegionPeerState {
  storeId: StoreId
  role: 'voter'
  raftRole: PeerRaftRole
  matchIndex: number
  appliedIndex: number
  healthy: boolean
}

export interface RegionState {
  id: number
  /** Inclusive, synthetic key-space boundary. */
  startKey: number
  /** Exclusive, synthetic key-space boundary. */
  endKey: number
  peers: RegionPeerState[]
  leaderStoreId: StoreId
  term: number
  commitIndex: number
  appliedIndex: number
  sizeMiB: number
  hotScore: number
  epoch: number
  health: 'healthy' | 'degraded' | 'unavailable'
  tiflashReplica: boolean
}

export interface TiDBControls {
  qps: number
  writeRatio: number
  keyDistribution: KeyDistribution
  transactionMode: TransactionMode
  commitProtocol: CommitProtocol
  readPolicy: ReadPolicy
  regionSplitThresholdMiB: number
  gcLifetimeSeconds: number
  networkLatencyMs: number
  tiflashLagSeconds: number
  playbackSpeed: number
  paused: boolean
}

export interface TsoState {
  /** Logical TSO values in this educational model; never wall-clock time. */
  lastAllocated: number
  allocations: number
}

export type TransactionPhase =
  | 'active'
  | 'prewriting'
  | 'committing'
  | 'committed'
  | 'rolled_back'

export interface TransactionState {
  id: string
  mode: TransactionMode
  protocol: ResolvedCommitProtocol
  startTs: number
  commitTs: number | null
  regionIds: number[]
  primaryRegionId: number
  phase: TransactionPhase
  conflict: boolean
  /** Present for composite teaching scenarios with multiple client attempts. */
  clientId?: string
  /** One-based application attempt number. */
  attempt?: number
  /** The failed transaction replaced by this application retry. */
  retryOfTransactionId?: string
}

export interface GcState {
  safePoint: number
  blockedByStartTs: number | null
  obsoleteVersions: number
  collectedVersions: number
  backlog: number
}

export interface TiFlashState {
  available: boolean
  resolvedTs: number
  targetTs: number
  lagSeconds: number
  pendingVersions: number
  mppQueries: number
}

export interface TiDBMetrics {
  statements: number
  reads: number
  writes: number
  commits: number
  rollbacks: number
  conflicts: number
  raftEntries: number
  regionSplits: number
  leaderElections: number
  gcRuns: number
  lockWaits: number
  deadlocks: number
  retries: number
}

export type TraceDomain =
  | 'client'
  | 'sql'
  | 'tso'
  | 'txn2pc'
  | 'raft'
  | 'kv'
  | 'tiflash'
  | 'return'

export type TraceEventStatus = 'queued' | 'active' | 'success' | 'warning' | 'failed'
export type TraceMetadataValue = string | number | boolean
export type TracePath = 'critical' | 'background'

export type TraceTransactionStage =
  | 'request'
  | 'active'
  | 'locking'
  | 'prewriting'
  | 'prewritten'
  | 'committing_primary'
  | 'client_acknowledged'
  | 'committing_secondary'
  | 'complete'
  | 'rolled_back'

export interface TraceTransactionSnapshot {
  id: string
  mode: TransactionMode
  protocol: ResolvedCommitProtocol
  stage: TraceTransactionStage
  startTs: number
  commitTs: number | null
  regionIds: readonly number[]
  primaryRegionId: number
  clientResponded: boolean
}

export interface TracePessimisticLockSnapshot {
  transactionId: string
  leaderStoreId: StoreId
  /** Synthetic identifier only; never a real encoded TiKV key. */
  resourceId?: string
  /** TiDB v8.5's normal in-memory pessimistic-lock path is leader-local. */
  storage: 'leader_memory'
  replicated: false
}

export interface TraceMvccSnapshot {
  /** A tentative value is stored in default CF at prewrite and retained at commit. */
  defaultCf: 'empty' | 'value'
  /** The durable transactional lock created by prewrite, not the in-memory lock. */
  lockCf: 'empty' | 'prewrite'
  /** The commit record that makes the default-CF value visible. */
  writeCf: 'empty' | 'commit'
  startTs: number | null
  commitTs: number | null
  primary: boolean
}

export interface TraceRaftPeerSnapshot {
  storeId: StoreId
  raftRole: PeerRaftRole
  matchIndex: number
  appliedIndex: number
  healthy: boolean
}

export interface TraceRegionSnapshot {
  regionId: number
  leaderStoreId: StoreId
  term: number
  proposedIndex: number | null
  persistedStoreIds: readonly StoreId[]
  acknowledgements: number
  quorum: 2
  commitIndex: number
  appliedIndex: number
  peers: readonly TraceRaftPeerSnapshot[]
  pessimisticLock: TracePessimisticLockSnapshot | null
  mvcc: TraceMvccSnapshot
}

export type TraceRaftLabPhase =
  | 'healthy'
  | 'requesting'
  | 'leader_lost'
  | 'backoff'
  | 'timeout'
  | 'pre_vote'
  | 'vote'
  | 'elected'
  | 'confirming'
  | 'routing'
  | 'serving'
  | 'complete'

export type TraceRaftLabPeerRole =
  | 'leader'
  | 'follower'
  | 'pre_candidate'
  | 'candidate'
  | 'offline'

export interface TraceRaftLabPeerSnapshot {
  storeId: StoreId
  role: TraceRaftLabPeerRole
  healthy: boolean
  currentTerm: number
  votedFor: StoreId | null
  lastLogIndex: number
  lastLogTerm: number
  matchIndex: number
  commitIndex: number
  appliedIndex: number
}

export interface TraceRaftLabElectionSnapshot {
  phase: 'idle' | 'timeout' | 'pre_vote' | 'vote' | 'elected'
  candidateStoreId: StoreId | null
  preVotesGranted: readonly StoreId[]
  votesGranted: readonly StoreId[]
  prevoteEnabled: true
  configuredElectionTimeoutTicks: 10
  configuredMaxElectionTimeoutTicks: 20
  /** Deterministic teaching order, not a measured TiKV election duration. */
  elapsedTicks: 13
  candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy'
}

export interface TraceRaftLabLogSnapshot {
  /** TiKV's new-leader empty entry; never a user row mutation. */
  entryKind: 'leader_noop' | null
  index: number | null
  term: number | null
  persistedStoreIds: readonly StoreId[]
  committed: boolean
  appliedStoreIds: readonly StoreId[]
}

export interface TraceRaftLabRequestSnapshot {
  logicalRequestId: string
  source: 'tidb_internal'
  attempt: 0 | 1 | 2
  cachedLeaderStoreId: StoreId | null
  cacheState: 'cached' | 'invalidated' | 'refreshed'
  status:
    | 'idle'
    | 'sent'
    | 'transport_error'
    | 'backoff'
    | 'retrying'
    | 'served'
    | 'completed'
  /** Representative teaching value, not a TiDB retry guarantee. */
  backoffMs: number
  clientVisibleError: false
}

export interface TraceRaftLabPdSnapshot {
  /** PD observes and answers routing metadata; it never votes in Region Raft. */
  role: 'observer_and_routing_only'
  observedLeaderStoreId: StoreId | null
  routeLookupCompleted: boolean
}

/**
 * One representative Region's immutable failover projection. A TiKV process
 * failure affects peers in many Regions, but this detailed vertical slice
 * expands only Region 0.
 */
export interface TraceRaftLabSnapshot {
  regionId: number
  phase: TraceRaftLabPhase
  oldLeaderStoreId: StoreId
  leaderStoreId: StoreId | null
  failedStoreId: StoreId | null
  quorum: 2
  liveVoterCount: number
  peers: readonly TraceRaftLabPeerSnapshot[]
  election: TraceRaftLabElectionSnapshot
  log: TraceRaftLabLogSnapshot
  request: TraceRaftLabRequestSnapshot
  pd: TraceRaftLabPdSnapshot
}

export type TraceProtocolLaneId = 'one_pc' | 'async_commit' | 'two_pc'

export type TraceProtocolLaneStage =
  | 'idle'
  | 'requested'
  | 'started'
  | 'selected'
  | 'latest_ts'
  | 'prewriting'
  | 'prewritten'
  | 'commit_ts'
  | 'committing'
  | 'client_acknowledged'
  | 'background'
  | 'complete'

export type TraceProtocolRaftOperation =
  | 'one_pc_prewrite'
  | 'prewrite'
  | 'commit_primary'
  | 'commit_secondary'
  | 'commit_async'

export type TraceProtocolRaftStage =
  | 'idle'
  | 'proposed'
  | 'persisted_quorum'
  | 'committed'
  | 'applied'

export interface TraceProtocolRegionSnapshot {
  regionId: number
  role: 'primary' | 'secondary'
  leaderStoreId: StoreId
  voterStoreIds: readonly [StoreId, StoreId, StoreId]
  mutationCount: number
  raft: Readonly<{
    operation: TraceProtocolRaftOperation | null
    stage: TraceProtocolRaftStage
    index: number | null
    persistedStoreIds: readonly StoreId[]
    acknowledgements: number
    quorum: 2
  }>
  mvcc: Readonly<{
    defaultCf: 'empty' | 'value'
    lockCf: 'empty' | 'prewrite'
    writeCf: 'empty' | 'commit'
    /** Only Async Commit prewrite locks carry this modeled flag. */
    asyncCommit: boolean
    /**
     * Count metadata is shown only on the primary lock. The model never
     * retains or projects real secondary keys.
     */
    secondaryCount: number
  }>
  returnedMinCommitTs: number | null
}

export interface TraceProtocolEligibilitySnapshot {
  enable1Pc: true
  enableAsyncCommit: true
  consistency: 'linearizable'
  mutationCount: number
  totalKeyBytes: number
  regionCount: number
  onePcEligible: boolean
  asyncCommitEligible: boolean
  selected: ResolvedCommitProtocol
  selectionReason:
    | 'single_region_one_pc_model_case'
    | 'multi_region_async_commit_model_case'
    | 'async_key_count_limit_model_case'
  onePcRejectedBeforeRpc: boolean
  asyncRejectedAtClientPrecheck: boolean
  onePcDecisionPoint: 'region_batching' | 'tikv_prewrite'
  asyncDecisionPoint: 'client_precheck' | 'tikv_prewrite'
  runtimeFallback: false
  tryOnePcSent: boolean
  asyncKeyCountLimit: 256
  asyncTotalKeyBytesLimit: 4096
}

export interface TraceProtocolLaneSnapshot {
  id: TraceProtocolLaneId
  protocol: ResolvedCommitProtocol
  requestId: string
  transactionId: string
  stage: TraceProtocolLaneStage
  eligibility: TraceProtocolEligibilitySnapshot
  startTs: number | null
  latestTs: number | null
  requestMinCommitTs: number | null
  maxCommitTs: number | null
  commitTs: number | null
  commitTsSource:
    | 'tikv_one_pc_result'
    | 'max_prewrite_min_commit_ts'
    | 'pd_tso_after_prewrite'
    | null
  clientResponded: boolean
  backgroundComplete: boolean
  regions: readonly TraceProtocolRegionSnapshot[]
}

/**
 * Model-5 comparison state for three independent optimistic transactions.
 * Transaction coordination and each Region's Raft quorum remain distinct.
 */
export interface TraceProtocolLabSnapshot {
  phase: 'idle' | 'running' | 'complete'
  focusLaneId: TraceProtocolLaneId | null
  consistency: 'linearizable'
  transactionMode: 'optimistic'
  transactionScope: 'global'
  representation: 'aggregate_counts_only'
  safeWindowMs: 2000
  coordinatorLayer: 'tidb_transaction_commit'
  raftLayer: 'per_region_consensus'
  tikvAsyncApplyPrewrite: false
  clientBoundary: 'response_before_cleanup_completion'
  backgroundScheduling: 'deterministic_after_client_boundary_model_policy'
  maxCommitTsPolicy: 'representative_safe_window_model_bound'
  lanes: readonly [
    TraceProtocolLaneSnapshot,
    TraceProtocolLaneSnapshot,
    TraceProtocolLaneSnapshot,
  ]
}

export type TraceGcLabRound = 1 | 2

export type TraceGcLabPhase =
  | 'idle'
  | 'preparing'
  | 'safe_point_bounded'
  | 'resolving_locks'
  | 'caching_safe_point'
  | 'deleting_ranges'
  | 'publishing_safe_point'
  | 'tikv_observing'
  | 'compacting'
  | 'between_rounds'
  | 'complete'

export type TraceGcVersionWriteType =
  | 'put'
  | 'delete'
  | 'rollback'
  | 'lock'

export type TraceGcVersionState =
  | 'present'
  | 'retained_anchor'
  | 'filtered'

export interface TraceGcVersionSnapshot {
  /** Synthetic version label only; never a real or encoded TiKV key. */
  id: string
  commitTs: number
  writeType: TraceGcVersionWriteType
  valueStorage: 'write_cf_only' | 'write_cf_inline' | 'write_and_default_cf'
  state: TraceGcVersionState
}

export interface TraceGcKeyChainSnapshot {
  /** Synthetic chain label only; the model retains no key bytes or values. */
  id: string
  regionId: number
  versions: readonly TraceGcVersionSnapshot[]
}

export interface TraceGcLockSnapshot {
  id: string
  regionId: number
  startTs: number
  primaryStatus: 'committed' | 'rolled_back'
  status: 'pending' | 'resolved_commit' | 'resolved_rollback'
}

export interface TraceGcDeleteRangeSnapshot {
  id: string
  dropTs: number
  status: 'pending' | 'eligible' | 'deleted'
}

export interface TraceGcStoreSnapshot {
  storeId: StoreId
  detectedSafePoint: number
  compaction:
    | 'idle'
    | 'eligible'
    | 'running'
    | 'complete'
  /**
   * Activity is per store, while the version-board counts below are one
   * logical projection and are deliberately not multiplied by replicas.
   */
  filterActive: boolean
}

/**
 * Model-6 GC/Storage Lab. It pins the TiDB v8.5.0 default Compaction Filter
 * path and projects synthetic aggregate MVCC chains, never real keys/values.
 */
export interface TraceGcLabSnapshot {
  phase: TraceGcLabPhase
  round: TraceGcLabRound
  configuration: Readonly<{
    gcEnabled: true
    runIntervalSeconds: 600
    lifeTimeSeconds: 600
    maxWaitTimeSeconds: 86400
    minStartTsReportIntervalSeconds: 30
    scanLockImplementation: 'REGION_SCAN_LOCK'
    scanLockModeVariableUsed: false
    physicalScanLockAvailable: false
    distributedGc: true
    compactionFilterEnabled: true
    compactionFilterRatioThreshold: 1.1
    raftstoreMode: 'v1_classic'
  }>
  safePoint: Readonly<{
    previous: number
    candidate: number | null
    globalMinStartTs: number | null
    activeTransactionBound: number | null
    serviceSafePoint: number | null
    staged: number
    visibilitySaved: number
    published: number
    blocked: boolean
  }>
  blocker: Readonly<{
    transactionId: string
    startTs: number
    status: 'active' | 'completed'
    reportedByTiDB: true
    withinMaxWaitTime: true
  }>
  resolveLocks: Readonly<{
    implementation: 'REGION_SCAN_LOCK'
    scannedRegionIds: readonly number[]
    locks: readonly TraceGcLockSnapshot[]
  }>
  deleteRanges: readonly TraceGcDeleteRangeSnapshot[]
  stores: readonly TraceGcStoreSnapshot[]
  keyChains: readonly TraceGcKeyChainSnapshot[]
  storage: Readonly<{
    representation: 'logical_chains_counted_once'
    compactionLevel: 'bottommost_model_fixture'
    initialVersionCount: number
    filteredVersionCount: number
    retainedAnchorCount: number
    presentVersionCount: number
    deletedDefaultCfValues: number
    compactionRaftEntriesCreated: 0
  }>
}

export type TraceLockTransactionStatus =
  | 'active'
  | 'waiting'
  | 'victim'
  | 'rolled_back'
  | 'commit_handoff'
  | 'completed'

export interface TraceLockTransactionSnapshot {
  clientId: string
  transactionId: string
  attempt: number
  retryOfTransactionId: string | null
  startTs: number
  commitTs: number | null
  status: TraceLockTransactionStatus
  heldResourceIds: readonly string[]
  waitingForResourceId: string | null
}

export interface TraceLockResourceSnapshot {
  /** Synthetic resource label such as resource-a; never an encoded row key. */
  id: string
  regionId: number
  leaderStoreId: StoreId
  holderTransactionId: string | null
  waiterTransactionIds: readonly string[]
  /** Deterministic TiCity teaching policy, not a TiDB fairness guarantee. */
  wakePolicy: 'smallest_start_ts_model_policy'
  storage: 'leader_memory'
}

export interface TraceWaitForEdgeSnapshot {
  id: string
  /** DATA_LOCK_WAITS direction: blocked waiter to current lock holder. */
  waiterTransactionId: string
  holderTransactionId: string
  resourceId: string
  regionId: number
}

export interface TraceDeadlockSnapshot {
  id: string
  /** Ordered cycle with the first transaction repeated at the end. */
  cycleTransactionIds: readonly string[]
  victimTransactionId: string | null
  /**
   * A deterministic TiCity policy, not a TiDB victim-selection guarantee.
   * The request that closes the cycle is selected for this teaching trace.
   */
  selectionPolicy: 'cycle_closing_waiter_model_policy'
  retryable: false
  resolution: 'detected' | 'rolling_back' | 'resolved'
  /** Set only after Error 1213 has actually crossed the client boundary. */
  clientErrorCode: 1213 | null
  clientErrorTransactionId: string | null
}

export interface TraceApplicationRetrySnapshot {
  source: 'application'
  clientId: string
  retryOfTransactionId: string
  fixedBackoffMs: number
  status: 'backoff' | 'started' | 'completed'
  newTransactionId: string | null
}

export interface TraceLockLabSnapshot {
  detectorScope: 'cluster_wide'
  detectorLeaderStoreId: StoreId
  transactions: readonly TraceLockTransactionSnapshot[]
  resources: readonly TraceLockResourceSnapshot[]
  waitForEdges: readonly TraceWaitForEdgeSnapshot[]
  deadlock: TraceDeadlockSnapshot | null
  applicationRetry: TraceApplicationRetrySnapshot | null
}

/**
 * A renderer-safe projection immediately after one detailed model event.
 * It contains only synthetic teaching state and never SQL text or row values.
 */
export interface TraceStateSnapshot {
  modelVersion: string
  tsoLastAllocated: number
  transaction: TraceTransactionSnapshot | null
  regions: readonly TraceRegionSnapshot[]
  /** Present only for the composite model-3 Lock Lab scenario. */
  lockLab?: TraceLockLabSnapshot
  /** Present only for the model-4 Region Raft failure vertical slice. */
  raftLab?: TraceRaftLabSnapshot
  /** Present only for the model-5 commit-protocol comparison. */
  protocolLab?: TraceProtocolLabSnapshot
  /** Present only for the model-6 GC/Storage vertical slice. */
  gcLab?: TraceGcLabSnapshot
}

export type TraceStateDelta =
  | Readonly<{
    kind: 'tso_allocate'
    purpose: 'start_ts' | 'commit_ts'
    timestamp: number
  }>
  | Readonly<{
    kind: 'transaction_stage'
    from: TraceTransactionStage
    to: TraceTransactionStage
  }>
  | Readonly<{
    kind: 'pessimistic_lock'
    action: 'acquire' | 'release'
    regionId: number
    leaderStoreId: StoreId
    storage: 'leader_memory'
  }>
  | Readonly<{
    kind: 'raft_propose'
    regionId: number
    index: number
    operation:
      | 'prewrite'
      | 'commit_primary'
      | 'commit_secondary'
      | 'leader_noop'
    term?: number
  }>
  | Readonly<{
    kind: 'raft_persist'
    regionId: number
    index: number
    storeIds: readonly StoreId[]
    term?: number
  }>
  | Readonly<{
    kind: 'raft_commit'
    regionId: number
    index: number
    acknowledgements: number
    quorum: 2
    term?: number
  }>
  | Readonly<{
    kind: 'raft_apply'
    regionId: number
    index: number
    term?: number
    storeIds?: readonly StoreId[]
  }>
  | Readonly<{
    kind: 'raft_peer_health'
    regionId: number
    storeId: StoreId
    from: 'up'
    to: 'down'
  }>
  | Readonly<{
    kind: 'raft_election_timeout'
    regionId: number
    candidateStoreId: StoreId
    configuredElectionTimeoutTicks: 10
    configuredMaxElectionTimeoutTicks: 20
    elapsedTicks: 13
    candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy'
  }>
  | Readonly<{
    kind: 'raft_pre_vote'
    action: 'start' | 'grant'
    regionId: number
    candidateStoreId: StoreId
    voterStoreId: StoreId
    prospectiveTerm: number
  }>
  | Readonly<{
    kind: 'raft_term_vote'
    action: 'become_candidate' | 'grant'
    regionId: number
    candidateStoreId: StoreId
    voterStoreId: StoreId
    term: number
  }>
  | Readonly<{
    kind: 'raft_leader_elected'
    regionId: number
    oldLeaderStoreId: StoreId
    newLeaderStoreId: StoreId
    term: number
    votesGranted: readonly StoreId[]
    quorum: 2
  }>
  | Readonly<{
    kind: 'raft_region_request'
    action:
      | 'send'
      | 'transport_error'
      | 'backoff'
      | 'refresh'
      | 'retry'
      | 'serve'
      | 'complete'
    regionId: number
    logicalRequestId: string
    attempt: 1 | 2
    targetStoreId: StoreId | null
    backoffMs: number
    source: 'tidb_internal'
    clientVisibleError: false
  }>
  | Readonly<{
    kind: 'raft_pd_state'
    action: 'observe_leader' | 'route_lookup'
    regionId: number
    leaderStoreId: StoreId
    role: 'observer_and_routing_only'
  }>
  | Readonly<{
    kind: 'mvcc'
    regionId: number
    cf: 'default' | 'lock' | 'write'
    action: 'put' | 'delete'
    timestamp: number
  }>
  | Readonly<{
    kind: 'client_response'
    committed: boolean
  }>
  | Readonly<{
    kind: 'lock_transaction_begin'
    clientId: string
    transactionId: string
    attempt: number
    retryOfTransactionId: string | null
    startTs: number
  }>
  | Readonly<{
    kind: 'lock_transaction_status'
    transactionId: string
    from: TraceLockTransactionStatus
    to: TraceLockTransactionStatus
    commitTs?: number
  }>
  | Readonly<{
    kind: 'lock_owner'
    action: 'acquire' | 'release'
    resourceId: string
    regionId: number
    transactionId: string
    leaderStoreId: StoreId
  }>
  | Readonly<{
    kind: 'lock_wait_queue'
    action: 'enqueue' | 'dequeue'
    resourceId: string
    transactionId: string
    position: number
  }>
  | Readonly<{
    kind: 'wait_for_edge'
    action: 'add' | 'remove'
    edgeId: string
    waiterTransactionId: string
    holderTransactionId: string
    resourceId: string
    regionId: number
  }>
  | Readonly<{
    kind: 'deadlock_state'
    action: 'detect' | 'select_victim' | 'resolve'
    deadlockId: string
    cycleTransactionIds: readonly string[]
    victimTransactionId: string | null
    selectionPolicy: 'cycle_closing_waiter_model_policy'
    retryable: false
  }>
  | Readonly<{
    kind: 'deadlock_client_error'
    deadlockId: string
    transactionId: string
    errorCode: 1213
    retryable: false
  }>
  | Readonly<{
    kind: 'application_retry'
    action: 'schedule' | 'begin' | 'complete'
    clientId: string
    retryOfTransactionId: string
    fixedBackoffMs: number
    newTransactionId: string | null
  }>
  | Readonly<{
    kind: 'protocol_lab_focus'
    laneId: TraceProtocolLaneId | null
    phase: 'running' | 'complete'
  }>
  | Readonly<{
    kind: 'protocol_lane_stage'
    laneId: TraceProtocolLaneId
    from: TraceProtocolLaneStage
    to: TraceProtocolLaneStage
  }>
  | Readonly<{
    kind: 'protocol_timestamp'
    laneId: TraceProtocolLaneId
    purpose:
      | 'start_ts'
      | 'latest_ts'
      | 'request_min_commit_ts'
      | 'max_commit_ts'
      | 'returned_min_commit_ts'
      | 'one_pc_commit_ts'
      | 'async_commit_ts'
      | 'commit_ts'
    source: 'pd' | 'tidb_model_bound' | 'tikv'
    timestamp: number
    regionId?: number
  }>
  | Readonly<{
    kind: 'protocol_region_raft'
    laneId: TraceProtocolLaneId
    regionId: number
    operation: TraceProtocolRaftOperation
    action: 'propose' | 'persist_quorum' | 'commit' | 'apply'
    index: number
    storeIds?: readonly StoreId[]
  }>
  | Readonly<{
    kind: 'protocol_client_response'
    laneId: TraceProtocolLaneId
    commitTs: number
  }>
  | Readonly<{
    kind: 'protocol_background_complete'
    laneId: TraceProtocolLaneId
  }>
  | Readonly<{
    kind: 'gc_phase'
    round: TraceGcLabRound
    from: TraceGcLabPhase
    to: TraceGcLabPhase
  }>
  | Readonly<{
    kind: 'gc_safe_point_candidate'
    round: TraceGcLabRound
    previous: number
    candidate: number
  }>
  | Readonly<{
    kind: 'gc_safe_point_bound'
    round: TraceGcLabRound
    globalMinStartTs: number | null
    activeTransactionBound: number | null
    serviceSafePoint: number
    blocked: boolean
  }>
  | Readonly<{
    kind: 'gc_blocker_state'
    from: 'active'
    to: 'completed'
  }>
  | Readonly<{
    kind: 'gc_resolve_lock_scan'
    regionId: number
  }>
  | Readonly<{
    kind: 'gc_resolve_lock'
    lockId: string
    action: 'commit' | 'rollback'
  }>
  | Readonly<{
    kind: 'gc_delete_range'
    rangeId: string
    action: 'mark_eligible' | 'delete'
  }>
  | Readonly<{
    kind: 'gc_safe_point_stage'
    safePoint: number
  }>
  | Readonly<{
    kind: 'gc_visibility_safe_point_save'
    safePoint: number
  }>
  | Readonly<{
    kind: 'gc_safe_point_publish'
    safePoint: number
  }>
  | Readonly<{
    kind: 'gc_store_safe_point'
    storeId: StoreId
    safePoint: number
  }>
  | Readonly<{
    kind: 'gc_compaction_state'
    storeId: StoreId
    from: TraceGcStoreSnapshot['compaction']
    to: TraceGcStoreSnapshot['compaction']
  }>
  | Readonly<{
    kind: 'gc_compaction_filter'
    safePoint: number
    filteredVersionIds: readonly string[]
    retainedAnchorIds: readonly string[]
  }>

export interface TraceEvent {
  id: string
  /** Milliseconds from the receipt's start, on the stretched teaching clock. */
  atMs: number
  durationMs: number
  domain: TraceDomain
  kind: string
  label: string
  detail: string
  status: TraceEventStatus
  source?: string
  target?: string
  regionId?: number
  transactionId?: string
  /** Causal parents. An empty list denotes a DAG root. */
  dependsOn?: readonly string[]
  /** Whether this event delays the client response or happens afterwards. */
  path?: TracePath
  /** Stable lane identifier for parallel Region branches. */
  branchId?: string
  /** Post-event projection for deterministic presentation and inspection. */
  snapshot?: TraceStateSnapshot
  /** Typed state changes represented by this event. */
  deltas?: readonly TraceStateDelta[]
  metadata: Readonly<Record<string, TraceMetadataValue>>
}

export type SqlStatus = 'supported' | 'unsupported' | 'invalid'
export type SqlQueryKind =
  | 'point_read'
  | 'range_read'
  | 'aggregate'
  | 'insert'
  | 'update'
  | 'delete'
  | 'explain'
  | 'unknown'

export type SqlAccessPath =
  | 'point_get'
  | 'range_scan'
  | 'table_scan'
  | 'tiflash_mpp'
  | 'kv_write'
  | 'none'

export interface ModelPlanNode {
  id: string
  operator: string
  task: 'root' | 'cop[tikv]' | 'mpp[tiflash]'
  accessObject: string | null
  children: readonly ModelPlanNode[]
}

export interface SqlAnalysis {
  status: SqlStatus
  kind: SqlQueryKind
  /** Underlying operation for EXPLAIN; otherwise equal to kind. */
  statementKind: Exclude<SqlQueryKind, 'explain'>
  table: string | null
  accessPath: SqlAccessPath
  readOnly: boolean
  plan: readonly ModelPlanNode[]
  warnings: readonly string[]
  explanation: string
}

export interface ReplaySpec {
  modelVersion: string
  seed: number
  scenarioId: ScenarioId | null
  query: Pick<SqlAnalysis, 'kind' | 'statementKind' | 'table' | 'accessPath'>
  transactionMode: TransactionMode
  /** Null for reads and model-only EXPLAIN receipts. */
  commitProtocol: ResolvedCommitProtocol | null
}

export interface TraceReceipt {
  id: string
  scenarioId: ScenarioId | null
  analysis: SqlAnalysis
  startTs: number | null
  commitTs: number | null
  /** True when the modeled request completed successfully, including reads. */
  succeeded: boolean
  /** True only when a write transaction reached a committed state. */
  committed: boolean
  outcome: TraceOutcome
  /** Reads and model-only EXPLAIN have no commit protocol. */
  protocol: ResolvedCommitProtocol | null
  events: readonly TraceEvent[]
  durationMs: number
  replay: ReplaySpec
  warnings: readonly string[]
}

export interface TraceRequest {
  analysis: SqlAnalysis
  scenarioId?: ScenarioId
  regionIds?: readonly number[]
  forceConflict?: boolean
  forceProtocol?: CommitProtocol
}

export interface SqlSubmission {
  analysis: SqlAnalysis
  receipt: TraceReceipt | null
}

export interface TiCityState {
  modelVersion: string
  seed: number
  t: number
  tick: number
  scenario: ScenarioId | null
  controls: TiDBControls
  topology: TiDBTopology
  regions: RegionState[]
  tso: TsoState
  transactions: TransactionState[]
  gc: GcState
  tiflash: TiFlashState
  metrics: TiDBMetrics
  playback: PlaybackMode
  lastTrace: TraceReceipt | null
}

export interface TiDBSimulationOptions {
  seed?: number
  fixedStepSeconds?: number
}

export interface TiDBSimulationApi {
  readonly state: TiCityState
  update(deltaSeconds: number): void
  setControl<K extends keyof TiDBControls>(key: K, value: TiDBControls[K]): void
  runScenario(id: ScenarioId): TraceReceipt
  submitSql(sql: string): SqlSubmission
  requestTrace(request: TraceRequest): TraceReceipt | null
  setPlayback(mode: PlaybackMode): void
  reset(): void
}
