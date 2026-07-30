/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * A deterministic TiDB v8.5 teaching model. Time and volume are stretched for
 * legibility, but transaction 2PC and Region Raft remain separate state
 * machines. This module has no renderer or browser dependencies.
 */

import { getScenario } from './scenarios'
import { analyzeSql } from './sql'
import {
  createLockLabState,
  detectWaitForCycle,
  freezeLockLabSnapshot,
  isLockLabDelta,
  reduceLockLabState,
  selectWaiterByStartTs,
} from './lock-lab'
import {
  clonePeers,
  createRegions,
  createTopology,
  KEYSPACE_END,
  regionForKey,
} from './topology'
import {
  TIDB_MODEL_VERSION,
} from './types'
import type {
  CommitProtocol,
  GcState,
  ModelPlanNode,
  RegionState,
  ReplaySpec,
  ResolvedCommitProtocol,
  ScenarioId,
  SqlAnalysis,
  SqlSubmission,
  StoreId,
  TiCityState,
  TiDBControls,
  TiDBSimulationApi,
  TiDBSimulationOptions,
  TraceDomain,
  TraceEvent,
  TraceEventStatus,
  TraceLockLabSnapshot,
  TraceMetadataValue,
  TraceOutcome,
  TracePath,
  TraceRegionSnapshot,
  TraceReceipt,
  TraceRequest,
  TraceStateDelta,
  TraceStateSnapshot,
  TraceTransactionSnapshot,
  TraceTransactionStage,
  TransactionState,
} from './types'

const DEFAULT_FIXED_STEP_SECONDS = 1 / 30
const TSO_BASE = 1_000_000_000
const MAX_TRANSACTIONS = 64

export const DEFAULT_TIDB_CONTROLS: Readonly<TiDBControls> = Object.freeze({
  qps: 24,
  writeRatio: 0.3,
  keyDistribution: 'uniform',
  transactionMode: 'pessimistic',
  commitProtocol: 'auto',
  readPolicy: 'leader',
  regionSplitThresholdMiB: 96,
  gcLifetimeSeconds: 60,
  networkLatencyMs: 12,
  tiflashLagSeconds: 1.5,
  playbackSpeed: 1,
  paused: false,
})

interface PendingTiFlashVersion {
  readyAt: number
  ts: number
  versions: number
}

interface DetailedRegionProjection {
  readonly region: RegionState
  proposedIndex: number | null
  persistedStoreIds: StoreId[]
  acknowledgements: number
  pessimisticLock: {
    transactionId: string
    leaderStoreId: StoreId
    storage: 'leader_memory'
    replicated: false
  } | null
  mvcc: {
    defaultCf: 'empty' | 'value'
    lockCf: 'empty' | 'prewrite'
    writeCf: 'empty' | 'commit'
    startTs: number | null
    commitTs: number | null
    primary: boolean
  }
}

interface EventOptions {
  durationMs?: number
  status?: TraceEventStatus
  source?: string
  target?: string
  regionId?: number
  transactionId?: string
  dependsOn?: readonly string[]
  path?: TracePath
  branchId?: string
  snapshot?: TraceStateSnapshot
  deltas?: readonly TraceStateDelta[]
  metadata?: Readonly<Record<string, TraceMetadataValue>>
}

function freezePlanNode(node: ModelPlanNode): ModelPlanNode {
  return Object.freeze({
    ...node,
    children: Object.freeze(node.children.map(freezePlanNode)),
  })
}

function freezeAnalysis(analysis: SqlAnalysis): SqlAnalysis {
  return Object.freeze({
    ...analysis,
    plan: Object.freeze(analysis.plan.map(freezePlanNode)),
    warnings: Object.freeze([...analysis.warnings]),
  })
}

function freezeTraceDelta(delta: TraceStateDelta): TraceStateDelta {
  if (delta.kind === 'raft_persist') {
    return Object.freeze({
      ...delta,
      storeIds: Object.freeze([...delta.storeIds]),
    })
  }
  if (delta.kind === 'deadlock_state') {
    return Object.freeze({
      ...delta,
      cycleTransactionIds: Object.freeze([...delta.cycleTransactionIds]),
    })
  }
  return Object.freeze({ ...delta })
}

function freezeTraceSnapshot(snapshot: TraceStateSnapshot): TraceStateSnapshot {
  return Object.freeze({
    ...snapshot,
    transaction: snapshot.transaction === null
      ? null
      : Object.freeze({
        ...snapshot.transaction,
        regionIds: Object.freeze([...snapshot.transaction.regionIds]),
      }),
    regions: Object.freeze(snapshot.regions.map((region) => Object.freeze({
      ...region,
      persistedStoreIds: Object.freeze([...region.persistedStoreIds]),
      peers: Object.freeze(region.peers.map((peer) => Object.freeze({ ...peer }))),
      pessimisticLock: region.pessimisticLock === null
        ? null
        : Object.freeze({ ...region.pessimisticLock }),
      mvcc: Object.freeze({ ...region.mvcc }),
    }))),
    ...(snapshot.lockLab
      ? { lockLab: freezeLockLabSnapshot(snapshot.lockLab) }
      : {}),
  })
}

class TraceBuilder {
  readonly events: TraceEvent[] = []
  private cursorMs = 0
  private lastEventId: string | null = null
  private readonly eventById = new Map<string, TraceEvent>()

  constructor(
    private readonly receiptId: string,
    private readonly networkLatencyMs: number,
  ) {}

  add(
    domain: TraceDomain,
    kind: string,
    label: string,
    detail: string,
    options: EventOptions = {},
  ): TraceEvent {
    const durationMs = options.durationMs ?? Math.max(8, this.networkLatencyMs)
    const dependsOn = options.dependsOn === undefined
      ? this.lastEventId === null ? [] : [this.lastEventId]
      : [...options.dependsOn]
    const dependencyEndMs = dependsOn.reduce((latest, dependencyId) => {
      const dependency = this.eventById.get(dependencyId)
      if (!dependency) {
        throw new Error(`Unknown trace dependency: ${dependencyId}`)
      }
      return Math.max(latest, dependency.atMs + dependency.durationMs)
    }, 0)
    const atMs = options.dependsOn === undefined
      ? this.cursorMs
      : dependencyEndMs
    const event: TraceEvent = Object.freeze({
      id: `${this.receiptId}-event-${this.events.length + 1}`,
      atMs,
      durationMs,
      domain,
      kind,
      label,
      detail,
      status: options.status ?? 'success',
      ...(options.source ? { source: options.source } : {}),
      ...(options.target ? { target: options.target } : {}),
      ...(options.regionId !== undefined ? { regionId: options.regionId } : {}),
      ...(options.transactionId ? { transactionId: options.transactionId } : {}),
      dependsOn: Object.freeze(dependsOn),
      path: options.path ?? 'critical',
      ...(options.branchId ? { branchId: options.branchId } : {}),
      ...(options.snapshot ? { snapshot: options.snapshot } : {}),
      ...(options.deltas
        ? { deltas: Object.freeze(options.deltas.map(freezeTraceDelta)) }
        : {}),
      metadata: Object.freeze({ ...(options.metadata ?? {}) }),
    })
    this.events.push(event)
    this.eventById.set(event.id, event)
    this.lastEventId = event.id
    this.cursorMs = Math.max(this.cursorMs, atMs + durationMs)
    return event
  }

  get durationMs(): number {
    return this.cursorMs
  }
}

class SeededRng {
  private value: number

  constructor(seed: number) {
    this.value = seed >>> 0
  }

  reset(seed: number): void {
    this.value = seed >>> 0
  }

  next(): number {
    this.value |= 0
    this.value = (this.value + 0x6d2b79f5) | 0
    let mixed = Math.imul(this.value ^ (this.value >>> 15), 1 | this.value)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value
}

function createMetrics(): TiCityState['metrics'] {
  return {
    statements: 0,
    reads: 0,
    writes: 0,
    commits: 0,
    rollbacks: 0,
    conflicts: 0,
    raftEntries: 0,
    regionSplits: 0,
    leaderElections: 0,
    gcRuns: 0,
    lockWaits: 0,
    deadlocks: 0,
    retries: 0,
  }
}

function createGc(): GcState {
  return {
    safePoint: TSO_BASE,
    blockedByStartTs: null,
    obsoleteVersions: 0,
    collectedVersions: 0,
    backlog: 0,
  }
}

function makeInitialState(seed: number): TiCityState {
  return {
    modelVersion: TIDB_MODEL_VERSION,
    seed,
    t: 0,
    tick: 0,
    scenario: null,
    controls: { ...DEFAULT_TIDB_CONTROLS },
    topology: createTopology(),
    regions: createRegions(),
    tso: {
      lastAllocated: TSO_BASE,
      allocations: 0,
    },
    transactions: [],
    gc: createGc(),
    tiflash: {
      available: true,
      resolvedTs: TSO_BASE,
      targetTs: TSO_BASE,
      lagSeconds: 0,
      pendingVersions: 0,
      mppQueries: 0,
    },
    metrics: createMetrics(),
    playback: 'slow',
    lastTrace: null,
  }
}

function hashTable(table: string | null): number {
  let hash = 2_166_136_261
  for (const char of table ?? 'unknown') {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function asRegionIds(
  requested: readonly number[] | undefined,
  analysis: SqlAnalysis,
  regions: readonly RegionState[],
): number[] {
  if (requested && requested.length > 0) {
    return [...new Set(requested)]
      .filter((id) => regions.some((region) => region.id === id))
  }

  const baseIndex = hashTable(analysis.table) % regions.length
  if (analysis.accessPath === 'tiflash_mpp') {
    return regions.filter((region) => region.tiflashReplica).slice(0, 3).map((region) => region.id)
  }
  if (analysis.statementKind === 'aggregate') {
    return [
      regions[baseIndex].id,
      regions[(baseIndex + 1) % regions.length].id,
      regions[(baseIndex + 2) % regions.length].id,
    ]
  }
  if (analysis.statementKind === 'range_read') {
    return [
      regions[baseIndex].id,
      regions[(baseIndex + 1) % regions.length].id,
      regions[(baseIndex + 2) % regions.length].id,
    ]
  }
  return [regions[baseIndex].id]
}

function resolvedProtocol(
  requested: CommitProtocol,
  regionCount: number,
  warnings: string[],
): ResolvedCommitProtocol {
  if (requested === 'auto') {
    if (regionCount === 1) return '1pc'
    /*
     * The workbench only accepts one small, primary-key-constrained mutation.
     * That representative mutation is eligible for Async Commit regardless of
     * how many Regions a teaching scenario asks us to display. Real TiDB also
     * considers feature flags, transaction size, key bytes, and runtime
     * timestamp bounds; Region count alone is not its eligibility rule.
     */
    return 'async_commit'
  }
  if (requested === '1pc' && regionCount !== 1) {
    warnings.push('1PC is ineligible across multiple Regions; the model used 2PC.')
    return '2pc'
  }
  return requested
}

function updateRegionHealth(region: RegionState): void {
  const healthy = region.peers.filter((peer) => peer.healthy).length
  const leader = region.peers.find((peer) => peer.storeId === region.leaderStoreId)
  region.health = healthy < 2 || !leader?.healthy
    ? healthy < 2 ? 'unavailable' : 'degraded'
    : healthy < region.peers.length ? 'degraded' : 'healthy'
}

export function createTiDBSimulation(
  options: TiDBSimulationOptions = {},
): TiDBSimulationApi {
  const seed = (options.seed ?? 0x5eed425) >>> 0
  const fixedStepSeconds = options.fixedStepSeconds ?? DEFAULT_FIXED_STEP_SECONDS
  if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
    throw new RangeError('fixedStepSeconds must be a positive finite number.')
  }

  const state = makeInitialState(seed)
  const rng = new SeededRng(seed)
  let accumulator = 0
  let workloadCredit = 0
  let sequentialKey = KEYSPACE_END - 100_000
  let receiptCounter = 0
  let transactionCounter = 0
  let tiflashQueue: PendingTiFlashVersion[] = []

  function allocateTs(): number {
    const physical = TSO_BASE + Math.floor(state.t * 1_000) * 1_000
    const timestamp = Math.max(state.tso.lastAllocated + 1, physical)
    state.tso.lastAllocated = timestamp
    state.tso.allocations++
    return timestamp
  }

  function trimTransactions(): void {
    if (state.transactions.length <= MAX_TRANSACTIONS) return
    let removable = state.transactions.length - MAX_TRANSACTIONS
    state.transactions = state.transactions.filter((transaction) => {
      if (removable > 0 &&
          (transaction.phase === 'committed' || transaction.phase === 'rolled_back')) {
        removable--
        return false
      }
      return true
    })
  }

  function enqueueTiFlash(ts: number, versions = 1): void {
    if (!state.tiflash.available) return
    state.tiflash.targetTs = Math.max(state.tiflash.targetTs, ts)
    state.tiflash.pendingVersions += versions
    tiflashQueue.push({
      readyAt: state.t + state.controls.tiflashLagSeconds,
      ts,
      versions,
    })
  }

  function applyTiFlashQueue(): void {
    let consumed = 0
    while (consumed < tiflashQueue.length &&
           tiflashQueue[consumed].readyAt <= state.t + 1e-12) {
      const pending = tiflashQueue[consumed]
      state.tiflash.resolvedTs = Math.max(state.tiflash.resolvedTs, pending.ts)
      state.tiflash.pendingVersions = Math.max(
        0,
        state.tiflash.pendingVersions - pending.versions,
      )
      consumed++
    }
    if (consumed > 0) tiflashQueue.splice(0, consumed)
    state.tiflash.lagSeconds = state.tiflash.pendingVersions > 0
      ? Math.max(0, state.tiflash.targetTs - state.tiflash.resolvedTs) / 1_000_000
      : 0
  }

  function catchUpTiFlashTo(snapshotTs: number): void {
    let consumedVersions = 0
    tiflashQueue = tiflashQueue.filter((pending) => {
      if (pending.ts > snapshotTs) return true
      consumedVersions += pending.versions
      return false
    })
    state.tiflash.pendingVersions = Math.max(
      0,
      state.tiflash.pendingVersions - consumedVersions,
    )
    state.tiflash.resolvedTs = Math.max(state.tiflash.resolvedTs, snapshotTs)
    state.tiflash.targetTs = Math.max(state.tiflash.targetTs, snapshotTs)
    state.tiflash.lagSeconds = state.tiflash.pendingVersions > 0
      ? Math.max(0, state.tiflash.targetTs - state.tiflash.resolvedTs) / 1_000_000
      : 0
  }

  function advanceGc(): void {
    const target = TSO_BASE +
      Math.max(0, Math.floor((state.t - state.controls.gcLifetimeSeconds) * 1_000)) * 1_000
    const activeStarts = state.transactions
      .filter((transaction) =>
        transaction.phase === 'active' ||
        transaction.phase === 'prewriting' ||
        transaction.phase === 'committing',
      )
      .map((transaction) => transaction.startTs)
    const oldest = activeStarts.length > 0 ? Math.min(...activeStarts) : null
    state.gc.blockedByStartTs = oldest
    const permitted = oldest === null ? target : Math.min(target, oldest - 1)
    const previous = state.gc.safePoint
    state.gc.safePoint = Math.max(state.gc.safePoint, permitted)
    if (state.gc.safePoint > previous && state.gc.obsoleteVersions > 0) {
      const collected = Math.min(
        state.gc.obsoleteVersions,
        Math.max(1, Math.floor((state.gc.safePoint - previous) / 10_000)),
      )
      state.gc.obsoleteVersions -= collected
      state.gc.collectedVersions += collected
      state.metrics.gcRuns++
    }
    state.gc.backlog = state.gc.obsoleteVersions
  }

  function applyRaftWithoutTrace(region: RegionState): boolean {
    const leader = region.peers.find((peer) => peer.storeId === region.leaderStoreId)
    if (!leader?.healthy) return false
    const nextIndex = region.commitIndex + 1
    let acknowledgements = 0
    for (const peer of region.peers) {
      if (!peer.healthy) continue
      peer.matchIndex = nextIndex
      acknowledgements++
    }
    state.metrics.raftEntries++
    if (acknowledgements < 2) {
      updateRegionHealth(region)
      return false
    }
    region.commitIndex = nextIndex
    region.appliedIndex = nextIndex
    for (const peer of region.peers) {
      if (peer.healthy) peer.appliedIndex = nextIndex
    }
    updateRegionHealth(region)
    return true
  }

  function runBackgroundWork(): void {
    workloadCredit += state.controls.qps * fixedStepSeconds
    const statements = Math.floor(workloadCredit)
    workloadCredit -= statements

    for (let index = 0; index < statements; index++) {
      state.metrics.statements++
      const write = rng.next() < state.controls.writeRatio
      const key = state.controls.keyDistribution === 'sequential'
        ? sequentialKey++
        : Math.floor(rng.next() * KEYSPACE_END)
      if (sequentialKey >= KEYSPACE_END) sequentialKey = 0
      const region = regionForKey(state.regions, key)
      region.hotScore += write ? 0.2 : 0.05

      if (!write) {
        state.metrics.reads++
        continue
      }

      state.metrics.writes++
      const startTs = allocateTs()
      const commitTs = allocateTs()
      if (applyRaftWithoutTrace(region)) {
        state.metrics.commits++
        region.sizeMiB += 0.0005
        state.gc.obsoleteVersions++
      } else {
        state.metrics.rollbacks++
      }
      /* Keep the optimizer from proving these allocations irrelevant: the two
         values model distinct TSO requests even in the aggregated workload. */
      void startTs
    }
  }

  function fixedStep(): void {
    state.tick++
    state.t = state.tick * fixedStepSeconds
    for (const region of state.regions) {
      region.hotScore *= 0.998
      if (region.hotScore < 1e-9) region.hotScore = 0
    }
    applyTiFlashQueue()
    runBackgroundWork()
    advanceGc()
  }

  function ensureLeader(
    region: RegionState,
    builder?: TraceBuilder,
    path: TracePath = 'critical',
  ): boolean {
    const eligibleVoters = region.peers.filter((peer) =>
      peer.healthy && peer.matchIndex >= region.commitIndex,
    )
    if (eligibleVoters.length < 2) {
      updateRegionHealth(region)
      return false
    }
    const current = region.peers.find((peer) => peer.storeId === region.leaderStoreId)
    if (current?.healthy && current.matchIndex >= region.commitIndex) return true
    const replacement = eligibleVoters[0]
    if (!replacement) {
      updateRegionHealth(region)
      return false
    }
    for (const peer of region.peers) peer.raftRole = 'follower'
    replacement.raftRole = 'leader'
    const previous = region.leaderStoreId
    region.leaderStoreId = replacement.storeId
    region.term++
    state.metrics.leaderElections++
    updateRegionHealth(region)
    builder?.add(
      'raft',
      'leader_election',
      'Raft leader election',
      `Region ${region.id} elected ${replacement.storeId} after ${previous} became unavailable.`,
      {
        source: previous,
        target: replacement.storeId,
        regionId: region.id,
        path,
        metadata: { term: region.term, quorum: 2 },
      },
    )
    return true
  }

  function replicateRaft(
    region: RegionState,
    operation: string,
    transactionId: string,
    builder: TraceBuilder,
    path: TracePath = 'critical',
  ): boolean {
    if (!ensureLeader(region, builder, path)) {
      builder.add(
        'raft',
        'quorum_unavailable',
        'Raft quorum unavailable',
        `Region ${region.id} has no live leader.`,
        {
          status: 'failed',
          regionId: region.id,
          transactionId,
          path,
          metadata: { term: region.term },
        },
      )
      return false
    }

    const nextIndex = region.commitIndex + 1
    const leader = region.peers.find((peer) => peer.storeId === region.leaderStoreId)
    if (!leader) return false
    const liveFollower = region.peers.find((peer) =>
      peer.healthy && peer.storeId !== region.leaderStoreId,
    )
    leader.matchIndex = nextIndex
    builder.add(
      'raft',
      'append_entry',
      'Append Raft entry',
      `${operation} entered Region ${region.id}'s Raft log at index ${nextIndex}.`,
      {
        source: region.leaderStoreId,
        target: liveFollower?.storeId ?? region.leaderStoreId,
        regionId: region.id,
        transactionId,
        path,
        metadata: { term: region.term, index: nextIndex, operation },
      },
    )

    let acknowledgements = 0
    for (const peer of region.peers) {
      if (!peer.healthy) continue
      peer.matchIndex = nextIndex
      acknowledgements++
    }
    state.metrics.raftEntries++
    const quorum = acknowledgements >= 2
    builder.add(
      'raft',
      quorum ? 'quorum_commit' : 'quorum_unavailable',
      quorum ? 'Raft quorum committed' : 'Raft quorum unavailable',
      quorum
        ? `${acknowledgements} voters persisted index ${nextIndex}; Region ${region.id} may apply it.`
        : `Only ${acknowledgements} voter acknowledged Region ${region.id}; the KV write cannot commit.`,
      {
        status: quorum ? 'success' : 'failed',
        source: liveFollower?.storeId ?? region.leaderStoreId,
        target: region.leaderStoreId,
        regionId: region.id,
        transactionId,
        path,
        metadata: {
          term: region.term,
          index: nextIndex,
          acknowledgements,
          quorum: 2,
          operation,
        },
      },
    )

    if (!quorum) {
      updateRegionHealth(region)
      return false
    }
    region.commitIndex = nextIndex
    region.appliedIndex = nextIndex
    for (const peer of region.peers) {
      if (peer.healthy) peer.appliedIndex = nextIndex
    }
    updateRegionHealth(region)
    return true
  }

  function splitRegion(regionId: number, builder: TraceBuilder): void {
    const index = state.regions.findIndex((region) => region.id === regionId)
    if (index < 0) return
    const region = state.regions[index]
    const oldStart = region.startKey
    const oldEnd = region.endKey
    const midpoint = Math.floor((region.startKey + oldEnd) / 2)
    if (midpoint <= region.startKey || midpoint >= oldEnd) return
    const nextId = Math.max(...state.regions.map((candidate) => candidate.id)) + 1
    const halfSize = region.sizeMiB / 2
    region.startKey = midpoint
    region.sizeMiB = halfSize
    region.hotScore /= 2
    region.epoch++
    const sibling: RegionState = {
      ...region,
      id: nextId,
      startKey: oldStart,
      endKey: midpoint,
      peers: clonePeers(region.peers),
    }
    /*
     * Keep the existing Region id on the sequential upper range so the fixed
     * 36-tile city can continue to project it; the new logical Region owns the
     * lower half and remains inspectable in Machine/Diagnose.
     */
    state.regions.splice(index, 0, sibling)
    state.metrics.regionSplits++
    builder.add(
      'kv',
      'region_split',
      'PD scheduled a Region split',
      `Region ${regionId} split at key ${midpoint}; Region ${nextId} owns the lower range and Region ${regionId} retains the sequential upper range.`,
      {
        source: 'pd-1',
        target: region.leaderStoreId,
        regionId,
        metadata: { splitKey: midpoint, newRegionId: nextId, epoch: region.epoch },
      },
    )
  }

  function markStoreDown(storeId: StoreId): void {
    const store = state.topology.tikv.find((node) => node.id === storeId)
    if (store) store.status = 'down'
    for (const region of state.regions) {
      const peer = region.peers.find((candidate) => candidate.storeId === storeId)
      if (peer) peer.healthy = false
      updateRegionHealth(region)
    }
  }

  function appendCommonStart(
    builder: TraceBuilder,
    analysis: SqlAnalysis,
    proxyId: string,
    tidbId: string,
  ): void {
    builder.add(
      'client',
      'submit',
      'Client submitted SQL',
      'The SQL text stays in this browser; the model retains only its classification.',
      { source: 'client', target: proxyId },
    )
    builder.add(
      'sql',
      'route',
      'TiProxy routed the session',
      `${proxyId} selected stateless ${tidbId}.`,
      { source: proxyId, target: tidbId },
    )
    builder.add(
      'sql',
      'parse_optimize',
      'Parse and optimize',
      analysis.explanation,
      {
        source: tidbId,
        target: tidbId,
        metadata: {
          statementKind: analysis.statementKind,
          accessPath: analysis.accessPath,
        },
      },
    )
  }

  function addReturn(builder: TraceBuilder, succeeded: boolean, tidbId: string): void {
    builder.add(
      'return',
      succeeded ? 'complete' : 'error',
      succeeded ? 'Modeled route complete' : 'Modeled request failed',
      succeeded
        ? 'No result rows are generated; the receipt records only architecture and state transitions.'
        : 'The model returns an error condition without inventing database output.',
      {
        status: succeeded ? 'success' : 'failed',
        source: tidbId,
        target: 'client',
      },
    )
  }

  function recordReceipt(
    id: string,
    scenarioId: ScenarioId | null,
    analysis: SqlAnalysis,
    startTs: number | null,
    commitTs: number | null,
    outcome: TraceOutcome,
    protocol: ResolvedCommitProtocol | null,
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const succeeded = outcome === 'succeeded' || outcome === 'committed'
    const committed = outcome === 'committed'
    const analysisSnapshot = freezeAnalysis(analysis)
    const replay: ReplaySpec = Object.freeze({
      modelVersion: state.modelVersion,
      seed: state.seed,
      scenarioId,
      query: Object.freeze({
        kind: analysisSnapshot.kind,
        statementKind: analysisSnapshot.statementKind,
        table: analysisSnapshot.table,
        accessPath: analysisSnapshot.accessPath,
      }),
      transactionMode: state.controls.transactionMode,
      commitProtocol: protocol,
    })
    const receipt: TraceReceipt = Object.freeze({
      id,
      scenarioId,
      analysis: analysisSnapshot,
      startTs,
      commitTs,
      succeeded,
      committed,
      outcome,
      protocol,
      events: Object.freeze([...builder.events]),
      durationMs: builder.durationMs,
      replay,
      warnings: Object.freeze([...warnings, ...analysisSnapshot.warnings]),
    })
    state.lastTrace = receipt
    return receipt
  }

  function combineProtocolReceipts(
    analysis: SqlAnalysis,
    receipts: readonly TraceReceipt[],
  ): TraceReceipt {
    let offsetMs = 0
    const events: TraceEvent[] = []
    for (const receipt of receipts) {
      for (const event of receipt.events) {
        events.push(Object.freeze({
          ...event,
          atMs: event.atMs + offsetMs,
        }))
      }
      offsetMs += receipt.durationMs + Math.max(16, state.controls.networkLatencyMs * 2)
    }
    const succeeded = receipts.every((receipt) => receipt.committed)
    const analysisSnapshot = freezeAnalysis(analysis)
    const replay: ReplaySpec = Object.freeze({
      modelVersion: state.modelVersion,
      seed: state.seed,
      scenarioId: 'commit-protocols',
      query: Object.freeze({
        kind: analysisSnapshot.kind,
        statementKind: analysisSnapshot.statementKind,
        table: analysisSnapshot.table,
        accessPath: analysisSnapshot.accessPath,
      }),
      transactionMode: state.controls.transactionMode,
      commitProtocol: null,
    })
    const receipt: TraceReceipt = Object.freeze({
      id: `trace-comparison-${receiptCounter}`,
      scenarioId: 'commit-protocols',
      analysis: analysisSnapshot,
      startTs: null,
      commitTs: null,
      succeeded,
      committed: false,
      outcome: succeeded ? 'succeeded' : 'failed',
      protocol: null,
      events: Object.freeze(events),
      durationMs: Math.max(0, offsetMs - Math.max(16, state.controls.networkLatencyMs * 2)),
      replay,
      warnings: Object.freeze([
        ...new Set(receipts.flatMap((receipt) => receipt.warnings)),
      ]),
    })
    state.lastTrace = receipt
    return receipt
  }

  function traceRead(
    id: string,
    analysis: SqlAnalysis,
    scenarioId: ScenarioId | null,
    regions: RegionState[],
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const proxyId = state.topology.tiproxy[state.metrics.statements % 2].id
    const tidbId = state.topology.tidb[state.metrics.statements % 3].id
    appendCommonStart(builder, analysis, proxyId, tidbId)
    const startTs = allocateTs()
    builder.add(
      'tso',
      'snapshot_ts',
      'PD allocated a snapshot timestamp',
      `The read uses start_ts ${startTs}.`,
      {
        source: tidbId,
        target: 'pd-1',
        metadata: { startTs },
      },
    )
    builder.add(
      'sql',
      'locate_regions',
      'Locate Regions',
      `The table key range maps to ${regions.length} representative Region(s).`,
      {
        source: tidbId,
        target: 'pd-1',
        metadata: { regionCount: regions.length },
      },
    )

    if (analysis.accessPath === 'tiflash_mpp') {
      if (!state.tiflash.available) {
        warnings.push('TiFlash is unavailable; the modeled MPP query could not run.')
        builder.add(
          'tiflash',
          'mpp_unavailable',
          'TiFlash unavailable',
          'The analytical replica cannot accept an MPP fragment.',
          { status: 'failed', source: tidbId, target: 'tiflash-1' },
        )
        addReturn(builder, false, tidbId)
        state.metrics.statements++
        state.metrics.reads++
        return recordReceipt(
          id,
          scenarioId,
          analysis,
          startTs,
          null,
          'failed',
          null,
          builder,
          warnings,
        )
      }
      if (state.tiflash.resolvedTs < startTs) {
        builder.add(
          'tiflash',
          'learner_catch_up',
          'Wait for TiFlash learner',
          `TiFlash advanced resolved_ts from ${state.tiflash.resolvedTs} to ${startTs}.`,
          {
            source: regions[0]?.leaderStoreId ?? 'tikv-1',
            target: 'tiflash-1',
            regionId: regions[0]?.id,
            durationMs: Math.max(
              state.controls.networkLatencyMs,
              state.controls.tiflashLagSeconds * 1_000,
            ),
            metadata: { snapshotTs: startTs },
          },
        )
        catchUpTiFlashTo(startTs)
      }
      builder.add(
        'tiflash',
        'mpp_dispatch',
        'Dispatch MPP fragments',
        `${regions.length} representative partitions scan a resolved TiFlash snapshot.`,
        {
          source: tidbId,
          target: 'tiflash-1',
          metadata: { regionCount: regions.length, snapshotTs: startTs },
        },
      )
      state.tiflash.mppQueries++
    } else {
      for (const region of regions) {
        if (!ensureLeader(region, builder)) {
          warnings.push(`Region ${region.id} has no available leader.`)
          continue
        }
        let target = region.leaderStoreId
        if (state.controls.readPolicy === 'follower') {
          target = region.peers.find((peer) =>
            peer.healthy && peer.storeId !== region.leaderStoreId,
          )?.storeId ?? target
        }
        builder.add(
          'kv',
          analysis.statementKind === 'point_read' ? 'point_get' : 'coprocessor_scan',
          analysis.statementKind === 'point_read' ? 'TiKV Point Get' : 'TiKV Coprocessor scan',
          `Region ${region.id} served the modeled snapshot from ${target}.`,
          {
            source: tidbId,
            target,
            regionId: region.id,
            metadata: {
              snapshotTs: startTs,
              readPolicy: state.controls.readPolicy,
              accessPath: analysis.accessPath,
            },
          },
        )
      }
    }

    addReturn(builder, warnings.length === 0, tidbId)
    state.metrics.statements++
    state.metrics.reads++
    return recordReceipt(
      id,
      scenarioId,
      analysis,
      startTs,
      null,
      warnings.length === 0 ? 'succeeded' : 'failed',
      null,
      builder,
      warnings,
    )
  }

  function traceExplain(
    id: string,
    analysis: SqlAnalysis,
    scenarioId: ScenarioId | null,
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const proxyId = state.topology.tiproxy[state.metrics.statements % 2].id
    const tidbId = state.topology.tidb[state.metrics.statements % 3].id
    appendCommonStart(builder, analysis, proxyId, tidbId)
    builder.add(
      'sql',
      'model_plan',
      'Build model plan',
      'No statement was executed and no actual TiDB measurements were requested.',
      {
        source: tidbId,
        target: tidbId,
        metadata: { planRoots: analysis.plan.length },
      },
    )
    addReturn(builder, true, tidbId)
    state.metrics.statements++
    return recordReceipt(
      id,
      scenarioId,
      analysis,
      null,
      null,
      'succeeded',
      null,
      builder,
      warnings,
    )
  }

  function failTransaction(
    transaction: TransactionState,
    builder: TraceBuilder,
    tidbId: string,
    warnings: string[],
    reason: string,
  ): void {
    transaction.phase = 'rolled_back'
    const primary = state.regions.find((region) =>
      region.id === transaction.primaryRegionId,
    )
    builder.add(
      'txn2pc',
      'rollback',
      'Transaction rolled back',
      reason,
      {
        status: 'failed',
        source: tidbId,
        target: primary?.leaderStoreId ?? tidbId,
        regionId: primary?.id,
        transactionId: transaction.id,
      },
    )
    warnings.push(reason)
    state.metrics.rollbacks++
  }

  function raftMutation(
    region: RegionState,
    operation: string,
    transaction: TransactionState,
    tidbId: string,
    builder: TraceBuilder,
    path: TracePath = 'critical',
  ): boolean {
    builder.add(
      'kv',
      'mutation',
      'Send KV mutation to Region leader',
      `${tidbId} sent ${operation} for transaction ${transaction.id}.`,
      {
        source: tidbId,
        target: region.leaderStoreId,
        regionId: region.id,
        transactionId: transaction.id,
        path,
        metadata: { operation },
      },
    )
    return replicateRaft(region, operation, transaction.id, builder, path)
  }

  /**
   * The first model-2 vertical slice. Unlike the compact write tracer below,
   * this path records a causal event graph and a post-event state projection
   * for every step. The projections are deliberately small: two representative
   * Regions, their three voters, and conceptual MVCC column-family state.
   */
  function traceDetailedCrossRegionTransaction(
    id: string,
    analysis: SqlAnalysis,
    regions: readonly [RegionState, RegionState],
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const proxyId = state.topology.tiproxy[state.metrics.statements % 2].id
    const tidbId = state.topology.tidb[state.metrics.statements % 3].id
    const transactionId = `txn-${++transactionCounter}`
    let transactionProjection: TraceTransactionSnapshot | null = null
    const projectedRegions: DetailedRegionProjection[] = regions.map((region, index) => ({
      region,
      proposedIndex: null,
      persistedStoreIds: [],
      acknowledgements: 0,
      pessimisticLock: null,
      mvcc: {
        defaultCf: 'empty',
        lockCf: 'empty',
        writeCf: 'empty',
        startTs: null,
        commitTs: null,
        primary: index === 0,
      },
    }))

    function projection(): TraceStateSnapshot {
      const transaction = transactionProjection === null
        ? null
        : {
          ...transactionProjection,
          regionIds: [...transactionProjection.regionIds],
        }
      const regionSnapshots: TraceRegionSnapshot[] = projectedRegions.map((projected) => ({
        regionId: projected.region.id,
        leaderStoreId: projected.region.leaderStoreId,
        term: projected.region.term,
        proposedIndex: projected.proposedIndex,
        persistedStoreIds: [...projected.persistedStoreIds],
        acknowledgements: projected.acknowledgements,
        quorum: 2,
        commitIndex: projected.region.commitIndex,
        appliedIndex: projected.region.appliedIndex,
        peers: projected.region.peers.map((peer) => ({
          storeId: peer.storeId,
          raftRole: peer.raftRole,
          matchIndex: peer.matchIndex,
          appliedIndex: peer.appliedIndex,
          healthy: peer.healthy,
        })),
        pessimisticLock: projected.pessimisticLock === null
          ? null
          : { ...projected.pessimisticLock },
        mvcc: { ...projected.mvcc },
      }))
      return freezeTraceSnapshot({
        modelVersion: state.modelVersion,
        tsoLastAllocated: state.tso.lastAllocated,
        transaction,
        regions: regionSnapshots,
      })
    }

    function addDetailedEvent(
      domain: TraceDomain,
      kind: string,
      label: string,
      detail: string,
      options: EventOptions = {},
    ): TraceEvent {
      return builder.add(domain, kind, label, detail, {
        ...options,
        path: options.path ?? 'critical',
        snapshot: projection(),
        deltas: options.deltas ?? [],
      })
    }

    const submit = addDetailedEvent(
      'client',
      'submit',
      'Client submitted a modeled transaction',
      'The browser keeps SQL text private and sends only its classified teaching operation into the model.',
      {
        source: 'client',
        target: proxyId,
      },
    )
    const route = addDetailedEvent(
      'sql',
      'route',
      'TiProxy routed the session',
      `${proxyId} selected stateless ${tidbId}.`,
      {
        source: proxyId,
        target: tidbId,
        dependsOn: [submit.id],
      },
    )
    const optimize = addDetailedEvent(
      'sql',
      'parse_optimize',
      'Build the modeled mutation plan',
      'TiDB identified two representative key mutations without retaining SQL text or row values.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [route.id],
        metadata: {
          statementKind: analysis.statementKind,
          accessPath: analysis.accessPath,
          mutationCount: 2,
        },
      },
    )

    const startTs = allocateTs()
    transactionProjection = {
      id: transactionId,
      mode: 'pessimistic',
      protocol: '2pc',
      stage: 'active',
      startTs,
      commitTs: null,
      regionIds: regions.map((region) => region.id),
      primaryRegionId: regions[0].id,
      clientResponded: false,
    }
    const transaction: TransactionState = {
      id: transactionId,
      mode: 'pessimistic',
      protocol: '2pc',
      startTs,
      commitTs: null,
      regionIds: regions.map((region) => region.id),
      primaryRegionId: regions[0].id,
      phase: 'active',
      conflict: false,
    }
    state.transactions.push(transaction)
    trimTransactions()
    const start = addDetailedEvent(
      'tso',
      'start_ts',
      'PD allocated start_ts',
      `The explicit pessimistic transaction starts at logical timestamp ${startTs}.`,
      {
        source: tidbId,
        target: 'pd-1',
        transactionId,
        dependsOn: [optimize.id],
        deltas: [{
          kind: 'tso_allocate',
          purpose: 'start_ts',
          timestamp: startTs,
        }],
        metadata: { startTs },
      },
    )
    const protocol = addDetailedEvent(
      'txn2pc',
      'protocol_selection',
      'Select classic two-phase commit',
      'Two Regions participate in transaction 2PC; each Region will use its own independent Raft group.',
      {
        source: tidbId,
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        transactionId,
        dependsOn: [start.id],
        metadata: {
          requested: '2pc',
          selected: '2pc',
          regionCount: 2,
          distinctLeaders: regions[0].leaderStoreId !== regions[1].leaderStoreId,
        },
      },
    )

    let previousLockEvent = protocol
    for (const projected of projectedRegions) {
      const raftIndexBefore = projected.region.commitIndex
      const previousStage = transactionProjection.stage
      transactionProjection.stage = 'locking'
      projected.pessimisticLock = {
        transactionId,
        leaderStoreId: projected.region.leaderStoreId,
        storage: 'leader_memory',
        replicated: false,
      }
      const lock = addDetailedEvent(
        'txn2pc',
        'pessimistic_lock',
        'Acquire leader-local pessimistic lock',
        `Region ${projected.region.id}'s leader keeps the lock in memory; no Raft entry is proposed.`,
        {
          source: tidbId,
          target: projected.region.leaderStoreId,
          regionId: projected.region.id,
          transactionId,
          dependsOn: [previousLockEvent.id],
          branchId: `region-${projected.region.id}`,
          deltas: [
            ...(previousStage === 'locking'
              ? []
              : [{
                kind: 'transaction_stage' as const,
                from: previousStage,
                to: 'locking' as const,
              }]),
            {
              kind: 'pessimistic_lock',
              action: 'acquire',
              regionId: projected.region.id,
              leaderStoreId: projected.region.leaderStoreId,
              storage: 'leader_memory',
            },
          ],
          metadata: {
            storage: 'leader_memory',
            replicated: false,
            raftIndexBefore,
            raftIndexAfter: projected.region.commitIndex,
          },
        },
      )
      previousLockEvent = lock
    }

    const commitRequested = addDetailedEvent(
      'txn2pc',
      'commit_requested',
      'COMMIT enters the 2PC coordinator',
      'TiDB chooses the first mutation as primary and dispatches both Region prewrites.',
      {
        source: tidbId,
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        transactionId,
        dependsOn: [previousLockEvent.id],
        metadata: {
          primaryRegionId: regions[0].id,
          secondaryRegionId: regions[1].id,
        },
      },
    )

    const previousStage = transactionProjection.stage
    transactionProjection.stage = 'prewriting'
    transaction.phase = 'prewriting'
    const branches = projectedRegions.map((projected, index) => {
      const role = index === 0 ? 'primary' : 'secondary'
      const branchId = `region-${projected.region.id}`
      const prewrite = addDetailedEvent(
        'txn2pc',
        'prewrite',
        `Dispatch ${role} prewrite`,
        `TiDB sends the ${role} mutation to Region ${projected.region.id}.`,
        {
          source: tidbId,
          target: projected.region.leaderStoreId,
          regionId: projected.region.id,
          transactionId,
          dependsOn: [commitRequested.id],
          branchId,
          deltas: index === 0
            ? [{
              kind: 'transaction_stage',
              from: previousStage,
              to: 'prewriting',
            }]
            : [],
          metadata: {
            primary: index === 0,
            primaryRegionId: regions[0].id,
            startTs,
          },
        },
      )
      return {
        projected,
        role,
        branchId,
        operation: 'prewrite' as const,
        index: projected.region.commitIndex + 1,
        terminal: prewrite,
      }
    })

    for (const branch of branches) {
      branch.projected.proposedIndex = branch.index
      branch.projected.persistedStoreIds = []
      branch.projected.acknowledgements = 0
      state.metrics.raftEntries++
      branch.terminal = addDetailedEvent(
        'raft',
        'raft_propose',
        'Propose prewrite to Region Raft',
        `Region ${branch.projected.region.id}'s leader proposes index ${branch.index}.`,
        {
          source: branch.projected.region.leaderStoreId,
          target: branch.projected.region.leaderStoreId,
          regionId: branch.projected.region.id,
          transactionId,
          dependsOn: [branch.terminal.id],
          branchId: branch.branchId,
          deltas: [{
            kind: 'raft_propose',
            regionId: branch.projected.region.id,
            index: branch.index,
            operation: 'prewrite',
          }],
          metadata: {
            term: branch.projected.region.term,
            index: branch.index,
            operation: 'prewrite',
          },
        },
      )
    }

    for (const branch of branches) {
      const region = branch.projected.region
      const leader = region.peers.find((peer) =>
        peer.storeId === region.leaderStoreId && peer.healthy,
      )
      const follower = region.peers.find((peer) =>
        peer.storeId !== region.leaderStoreId && peer.healthy,
      )
      if (!leader || !follower) {
        throw new Error(`Detailed scenario Region ${region.id} unexpectedly lost quorum.`)
      }
      leader.matchIndex = branch.index
      follower.matchIndex = branch.index
      branch.projected.persistedStoreIds = [leader.storeId, follower.storeId]
      branch.projected.acknowledgements = 2
      branch.terminal = addDetailedEvent(
        'raft',
        'raft_persist',
        'Persist Raft entry on two voters',
        `The leader and one follower persisted Region ${region.id} index ${branch.index}.`,
        {
          source: leader.storeId,
          target: follower.storeId,
          regionId: region.id,
          transactionId,
          dependsOn: [branch.terminal.id],
          branchId: branch.branchId,
          deltas: [{
            kind: 'raft_persist',
            regionId: region.id,
            index: branch.index,
            storeIds: [leader.storeId, follower.storeId],
          }],
          metadata: {
            index: branch.index,
            acknowledgements: 2,
            voters: 3,
          },
        },
      )
    }

    for (const branch of branches) {
      const region = branch.projected.region
      region.commitIndex = branch.index
      branch.terminal = addDetailedEvent(
        'raft',
        'quorum_commit',
        'Raft quorum commits prewrite',
        `Exactly 2 of 3 voters form the modeled quorum for Region ${region.id}.`,
        {
          source: branch.projected.persistedStoreIds[1],
          target: region.leaderStoreId,
          regionId: region.id,
          transactionId,
          dependsOn: [branch.terminal.id],
          branchId: branch.branchId,
          deltas: [{
            kind: 'raft_commit',
            regionId: region.id,
            index: branch.index,
            acknowledgements: 2,
            quorum: 2,
          }],
          metadata: {
            index: branch.index,
            acknowledgements: 2,
            voters: 3,
            quorum: 2,
            operation: 'prewrite',
          },
        },
      )
    }

    for (const branch of branches) {
      const region = branch.projected.region
      region.appliedIndex = branch.index
      for (const peer of region.peers) {
        if (branch.projected.persistedStoreIds.includes(peer.storeId)) {
          peer.appliedIndex = branch.index
        }
      }
      branch.terminal = addDetailedEvent(
        'raft',
        'raft_apply',
        'Apply committed prewrite',
        `Region ${region.id} applies committed index ${branch.index} to its KV state machine.`,
        {
          source: region.leaderStoreId,
          target: region.leaderStoreId,
          regionId: region.id,
          transactionId,
          dependsOn: [branch.terminal.id],
          branchId: branch.branchId,
          deltas: [{
            kind: 'raft_apply',
            regionId: region.id,
            index: branch.index,
          }],
          metadata: {
            index: branch.index,
            commitIndex: region.commitIndex,
            appliedIndex: region.appliedIndex,
            operation: 'prewrite',
          },
        },
      )
    }

    for (const branch of branches) {
      const projected = branch.projected
      projected.pessimisticLock = null
      projected.mvcc.defaultCf = 'value'
      projected.mvcc.lockCf = 'prewrite'
      projected.mvcc.startTs = startTs
      branch.terminal = addDetailedEvent(
        'kv',
        'mvcc_prewrite',
        'Materialize MVCC prewrite',
        `Region ${projected.region.id} writes the tentative value to default CF and the durable transaction lock to lock CF.`,
        {
          source: projected.region.leaderStoreId,
          target: projected.region.leaderStoreId,
          regionId: projected.region.id,
          transactionId,
          dependsOn: [branch.terminal.id],
          branchId: branch.branchId,
          deltas: [
            {
              kind: 'pessimistic_lock',
              action: 'release',
              regionId: projected.region.id,
              leaderStoreId: projected.region.leaderStoreId,
              storage: 'leader_memory',
            },
            {
              kind: 'mvcc',
              regionId: projected.region.id,
              cf: 'default',
              action: 'put',
              timestamp: startTs,
            },
            {
              kind: 'mvcc',
              regionId: projected.region.id,
              cf: 'lock',
              action: 'put',
              timestamp: startTs,
            },
          ],
          metadata: {
            defaultCf: 'value',
            lockCf: 'prewrite',
            writeCf: 'empty',
            primary: projected.mvcc.primary,
            startTs,
          },
        },
      )
    }

    const prewriteStage = transactionProjection.stage
    transactionProjection.stage = 'prewritten'
    const allPrewritten = addDetailedEvent(
      'txn2pc',
      'all_prewrite_complete',
      'Both Region prewrites completed',
      'The 2PC coordinator joins both independent Raft branches before requesting commit_ts.',
      {
        source: regions[1].leaderStoreId,
        target: tidbId,
        transactionId,
        dependsOn: branches.map((branch) => branch.terminal.id),
        deltas: [{
          kind: 'transaction_stage',
          from: prewriteStage,
          to: 'prewritten',
        }],
        metadata: {
          prewrittenRegions: 2,
          primaryRegionId: regions[0].id,
        },
      },
    )

    const commitTs = allocateTs()
    const prewrittenStage = transactionProjection.stage
    transactionProjection.stage = 'committing_primary'
    transactionProjection.commitTs = commitTs
    transaction.phase = 'committing'
    const commitTimestamp = addDetailedEvent(
      'tso',
      'commit_ts',
      'PD allocated commit_ts',
      `Only after both prewrites, PD allocates logical commit timestamp ${commitTs}.`,
      {
        source: tidbId,
        target: 'pd-1',
        transactionId,
        dependsOn: [allPrewritten.id],
        deltas: [
          {
            kind: 'tso_allocate',
            purpose: 'commit_ts',
            timestamp: commitTs,
          },
          {
            kind: 'transaction_stage',
            from: prewrittenStage,
            to: 'committing_primary',
          },
        ],
        metadata: { startTs, commitTs, prewrittenRegions: 2 },
      },
    )

    function appendSerialRaftOperation(
      projected: DetailedRegionProjection,
      operation: 'commit_primary' | 'commit_secondary',
      parent: TraceEvent,
      path: TracePath,
    ): TraceEvent {
      const branchId = `region-${projected.region.id}`
      const index = projected.region.commitIndex + 1
      projected.proposedIndex = index
      projected.persistedStoreIds = []
      projected.acknowledgements = 0
      state.metrics.raftEntries++
      let terminal = addDetailedEvent(
        'raft',
        'raft_propose',
        `Propose ${operation.replace('_', ' ')}`,
        `Region ${projected.region.id}'s leader proposes index ${index}.`,
        {
          source: projected.region.leaderStoreId,
          target: projected.region.leaderStoreId,
          regionId: projected.region.id,
          transactionId,
          dependsOn: [parent.id],
          branchId,
          path,
          deltas: [{
            kind: 'raft_propose',
            regionId: projected.region.id,
            index,
            operation,
          }],
          metadata: { index, operation, term: projected.region.term },
        },
      )
      const leader = projected.region.peers.find((peer) =>
        peer.storeId === projected.region.leaderStoreId && peer.healthy,
      )
      const follower = projected.region.peers.find((peer) =>
        peer.storeId !== projected.region.leaderStoreId && peer.healthy,
      )
      if (!leader || !follower) {
        throw new Error(`Detailed scenario Region ${projected.region.id} unexpectedly lost quorum.`)
      }
      leader.matchIndex = index
      follower.matchIndex = index
      projected.persistedStoreIds = [leader.storeId, follower.storeId]
      projected.acknowledgements = 2
      terminal = addDetailedEvent(
        'raft',
        'raft_persist',
        `Persist ${operation.replace('_', ' ')}`,
        `Two voters persisted Region ${projected.region.id} index ${index}.`,
        {
          source: leader.storeId,
          target: follower.storeId,
          regionId: projected.region.id,
          transactionId,
          dependsOn: [terminal.id],
          branchId,
          path,
          deltas: [{
            kind: 'raft_persist',
            regionId: projected.region.id,
            index,
            storeIds: [leader.storeId, follower.storeId],
          }],
          metadata: { index, operation, acknowledgements: 2, voters: 3 },
        },
      )
      projected.region.commitIndex = index
      terminal = addDetailedEvent(
        'raft',
        'quorum_commit',
        `Quorum commits ${operation.replace('_', ' ')}`,
        `Exactly 2 of 3 voters commit Region ${projected.region.id} index ${index}.`,
        {
          source: follower.storeId,
          target: leader.storeId,
          regionId: projected.region.id,
          transactionId,
          dependsOn: [terminal.id],
          branchId,
          path,
          deltas: [{
            kind: 'raft_commit',
            regionId: projected.region.id,
            index,
            acknowledgements: 2,
            quorum: 2,
          }],
          metadata: {
            index,
            operation,
            acknowledgements: 2,
            voters: 3,
            quorum: 2,
          },
        },
      )
      projected.region.appliedIndex = index
      for (const peer of projected.region.peers) {
        if (projected.persistedStoreIds.includes(peer.storeId)) {
          peer.appliedIndex = index
        }
      }
      return addDetailedEvent(
        'raft',
        'raft_apply',
        `Apply ${operation.replace('_', ' ')}`,
        `Region ${projected.region.id} applies committed index ${index}.`,
        {
          source: leader.storeId,
          target: leader.storeId,
          regionId: projected.region.id,
          transactionId,
          dependsOn: [terminal.id],
          branchId,
          path,
          deltas: [{
            kind: 'raft_apply',
            regionId: projected.region.id,
            index,
          }],
          metadata: {
            index,
            operation,
            commitIndex: projected.region.commitIndex,
            appliedIndex: projected.region.appliedIndex,
          },
        },
      )
    }

    const primary = projectedRegions[0]
    const primaryDispatch = addDetailedEvent(
      'txn2pc',
      'commit_primary',
      'Commit the primary',
      `The primary decision is sent to Region ${primary.region.id} first.`,
      {
        source: tidbId,
        target: primary.region.leaderStoreId,
        regionId: primary.region.id,
        transactionId,
        dependsOn: [commitTimestamp.id],
        branchId: `region-${primary.region.id}`,
        metadata: { commitTs, primary: true },
      },
    )
    const primaryApplied = appendSerialRaftOperation(
      primary,
      'commit_primary',
      primaryDispatch,
      'critical',
    )
    primary.mvcc.lockCf = 'empty'
    primary.mvcc.writeCf = 'commit'
    primary.mvcc.commitTs = commitTs
    transaction.phase = 'committed'
    transaction.commitTs = commitTs
    const primaryCommitted = addDetailedEvent(
      'kv',
      'mvcc_primary_commit',
      'Publish the primary commit record',
      `Region ${primary.region.id} removes the lock-CF entry and writes the commit record to write CF.`,
      {
        source: primary.region.leaderStoreId,
        target: tidbId,
        regionId: primary.region.id,
        transactionId,
        dependsOn: [primaryApplied.id],
        branchId: `region-${primary.region.id}`,
        deltas: [
          {
            kind: 'mvcc',
            regionId: primary.region.id,
            cf: 'lock',
            action: 'delete',
            timestamp: startTs,
          },
          {
            kind: 'mvcc',
            regionId: primary.region.id,
            cf: 'write',
            action: 'put',
            timestamp: commitTs,
          },
        ],
        metadata: {
          defaultCf: 'value',
          lockCf: 'empty',
          writeCf: 'commit',
          primary: true,
          startTs,
          commitTs,
        },
      },
    )

    const primaryStage = transactionProjection.stage
    transactionProjection.stage = 'client_acknowledged'
    transactionProjection.clientResponded = true
    const response = addDetailedEvent(
      'return',
      'complete',
      'Primary decision acknowledged to client',
      'The transaction is committed once the primary decision is durable; secondary cleanup continues in the background.',
      {
        source: tidbId,
        target: 'client',
        transactionId,
        dependsOn: [primaryCommitted.id],
        deltas: [
          {
            kind: 'transaction_stage',
            from: primaryStage,
            to: 'client_acknowledged',
          },
          {
            kind: 'client_response',
            committed: true,
          },
        ],
        metadata: { commitTs, secondaryCleanupPending: true },
      },
    )

    const secondary = projectedRegions[1]
    const responseStage = transactionProjection.stage
    transactionProjection.stage = 'committing_secondary'
    const secondaryDispatch = addDetailedEvent(
      'txn2pc',
      'commit_secondary',
      'Resolve the secondary after response',
      `Region ${secondary.region.id}'s secondary lock is committed off the client critical path.`,
      {
        source: tidbId,
        target: secondary.region.leaderStoreId,
        regionId: secondary.region.id,
        transactionId,
        dependsOn: [response.id],
        branchId: `region-${secondary.region.id}`,
        path: 'background',
        deltas: [{
          kind: 'transaction_stage',
          from: responseStage,
          to: 'committing_secondary',
        }],
        metadata: {
          commitTs,
          primary: false,
          clientAlreadyResponded: true,
        },
      },
    )
    const secondaryApplied = appendSerialRaftOperation(
      secondary,
      'commit_secondary',
      secondaryDispatch,
      'background',
    )
    secondary.mvcc.lockCf = 'empty'
    secondary.mvcc.writeCf = 'commit'
    secondary.mvcc.commitTs = commitTs
    const secondaryCommitted = addDetailedEvent(
      'kv',
      'mvcc_secondary_commit',
      'Publish the secondary commit record',
      `Region ${secondary.region.id} removes its lock-CF entry and writes the same commit decision to write CF.`,
      {
        source: secondary.region.leaderStoreId,
        target: secondary.region.leaderStoreId,
        regionId: secondary.region.id,
        transactionId,
        dependsOn: [secondaryApplied.id],
        branchId: `region-${secondary.region.id}`,
        path: 'background',
        deltas: [
          {
            kind: 'mvcc',
            regionId: secondary.region.id,
            cf: 'lock',
            action: 'delete',
            timestamp: startTs,
          },
          {
            kind: 'mvcc',
            regionId: secondary.region.id,
            cf: 'write',
            action: 'put',
            timestamp: commitTs,
          },
        ],
        metadata: {
          defaultCf: 'value',
          lockCf: 'empty',
          writeCf: 'commit',
          primary: false,
          startTs,
          commitTs,
        },
      },
    )
    const cleanupStage = transactionProjection.stage
    transactionProjection.stage = 'complete'
    addDetailedEvent(
      'txn2pc',
      'secondary_cleanup_complete',
      'Secondary cleanup complete',
      'Both Regions now expose commit records and retain no modeled transaction locks.',
      {
        source: secondary.region.leaderStoreId,
        target: tidbId,
        regionId: secondary.region.id,
        transactionId,
        dependsOn: [secondaryCommitted.id],
        branchId: `region-${secondary.region.id}`,
        path: 'background',
        deltas: [{
          kind: 'transaction_stage',
          from: cleanupStage,
          to: 'complete',
        }],
        metadata: {
          committedRegions: 2,
          remainingLocks: 0,
          clientAlreadyResponded: true,
        },
      },
    )

    state.metrics.statements++
    state.metrics.writes++
    state.metrics.commits++
    for (const region of regions) {
      region.sizeMiB += 0.05
      region.hotScore += 2
    }
    state.gc.obsoleteVersions += regions.length
    advanceGc()
    return recordReceipt(
      id,
      'cross-region-transaction',
      analysis,
      startTs,
      commitTs,
      'committed',
      '2pc',
      builder,
      warnings,
    )
  }

  /**
   * A composite Lock Lab trace with two clients. It deliberately ends each
   * successful lock sequence at an explicit commit handoff/summary boundary
   * instead of duplicating the model-2 2PC/Raft/MVCC vertical slice.
   */
  function traceLockDeadlockScenario(
    id: string,
    analysis: SqlAnalysis,
    regions: readonly [RegionState, RegionState],
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const clientA = 'client-a'
    const clientB = 'client-b'
    const tidbA = 'tidb-1'
    const tidbB = 'tidb-2'
    const resourceA = 'resource-a'
    const resourceB = 'resource-b'
    const detectorLeaderStoreId: StoreId = 'tikv-3'
    const retryBackoffMs = 120
    let lockLab: TraceLockLabSnapshot = createLockLabState(
      detectorLeaderStoreId,
      [
        {
          id: resourceA,
          regionId: regions[0].id,
          leaderStoreId: regions[0].leaderStoreId,
        },
        {
          id: resourceB,
          regionId: regions[1].id,
          leaderStoreId: regions[1].leaderStoreId,
        },
      ],
    )

    function projection(): TraceStateSnapshot {
      return freezeTraceSnapshot({
        modelVersion: state.modelVersion,
        tsoLastAllocated: state.tso.lastAllocated,
        /*
         * This is a multi-client receipt. The canonical transaction collection
         * lives under lockLab; leaving the legacy focus transaction null keeps
         * model-2 single-transaction consumers backward compatible.
         */
        transaction: null,
        regions: regions.map((region) => {
          const resource = lockLab.resources.find((candidate) =>
            candidate.regionId === region.id)
          return {
            regionId: region.id,
            leaderStoreId: region.leaderStoreId,
            term: region.term,
            proposedIndex: null,
            persistedStoreIds: [],
            acknowledgements: 0,
            quorum: 2,
            commitIndex: region.commitIndex,
            appliedIndex: region.appliedIndex,
            peers: region.peers.map((peer) => ({
              storeId: peer.storeId,
              raftRole: peer.raftRole,
              matchIndex: peer.matchIndex,
              appliedIndex: peer.appliedIndex,
              healthy: peer.healthy,
            })),
            pessimisticLock: resource?.holderTransactionId
              ? {
                transactionId: resource.holderTransactionId,
                leaderStoreId: region.leaderStoreId,
                resourceId: resource.id,
                storage: 'leader_memory' as const,
                replicated: false as const,
              }
              : null,
            mvcc: {
              defaultCf: 'empty' as const,
              lockCf: 'empty' as const,
              writeCf: 'empty' as const,
              startTs: null,
              commitTs: null,
              primary: region.id === regions[0].id,
            },
          }
        }),
        lockLab,
      })
    }

    function addLockEvent(
      domain: TraceDomain,
      kind: string,
      label: string,
      detail: string,
      options: EventOptions = {},
    ): TraceEvent {
      const deltas = options.deltas ?? []
      for (const delta of deltas) {
        if (isLockLabDelta(delta)) {
          lockLab = reduceLockLabState(lockLab, delta)
        }
      }
      return builder.add(domain, kind, label, detail, {
        ...options,
        path: options.path ?? 'critical',
        snapshot: projection(),
        deltas,
      })
    }

    function actualTransaction(transactionId: string): TransactionState {
      const transaction = state.transactions.find((candidate) =>
        candidate.id === transactionId)
      if (!transaction) throw new Error(`Missing Lock Lab transaction ${transactionId}.`)
      return transaction
    }

    const root = addLockEvent(
      'client',
      'lock_lab_start',
      'Two clients begin a synthetic Lock Lab',
      'The model uses only resource-a and resource-b; it retains no SQL text, row key, or value.',
      {
        source: 'client',
        target: 'tiproxy-1',
        metadata: {
          clients: 2,
          resources: 2,
          syntheticResources: true,
        },
      },
    )

    const transactionAId = `txn-${++transactionCounter}`
    const startTsA = allocateTs()
    state.transactions.push({
      id: transactionAId,
      mode: 'pessimistic',
      protocol: '2pc',
      startTs: startTsA,
      commitTs: null,
      regionIds: regions.map((region) => region.id),
      primaryRegionId: regions[0].id,
      phase: 'active',
      conflict: false,
      clientId: clientA,
      attempt: 1,
    })
    const beginA = addLockEvent(
      'tso',
      'start_ts',
      'PD allocated Client A start_ts',
      `Client A attempt 1 starts at logical timestamp ${startTsA}.`,
      {
        source: tidbA,
        target: 'pd-1',
        transactionId: transactionAId,
        dependsOn: [root.id],
        branchId: clientA,
        deltas: [
          {
            kind: 'tso_allocate',
            purpose: 'start_ts',
            timestamp: startTsA,
          },
          {
            kind: 'lock_transaction_begin',
            clientId: clientA,
            transactionId: transactionAId,
            attempt: 1,
            retryOfTransactionId: null,
            startTs: startTsA,
          },
        ],
        metadata: {
          clientId: clientA,
          attempt: 1,
          startTs: startTsA,
        },
      },
    )

    const transactionBId = `txn-${++transactionCounter}`
    const startTsB = allocateTs()
    state.transactions.push({
      id: transactionBId,
      mode: 'pessimistic',
      protocol: '2pc',
      startTs: startTsB,
      commitTs: null,
      regionIds: regions.map((region) => region.id),
      primaryRegionId: regions[1].id,
      phase: 'active',
      conflict: false,
      clientId: clientB,
      attempt: 1,
    })
    const beginB = addLockEvent(
      'tso',
      'start_ts',
      'PD allocated Client B start_ts',
      `Client B attempt 1 starts at logical timestamp ${startTsB}.`,
      {
        source: tidbB,
        target: 'pd-1',
        transactionId: transactionBId,
        dependsOn: [beginA.id],
        branchId: clientB,
        deltas: [
          {
            kind: 'tso_allocate',
            purpose: 'start_ts',
            timestamp: startTsB,
          },
          {
            kind: 'lock_transaction_begin',
            clientId: clientB,
            transactionId: transactionBId,
            attempt: 1,
            retryOfTransactionId: null,
            startTs: startTsB,
          },
        ],
        metadata: {
          clientId: clientB,
          attempt: 1,
          startTs: startTsB,
        },
      },
    )

    const initialRaftIndexes = new Map(regions.map((region) => [
      region.id,
      { commitIndex: region.commitIndex, appliedIndex: region.appliedIndex },
    ]))
    const acquireA = addLockEvent(
      'kv',
      'lock_acquired',
      'Client A acquired resource-a',
      `Region ${regions[0].id}'s leader stores the pessimistic lock only in memory.`,
      {
        source: tidbA,
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        transactionId: transactionAId,
        dependsOn: [beginB.id],
        branchId: clientA,
        deltas: [{
          kind: 'lock_owner',
          action: 'acquire',
          resourceId: resourceA,
          regionId: regions[0].id,
          transactionId: transactionAId,
          leaderStoreId: regions[0].leaderStoreId,
        }],
        metadata: {
          resourceId: resourceA,
          storage: 'leader_memory',
          replicated: false,
          raftIndexBefore: regions[0].commitIndex,
          raftIndexAfter: regions[0].commitIndex,
        },
      },
    )
    const acquireB = addLockEvent(
      'kv',
      'lock_acquired',
      'Client B acquired resource-b',
      `Region ${regions[1].id}'s leader stores the pessimistic lock only in memory.`,
      {
        source: tidbB,
        target: regions[1].leaderStoreId,
        regionId: regions[1].id,
        transactionId: transactionBId,
        dependsOn: [beginB.id],
        branchId: clientB,
        deltas: [{
          kind: 'lock_owner',
          action: 'acquire',
          resourceId: resourceB,
          regionId: regions[1].id,
          transactionId: transactionBId,
          leaderStoreId: regions[1].leaderStoreId,
        }],
        metadata: {
          resourceId: resourceB,
          storage: 'leader_memory',
          replicated: false,
          raftIndexBefore: regions[1].commitIndex,
          raftIndexAfter: regions[1].commitIndex,
        },
      },
    )

    const edgeAToB = 'wait-edge-a-to-b'
    const waitA = addLockEvent(
      'kv',
      'lock_wait_enqueued',
      'Client A waits for Client B',
      'resource-b queues Client A and registers the DATA_LOCK_WAITS direction A → B.',
      {
        status: 'warning',
        source: regions[1].leaderStoreId,
        target: detectorLeaderStoreId,
        regionId: regions[1].id,
        transactionId: transactionAId,
        dependsOn: [acquireA.id, acquireB.id],
        branchId: clientA,
        deltas: [
          {
            kind: 'lock_wait_queue',
            action: 'enqueue',
            resourceId: resourceB,
            transactionId: transactionAId,
            position: 0,
          },
          {
            kind: 'wait_for_edge',
            action: 'add',
            edgeId: edgeAToB,
            waiterTransactionId: transactionAId,
            holderTransactionId: transactionBId,
            resourceId: resourceB,
            regionId: regions[1].id,
          },
        ],
        metadata: {
          resourceId: resourceB,
          waiterTransactionId: transactionAId,
          holderTransactionId: transactionBId,
          direction: 'waiter_to_holder',
          queuePosition: 0,
        },
      },
    )
    state.metrics.lockWaits++

    const edgeBToA = 'wait-edge-b-to-a'
    const waitB = addLockEvent(
      'kv',
      'lock_wait_enqueued',
      'Client B waits for Client A',
      'resource-a queues Client B and registers B → A, closing a two-transaction cycle.',
      {
        status: 'warning',
        source: regions[0].leaderStoreId,
        target: detectorLeaderStoreId,
        regionId: regions[0].id,
        transactionId: transactionBId,
        dependsOn: [waitA.id],
        branchId: clientB,
        deltas: [
          {
            kind: 'lock_wait_queue',
            action: 'enqueue',
            resourceId: resourceA,
            transactionId: transactionBId,
            position: 0,
          },
          {
            kind: 'wait_for_edge',
            action: 'add',
            edgeId: edgeBToA,
            waiterTransactionId: transactionBId,
            holderTransactionId: transactionAId,
            resourceId: resourceA,
            regionId: regions[0].id,
          },
        ],
        metadata: {
          resourceId: resourceA,
          waiterTransactionId: transactionBId,
          holderTransactionId: transactionAId,
          direction: 'waiter_to_holder',
          queuePosition: 0,
        },
      },
    )
    state.metrics.lockWaits++

    const detectorLookup = addLockEvent(
      'kv',
      'deadlock_detector_lookup',
      'Locate the cluster-wide detector leader',
      `PD returns only the current detector leader location (${detectorLeaderStoreId}); no lock, key, or row data passes through PD.`,
      {
        source: regions[0].leaderStoreId,
        target: 'pd-1',
        regionId: regions[0].id,
        transactionId: transactionBId,
        dependsOn: [waitB.id],
        branchId: 'deadlock-detector',
        metadata: {
          detectorScope: 'cluster_wide',
          detectorLeaderStoreId,
          pdRole: 'leader_lookup_only',
          rowData: false,
        },
      },
    )

    const cycle = detectWaitForCycle(lockLab.waitForEdges, edgeBToA)
    if (!cycle) throw new Error('Lock Lab failed to detect its synthetic wait-for cycle.')
    const deadlockId = 'deadlock-1'
    const detected = addLockEvent(
      'kv',
      'deadlock_detected',
      'Cluster-wide detector found a cycle',
      'The detector followed B → A → B. This is a classic, non-retryable transaction deadlock.',
      {
        status: 'failed',
        source: regions[0].leaderStoreId,
        target: detectorLeaderStoreId,
        regionId: regions[0].id,
        transactionId: transactionBId,
        dependsOn: [detectorLookup.id],
        branchId: 'deadlock-detector',
        deltas: [{
          kind: 'deadlock_state',
          action: 'detect',
          deadlockId,
          cycleTransactionIds: cycle,
          victimTransactionId: null,
          selectionPolicy: 'cycle_closing_waiter_model_policy',
          retryable: false,
        }],
        metadata: {
          deadlockId,
          cycleLength: cycle.length - 1,
          retryable: false,
          detectorScope: 'cluster_wide',
        },
      },
    )
    state.metrics.deadlocks++
    state.metrics.conflicts++

    const victimSelected = addLockEvent(
      'kv',
      'deadlock_victim_selected',
      'Select Client B as victim (MODEL POLICY)',
      'TiCity selects the cycle-closing waiter for deterministic teaching. TiDB does not guarantee this general victim rule.',
      {
        status: 'failed',
        source: detectorLeaderStoreId,
        target: tidbB,
        regionId: regions[0].id,
        transactionId: transactionBId,
        dependsOn: [detected.id],
        branchId: clientB,
        deltas: [
          {
            kind: 'deadlock_state',
            action: 'select_victim',
            deadlockId,
            cycleTransactionIds: cycle,
            victimTransactionId: transactionBId,
            selectionPolicy: 'cycle_closing_waiter_model_policy',
            retryable: false,
          },
          {
            kind: 'lock_transaction_status',
            transactionId: transactionBId,
            from: 'waiting',
            to: 'victim',
          },
        ],
        metadata: {
          deadlockId,
          victimTransactionId: transactionBId,
          selectionPolicy: 'MODEL POLICY: cycle-closing waiter',
          retryable: false,
        },
      },
    )

    const victim = actualTransaction(transactionBId)
    victim.phase = 'rolled_back'
    victim.conflict = true
    const waiter = selectWaiterByStartTs(lockLab, resourceB)
    if (waiter !== transactionAId) {
      throw new Error('Lock Lab MODEL POLICY did not select the smallest start_ts.')
    }
    const victimRollback = addLockEvent(
      'txn2pc',
      'deadlock_victim_rollback',
      'Roll back Client B and wake Client A',
      'The whole classic-deadlock victim transaction ends. Releasing resource-b atomically applies TiCity’s smallest-start_ts MODEL POLICY so every published edge still names its current holder.',
      {
        status: 'failed',
        source: tidbB,
        target: regions[1].leaderStoreId,
        regionId: regions[1].id,
        transactionId: transactionBId,
        dependsOn: [victimSelected.id],
        branchId: clientB,
        deltas: [
          {
            kind: 'wait_for_edge',
            action: 'remove',
            edgeId: edgeBToA,
            waiterTransactionId: transactionBId,
            holderTransactionId: transactionAId,
            resourceId: resourceA,
            regionId: regions[0].id,
          },
          {
            kind: 'lock_wait_queue',
            action: 'dequeue',
            resourceId: resourceA,
            transactionId: transactionBId,
            position: 0,
          },
          {
            kind: 'wait_for_edge',
            action: 'remove',
            edgeId: edgeAToB,
            waiterTransactionId: transactionAId,
            holderTransactionId: transactionBId,
            resourceId: resourceB,
            regionId: regions[1].id,
          },
          {
            kind: 'lock_wait_queue',
            action: 'dequeue',
            resourceId: resourceB,
            transactionId: transactionAId,
            position: 0,
          },
          {
            kind: 'lock_owner',
            action: 'release',
            resourceId: resourceB,
            regionId: regions[1].id,
            transactionId: transactionBId,
            leaderStoreId: regions[1].leaderStoreId,
          },
          {
            kind: 'lock_owner',
            action: 'acquire',
            resourceId: resourceB,
            regionId: regions[1].id,
            transactionId: transactionAId,
            leaderStoreId: regions[1].leaderStoreId,
          },
          {
            kind: 'lock_transaction_status',
            transactionId: transactionBId,
            from: 'victim',
            to: 'rolled_back',
          },
        ],
        metadata: {
          errorCode: 1213,
          retryable: false,
          releasedResourceId: resourceB,
          wokenTransactionId: transactionAId,
          wakePolicy: 'smallest_start_ts_model_policy',
          raftIndexBefore: regions[1].commitIndex,
          raftIndexAfter: regions[1].commitIndex,
        },
      },
    )
    state.metrics.rollbacks++

    const resolved = addLockEvent(
      'kv',
      'deadlock_resolved',
      'Break the wait-for cycle',
      'Victim rollback removes both wait edges, transfers resource-b to Client A, and preserves the deadlock as diagnostic history.',
      {
        source: detectorLeaderStoreId,
        target: regions[1].leaderStoreId,
        transactionId: transactionBId,
        dependsOn: [victimRollback.id],
        branchId: 'deadlock-detector',
        deltas: [{
          kind: 'deadlock_state',
          action: 'resolve',
          deadlockId,
          cycleTransactionIds: cycle,
          victimTransactionId: transactionBId,
          selectionPolicy: 'cycle_closing_waiter_model_policy',
          retryable: false,
        }],
        metadata: {
          deadlockId,
          remainingWaitEdges: 0,
        },
      },
    )

    const error1213 = addLockEvent(
      'return',
      'deadlock_error_1213',
      'Return Error 1213 to Client B',
      'The non-retryable transaction boundary is complete. Any whole-transaction retry must begin in the application.',
      {
        status: 'failed',
        source: tidbB,
        target: clientB,
        transactionId: transactionBId,
        dependsOn: [victimRollback.id],
        branchId: clientB,
        metadata: {
          errorCode: 1213,
          retryable: false,
          transactionRolledBack: true,
          retryBoundary: 'application',
        },
      },
    )

    const retryBackoff = addLockEvent(
      'client',
      'application_retry_backoff',
      'Application schedules a fixed retry backoff',
      `Client B waits a representative ${retryBackoffMs} ms before starting a new whole transaction.`,
      {
        status: 'warning',
        source: clientB,
        target: clientB,
        transactionId: transactionBId,
        dependsOn: [error1213.id],
        branchId: clientB,
        durationMs: retryBackoffMs,
        deltas: [{
          kind: 'application_retry',
          action: 'schedule',
          clientId: clientB,
          retryOfTransactionId: transactionBId,
          fixedBackoffMs: retryBackoffMs,
          newTransactionId: null,
        }],
        metadata: {
          retrySource: 'application',
          fixedBackoffMs: retryBackoffMs,
          automaticTiDBRetry: false,
        },
      },
    )

    const wakeA = addLockEvent(
      'kv',
      'lock_waiter_woken',
      'Wake Client A by TiCity MODEL POLICY',
      'The atomic victim-release transition selected Client A by deterministic smallest start_ts and transferred resource-b in leader memory; this is not a TiDB fairness guarantee.',
      {
        source: regions[1].leaderStoreId,
        target: tidbA,
        regionId: regions[1].id,
        transactionId: transactionAId,
        dependsOn: [resolved.id],
        branchId: clientA,
        metadata: {
          resourceId: resourceB,
          wakePolicy: 'smallest_start_ts_model_policy',
          selectedStartTs: startTsA,
          raftIndexBefore: regions[1].commitIndex,
          raftIndexAfter: regions[1].commitIndex,
        },
      },
    )

    const handoffA = addLockEvent(
      'txn2pc',
      'commit_handoff',
      'Hand Client A to the commit model',
      'Lock Lab stops at the commit boundary; the detailed 2PC/Raft/MVCC mechanism remains the cross-Region Transaction Lab contract.',
      {
        source: tidbA,
        target: regions[0].leaderStoreId,
        transactionId: transactionAId,
        dependsOn: [wakeA.id],
        branchId: clientA,
        deltas: [{
          kind: 'lock_transaction_status',
          transactionId: transactionAId,
          from: 'active',
          to: 'commit_handoff',
        }],
        metadata: {
          commitMechanism: 'summary_boundary',
          detailedScenario: 'cross-region-transaction',
          raftModeledHere: false,
        },
      },
    )

    const commitTsA = allocateTs()
    const transactionA = actualTransaction(transactionAId)
    transactionA.phase = 'committed'
    transactionA.commitTs = commitTsA
    const summaryA = addLockEvent(
      'txn2pc',
      'commit_summary',
      'Client A commit completed',
      'The summary records a successful handoff without replaying the detailed commit internals.',
      {
        source: regions[0].leaderStoreId,
        target: tidbA,
        transactionId: transactionAId,
        dependsOn: [handoffA.id],
        branchId: clientA,
        deltas: [
          {
            kind: 'tso_allocate',
            purpose: 'commit_ts',
            timestamp: commitTsA,
          },
          {
            kind: 'lock_transaction_status',
            transactionId: transactionAId,
            from: 'commit_handoff',
            to: 'completed',
            commitTs: commitTsA,
          },
        ],
        metadata: {
          committed: true,
          commitTs: commitTsA,
          commitMechanism: 'summary_boundary',
        },
      },
    )
    state.metrics.commits++

    const releaseA = addLockEvent(
      'kv',
      'lock_release_after_commit',
      'Release Client A locks after commit',
      'Both synthetic leader-memory resources become available after the commit summary.',
      {
        source: tidbA,
        target: regions[1].leaderStoreId,
        transactionId: transactionAId,
        dependsOn: [summaryA.id],
        branchId: clientA,
        deltas: [
          {
            kind: 'lock_owner',
            action: 'release',
            resourceId: resourceA,
            regionId: regions[0].id,
            transactionId: transactionAId,
            leaderStoreId: regions[0].leaderStoreId,
          },
          {
            kind: 'lock_owner',
            action: 'release',
            resourceId: resourceB,
            regionId: regions[1].id,
            transactionId: transactionAId,
            leaderStoreId: regions[1].leaderStoreId,
          },
        ],
        metadata: {
          releasedResources: 2,
          raftModeledHere: false,
        },
      },
    )

    const retryTransactionId = `txn-${++transactionCounter}`
    const retryStartTs = allocateTs()
    state.transactions.push({
      id: retryTransactionId,
      mode: 'pessimistic',
      protocol: '2pc',
      startTs: retryStartTs,
      commitTs: null,
      regionIds: regions.map((region) => region.id),
      primaryRegionId: regions[0].id,
      phase: 'active',
      conflict: false,
      clientId: clientB,
      attempt: 2,
      retryOfTransactionId: transactionBId,
    })
    const retryBegin = addLockEvent(
      'tso',
      'application_retry_begin',
      'Client B starts a new transaction',
      `Application attempt 2 receives a fresh transaction ID and start_ts ${retryStartTs}.`,
      {
        source: tidbB,
        target: 'pd-1',
        transactionId: retryTransactionId,
        dependsOn: [retryBackoff.id, releaseA.id],
        branchId: clientB,
        deltas: [
          {
            kind: 'tso_allocate',
            purpose: 'start_ts',
            timestamp: retryStartTs,
          },
          {
            kind: 'application_retry',
            action: 'begin',
            clientId: clientB,
            retryOfTransactionId: transactionBId,
            fixedBackoffMs: retryBackoffMs,
            newTransactionId: retryTransactionId,
          },
          {
            kind: 'lock_transaction_begin',
            clientId: clientB,
            transactionId: retryTransactionId,
            attempt: 2,
            retryOfTransactionId: transactionBId,
            startTs: retryStartTs,
          },
        ],
        metadata: {
          retrySource: 'application',
          attempt: 2,
          retryOfTransactionId: transactionBId,
          freshTransactionId: true,
          startTs: retryStartTs,
        },
      },
    )
    state.metrics.retries++

    const retryAcquireA = addLockEvent(
      'kv',
      'retry_lock_acquired',
      'Retry acquired resource-a first',
      'Attempt 2 uses the same canonical A → B resource order as Client A.',
      {
        source: tidbB,
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        transactionId: retryTransactionId,
        dependsOn: [retryBegin.id],
        branchId: clientB,
        deltas: [{
          kind: 'lock_owner',
          action: 'acquire',
          resourceId: resourceA,
          regionId: regions[0].id,
          transactionId: retryTransactionId,
          leaderStoreId: regions[0].leaderStoreId,
        }],
        metadata: {
          resourceId: resourceA,
          acquisitionOrder: 1,
          storage: 'leader_memory',
          raftIndexBefore: regions[0].commitIndex,
          raftIndexAfter: regions[0].commitIndex,
        },
      },
    )

    const retryAcquireB = addLockEvent(
      'kv',
      'retry_lock_acquired',
      'Retry acquired resource-b second',
      'The consistent resource order introduces no wait-for edge or cycle.',
      {
        source: tidbB,
        target: regions[1].leaderStoreId,
        regionId: regions[1].id,
        transactionId: retryTransactionId,
        dependsOn: [retryAcquireA.id],
        branchId: clientB,
        deltas: [{
          kind: 'lock_owner',
          action: 'acquire',
          resourceId: resourceB,
          regionId: regions[1].id,
          transactionId: retryTransactionId,
          leaderStoreId: regions[1].leaderStoreId,
        }],
        metadata: {
          resourceId: resourceB,
          acquisitionOrder: 2,
          storage: 'leader_memory',
          raftIndexBefore: regions[1].commitIndex,
          raftIndexAfter: regions[1].commitIndex,
        },
      },
    )

    const retryHandoff = addLockEvent(
      'txn2pc',
      'commit_handoff',
      'Hand retry attempt to the commit model',
      'The Lock Lab again records only the explicit summary boundary.',
      {
        source: tidbB,
        target: regions[0].leaderStoreId,
        transactionId: retryTransactionId,
        dependsOn: [retryAcquireB.id],
        branchId: clientB,
        deltas: [{
          kind: 'lock_transaction_status',
          transactionId: retryTransactionId,
          from: 'active',
          to: 'commit_handoff',
        }],
        metadata: {
          attempt: 2,
          commitMechanism: 'summary_boundary',
          detailedScenario: 'cross-region-transaction',
          raftModeledHere: false,
        },
      },
    )

    const retryCommitTs = allocateTs()
    const retryTransaction = actualTransaction(retryTransactionId)
    retryTransaction.phase = 'committed'
    retryTransaction.commitTs = retryCommitTs
    const retrySummary = addLockEvent(
      'txn2pc',
      'commit_summary',
      'Application retry commit completed',
      'Attempt 2 completed after acquiring both resources in a consistent order.',
      {
        source: regions[0].leaderStoreId,
        target: tidbB,
        transactionId: retryTransactionId,
        dependsOn: [retryHandoff.id],
        branchId: clientB,
        deltas: [
          {
            kind: 'tso_allocate',
            purpose: 'commit_ts',
            timestamp: retryCommitTs,
          },
          {
            kind: 'lock_transaction_status',
            transactionId: retryTransactionId,
            from: 'commit_handoff',
            to: 'completed',
            commitTs: retryCommitTs,
          },
        ],
        metadata: {
          committed: true,
          attempt: 2,
          commitTs: retryCommitTs,
          commitMechanism: 'summary_boundary',
        },
      },
    )
    state.metrics.commits++

    const retryRelease = addLockEvent(
      'kv',
      'lock_release_after_commit',
      'Release retry locks after commit',
      'The retry leaves no synthetic owner, waiter, or wait-for edge.',
      {
        source: tidbB,
        target: regions[1].leaderStoreId,
        transactionId: retryTransactionId,
        dependsOn: [retrySummary.id],
        branchId: clientB,
        deltas: [
          {
            kind: 'lock_owner',
            action: 'release',
            resourceId: resourceA,
            regionId: regions[0].id,
            transactionId: retryTransactionId,
            leaderStoreId: regions[0].leaderStoreId,
          },
          {
            kind: 'lock_owner',
            action: 'release',
            resourceId: resourceB,
            regionId: regions[1].id,
            transactionId: retryTransactionId,
            leaderStoreId: regions[1].leaderStoreId,
          },
        ],
        metadata: {
          releasedResources: 2,
          attempt: 2,
          raftModeledHere: false,
        },
      },
    )

    addLockEvent(
      'return',
      'lock_lab_summary',
      'Lock Lab completed',
      'One victim rolled back, Client A completed, and Client B completed as a fresh application retry.',
      {
        source: tidbB,
        target: 'client',
        transactionId: retryTransactionId,
        dependsOn: [retryRelease.id],
        branchId: clientB,
        deltas: [{
          kind: 'application_retry',
          action: 'complete',
          clientId: clientB,
          retryOfTransactionId: transactionBId,
          fixedBackoffMs: retryBackoffMs,
          newTransactionId: retryTransactionId,
        }],
        metadata: {
          committedTransactions: 2,
          rolledBackTransactions: 1,
          remainingLocks: 0,
          remainingWaitEdges: 0,
          retrySource: 'application',
        },
      },
    )

    for (const region of regions) {
      const initial = initialRaftIndexes.get(region.id)
      if (
        !initial ||
        region.commitIndex !== initial.commitIndex ||
        region.appliedIndex !== initial.appliedIndex
      ) {
        throw new Error(`Lock Lab unexpectedly advanced Region ${region.id} Raft indexes.`)
      }
    }
    state.metrics.statements += 3
    state.metrics.writes += 3
    trimTransactions()
    advanceGc()
    return recordReceipt(
      id,
      'lock-deadlock',
      analysis,
      null,
      null,
      'succeeded',
      null,
      builder,
      warnings,
    )
  }

  function traceWrite(
    id: string,
    request: TraceRequest,
    scenarioId: ScenarioId | null,
    regions: RegionState[],
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const { analysis } = request
    const proxyId = state.topology.tiproxy[state.metrics.statements % 2].id
    const tidbId = state.topology.tidb[state.metrics.statements % 3].id
    appendCommonStart(builder, analysis, proxyId, tidbId)
    if (scenarioId === 'gc-safe-point') {
      const blocker = state.transactions.find((transaction) =>
        transaction.phase === 'active' &&
        transaction.startTs === state.gc.blockedByStartTs,
      )
      const blockedRegion = blocker
        ? state.regions.find((region) => region.id === blocker.primaryRegionId)
        : undefined
      builder.add(
        'kv',
        'gc_safe_point_blocked',
        'Active transaction holds the GC safe point',
        'TiDB v8.5 considers active transaction start_ts. The default 86,400-second tidb_gc_max_wait_time is documented but not elapsed on this short teaching clock.',
        {
          status: 'warning',
          source: 'gc-worker',
          target: blockedRegion?.leaderStoreId ?? tidbId,
          regionId: blockedRegion?.id,
          transactionId: blocker?.id,
          metadata: {
            blockedByStartTs: state.gc.blockedByStartTs ?? 0,
            gcMaxWaitSeconds: 86_400,
          },
        },
      )
    }
    if (scenarioId === 'hotspot-split') {
      const hot = regions.find((region) => region.id === 35)
      if (hot && hot.sizeMiB >= state.controls.regionSplitThresholdMiB) {
        splitRegion(hot.id, builder)
      }
    }
    const protocol = resolvedProtocol(
      request.forceProtocol ?? state.controls.commitProtocol,
      regions.length,
      warnings,
    )
    const startTs = allocateTs()
    const transaction: TransactionState = {
      id: `txn-${++transactionCounter}`,
      mode: state.controls.transactionMode,
      protocol,
      startTs,
      commitTs: null,
      regionIds: regions.map((region) => region.id),
      primaryRegionId: regions[0].id,
      phase: 'active',
      conflict: Boolean(request.forceConflict),
    }
    state.transactions.push(transaction)
    trimTransactions()
    builder.add(
      'tso',
      'start_ts',
      'PD allocated start_ts',
      `Transaction ${transaction.id} starts at ${startTs}.`,
      {
        source: tidbId,
        target: 'pd-1',
        transactionId: transaction.id,
        metadata: { startTs },
      },
    )
    builder.add(
      'txn2pc',
      'protocol_selection',
      'Select commit protocol',
      `The modeled eligibility rules selected ${protocol}.`,
      {
        source: tidbId,
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        transactionId: transaction.id,
        metadata: {
          requested: request.forceProtocol ?? state.controls.commitProtocol,
          selected: protocol,
          regionCount: regions.length,
        },
      },
    )

    if (transaction.mode === 'pessimistic') {
      for (const region of regions) {
        if (!ensureLeader(region, builder)) {
          failTransaction(
            transaction,
            builder,
            tidbId,
            warnings,
            `Region ${region.id} has no available leader for its in-memory pessimistic lock.`,
          )
          addReturn(builder, false, tidbId)
          state.metrics.statements++
          state.metrics.writes++
          return recordReceipt(
            id,
            scenarioId,
            analysis,
            startTs,
            null,
            'rolled_back',
            protocol,
            builder,
            warnings,
          )
        }
        const raftIndexBefore = region.commitIndex
        builder.add(
          'txn2pc',
          'pessimistic_lock',
          'Acquire leader-local pessimistic lock',
          `Transaction ${transaction.id} locks its key in Region ${region.id}'s leader memory without Raft replication.`,
          {
            source: tidbId,
            target: region.leaderStoreId,
            regionId: region.id,
            transactionId: transaction.id,
            metadata: {
              storage: 'leader_memory',
              replicated: false,
              raftIndexBefore,
              raftIndexAfter: region.commitIndex,
            },
          },
        )
      }
    }

    if (request.forceConflict) {
      transaction.phase = 'prewriting'
      transaction.conflict = true
      builder.add(
        'txn2pc',
        'write_conflict',
        'Optimistic prewrite conflict',
        'A newer committed version has a commit_ts greater than this transaction start_ts.',
        {
          status: 'failed',
          source: regions[0].leaderStoreId,
          target: tidbId,
          regionId: regions[0].id,
          transactionId: transaction.id,
          metadata: { startTs },
        },
      )
      state.metrics.conflicts++
      failTransaction(
        transaction,
        builder,
        tidbId,
        warnings,
        'COMMIT failed because optimistic conflict detection found a newer version.',
      )
      addReturn(builder, false, tidbId)
      state.metrics.statements++
      state.metrics.writes++
      return recordReceipt(
        id,
        scenarioId,
        analysis,
        startTs,
        null,
        'rolled_back',
        protocol,
        builder,
        warnings,
      )
    }

    let commitTs: number | null = null
    let returnedToClient = false
    if (protocol === '1pc') {
      transaction.phase = 'committing'
      commitTs = allocateTs()
      builder.add(
        'txn2pc',
        'one_phase_commit',
        'One-phase commit',
        'The single eligible Region persists mutation and commit state in one Raft entry.',
        {
          source: tidbId,
          target: regions[0].leaderStoreId,
          regionId: regions[0].id,
          transactionId: transaction.id,
          metadata: { startTs, commitTs },
        },
      )
      if (!raftMutation(regions[0], 'one_phase_commit', transaction, tidbId, builder)) {
        failTransaction(
          transaction,
          builder,
          tidbId,
          warnings,
          `Region ${regions[0].id} lost quorum during one-phase commit.`,
        )
        commitTs = null
      }
    } else {
      transaction.phase = 'prewriting'
      const minCommitTs = protocol === 'async_commit' ? allocateTs() : null
      if (minCommitTs !== null) {
        builder.add(
          'tso',
          'min_commit_ts',
          'Get latest timestamp for Async Commit',
          `The modeled prewrite carries min_commit_ts ${minCommitTs}; there is no later Get_commit_ts on the client critical path.`,
          {
            source: tidbId,
            target: 'pd-1',
            transactionId: transaction.id,
            metadata: { startTs, minCommitTs },
          },
        )
      }
      for (const region of regions) {
        builder.add(
          'txn2pc',
          'prewrite',
          'Transaction prewrite',
          `Write lock and tentative value for ${transaction.id} in Region ${region.id}.`,
          {
            source: tidbId,
            target: region.leaderStoreId,
            regionId: region.id,
            transactionId: transaction.id,
            metadata: {
              primaryRegionId: transaction.primaryRegionId,
              startTs,
              ...(minCommitTs === null
                ? {}
                : { minCommitTs, asyncCommit: true }),
            },
          },
        )
        if (!raftMutation(region, 'prewrite', transaction, tidbId, builder)) {
          failTransaction(
            transaction,
            builder,
            tidbId,
            warnings,
            `Region ${region.id} lost quorum during prewrite.`,
          )
          addReturn(builder, false, tidbId)
          state.metrics.statements++
          state.metrics.writes++
          return recordReceipt(
            id,
            scenarioId,
            analysis,
            startTs,
            null,
            'rolled_back',
            protocol,
            builder,
            warnings,
          )
        }
      }

      transaction.phase = 'committing'
      if (protocol === 'async_commit') {
        commitTs = minCommitTs
        builder.add(
          'txn2pc',
          'async_commit_decision',
          'Prewrite established Async Commit',
          `All modeled prewrites persisted the primary, secondaries, and min_commit_ts; commit_ts is ${commitTs}.`,
          {
            source: regions[0].leaderStoreId,
            target: tidbId,
            regionId: regions[0].id,
            transactionId: transaction.id,
            metadata: { commitTs: commitTs ?? startTs },
          },
        )
        addReturn(builder, true, tidbId)
        returnedToClient = true

        for (const region of regions) {
          builder.add(
            'txn2pc',
            'commit_background',
            'Commit mutation in background',
            `After the client response, resolve the Async Commit lock in Region ${region.id}.`,
            {
              source: tidbId,
              target: region.leaderStoreId,
              regionId: region.id,
              transactionId: transaction.id,
              path: 'background',
              metadata: {
                commitTs: commitTs ?? startTs,
                criticalPath: false,
              },
            },
          )
          if (!raftMutation(
            region,
            'commit_background',
            transaction,
            tidbId,
            builder,
            'background',
          )) {
            warnings.push(
              `Region ${region.id} needs later lock resolution after the Async Commit response.`,
            )
          }
        }
      } else {
        commitTs = allocateTs()
        builder.add(
          'tso',
          'commit_ts',
          'PD allocated commit_ts',
          `commit_ts ${commitTs} is greater than start_ts ${startTs}.`,
          {
            source: tidbId,
            target: 'pd-1',
            transactionId: transaction.id,
            metadata: { startTs, commitTs },
          },
        )

        const primary = regions[0]
        builder.add(
          'txn2pc',
          'commit_primary',
          'Commit primary',
          `Commit the primary lock in Region ${primary.id}.`,
          {
            source: tidbId,
            target: primary.leaderStoreId,
            regionId: primary.id,
            transactionId: transaction.id,
            metadata: { commitTs },
          },
        )
        if (!raftMutation(primary, 'commit_primary', transaction, tidbId, builder)) {
          failTransaction(
            transaction,
            builder,
            tidbId,
            warnings,
            `Primary Region ${primary.id} lost quorum during commit.`,
          )
          commitTs = null
        } else {
          for (const region of regions.slice(1)) {
            builder.add(
              'txn2pc',
              'commit_secondary',
              'Commit secondary',
              `Resolve the secondary lock in Region ${region.id}.`,
              {
                source: tidbId,
                target: region.leaderStoreId,
                regionId: region.id,
                transactionId: transaction.id,
                metadata: { commitTs },
              },
            )
            if (!raftMutation(region, 'commit_secondary', transaction, tidbId, builder)) {
              warnings.push(
                `Secondary Region ${region.id} remains locked for asynchronous resolution.`,
              )
            }
          }
        }
      }
    }

    const committed = commitTs !== null
    if (commitTs !== null) {
      transaction.phase = 'committed'
      transaction.commitTs = commitTs
      state.metrics.commits++
      for (const region of regions) {
        region.sizeMiB += 0.05
        region.hotScore += 2
      }
      state.gc.obsoleteVersions += Math.max(1, regions.length)
      if (analysis.table === 'events') {
        enqueueTiFlash(commitTs, Math.max(1, regions.length))
      }
    }
    if (!returnedToClient) addReturn(builder, committed, tidbId)
    state.metrics.statements++
    state.metrics.writes++
    advanceGc()
    return recordReceipt(
      id,
      scenarioId,
      analysis,
      startTs,
      commitTs,
      committed ? 'committed' : 'rolled_back',
      protocol,
      builder,
      warnings,
    )
  }

  function requestTrace(request: TraceRequest): TraceReceipt | null {
    const { analysis } = request
    if (analysis.status !== 'supported') return null
    const scenarioId = request.scenarioId ?? state.scenario
    const id = `trace-${++receiptCounter}`
    const builder = new TraceBuilder(id, state.controls.networkLatencyMs)
    const warnings: string[] = []

    const regionIds = asRegionIds(request.regionIds, analysis, state.regions)
    let regions = regionIds
      .map((regionId) => state.regions.find((region) => region.id === regionId))
      .filter((region): region is RegionState => Boolean(region))
    if (
      (scenarioId === 'cross-region-transaction' || scenarioId === 'lock-deadlock') &&
      regions.length > 0
    ) {
      const first = regions[0]
      const second = regions.find((region) =>
        region.id !== first.id && region.leaderStoreId !== first.leaderStoreId,
      ) ?? state.regions.find((region) =>
        region.id !== first.id && region.leaderStoreId !== first.leaderStoreId,
      )
      regions = second ? [first, second] : regions
    }
    if (regions.length === 0) {
      warnings.push('No representative Region matched this request.')
      return recordReceipt(
        id,
        scenarioId,
        analysis,
        null,
        null,
        'failed',
        null,
        builder,
        warnings,
      )
    }

    if (analysis.kind === 'explain') {
      return traceExplain(id, analysis, scenarioId, builder, warnings)
    }
    if (analysis.readOnly) {
      return traceRead(id, analysis, scenarioId, regions, builder, warnings)
    }
    if (
      scenarioId === 'lock-deadlock' &&
      regions.length === 2 &&
      state.controls.transactionMode === 'pessimistic'
    ) {
      return traceLockDeadlockScenario(
        id,
        analysis,
        [regions[0], regions[1]],
        builder,
        warnings,
      )
    }
    if (
      scenarioId === 'cross-region-transaction' &&
      regions.length === 2 &&
      state.controls.transactionMode === 'pessimistic' &&
      (request.forceProtocol ?? state.controls.commitProtocol) === '2pc'
    ) {
      return traceDetailedCrossRegionTransaction(
        id,
        analysis,
        [regions[0], regions[1]],
        builder,
        warnings,
      )
    }
    return traceWrite(id, request, scenarioId, regions, builder, warnings)
  }

  function submitSql(sql: string): SqlSubmission {
    const analysis = analyzeSql(sql)
    return {
      analysis,
      receipt: analysis.status === 'supported'
        ? requestTrace({ analysis })
        : null,
    }
  }

  function setControl<K extends keyof TiDBControls>(
    key: K,
    value: TiDBControls[K],
  ): void {
    let normalized: TiDBControls[K] = value
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new RangeError(`${key} must be finite.`)
      const limits: Partial<Record<keyof TiDBControls, readonly [number, number]>> = {
        qps: [0, 5_000],
        writeRatio: [0, 1],
        regionSplitThresholdMiB: [8, 512],
        gcLifetimeSeconds: [1, 86_400],
        networkLatencyMs: [0, 5_000],
        tiflashLagSeconds: [0, 3_600],
        playbackSpeed: [0.1, 20],
      }
      const range = limits[key]
      if (range) normalized = clamp(value, range[0], range[1]) as TiDBControls[K]
    }
    state.controls[key] = normalized
  }

  function reset(): void {
    const fresh = makeInitialState(seed)
    Object.assign(state, fresh)
    rng.reset(seed)
    accumulator = 0
    workloadCredit = 0
    sequentialKey = KEYSPACE_END - 100_000
    receiptCounter = 0
    transactionCounter = 0
    tiflashQueue = []
  }

  function runScenario(id: ScenarioId): TraceReceipt {
    reset()
    const scenario = getScenario(id)
    state.scenario = id
    for (const [key, value] of Object.entries(scenario.controls)) {
      setControl(
        key as keyof TiDBControls,
        value as TiDBControls[keyof TiDBControls],
      )
    }

    if (id === 'hotspot-split') {
      const hot = state.regions.find((region) => region.id === 35)
      if (hot) {
        hot.sizeMiB = state.controls.regionSplitThresholdMiB + 8
        hot.hotScore = 100
      }
    } else if (id === 'tikv-failover') {
      markStoreDown('tikv-1')
    } else if (id === 'gc-safe-point') {
      const oldStart = allocateTs()
      const blocker: TransactionState = {
        id: `txn-${++transactionCounter}`,
        mode: 'pessimistic',
        protocol: '2pc',
        startTs: oldStart,
        commitTs: null,
        regionIds: [8],
        primaryRegionId: 8,
        phase: 'active',
        conflict: false,
      }
      state.transactions.push(blocker)
      state.gc.obsoleteVersions = 1_000
      state.gc.backlog = 1_000
      advanceGc()
    }

    const analysis = analyzeSql(scenario.sql)
    if (id === 'commit-protocols') {
      const variants = [
        { regionIds: [24], forceProtocol: '1pc' },
        { regionIds: [24, 25], forceProtocol: 'async_commit' },
        { regionIds: [24, 25, 26], forceProtocol: '2pc' },
      ] as const
      const receipts = variants.map((variant) => requestTrace({
        analysis,
        scenarioId: id,
        regionIds: variant.regionIds,
        forceProtocol: variant.forceProtocol,
      }))
      if (receipts.some((receipt) => receipt === null)) {
        throw new Error(`Scenario ${id} contains unsupported SQL.`)
      }
      return combineProtocolReceipts(
        analysis,
        receipts as readonly TraceReceipt[],
      )
    }
    const receipt = requestTrace({
      analysis,
      scenarioId: id,
      regionIds: scenario.regionIds,
      forceProtocol: scenario.forceProtocol,
      forceConflict: scenario.forceConflict,
    })
    if (!receipt) throw new Error(`Scenario ${id} contains unsupported SQL.`)
    return receipt
  }

  function update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be a non-negative finite number.')
    }
    if (state.controls.paused || deltaSeconds === 0) return
    accumulator += deltaSeconds * state.controls.playbackSpeed
    while (accumulator + 1e-12 >= fixedStepSeconds) {
      fixedStep()
      accumulator -= fixedStepSeconds
      if (accumulator < 0 && accumulator > -1e-10) accumulator = 0
    }
  }

  function setPlayback(mode: TiCityState['playback']): void {
    state.playback = mode
    if (mode === 'step') {
      /*
       * "Step" advances one deterministic model quantum and then holds both
       * workload and trace animation. Selecting slow/live resumes playback.
       */
      state.controls.paused = false
      fixedStep()
      state.controls.paused = true
      return
    }
    state.controls.paused = false
    state.controls.playbackSpeed = mode === 'slow' ? 1 : 4
  }

  return {
    state,
    update,
    setControl,
    runScenario,
    submitSql,
    requestTrace,
    setPlayback,
    reset,
  }
}
