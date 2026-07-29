/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * TiCity model contracts. The model owns these values; presentation layers
 * receive them as projections and must not invent alternate simulation state.
 */

export const TIDB_MODEL_VERSION = 'tidb-v8.5-model-1'

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
