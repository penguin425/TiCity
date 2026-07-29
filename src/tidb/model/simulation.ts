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
  TiDBCityState,
  TiDBControls,
  TiDBSimulationApi,
  TiDBSimulationOptions,
  TraceDomain,
  TraceEvent,
  TraceEventStatus,
  TraceMetadataValue,
  TraceOutcome,
  TraceReceipt,
  TraceRequest,
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

interface EventOptions {
  durationMs?: number
  status?: TraceEventStatus
  source?: string
  target?: string
  regionId?: number
  transactionId?: string
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

class TraceBuilder {
  readonly events: TraceEvent[] = []
  private cursorMs = 0

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
  ): void {
    const durationMs = options.durationMs ?? Math.max(8, this.networkLatencyMs)
    const event: TraceEvent = Object.freeze({
      id: `${this.receiptId}-event-${this.events.length + 1}`,
      atMs: this.cursorMs,
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
      metadata: Object.freeze({ ...(options.metadata ?? {}) }),
    })
    this.events.push(event)
    this.cursorMs += durationMs
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

function createMetrics(): TiDBCityState['metrics'] {
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

function makeInitialState(seed: number): TiDBCityState {
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

  function ensureLeader(region: RegionState, builder?: TraceBuilder): boolean {
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
  ): boolean {
    if (!ensureLeader(region, builder)) {
      builder.add(
        'raft',
        'quorum_unavailable',
        'Raft quorum unavailable',
        `Region ${region.id} has no live leader.`,
        {
          status: 'failed',
          regionId: region.id,
          transactionId,
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
        metadata: { operation },
      },
    )
    return replicateRaft(region, operation, transaction.id, builder)
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
        builder.add(
          'txn2pc',
          'pessimistic_lock',
          'Acquire pessimistic lock',
          `Transaction ${transaction.id} locks its key in Region ${region.id}.`,
          {
            source: tidbId,
            target: region.leaderStoreId,
            regionId: region.id,
            transactionId: transaction.id,
          },
        )
        if (!raftMutation(region, 'pessimistic_lock', transaction, tidbId, builder)) {
          failTransaction(
            transaction,
            builder,
            tidbId,
            warnings,
            `Region ${region.id} could not replicate the pessimistic lock.`,
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
              metadata: {
                commitTs: commitTs ?? startTs,
                criticalPath: false,
              },
            },
          )
          if (!raftMutation(region, 'commit_background', transaction, tidbId, builder)) {
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
    const regions = regionIds
      .map((regionId) => state.regions.find((region) => region.id === regionId))
      .filter((region): region is RegionState => Boolean(region))
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

  function setPlayback(mode: TiDBCityState['playback']): void {
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
