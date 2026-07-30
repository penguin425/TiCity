/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * TiCity model contracts. The model owns these values; presentation layers
 * receive them as projections and must not invent alternate simulation state.
 */

export const TIDB_MODEL_VERSION = 'tidb-v8.5-model-2'

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

/**
 * A renderer-safe projection immediately after one detailed model event.
 * It contains only synthetic teaching state and never SQL text or row values.
 */
export interface TraceStateSnapshot {
  modelVersion: string
  tsoLastAllocated: number
  transaction: TraceTransactionSnapshot | null
  regions: readonly TraceRegionSnapshot[]
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
    operation: 'prewrite' | 'commit_primary' | 'commit_secondary'
  }>
  | Readonly<{
    kind: 'raft_persist'
    regionId: number
    index: number
    storeIds: readonly StoreId[]
  }>
  | Readonly<{
    kind: 'raft_commit'
    regionId: number
    index: number
    acknowledgements: number
    quorum: 2
  }>
  | Readonly<{
    kind: 'raft_apply'
    regionId: number
    index: number
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
