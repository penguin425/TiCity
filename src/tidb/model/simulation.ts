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
  createRaftLabState,
  freezeRaftLabSnapshot,
  isRaftLabDelta,
  reduceRaftLabState,
} from './raft-lab'
import {
  createProtocolLabState,
  freezeProtocolLabSnapshot,
  isProtocolLabDelta,
  reduceProtocolLabState,
} from './protocol-lab'
import {
  createGcLabState,
  freezeGcLabSnapshot,
  isGcLabDelta,
  reduceGcLabState,
} from './gc-lab'
import {
  createTiFlashMppLabState,
  freezeTiFlashMppLabSnapshot,
  isTiFlashMppLabDelta,
  reduceTiFlashMppLabState,
} from './tiflash-mpp-lab'
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
  TraceGcLabSnapshot,
  TraceLockLabSnapshot,
  TraceMetadataValue,
  TraceOutcome,
  TracePath,
  TraceProtocolLabSnapshot,
  TraceProtocolLaneId,
  TraceProtocolLaneSnapshot,
  TraceProtocolRaftOperation,
  TraceRaftLabSnapshot,
  TraceRegionSnapshot,
  TraceReceipt,
  TraceRequest,
  TraceStateDelta,
  TraceStateSnapshot,
  TraceTransactionSnapshot,
  TraceTransactionStage,
  TraceTiFlashMppLabSnapshot,
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
  gcLifetimeSeconds: 600,
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
  /**
   * Deterministic presentation fence only. It delays an independent event in
   * replay without adding a causal DAG edge.
   */
  presentationAfter?: string
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
  if (
    delta.kind === 'raft_persist' ||
    delta.kind === 'raft_apply' ||
    delta.kind === 'protocol_region_raft'
  ) {
    return Object.freeze({
      ...delta,
      ...(delta.storeIds
        ? { storeIds: Object.freeze([...delta.storeIds]) }
        : {}),
    })
  }
  if (delta.kind === 'raft_leader_elected') {
    return Object.freeze({
      ...delta,
      votesGranted: Object.freeze([...delta.votesGranted]),
    })
  }
  if (delta.kind === 'deadlock_state') {
    return Object.freeze({
      ...delta,
      cycleTransactionIds: Object.freeze([...delta.cycleTransactionIds]),
    })
  }
  if (delta.kind === 'gc_compaction_filter') {
    return Object.freeze({
      ...delta,
      filteredVersionIds: Object.freeze([...delta.filteredVersionIds]),
      retainedAnchorIds: Object.freeze([...delta.retainedAnchorIds]),
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
    ...(snapshot.raftLab
      ? { raftLab: freezeRaftLabSnapshot(snapshot.raftLab) }
      : {}),
    ...(snapshot.protocolLab
      ? { protocolLab: freezeProtocolLabSnapshot(snapshot.protocolLab) }
      : {}),
    ...(snapshot.gcLab
      ? { gcLab: freezeGcLabSnapshot(snapshot.gcLab) }
      : {}),
    ...(snapshot.tiflashMppLab
      ? { tiflashMppLab: freezeTiFlashMppLabSnapshot(snapshot.tiflashMppLab) }
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
    const presentationEndMs = options.presentationAfter === undefined
      ? 0
      : (() => {
        const predecessor = this.eventById.get(options.presentationAfter)
        if (!predecessor) {
          throw new Error(
            `Unknown trace presentation predecessor: ${options.presentationAfter}`,
          )
        }
        return predecessor.atMs + predecessor.durationMs
      })()
    const atMs = options.dependsOn === undefined
      ? Math.max(this.cursorMs, presentationEndMs)
      : Math.max(dependencyEndMs, presentationEndMs)
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
          'learner_snapshot_gate',
          'Gate the TiFlash snapshot per Region',
          'A production TiFlash read uses each Region self safe-ts or ReadIndex plus local applied-index waiting; this aggregate route does not advance a node-global resolved-ts to start_ts.',
          {
            source: regions[0]?.leaderStoreId ?? 'tikv-1',
            target: 'tiflash-1',
            regionId: regions[0]?.id,
            durationMs: Math.max(
              state.controls.networkLatencyMs,
              state.controls.tiflashLagSeconds * 1_000,
            ),
            metadata: {
              snapshotTs: startTs,
              nodeGlobalResolvedTsAdvanced: false,
              staleRead: false,
            },
          },
        )
      }
      builder.add(
        'tiflash',
        'mpp_dispatch',
        'Dispatch MPP fragments',
        `${regions.length} representative partitions scan after their TiFlash snapshot gates pass.`,
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

  /**
   * Model-7 fixed TiFlash/MPP vertical slice. Region Raft learner replication
   * is persistent storage state; MPP tunnels carry ephemeral aggregate blocks.
   */
  function traceDetailedTiFlashMpp(
    id: string,
    analysis: SqlAnalysis,
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    let tiflashMppLab: TraceTiFlashMppLabSnapshot =
      createTiFlashMppLabState()

    function projection(): TraceStateSnapshot {
      return freezeTraceSnapshot({
        modelVersion: state.modelVersion,
        tsoLastAllocated: state.tso.lastAllocated,
        transaction: null,
        regions: [],
        tiflashMppLab,
      })
    }

    function addTiFlashMppEvent(
      domain: TraceDomain,
      kind: string,
      label: string,
      detail: string,
      options: EventOptions & {
        deltas: readonly TraceStateDelta[]
      },
    ): TraceEvent {
      if (options.deltas.length === 0) {
        throw new Error(`TiFlash/MPP event ${kind} requires a typed delta.`)
      }
      for (const delta of options.deltas) {
        if (!isTiFlashMppLabDelta(delta)) {
          throw new Error(`TiFlash/MPP event ${kind} received ${delta.kind}.`)
        }
        tiflashMppLab = reduceTiFlashMppLabState(tiflashMppLab, delta)
      }
      return builder.add(domain, kind, label, detail, {
        ...options,
        snapshot: projection(),
      })
    }

    const commitEvents = new Map<number, TraceEvent>()
    let presentationFence: string | undefined
    for (const learner of tiflashMppLab.learners) {
      const index = learner.leaderCommitIndex + 1
      const committed = addTiFlashMppEvent(
        'raft',
        'tiflash_raft_leader_commit',
        `Region ${learner.regionId} committed a Raft entry`,
        'The TiKV leader committed one synthetic table mutation before the analytical query.',
        {
          source: learner.leaderStoreId,
          target: learner.leaderStoreId,
          regionId: learner.regionId,
          dependsOn: [],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${learner.regionId}`,
          deltas: [{
            kind: 'tiflash_replica_raft_commit',
            regionId: learner.regionId,
            index,
          }],
          metadata: {
            plane: 'persistent_region_raft',
            index,
            synthetic: true,
          },
        },
      )
      commitEvents.set(learner.regionId, committed)
      presentationFence = committed.id
    }

    const receiveEvents = new Map<number, TraceEvent>()
    presentationFence = undefined
    for (const learner of tiflashMppLab.learners) {
      const committed = commitEvents.get(learner.regionId)
      if (!committed) throw new Error(`Missing Region ${learner.regionId} commit.`)
      const received = addTiFlashMppEvent(
        'tiflash',
        'tiflash_learner_receive',
        `Region ${learner.regionId} learner received the entry`,
        'The non-voting TiFlash learner received the ordinary Region Raft log entry through the proxy path.',
        {
          source: learner.leaderStoreId,
          target: learner.learnerStoreId,
          regionId: learner.regionId,
          dependsOn: [committed.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${learner.regionId}`,
          deltas: [{
            kind: 'tiflash_replica_receive',
            regionId: learner.regionId,
            index: learner.leaderCommitIndex,
            replicationMode: 'raft_log',
          }],
          metadata: {
            plane: 'persistent_region_raft',
            learnerRole: 'learner',
            voter: false,
          },
        },
      )
      receiveEvents.set(learner.regionId, received)
      presentationFence = received.id
    }

    const region24Received = receiveEvents.get(24)
    if (!region24Received) throw new Error('Missing Region 24 receive event.')
    const apply24 = addTiFlashMppEvent(
      'tiflash',
      'tiflash_learner_apply_command',
      'Region 24 applied the Raft command',
      'TiFlash applied the synthetic Put/Delete command to the Region cache; this is persistent replication, not MPP data.',
      {
        source: 'tiflash-proxy',
        target: 'tiflash-1',
        regionId: 24,
        dependsOn: [region24Received.id],
        branchId: 'region-24',
        deltas: [{
          kind: 'tiflash_replica_apply',
          regionId: 24,
          index: 241,
        }],
        metadata: {
          plane: 'persistent_region_raft',
          index: 241,
        },
      },
    )
    const flush24 = addTiFlashMppEvent(
      'tiflash',
      'tiflash_dm_committed_flush',
      'Region 24 wrote committed rows to DeltaMerge',
      'Committed Region-cache data was written to TiFlash storage before the learner applied index advanced.',
      {
        source: 'tiflash-1',
        target: 'tiflash-1',
        regionId: 24,
        dependsOn: [apply24.id],
        branchId: 'region-24',
        deltas: [{
          kind: 'tiflash_replica_dm_flush',
          regionId: 24,
          index: 241,
          aggregateVersionCount: 1,
        }],
        metadata: {
          plane: 'persistent_region_raft',
          aggregateVersionCount: 1,
        },
      },
    )
    const applied24 = addTiFlashMppEvent(
      'tiflash',
      'tiflash_learner_applied_advance',
      'Region 24 advanced learner applied index',
      'The applied index advanced only after the committed storage write completed.',
      {
        source: 'tiflash-1',
        target: 'tiflash-1',
        regionId: 24,
        dependsOn: [flush24.id],
        branchId: 'region-24',
        deltas: [{
          kind: 'tiflash_replica_applied_advance',
          regionId: 24,
          from: 240,
          to: 241,
        }],
        metadata: {
          plane: 'persistent_region_raft',
          appliedIndex: 241,
        },
      },
    )

    const queryReceived = addTiFlashMppEvent(
      'client',
      'tiflash_mpp_query_received',
      'TiDB received the grouped aggregate',
      'The trace retains a synthetic query class and table token, never SQL text, keys, or group values.',
      {
        source: 'client',
        target: 'tidb-1',
        dependsOn: [
          applied24.id,
          receiveEvents.get(25)?.id ?? '',
          receiveEvents.get(26)?.id ?? '',
        ],
        deltas: [{
          kind: 'tiflash_mpp_query_received',
          queryToken: 'query-mpp-1',
          queryClass: 'grouped_aggregate',
        }],
        metadata: {
          queryToken: 'query-mpp-1',
          queryClass: 'grouped_aggregate',
        },
      },
    )

    const startTs = allocateTs()
    const snapshotEvent = addTiFlashMppEvent(
      'tso',
      'tiflash_mpp_snapshot_tso',
      'PD allocated the query snapshot TSO',
      'One synthetic start_ts identifies the MVCC snapshot requested from every Region.',
      {
        source: 'tidb-1',
        target: 'pd-1',
        dependsOn: [queryReceived.id],
        deltas: [{
          kind: 'tiflash_mpp_snapshot_tso',
          timestamp: startTs,
        }],
        metadata: {
          snapshotTs: startTs,
          synthetic: true,
        },
      },
    )

    const safeTsUpdated = addTiFlashMppEvent(
      'tiflash',
      'tiflash_safe_ts_read_state_update',
      'Per-Region safe-ts read state was observed',
      'Region 24 can use the self-safe-ts fast path. Regions 25 and 26 remain behind and must use ReadIndex.',
      {
        source: 'tiflash-proxy',
        target: 'tiflash-1',
        dependsOn: [snapshotEvent.id],
        deltas: [
          {
            kind: 'tiflash_mpp_safe_ts_update',
            regionId: 24,
            leaderSafeTs: startTs,
            selfSafeTs: startTs,
            lagBucket: 'none',
          },
          {
            kind: 'tiflash_mpp_safe_ts_update',
            regionId: 25,
            leaderSafeTs: startTs,
            selfSafeTs: 999_998_000,
            lagBucket: 'about_2s',
          },
          {
            kind: 'tiflash_mpp_safe_ts_update',
            regionId: 26,
            leaderSafeTs: startTs,
            selfSafeTs: 999_998_000,
            lagBucket: 'about_2s',
          },
        ],
        metadata: {
          regionCount: 3,
          correctnessScope: 'per_region',
        },
      },
    )

    const provisioning = addTiFlashMppEvent(
      'tiflash',
      'tiflash_replica_placement_observed',
      'TiDB observed provisioned TiFlash replicas',
      'AVAILABLE and PROGRESS make the access path eligible; they do not prove live snapshot readiness.',
      {
        source: 'tidb-1',
        target: 'tiflash-placement',
        dependsOn: [safeTsUpdated.id],
        deltas: [{
          kind: 'tiflash_mpp_provisioning_observed',
          available: true,
          progress: 1,
          meaning: 'placement_only_not_snapshot_readiness',
        }],
        metadata: {
          available: true,
          progress: 1,
          snapshotReady: false,
        },
      },
    )
    const accessPath = addTiFlashMppEvent(
      'sql',
      'tiflash_mpp_access_path_selected',
      'Optimizer selected the TiFlash MPP path',
      'This declared success fixture models an allowed costed MPP choice; replica presence alone does not force MPP.',
      {
        source: 'tidb-1',
        target: 'tidb-1',
        dependsOn: [provisioning.id],
        deltas: [{
          kind: 'tiflash_mpp_access_path',
          selected: true,
          optimizerMode: 'allow_mpp_costed',
        }],
        metadata: {
          optimizerChoice: 'declared_success_fixture',
          accessPath: 'tiflash_mpp',
        },
      },
    )
    const fragmentsBuilt = addTiFlashMppEvent(
      'sql',
      'tiflash_mpp_fragments_built',
      'TiDB built two MPP fragments',
      'The scan fragment performs partial aggregation and HashPartition; the final fragment receives, aggregates, and PassThroughs to TiDB.',
      {
        source: 'tidb-1',
        target: 'tidb-1',
        dependsOn: [accessPath.id],
        deltas: [{
          kind: 'tiflash_mpp_fragments_build',
          fragmentCount: 2,
        }],
        metadata: {
          fragmentCount: 2,
          aggregateStages: 2,
        },
      },
    )
    const scheduled = addTiFlashMppEvent(
      'sql',
      'tiflash_mpp_regions_scheduled',
      'TiDB grouped Regions by TiFlash store',
      'Regions 24 and 26 map to one scan task; Region 25 maps to the other. A Region is not automatically one MPP task.',
      {
        source: 'tidb-1',
        target: 'tiflash-scheduler',
        dependsOn: [fragmentsBuilt.id],
        deltas: [{
          kind: 'tiflash_mpp_regions_schedule',
          regionCount: 3,
          storeCount: 2,
          policy: 'group_regions_by_tiflash_address',
        }],
        metadata: {
          regionCount: 3,
          storeCount: 2,
        },
      },
    )
    const tasksBuilt = addTiFlashMppEvent(
      'sql',
      'tiflash_mpp_tasks_built',
      'TiDB instantiated four MPP tasks',
      'Each fragment has one task per participating TiFlash store in this fixture.',
      {
        source: 'tidb-1',
        target: 'tiflash-scheduler',
        dependsOn: [scheduled.id],
        deltas: [{
          kind: 'tiflash_mpp_tasks_build',
          taskCount: 4,
        }],
        metadata: {
          taskCount: 4,
          scanTaskCount: 2,
          finalTaskCount: 2,
        },
      },
    )
    const tunnelsBuilt = addTiFlashMppEvent(
      'tiflash',
      'tiflash_mpp_tunnels_registered',
      'Six ephemeral MPP tunnels were registered',
      'Four HashPartition task tunnels and two PassThrough root streams carry query blocks; none are Raft replication.',
      {
        source: 'tidb-1',
        target: 'tiflash-1',
        dependsOn: [tasksBuilt.id],
        deltas: [{
          kind: 'tiflash_mpp_tunnels_build',
          hashTunnelCount: 4,
          rootTunnelCount: 2,
        }],
        metadata: {
          tunnelCount: 6,
          persistence: 'ephemeral_query_blocks',
        },
      },
    )

    const dispatchDeltas: TraceStateDelta[] = tiflashMppLab.tasks.map((task) => ({
      kind: 'tiflash_mpp_task_stage',
      taskId: task.id,
      from: 'built',
      to: 'dispatched',
    }))
    const dispatched = addTiFlashMppEvent(
      'tiflash',
      'tiflash_mpp_dispatch_batch',
      'TiDB dispatched four tasks concurrently',
      'The event is a deterministic batch and does not claim a production network arrival order.',
      {
        source: 'tidb-1',
        target: 'tiflash-mpp',
        dependsOn: [tunnelsBuilt.id],
        deltas: dispatchDeltas,
        metadata: {
          taskCount: 4,
          concurrent: true,
        },
      },
    )
    const preparedDeltas: TraceStateDelta[] = tiflashMppLab.tasks.map((task) => ({
      kind: 'tiflash_mpp_task_stage',
      taskId: task.id,
      from: 'dispatched',
      to: 'prepared',
    }))
    const prepared = addTiFlashMppEvent(
      'tiflash',
      'tiflash_mpp_tasks_prepared',
      'TiFlash prepared and registered all tasks',
      'Each task decoded its DAG request, registered tunnels, and became ready for its fragment work.',
      {
        source: 'tiflash-mpp',
        target: 'tiflash-mpp',
        dependsOn: [dispatched.id],
        deltas: preparedDeltas,
        metadata: {
          preparedTaskCount: 4,
        },
      },
    )
    const gatingStarted = addTiFlashMppEvent(
      'tiflash',
      'tiflash_snapshot_gating_started',
      'Scan tasks began per-Region snapshot gating',
      'Snapshot correctness is checked independently for every Region before the DeltaMerge scan.',
      {
        source: 'tiflash-mpp',
        target: 'tiflash-learners',
        dependsOn: [prepared.id],
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-1',
            from: 'prepared',
            to: 'snapshot_gating',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-2',
            from: 'prepared',
            to: 'snapshot_gating',
          },
        ],
        metadata: {
          regionCount: 3,
          nodeGlobalResolvedTsUsed: false,
        },
      },
    )

    const safeChecks = new Map<number, TraceEvent>()
    presentationFence = undefined
    for (const regionId of [24, 25, 26]) {
      const check = addTiFlashMppEvent(
        'tiflash',
        'tiflash_snapshot_safe_ts_check',
        `Region ${regionId} compared start_ts with self safe-ts`,
        regionId === 24
          ? 'The requested snapshot is at or below this learner self safe-ts, so ReadIndex can be skipped safely.'
          : 'This learner self safe-ts is behind the requested snapshot, so TiFlash must use ReadIndex and wait for apply.',
        {
          source: regionId === 25 ? 'tiflash-2' : 'tiflash-1',
          target: regionId === 25 ? 'tiflash-2' : 'tiflash-1',
          regionId,
          dependsOn: [gatingStarted.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${regionId}`,
          deltas: [{
            kind: 'tiflash_mpp_snapshot_gate',
            regionId,
            action: 'check_safe_ts',
          }],
          metadata: {
            gate: 'self_safe_ts_compare',
            readIndexSkipped: regionId === 24,
          },
        },
      )
      safeChecks.set(regionId, check)
      presentationFence = check.id
    }

    const check24 = safeChecks.get(24)
    if (!check24) throw new Error('Missing Region 24 safe-ts check.')
    const ready24 = addTiFlashMppEvent(
      'tiflash',
      'tiflash_snapshot_gate_ready_safe_ts',
      'Region 24 passed through self safe-ts',
      'The learner can serve the requested MVCC snapshot without ReadIndex; this does not mean stale or inconsistent output.',
      {
        source: 'tiflash-1',
        target: 'task-scan-1',
        regionId: 24,
        dependsOn: [check24.id],
        branchId: 'region-24',
        deltas: [{
          kind: 'tiflash_mpp_snapshot_gate',
          regionId: 24,
          action: 'ready_safe_ts',
        }],
        metadata: {
          gateReason: 'self_safe_ts',
          staleRead: false,
        },
      },
    )

    const requestEvents = new Map<number, TraceEvent>()
    presentationFence = undefined
    for (const regionId of [25, 26]) {
      const check = safeChecks.get(regionId)
      if (!check) throw new Error(`Missing Region ${regionId} safe-ts check.`)
      const requested = addTiFlashMppEvent(
        'tiflash',
        'tiflash_read_index_requested',
        `Region ${regionId} requested ReadIndex`,
        'ReadIndex asks the Region leader for the committed index needed by this snapshot; it does not copy data.',
        {
          source: regionId === 25 ? 'tiflash-2' : 'tiflash-1',
          target: `tikv-region-${regionId}`,
          regionId,
          dependsOn: [check.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${regionId}`,
          deltas: [{
            kind: 'tiflash_mpp_snapshot_gate',
            regionId,
            action: 'request_read_index',
          }],
          metadata: {
            operation: 'read_index',
            transfersData: false,
          },
        },
      )
      requestEvents.set(regionId, requested)
      presentationFence = requested.id
    }

    const returnEvents = new Map<number, TraceEvent>()
    presentationFence = undefined
    for (const [regionId, requiredReadIndex] of [[25, 251], [26, 261]] as const) {
      const requested = requestEvents.get(regionId)
      if (!requested) throw new Error(`Missing Region ${regionId} ReadIndex request.`)
      const returned = addTiFlashMppEvent(
        'tiflash',
        'tiflash_read_index_returned',
        `Region ${regionId} received required ReadIndex`,
        'The response identifies the committed Raft index the local learner must have applied before reading.',
        {
          source: `tikv-region-${regionId}`,
          target: regionId === 25 ? 'tiflash-2' : 'tiflash-1',
          regionId,
          dependsOn: [requested.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${regionId}`,
          deltas: [{
            kind: 'tiflash_mpp_snapshot_gate',
            regionId,
            action: 'return_read_index',
            requiredReadIndex,
          }],
          metadata: {
            requiredReadIndex,
            synthetic: true,
          },
        },
      )
      returnEvents.set(regionId, returned)
      presentationFence = returned.id
    }

    const waitEvents = new Map<number, TraceEvent>()
    presentationFence = undefined
    for (const regionId of [25, 26]) {
      const returned = returnEvents.get(regionId)
      if (!returned) throw new Error(`Missing Region ${regionId} ReadIndex response.`)
      const waiting = addTiFlashMppEvent(
        'tiflash',
        'tiflash_learner_wait_applied',
        `Region ${regionId} waited for learner apply`,
        'TiFlash waits for local persistent Raft application instead of returning an older snapshot.',
        {
          source: regionId === 25 ? 'tiflash-2' : 'tiflash-1',
          target: regionId === 25 ? 'tiflash-2' : 'tiflash-1',
          regionId,
          dependsOn: [returned.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${regionId}`,
          status: 'active',
          deltas: [{
            kind: 'tiflash_mpp_snapshot_gate',
            regionId,
            action: 'wait_applied',
          }],
          metadata: {
            returnsStaleRows: false,
          },
        },
      )
      waitEvents.set(regionId, waiting)
      presentationFence = waiting.id
    }

    const applyTail = new Map<number, TraceEvent>()
    presentationFence = undefined
    for (const [regionId, from, to, storeId] of [
      [25, 250, 251, 'tiflash-2'],
      [26, 260, 261, 'tiflash-1'],
    ] as const) {
      const waiting = waitEvents.get(regionId)
      const received = receiveEvents.get(regionId)
      if (!waiting || !received) {
        throw new Error(`Missing Region ${regionId} replication prerequisites.`)
      }
      const applied = addTiFlashMppEvent(
        'tiflash',
        'tiflash_learner_apply_command',
        `Region ${regionId} applied the pending Raft command`,
        'The learner applied persistent Region state while the query gate waited.',
        {
          source: 'tiflash-proxy',
          target: storeId,
          regionId,
          dependsOn: [waiting.id, received.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${regionId}`,
          deltas: [{
            kind: 'tiflash_replica_apply',
            regionId,
            index: to,
          }],
          metadata: {
            plane: 'persistent_region_raft',
            index: to,
          },
        },
      )
      const flushed = addTiFlashMppEvent(
        'tiflash',
        'tiflash_dm_committed_flush',
        `Region ${regionId} wrote committed rows to DeltaMerge`,
        'The persistent write completes before this learner publishes the newer applied index.',
        {
          source: storeId,
          target: storeId,
          regionId,
          dependsOn: [applied.id],
          branchId: `region-${regionId}`,
          deltas: [{
            kind: 'tiflash_replica_dm_flush',
            regionId,
            index: to,
            aggregateVersionCount: 1,
          }],
          metadata: {
            plane: 'persistent_region_raft',
            aggregateVersionCount: 1,
          },
        },
      )
      const advanced = addTiFlashMppEvent(
        'tiflash',
        'tiflash_learner_applied_advance',
        `Region ${regionId} reached required applied index`,
        'The applied-index waiter can now be released without advancing a node-global resolved-ts.',
        {
          source: storeId,
          target: storeId,
          regionId,
          dependsOn: [flushed.id],
          branchId: `region-${regionId}`,
          deltas: [{
            kind: 'tiflash_replica_applied_advance',
            regionId,
            from,
            to,
          }],
          metadata: {
            appliedIndex: to,
            nodeGlobalResolvedTsAdvanced: false,
          },
        },
      )
      applyTail.set(regionId, advanced)
      presentationFence = advanced.id
    }

    const readIndexReady = new Map<number, TraceEvent>()
    presentationFence = undefined
    for (const regionId of [25, 26]) {
      const advanced = applyTail.get(regionId)
      if (!advanced) throw new Error(`Missing Region ${regionId} apply tail.`)
      const ready = addTiFlashMppEvent(
        'tiflash',
        'tiflash_snapshot_gate_ready_read_index',
        `Region ${regionId} passed ReadIndex plus apply`,
        'The learner applied the returned index, so the requested MVCC snapshot can proceed.',
        {
          source: regionId === 25 ? 'tiflash-2' : 'tiflash-1',
          target: regionId === 25 ? 'task-scan-2' : 'task-scan-1',
          regionId,
          dependsOn: [advanced.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: `region-${regionId}`,
          deltas: [{
            kind: 'tiflash_mpp_snapshot_gate',
            regionId,
            action: 'ready_read_index',
          }],
          metadata: {
            gateReason: 'read_index_applied',
            staleRead: false,
          },
        },
      )
      readIndexReady.set(regionId, ready)
      presentationFence = ready.id
    }

    const locksChecked = addTiFlashMppEvent(
      'tiflash',
      'tiflash_mvcc_lock_checks_complete',
      'All Region MVCC lock checks completed',
      'The successful fixture found zero locks. A lock or timeout would take a separate error/retry branch, not return stale rows.',
      {
        source: 'tiflash-learners',
        target: 'tiflash-storage',
        dependsOn: [
          ready24.id,
          readIndexReady.get(25)?.id ?? '',
          readIndexReady.get(26)?.id ?? '',
        ],
        deltas: [24, 25, 26].map((regionId): TraceStateDelta => ({
          kind: 'tiflash_mpp_snapshot_gate',
          regionId,
          action: 'lock_check',
          lockCount: 0,
        })),
        metadata: {
          regionCount: 3,
          aggregateLockCount: 0,
        },
      },
    )

    const scansStarted = addTiFlashMppEvent(
      'tiflash',
      'tiflash_dm_snapshot_scans_started',
      'Two scan tasks built DeltaMerge snapshot readers',
      'Each scan task uses the same requested snapshot TSO after all owned Regions pass their independent gates.',
      {
        source: 'tiflash-storage',
        target: 'tiflash-mpp',
        dependsOn: [locksChecked.id],
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-1',
            from: 'snapshot_gating',
            to: 'scanning',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-2',
            from: 'snapshot_gating',
            to: 'scanning',
          },
        ],
        metadata: {
          scanTaskCount: 2,
          rowValuesRetained: false,
        },
      },
    )

    const validated = addTiFlashMppEvent(
      'tiflash',
      'tiflash_regions_post_read_validated',
      'Region epochs and ranges were revalidated',
      'After storage readers were built, TiFlash verified that Region split, merge, and epoch state had not invalidated their ranges.',
      {
        source: 'tiflash-storage',
        target: 'tiflash-mpp',
        dependsOn: [scansStarted.id],
        deltas: [24, 25, 26].map((regionId): TraceStateDelta => ({
          kind: 'tiflash_mpp_snapshot_gate',
          regionId,
          action: 'post_read_validate',
        })),
        metadata: {
          regionCount: 3,
          validation: 'epoch_and_range',
        },
      },
    )

    const partialAggregated = addTiFlashMppEvent(
      'tiflash',
      'tiflash_partial_hash_aggregate_complete',
      'Scan tasks completed partial aggregation',
      'Only bucketed aggregate block counts are retained; no group keys or result values enter the trace.',
      {
        source: 'tiflash-storage',
        target: 'tiflash-mpp',
        dependsOn: [validated.id],
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-1',
            from: 'scanning',
            to: 'partial_aggregated',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-2',
            from: 'scanning',
            to: 'partial_aggregated',
          },
        ],
        metadata: {
          taskCount: 2,
          rowsBucket: 'small',
        },
      },
    )

    const exchangeStarted = addTiFlashMppEvent(
      'tiflash',
      'tiflash_hash_partition_started',
      'Scan tasks hash-partitioned aggregate blocks',
      'HashPartition scatters ephemeral aggregate blocks to both final tasks; it is not broadcast and not Raft.',
      {
        source: 'fragment-scan',
        target: 'fragment-final',
        dependsOn: [partialAggregated.id],
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-1',
            from: 'partial_aggregated',
            to: 'exchange_sending',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-2',
            from: 'partial_aggregated',
            to: 'exchange_sending',
          },
        ],
        metadata: {
          exchangeType: 'hash_partition',
          persistence: 'ephemeral_query_blocks',
        },
      },
    )

    const hashSendEvents: TraceEvent[] = []
    presentationFence = undefined
    for (const tunnelId of [
      'tunnel-hash-1',
      'tunnel-hash-2',
      'tunnel-hash-3',
      'tunnel-hash-4',
    ] as const) {
      const tunnel = tiflashMppLab.tunnels.find((candidate) =>
        candidate.id === tunnelId)
      if (!tunnel) throw new Error(`Missing ${tunnelId}.`)
      const sent = addTiFlashMppEvent(
        'tiflash',
        'tiflash_hash_exchange_send',
        `${tunnelId} sent aggregate blocks`,
        'One bounded packet aggregate represents the ephemeral block flow on this task-to-task tunnel.',
        {
          source: tunnel.sourceTaskId,
          target: tunnel.targetTaskId,
          dependsOn: [exchangeStarted.id],
          ...(presentationFence
            ? { presentationAfter: presentationFence }
            : {}),
          branchId: tunnelId,
          deltas: [{
            kind: 'tiflash_mpp_tunnel_data',
            tunnelId,
            action: 'send',
            packetCount: 1,
            bytesBucket: 'small',
          }],
          metadata: {
            exchangeType: 'hash_partition',
            locality: tunnel.locality,
            packetCount: 1,
          },
        },
      )
      hashSendEvents.push(sent)
      presentationFence = sent.id
    }

    const hashReceived = addTiFlashMppEvent(
      'tiflash',
      'tiflash_hash_exchange_received',
      'Final tasks received all HashPartition blocks',
      'Local and remote receivers decoded the same ephemeral packet format before final aggregation.',
      {
        source: 'fragment-scan',
        target: 'fragment-final',
        dependsOn: hashSendEvents.map((event) => event.id),
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-1',
            from: 'prepared',
            to: 'exchange_receiving',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-2',
            from: 'prepared',
            to: 'exchange_receiving',
          },
          ...([
            'tunnel-hash-1',
            'tunnel-hash-2',
            'tunnel-hash-3',
            'tunnel-hash-4',
          ] as const).map((tunnelId): TraceStateDelta => ({
            kind: 'tiflash_mpp_tunnel_data',
            tunnelId,
            action: 'receive',
            packetCount: 1,
            bytesBucket: 'small',
          })),
        ],
        metadata: {
          tunnelCount: 4,
          packetCount: 4,
        },
      },
    )

    const finalAggregated = addTiFlashMppEvent(
      'tiflash',
      'tiflash_final_hash_aggregate_complete',
      'Final tasks completed the second aggregation stage',
      'Each final task combined its received partitions without exposing group keys or aggregate values.',
      {
        source: 'fragment-final',
        target: 'fragment-final',
        dependsOn: [hashReceived.id],
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-1',
            from: 'exchange_receiving',
            to: 'final_aggregated',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-2',
            from: 'exchange_receiving',
            to: 'final_aggregated',
          },
        ],
        metadata: {
          taskCount: 2,
          resultValuesRetained: false,
        },
      },
    )

    const rootSent = addTiFlashMppEvent(
      'tiflash',
      'tiflash_root_passthrough_sent',
      'Two PassThrough streams sent result blocks to TiDB',
      'Each final task has one root stream to the TiDB virtual task. PassThrough is not broadcast.',
      {
        source: 'fragment-final',
        target: 'tidb-root',
        dependsOn: [finalAggregated.id],
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-1',
            from: 'final_aggregated',
            to: 'root_streaming',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-2',
            from: 'final_aggregated',
            to: 'root_streaming',
          },
          {
            kind: 'tiflash_mpp_tunnel_data',
            tunnelId: 'tunnel-root-1',
            action: 'send',
            packetCount: 1,
            bytesBucket: 'small',
          },
          {
            kind: 'tiflash_mpp_tunnel_data',
            tunnelId: 'tunnel-root-2',
            action: 'send',
            packetCount: 1,
            bytesBucket: 'small',
          },
        ],
        metadata: {
          exchangeType: 'pass_through',
          rootStreamCount: 2,
        },
      },
    )

    const gathered = addTiFlashMppEvent(
      'return',
      'tiflash_mpp_gather_decoded',
      'TiDB MPPGather decoded result chunks',
      'TiDB consumed both root streams and decoded aggregate packets into internal chunks.',
      {
        source: 'tidb-root',
        target: 'tidb-1',
        dependsOn: [rootSent.id],
        deltas: [
          {
            kind: 'tiflash_mpp_tunnel_data',
            tunnelId: 'tunnel-root-1',
            action: 'receive',
            packetCount: 1,
            bytesBucket: 'small',
          },
          {
            kind: 'tiflash_mpp_tunnel_data',
            tunnelId: 'tunnel-root-2',
            action: 'receive',
            packetCount: 1,
            bytesBucket: 'small',
          },
          {
            kind: 'tiflash_mpp_result_stage',
            from: 'idle',
            to: 'chunks_decoded',
            rootStreamCount: 2,
            chunksDecoded: 2,
            rowsBucket: 'none',
          },
        ],
        metadata: {
          rootStreamCount: 2,
          chunksDecoded: 2,
        },
      },
    )
    const columnsSent = addTiFlashMppEvent(
      'return',
      'tiflash_client_columns_sent',
      'TiDB sent result-column metadata',
      'The client protocol boundary begins without retaining SQL text or column values in the model snapshot.',
      {
        source: 'tidb-1',
        target: 'client',
        dependsOn: [gathered.id],
        deltas: [{
          kind: 'tiflash_mpp_result_stage',
          from: 'chunks_decoded',
          to: 'columns_sent',
          rootStreamCount: 2,
          chunksDecoded: 2,
          rowsBucket: 'none',
        }],
        metadata: {
          columnsSent: true,
        },
      },
    )
    const rowsStreamed = addTiFlashMppEvent(
      'return',
      'tiflash_client_rows_streamed',
      'TiDB streamed a bounded aggregate row bucket',
      'Rows may cross the client boundary before every task status report finishes; only a small bucket is retained.',
      {
        source: 'tidb-1',
        target: 'client',
        dependsOn: [columnsSent.id],
        deltas: [{
          kind: 'tiflash_mpp_result_stage',
          from: 'columns_sent',
          to: 'rows_streaming',
          rootStreamCount: 2,
          chunksDecoded: 2,
          rowsBucket: 'small',
        }],
        metadata: {
          rowsBucket: 'small',
          exactValuesRetained: false,
        },
      },
    )
    const streamsEof = addTiFlashMppEvent(
      'return',
      'tiflash_root_streams_eof',
      'Both root streams reached EOF',
      'All bounded root packets were consumed. Stream completion is distinct from dispatch acceptance.',
      {
        source: 'tidb-root',
        target: 'tidb-1',
        dependsOn: [rowsStreamed.id],
        deltas: [{
          kind: 'tiflash_mpp_result_stage',
          from: 'rows_streaming',
          to: 'streams_eof',
          rootStreamCount: 2,
          chunksDecoded: 2,
          rowsBucket: 'small',
        }],
        metadata: {
          rootStreamCount: 2,
          eof: true,
        },
      },
    )
    addTiFlashMppEvent(
      'return',
      'tiflash_client_query_complete',
      'TiDB completed the client response',
      'The successful baseline ends with zero retries, no fallback, and no stale-read result.',
      {
        source: 'tidb-1',
        target: 'client',
        dependsOn: [streamsEof.id],
        deltas: [
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-1',
            from: 'exchange_sending',
            to: 'complete',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-scan-2',
            from: 'exchange_sending',
            to: 'complete',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-1',
            from: 'root_streaming',
            to: 'complete',
          },
          {
            kind: 'tiflash_mpp_task_stage',
            taskId: 'task-final-2',
            from: 'root_streaming',
            to: 'complete',
          },
          {
            kind: 'tiflash_mpp_result_stage',
            from: 'streams_eof',
            to: 'client_complete',
            rootStreamCount: 2,
            chunksDecoded: 2,
            rowsBucket: 'small',
          },
        ],
        metadata: {
          retryCount: 0,
          fallbackToTiKV: false,
          staleRead: false,
        },
      },
    )

    if (builder.events.length > tiflashMppLab.configuration.maxEventNodes) {
      throw new Error('TiFlash/MPP trace exceeded its renderer event capacity.')
    }
    state.metrics.statements++
    state.metrics.reads++
    state.tiflash.mppQueries++
    return recordReceipt(
      id,
      'tiflash-mpp',
      analysis,
      startTs,
      null,
      'succeeded',
      null,
      builder,
      warnings,
    )
  }

  /**
   * A model-4 vertical slice for one representative Region. The failed TiKV
   * process affects every modeled peer on that store, while this receipt
   * expands only Region 0's Raft election and the same logical Region request.
   * The read itself creates no user-data Raft entry; the only entry below is
   * the empty current-term entry appended by the newly elected leader.
   */
  function traceRaftFailoverScenario(
    id: string,
    analysis: SqlAnalysis,
    region: RegionState,
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const proxyId = 'tiproxy-1'
    const tidbId = 'tidb-1'
    const pdId = 'pd-1'
    const oldLeaderStoreId = region.leaderStoreId
    const liveCandidates = region.peers
      .filter((peer) => peer.storeId !== oldLeaderStoreId)
      .sort((left, right) => left.storeId.localeCompare(right.storeId))
    const candidateStoreId = liveCandidates[0]?.storeId
    const voterStoreId = liveCandidates[1]?.storeId
    if (!candidateStoreId || !voterStoreId) {
      throw new Error('Raft Lab requires two follower voters.')
    }

    /*
     * A non-zero baseline makes last-log, commit, and apply movement legible.
     * These are representative teaching indexes, not values read from TiKV.
     */
    const baselineIndex = 42
    const baselineTerm = Math.max(1, region.term)
    region.term = baselineTerm
    region.commitIndex = baselineIndex
    region.appliedIndex = baselineIndex
    for (const peer of region.peers) {
      peer.healthy = true
      peer.raftRole = peer.storeId === oldLeaderStoreId ? 'leader' : 'follower'
      peer.matchIndex = baselineIndex
      peer.appliedIndex = baselineIndex
    }
    updateRegionHealth(region)

    const logicalRequestId = 'region-request-1'
    const backoffMs = 80
    let raftLab: TraceRaftLabSnapshot = createRaftLabState(
      region.id,
      oldLeaderStoreId,
      region.peers.map((peer) => ({
        storeId: peer.storeId,
        lastLogIndex: baselineIndex,
        lastLogTerm: baselineTerm,
        commitIndex: baselineIndex,
        appliedIndex: baselineIndex,
      })),
      logicalRequestId,
      backoffMs,
    )

    function syncActualRegion(): void {
      const labLeader = raftLab.leaderStoreId
      region.leaderStoreId = labLeader ?? oldLeaderStoreId
      region.term = Math.max(...raftLab.peers.map((peer) => peer.currentTerm))
      const leader = labLeader === null
        ? null
        : raftLab.peers.find((peer) => peer.storeId === labLeader) ?? null
      region.commitIndex = leader?.commitIndex ??
        Math.max(...raftLab.peers.map((peer) => peer.commitIndex))
      region.appliedIndex = leader?.appliedIndex ??
        Math.max(...raftLab.peers.map((peer) => peer.appliedIndex))
      for (const peer of region.peers) {
        const projected = raftLab.peers.find((candidate) =>
          candidate.storeId === peer.storeId)
        if (!projected) continue
        peer.healthy = projected.healthy
        peer.raftRole = projected.role === 'leader' ? 'leader' : 'follower'
        peer.matchIndex = projected.matchIndex
        peer.appliedIndex = projected.appliedIndex
      }
      updateRegionHealth(region)
    }

    function projection(): TraceStateSnapshot {
      const visibleLeader = raftLab.leaderStoreId ?? oldLeaderStoreId
      const leaderPeer = raftLab.leaderStoreId === null
        ? null
        : raftLab.peers.find((peer) =>
          peer.storeId === raftLab.leaderStoreId) ?? null
      return freezeTraceSnapshot({
        modelVersion: state.modelVersion,
        tsoLastAllocated: state.tso.lastAllocated,
        transaction: null,
        regions: [{
          regionId: region.id,
          /*
           * The legacy Region projection cannot encode a missing leader. Its
           * exact nullable leader contract lives in raftLab.
           */
          leaderStoreId: visibleLeader,
          term: Math.max(...raftLab.peers.map((peer) => peer.currentTerm)),
          proposedIndex: raftLab.log.committed ? null : raftLab.log.index,
          persistedStoreIds: [...raftLab.log.persistedStoreIds],
          acknowledgements: raftLab.log.persistedStoreIds.length,
          quorum: 2,
          commitIndex: leaderPeer?.commitIndex ??
            Math.max(...raftLab.peers.map((peer) => peer.commitIndex)),
          appliedIndex: leaderPeer?.appliedIndex ??
            Math.max(...raftLab.peers.map((peer) => peer.appliedIndex)),
          peers: raftLab.peers.map((peer) => ({
            storeId: peer.storeId,
            raftRole: peer.role === 'leader' ? 'leader' : 'follower',
            matchIndex: peer.matchIndex,
            appliedIndex: peer.appliedIndex,
            healthy: peer.healthy,
          })),
          pessimisticLock: null,
          mvcc: {
            defaultCf: 'empty',
            lockCf: 'empty',
            writeCf: 'empty',
            startTs: null,
            commitTs: null,
            primary: true,
          },
        }],
        raftLab,
      })
    }

    function addRaftEvent(
      domain: TraceDomain,
      kind: string,
      label: string,
      detail: string,
      options: EventOptions = {},
    ): TraceEvent {
      const deltas = options.deltas ?? []
      for (const delta of deltas) {
        if (delta.kind === 'raft_peer_health') {
          markStoreDown(delta.storeId)
        }
        if (isRaftLabDelta(delta)) {
          raftLab = reduceRaftLabState(raftLab, delta)
        }
        if (delta.kind === 'raft_leader_elected') {
          state.metrics.leaderElections++
        }
        if (
          delta.kind === 'raft_propose' &&
          delta.operation === 'leader_noop'
        ) {
          state.metrics.raftEntries++
        }
      }
      syncActualRegion()
      return builder.add(domain, kind, label, detail, {
        ...options,
        path: options.path ?? 'critical',
        snapshot: projection(),
        deltas,
      })
    }

    const root = addRaftEvent(
      'client',
      'raft_lab_start',
      'Begin one logical Region request',
      'The model retains only a point-read classification and a synthetic request ID; it stores no SQL text, key, value, or result row.',
      {
        source: 'client',
        target: proxyId,
        metadata: {
          regionId: region.id,
          voterCount: 3,
          quorum: 2,
          logicalRequestId,
          representativeRegionOnly: true,
        },
      },
    )
    const routed = addRaftEvent(
      'sql',
      'route',
      'TiProxy routed the session',
      `${proxyId} selected stateless ${tidbId}.`,
      {
        source: proxyId,
        target: tidbId,
        dependsOn: [root.id],
        metadata: { statelessSqlLayer: true },
      },
    )
    const planned = addRaftEvent(
      'sql',
      'parse_optimize',
      'Classify the point read',
      analysis.explanation,
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [routed.id],
        metadata: {
          statementKind: analysis.statementKind,
          accessPath: analysis.accessPath,
        },
      },
    )
    const startTs = allocateTs()
    const snapshotTs = addRaftEvent(
      'tso',
      'snapshot_ts',
      'PD allocated a snapshot timestamp',
      `The logical read uses synthetic start_ts ${startTs}.`,
      {
        source: tidbId,
        target: pdId,
        dependsOn: [planned.id],
        deltas: [{
          kind: 'tso_allocate',
          purpose: 'start_ts',
          timestamp: startTs,
        }],
        metadata: { startTs, pdRole: 'timestamp_only' },
      },
    )
    const located = addRaftEvent(
      'sql',
      'locate_region',
      'TiDB used its cached Region route',
      `Region ${region.id} is cached with ${oldLeaderStoreId} as leader before the failure.`,
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [snapshotTs.id],
        metadata: {
          regionId: region.id,
          cachedLeaderStoreId: oldLeaderStoreId,
          pdElectsRegionLeader: false,
        },
      },
    )
    const attemptOne = addRaftEvent(
      'kv',
      'region_request_attempt',
      'Send attempt 1 to the cached leader',
      `TiDB sends ${logicalRequestId} attempt 1 to ${oldLeaderStoreId}.`,
      {
        source: tidbId,
        target: oldLeaderStoreId,
        regionId: region.id,
        dependsOn: [located.id],
        branchId: 'region-request',
        deltas: [{
          kind: 'raft_region_request',
          action: 'send',
          regionId: region.id,
          logicalRequestId,
          attempt: 1,
          targetStoreId: oldLeaderStoreId,
          backoffMs,
          source: 'tidb_internal',
          clientVisibleError: false,
        }],
        metadata: {
          logicalRequestId,
          attempt: 1,
          cachedLeaderStoreId: oldLeaderStoreId,
        },
      },
    )
    const failed = addRaftEvent(
      'raft',
      'tikv_process_unreachable',
      'The old leader process becomes unreachable',
      `${oldLeaderStoreId} stops before it can serve the read. Its peers in every modeled Region are marked down; this cutaway expands Region ${region.id}.`,
      {
        status: 'failed',
        source: oldLeaderStoreId,
        target: oldLeaderStoreId,
        regionId: region.id,
        dependsOn: [attemptOne.id],
        branchId: 'raft-election',
        deltas: [{
          kind: 'raft_peer_health',
          regionId: region.id,
          storeId: oldLeaderStoreId,
          from: 'up',
          to: 'down',
        }],
        metadata: {
          failureKind: 'process_unreachable',
          networkPartitionModeled: false,
          liveVoters: 2,
          quorum: 2,
        },
      },
    )
    const transportError = addRaftEvent(
      'kv',
      'region_request_transport_error',
      'TiDB catches a retryable Region transport error',
      'The storage request did not reach a serving peer. TiDB keeps the client response pending and handles recovery inside its Region request path.',
      {
        status: 'warning',
        source: oldLeaderStoreId,
        target: tidbId,
        regionId: region.id,
        dependsOn: [failed.id],
        branchId: 'region-request',
        deltas: [{
          kind: 'raft_region_request',
          action: 'transport_error',
          regionId: region.id,
          logicalRequestId,
          attempt: 1,
          targetStoreId: oldLeaderStoreId,
          backoffMs,
          source: 'tidb_internal',
          clientVisibleError: false,
        }],
        metadata: {
          retryBoundary: 'tidb_internal_region_request',
          applicationRetry: false,
          clientVisibleError: false,
        },
      },
    )
    const backoff = addRaftEvent(
      'kv',
      'region_request_backoff',
      'Invalidate the cached leader and back off',
      `TiDB invalidates the stale Region leader route and waits a representative ${backoffMs} ms teaching backoff.`,
      {
        status: 'warning',
        source: tidbId,
        target: tidbId,
        regionId: region.id,
        dependsOn: [transportError.id],
        branchId: 'region-request',
        durationMs: backoffMs,
        deltas: [{
          kind: 'raft_region_request',
          action: 'backoff',
          regionId: region.id,
          logicalRequestId,
          attempt: 1,
          targetStoreId: null,
          backoffMs,
          source: 'tidb_internal',
          clientVisibleError: false,
        }],
        metadata: {
          backoffMs,
          modelValue: true,
          regionCache: 'invalidated',
        },
      },
    )
    const timeout = addRaftEvent(
      'raft',
      'raft_election_timeout',
      'A live follower reaches its election timeout',
      `${candidateStoreId} reaches a representative 13-tick teaching timeout first. TiKV's configured base is 10 ticks and default maximum is 20 ticks; the exact winner and order are TiCity MODEL POLICY.`,
      {
        status: 'warning',
        source: candidateStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [failed.id],
        branchId: 'raft-election',
        durationMs: 130,
        deltas: [{
          kind: 'raft_election_timeout',
          regionId: region.id,
          candidateStoreId,
          configuredElectionTimeoutTicks: 10,
          configuredMaxElectionTimeoutTicks: 20,
          elapsedTicks: 13,
          candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
        }],
        metadata: {
          configuredElectionTimeoutTicks: 10,
          configuredMaxElectionTimeoutTicks: 20,
          teachingElapsedTicks: 13,
          selectionPolicy: 'MODEL POLICY: lowest live up-to-date store id',
        },
      },
    )
    const preVoteStart = addRaftEvent(
      'raft',
      'raft_pre_vote_start',
      'Start pre-vote without advancing term',
      `${candidateStoreId} becomes a pre-candidate for prospective term ${baselineTerm + 1}; current term remains ${baselineTerm}.`,
      {
        source: candidateStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [timeout.id],
        branchId: 'raft-election',
        deltas: [{
          kind: 'raft_pre_vote',
          action: 'start',
          regionId: region.id,
          candidateStoreId,
          voterStoreId: candidateStoreId,
          prospectiveTerm: baselineTerm + 1,
        }],
        metadata: {
          prevoteEnabled: true,
          currentTerm: baselineTerm,
          prospectiveTerm: baselineTerm + 1,
        },
      },
    )
    const preVoteRequest = addRaftEvent(
      'raft',
      'raft_pre_vote_request',
      'Ask the other live voter for pre-vote',
      `${candidateStoreId} advertises last log (${baselineTerm}, ${baselineIndex}) to ${voterStoreId}.`,
      {
        source: candidateStoreId,
        target: voterStoreId,
        regionId: region.id,
        dependsOn: [preVoteStart.id],
        branchId: 'raft-election',
        metadata: {
          prospectiveTerm: baselineTerm + 1,
          lastLogTerm: baselineTerm,
          lastLogIndex: baselineIndex,
        },
      },
    )
    const preVoteGranted = addRaftEvent(
      'raft',
      'raft_pre_vote_granted',
      'Pre-vote reaches 2-of-3',
      `${voterStoreId} confirms that ${candidateStoreId}'s log is up to date. The two live voters form a pre-vote quorum.`,
      {
        source: voterStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [preVoteRequest.id],
        branchId: 'raft-election',
        deltas: [{
          kind: 'raft_pre_vote',
          action: 'grant',
          regionId: region.id,
          candidateStoreId,
          voterStoreId,
          prospectiveTerm: baselineTerm + 1,
        }],
        metadata: {
          preVotesGranted: 2,
          quorum: 2,
          voterCount: 3,
        },
      },
    )
    const becameCandidate = addRaftEvent(
      'raft',
      'raft_candidate_term',
      'Advance term and cast the candidate self-vote',
      `${candidateStoreId} advances to term ${baselineTerm + 1}, becomes candidate, and records one vote for itself.`,
      {
        source: candidateStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [preVoteGranted.id],
        branchId: 'raft-election',
        deltas: [{
          kind: 'raft_term_vote',
          action: 'become_candidate',
          regionId: region.id,
          candidateStoreId,
          voterStoreId: candidateStoreId,
          term: baselineTerm + 1,
        }],
        metadata: {
          term: baselineTerm + 1,
          votedFor: candidateStoreId,
          votesGranted: 1,
        },
      },
    )
    const voteRequest = addRaftEvent(
      'raft',
      'raft_vote_request',
      'Request the second vote',
      `${candidateStoreId} sends RequestVote for term ${baselineTerm + 1} to ${voterStoreId}.`,
      {
        source: candidateStoreId,
        target: voterStoreId,
        regionId: region.id,
        dependsOn: [becameCandidate.id],
        branchId: 'raft-election',
        metadata: {
          term: baselineTerm + 1,
          lastLogTerm: baselineTerm,
          lastLogIndex: baselineIndex,
        },
      },
    )
    const voteGranted = addRaftEvent(
      'raft',
      'raft_vote_granted',
      'RequestVote reaches 2-of-3',
      `${voterStoreId} records its one vote for ${candidateStoreId} in term ${baselineTerm + 1}.`,
      {
        source: voterStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [voteRequest.id],
        branchId: 'raft-election',
        deltas: [{
          kind: 'raft_term_vote',
          action: 'grant',
          regionId: region.id,
          candidateStoreId,
          voterStoreId,
          term: baselineTerm + 1,
        }],
        metadata: {
          term: baselineTerm + 1,
          votesGranted: 2,
          quorum: 2,
        },
      },
    )
    const elected = addRaftEvent(
      'raft',
      'raft_leader_elected',
      'The live quorum elects a new Region leader',
      `${candidateStoreId} becomes Region ${region.id}'s leader in term ${baselineTerm + 1}. PD did not nominate it or vote.`,
      {
        source: voterStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [voteGranted.id],
        branchId: 'raft-election',
        deltas: [{
          kind: 'raft_leader_elected',
          regionId: region.id,
          oldLeaderStoreId,
          newLeaderStoreId: candidateStoreId,
          term: baselineTerm + 1,
          votesGranted: [candidateStoreId, voterStoreId],
          quorum: 2,
        }],
        metadata: {
          term: baselineTerm + 1,
          votesGranted: 2,
          quorum: 2,
          pdParticipatedInElection: false,
        },
      },
    )
    const noOpIndex = baselineIndex + 1
    const proposed = addRaftEvent(
      'raft',
      'raft_leader_noop_propose',
      'Append the new leader current-term no-op',
      `${candidateStoreId} appends an empty Raft entry at index ${noOpIndex}. This is internal leadership confirmation, not a user-data mutation.`,
      {
        source: candidateStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [elected.id],
        branchId: 'leader-confirmation',
        deltas: [{
          kind: 'raft_propose',
          regionId: region.id,
          index: noOpIndex,
          operation: 'leader_noop',
          term: baselineTerm + 1,
        }],
        metadata: {
          term: baselineTerm + 1,
          index: noOpIndex,
          entryKind: 'leader_noop',
          userDataMutation: false,
        },
      },
    )
    const persisted = addRaftEvent(
      'raft',
      'raft_leader_noop_persist',
      'Persist the no-op on two live voters',
      `${candidateStoreId} and ${voterStoreId} persist term ${baselineTerm + 1}, index ${noOpIndex}; ${oldLeaderStoreId} remains down at index ${baselineIndex}.`,
      {
        source: candidateStoreId,
        target: voterStoreId,
        regionId: region.id,
        dependsOn: [proposed.id],
        branchId: 'leader-confirmation',
        deltas: [{
          kind: 'raft_persist',
          regionId: region.id,
          index: noOpIndex,
          term: baselineTerm + 1,
          storeIds: [candidateStoreId, voterStoreId],
        }],
        metadata: {
          term: baselineTerm + 1,
          index: noOpIndex,
          persistedVoters: 2,
          unavailableVoters: 1,
        },
      },
    )
    const committed = addRaftEvent(
      'raft',
      'raft_leader_noop_commit',
      'Commit the no-op at quorum',
      `Two of three configured voters persisted index ${noOpIndex}; the current-term no-op becomes committed.`,
      {
        source: voterStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [persisted.id],
        branchId: 'leader-confirmation',
        deltas: [{
          kind: 'raft_commit',
          regionId: region.id,
          index: noOpIndex,
          term: baselineTerm + 1,
          acknowledgements: 2,
          quorum: 2,
        }],
        metadata: {
          term: baselineTerm + 1,
          index: noOpIndex,
          acknowledgements: 2,
          quorum: 2,
        },
      },
    )
    const leaderApplied = addRaftEvent(
      'raft',
      'raft_leader_noop_apply',
      'The new leader applies the committed no-op',
      `${candidateStoreId} advances applied index to ${noOpIndex}; the read still has not created a user-data Raft entry.`,
      {
        source: candidateStoreId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [committed.id],
        branchId: 'leader-confirmation',
        deltas: [{
          kind: 'raft_apply',
          regionId: region.id,
          index: noOpIndex,
          term: baselineTerm + 1,
          storeIds: [candidateStoreId],
        }],
        metadata: {
          term: baselineTerm + 1,
          index: noOpIndex,
          storeId: candidateStoreId,
          userDataMutation: false,
        },
      },
    )
    const observed = addRaftEvent(
      'raft',
      'pd_observes_region_leader',
      'PD observes the new leader heartbeat',
      `${candidateStoreId} reports Region ${region.id}'s new leader metadata to PD after the Raft peers completed the election.`,
      {
        source: candidateStoreId,
        target: pdId,
        regionId: region.id,
        dependsOn: [leaderApplied.id],
        branchId: 'routing-recovery',
        deltas: [{
          kind: 'raft_pd_state',
          action: 'observe_leader',
          regionId: region.id,
          leaderStoreId: candidateStoreId,
          role: 'observer_and_routing_only',
        }],
        metadata: {
          pdRole: 'observer_only',
          pdVoted: false,
          leaderStoreId: candidateStoreId,
        },
      },
    )
    const refreshed = addRaftEvent(
      'sql',
      'region_cache_refreshed',
      'Refresh Region routing metadata',
      `After the internal backoff, TiDB learns that ${candidateStoreId} is Region ${region.id}'s leader and refreshes its cache.`,
      {
        source: tidbId,
        target: pdId,
        regionId: region.id,
        dependsOn: [observed.id, backoff.id],
        branchId: 'region-request',
        deltas: [
          {
            kind: 'raft_pd_state',
            action: 'route_lookup',
            regionId: region.id,
            leaderStoreId: candidateStoreId,
            role: 'observer_and_routing_only',
          },
          {
            kind: 'raft_region_request',
            action: 'refresh',
            regionId: region.id,
            logicalRequestId,
            attempt: 1,
            targetStoreId: candidateStoreId,
            backoffMs,
            source: 'tidb_internal',
            clientVisibleError: false,
          },
        ],
        metadata: {
          cacheState: 'refreshed',
          leaderStoreId: candidateStoreId,
          retryBoundary: 'tidb_internal_region_request',
        },
      },
    )
    const attemptTwo = addRaftEvent(
      'kv',
      'region_request_retry',
      'Retry the same logical request on the new leader',
      `TiDB sends ${logicalRequestId} attempt 2 to ${candidateStoreId}. This is not an application transaction retry.`,
      {
        source: tidbId,
        target: candidateStoreId,
        regionId: region.id,
        dependsOn: [refreshed.id],
        branchId: 'region-request',
        deltas: [{
          kind: 'raft_region_request',
          action: 'retry',
          regionId: region.id,
          logicalRequestId,
          attempt: 2,
          targetStoreId: candidateStoreId,
          backoffMs,
          source: 'tidb_internal',
          clientVisibleError: false,
        }],
        metadata: {
          logicalRequestId,
          attempt: 2,
          sameLogicalRequest: true,
          applicationRetry: false,
        },
      },
    )
    const served = addRaftEvent(
      'kv',
      'point_get_recovered',
      'The new leader serves the modeled snapshot',
      `${candidateStoreId} serves Region ${region.id} at applied index ${noOpIndex}. TiCity records no result row.`,
      {
        source: candidateStoreId,
        target: tidbId,
        regionId: region.id,
        dependsOn: [attemptTwo.id],
        branchId: 'region-request',
        deltas: [{
          kind: 'raft_region_request',
          action: 'serve',
          regionId: region.id,
          logicalRequestId,
          attempt: 2,
          targetStoreId: candidateStoreId,
          backoffMs,
          source: 'tidb_internal',
          clientVisibleError: false,
        }],
        metadata: {
          snapshotTs: startTs,
          appliedIndex: noOpIndex,
          resultRowsGenerated: false,
        },
      },
    )
    const response = addRaftEvent(
      'return',
      'raft_failover_complete',
      'Return success without exposing the transient Region error',
      'The same client request completes after TiDB-internal Region retry. The modeled recovery stayed within the client-visible error threshold.',
      {
        source: tidbId,
        target: 'client',
        dependsOn: [served.id],
        branchId: 'region-request',
        deltas: [{
          kind: 'raft_region_request',
          action: 'complete',
          regionId: region.id,
          logicalRequestId,
          attempt: 2,
          targetStoreId: candidateStoreId,
          backoffMs,
          source: 'tidb_internal',
          clientVisibleError: false,
        }],
        metadata: {
          logicalRequestId,
          attempts: 2,
          clientVisibleError: false,
          applicationRetry: false,
        },
      },
    )
    addRaftEvent(
      'raft',
      'raft_follower_noop_apply',
      'The surviving follower applies in background',
      `${voterStoreId} advances applied index to ${noOpIndex}; the failed ${oldLeaderStoreId} peer remains at ${baselineIndex}.`,
      {
        source: candidateStoreId,
        target: voterStoreId,
        regionId: region.id,
        dependsOn: [response.id],
        branchId: 'leader-confirmation',
        path: 'background',
        deltas: [{
          kind: 'raft_apply',
          regionId: region.id,
          index: noOpIndex,
          term: baselineTerm + 1,
          storeIds: [voterStoreId],
        }],
        metadata: {
          term: baselineTerm + 1,
          index: noOpIndex,
          storeId: voterStoreId,
          clientAlreadyResponded: true,
        },
      },
    )

    state.metrics.statements++
    state.metrics.reads++
    return recordReceipt(
      id,
      'tikv-failover',
      analysis,
      startTs,
      null,
      'succeeded',
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
        deltas: [{
          kind: 'deadlock_client_error',
          deadlockId,
          transactionId: transactionBId,
          errorCode: 1213,
          retryable: false,
        }],
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

  /**
   * Model-5 Protocol Lab. These are three independent representative
   * optimistic transactions, not a latency race and not three executions of
   * the displayed INSERT. Every TiKV mutation crosses its Region's own Raft
   * quorum before MVCC changes; transaction commit stays a separate layer.
   */
  function traceDetailedCommitProtocols(
    id: string,
    analysis: SqlAnalysis,
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const tidbId = 'tidb-1'
    const regionIds = [24, 25, 26, 27, 28] as const
    const protocolRegions = regionIds.map((regionId) => {
      const region = state.regions.find((candidate) => candidate.id === regionId)
      if (!region) throw new Error(`Protocol Lab requires Region ${regionId}.`)
      if (region.peers.length !== 3) {
        throw new Error(`Protocol Lab requires three voters in Region ${regionId}.`)
      }
      return region
    })
    const byRegionId = new Map(protocolRegions.map((region) => [region.id, region]))
    const regionDefinition = (
      regionId: number,
      role: 'primary' | 'secondary',
      mutationCount: number,
    ) => {
      const region = byRegionId.get(regionId)
      if (!region) throw new Error(`Missing Protocol Lab Region ${regionId}.`)
      return {
        regionId,
        role,
        leaderStoreId: region.leaderStoreId,
        voterStoreIds: region.peers.map((peer) => peer.storeId) as [
          StoreId,
          StoreId,
          StoreId,
        ],
        mutationCount,
      }
    }

    let protocolLab: TraceProtocolLabSnapshot = createProtocolLabState([
      {
        id: 'one_pc',
        protocol: '1pc',
        requestId: 'request-1pc',
        transactionId: 'txn-1pc',
        eligibility: {
          enable1Pc: true,
          enableAsyncCommit: true,
          consistency: 'linearizable',
          mutationCount: 2,
          totalKeyBytes: 16,
          regionCount: 1,
          onePcEligible: true,
          asyncCommitEligible: true,
          selected: '1pc',
          selectionReason: 'single_region_one_pc_model_case',
          onePcRejectedBeforeRpc: false,
          asyncRejectedAtClientPrecheck: false,
          onePcDecisionPoint: 'tikv_prewrite',
          asyncDecisionPoint: 'tikv_prewrite',
          runtimeFallback: false,
          tryOnePcSent: true,
          asyncKeyCountLimit: 256,
          asyncTotalKeyBytesLimit: 4096,
        },
        regions: [regionDefinition(24, 'primary', 2)],
      },
      {
        id: 'async_commit',
        protocol: 'async_commit',
        requestId: 'request-async',
        transactionId: 'txn-async',
        eligibility: {
          enable1Pc: true,
          enableAsyncCommit: true,
          consistency: 'linearizable',
          mutationCount: 2,
          totalKeyBytes: 16,
          regionCount: 2,
          onePcEligible: false,
          asyncCommitEligible: true,
          selected: 'async_commit',
          selectionReason: 'multi_region_async_commit_model_case',
          onePcRejectedBeforeRpc: true,
          asyncRejectedAtClientPrecheck: false,
          onePcDecisionPoint: 'region_batching',
          asyncDecisionPoint: 'tikv_prewrite',
          runtimeFallback: false,
          tryOnePcSent: false,
          asyncKeyCountLimit: 256,
          asyncTotalKeyBytesLimit: 4096,
        },
        regions: [
          regionDefinition(25, 'primary', 1),
          regionDefinition(26, 'secondary', 1),
        ],
      },
      {
        id: 'two_pc',
        protocol: '2pc',
        requestId: 'request-2pc',
        transactionId: 'txn-2pc',
        eligibility: {
          enable1Pc: true,
          enableAsyncCommit: true,
          consistency: 'linearizable',
          mutationCount: 257,
          totalKeyBytes: 2056,
          regionCount: 2,
          onePcEligible: false,
          asyncCommitEligible: false,
          selected: '2pc',
          selectionReason: 'async_key_count_limit_model_case',
          onePcRejectedBeforeRpc: true,
          asyncRejectedAtClientPrecheck: true,
          onePcDecisionPoint: 'region_batching',
          asyncDecisionPoint: 'client_precheck',
          runtimeFallback: false,
          tryOnePcSent: false,
          asyncKeyCountLimit: 256,
          asyncTotalKeyBytesLimit: 4096,
        },
        regions: [
          regionDefinition(27, 'primary', 129),
          regionDefinition(28, 'secondary', 128),
        ],
      },
    ])

    function projection(): TraceStateSnapshot {
      return freezeTraceSnapshot({
        modelVersion: state.modelVersion,
        tsoLastAllocated: state.tso.lastAllocated,
        transaction: null,
        regions: [],
        protocolLab,
      })
    }

    function addProtocolEvent(
      domain: TraceDomain,
      kind: string,
      label: string,
      detail: string,
      options: EventOptions = {},
    ): TraceEvent {
      const deltas = options.deltas ?? []
      for (const delta of deltas) {
        if (isProtocolLabDelta(delta)) {
          protocolLab = reduceProtocolLabState(protocolLab, delta)
        }
        if (
          delta.kind === 'protocol_region_raft' &&
          delta.action === 'propose'
        ) {
          state.metrics.raftEntries++
        }
      }
      return builder.add(domain, kind, label, detail, {
        ...options,
        snapshot: projection(),
        deltas,
      })
    }

    function lane(
      snapshot: TraceProtocolLabSnapshot,
      laneId: TraceProtocolLaneId,
    ): TraceProtocolLaneSnapshot {
      const result = snapshot.lanes.find((candidate) => candidate.id === laneId)
      if (!result) throw new Error(`Missing Protocol Lab lane ${laneId}.`)
      return result
    }

    function allocateProtocolTs(): number {
      const physical = TSO_BASE + Math.floor(state.t * 1_000) * 1_000
      const timestamp = Math.max(state.tso.lastAllocated + 100, physical)
      state.tso.lastAllocated = timestamp
      state.tso.allocations++
      return timestamp
    }

    const nextRaftIndex = new Map(
      protocolRegions.map((region) => [region.id, region.commitIndex]),
    )
    function raftSequence(
      laneId: TraceProtocolLaneId,
      regionId: number,
      operation: TraceProtocolRaftOperation,
      parent: TraceEvent,
      applyKind: string,
      path: TracePath = 'critical',
    ): TraceEvent {
      const region = byRegionId.get(regionId)
      if (!region) throw new Error(`Missing Protocol Lab Region ${regionId}.`)
      const index = (nextRaftIndex.get(regionId) ?? region.commitIndex) + 1
      nextRaftIndex.set(regionId, index)
      const branchId = `${laneId}-region-${regionId}`
      const propose = addProtocolEvent(
        'raft',
        'protocol_raft_propose',
        'Region leader proposed the mutation',
        `Region ${regionId} proposed ${operation} at synthetic Raft index ${index}.`,
        {
          source: region.leaderStoreId,
          target: region.leaderStoreId,
          regionId,
          dependsOn: [parent.id],
          path,
          branchId,
          deltas: [{
            kind: 'protocol_region_raft',
            laneId,
            regionId,
            operation,
            action: 'propose',
            index,
          }],
          metadata: {
            operation,
            raftLayer: 'per_region_consensus',
            index,
          },
        },
      )
      const quorumStores = [
        region.leaderStoreId,
        region.peers.find((peer) => peer.storeId !== region.leaderStoreId)
          ?.storeId ?? region.leaderStoreId,
      ]
      const persisted = addProtocolEvent(
        'raft',
        'protocol_raft_persist_quorum',
        'Two voters persisted the Raft entry',
        `Region ${regionId} reached its modeled 2/3 persistence quorum.`,
        {
          source: region.leaderStoreId,
          target: quorumStores[1],
          regionId,
          dependsOn: [propose.id],
          path,
          branchId,
          deltas: [{
            kind: 'protocol_region_raft',
            laneId,
            regionId,
            operation,
            action: 'persist_quorum',
            index,
            storeIds: quorumStores,
          }],
          metadata: {
            acknowledgements: 2,
            quorum: 2,
            voterCount: 3,
          },
        },
      )
      const committed = addProtocolEvent(
        'raft',
        'protocol_raft_commit',
        'Region Raft committed the entry',
        `Region ${regionId} committed ${operation}; transaction coordination remains a separate layer.`,
        {
          source: region.leaderStoreId,
          target: region.leaderStoreId,
          regionId,
          dependsOn: [persisted.id],
          path,
          branchId,
          deltas: [{
            kind: 'protocol_region_raft',
            laneId,
            regionId,
            operation,
            action: 'commit',
            index,
          }],
          metadata: {
            transactionLayer: 'tidb_transaction_commit',
            raftLayer: 'per_region_consensus',
          },
        },
      )
      return addProtocolEvent(
        'kv',
        applyKind,
        operation === 'one_pc_prewrite'
          ? 'Apply 1PC MVCC records atomically'
          : operation === 'prewrite'
            ? 'Apply tentative value and prewrite lock'
            : 'Apply commit record and remove lock',
        operation === 'one_pc_prewrite'
          ? 'The representative non-short value enters default CF and its commit record enters write CF; no durable lock-CF state appears.'
          : operation === 'prewrite'
            ? `Region ${regionId} applies the representative non-short value and durable transactional lock after Raft commit.`
            : `Region ${regionId} applies the write-CF commit record and removes the prewrite lock.`,
        {
          source: region.leaderStoreId,
          target: region.leaderStoreId,
          regionId,
          dependsOn: [committed.id],
          path,
          branchId,
          deltas: [{
            kind: 'protocol_region_raft',
            laneId,
            regionId,
            operation,
            action: 'apply',
            index,
          }],
          metadata: {
            valuePlacement: 'representative_non_short_value_model_policy',
            asyncApplyPrewrite: false,
          },
        },
      )
    }

    const comparison = addProtocolEvent(
      'client',
      'protocol_comparison_start',
      'Begin the commit-protocol comparison',
      'Three independent optimistic fixtures compare message shape, not latency. SQL text, keys, values, and rows are not retained.',
      {
        source: 'client',
        target: tidbId,
        deltas: [{
          kind: 'protocol_lab_focus',
          laneId: null,
          phase: 'running',
        }],
        metadata: {
          fixtures: 3,
          target: 'tidb-v8.5',
          representativeProtocolProfiles: true,
          latencyBenchmark: false,
        },
      },
    )

    // 1PC: one Prewrite RPC carrying TryOnePc, one Region Raft entry.
    const oneRequest = addProtocolEvent(
      'client',
      'protocol_client_request',
      'Start the 1PC fixture',
      'request-1pc represents two aggregate mutations grouped into one Region batch.',
      {
        source: 'client',
        target: tidbId,
        dependsOn: [comparison.id],
        branchId: 'one_pc',
        deltas: [
          { kind: 'protocol_lab_focus', laneId: 'one_pc', phase: 'running' },
          {
            kind: 'protocol_lane_stage',
            laneId: 'one_pc',
            from: 'idle',
            to: 'requested',
          },
        ],
        metadata: {
          requestId: 'request-1pc',
          transactionId: 'txn-1pc',
          representation: 'aggregate_counts_only',
        },
      },
    )
    const oneStartTs = allocateProtocolTs()
    const oneTransaction: TransactionState = {
      id: 'txn-1pc',
      clientId: 'request-1pc',
      mode: 'optimistic',
      protocol: '1pc',
      startTs: oneStartTs,
      commitTs: null,
      regionIds: [24],
      primaryRegionId: 24,
      phase: 'active',
      conflict: false,
    }
    state.transactions.push(oneTransaction)
    const oneStart = addProtocolEvent(
      'tso',
      'protocol_start_ts',
      'PD allocated 1PC start_ts',
      `request-1pc starts at synthetic timestamp ${oneStartTs}.`,
      {
        source: tidbId,
        target: 'pd-1',
        dependsOn: [oneRequest.id],
        branchId: 'one_pc',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'one_pc',
            purpose: 'start_ts',
            source: 'pd',
            timestamp: oneStartTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'one_pc',
            from: 'requested',
            to: 'started',
          },
        ],
        metadata: { source: 'pd_tso', startTs: oneStartTs },
      },
    )
    const oneEligibility = addProtocolEvent(
      'txn2pc',
      'protocol_eligibility_check',
      'Choose the TryOnePc candidate',
      'Both optional features are enabled. One Region batch makes 1PC the fixture candidate; success is confirmed only when TiKV returns one_pc_commit_ts.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [oneStart.id],
        branchId: 'one_pc',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'one_pc',
          from: 'started',
          to: 'selected',
        }],
        metadata: {
          candidate: '1pc',
          decisionPoint: 'tikv_prewrite',
          tryOnePc: true,
          useAsyncCommit: true,
          runtimeFallback: false,
        },
      },
    )
    const oneLatestTs = allocateProtocolTs()
    const oneMinTs = oneLatestTs + 1
    const oneMaxTs = oneLatestTs + 80
    const oneLatest = addProtocolEvent(
      'tso',
      'protocol_latest_ts_floor',
      'Get latest TSO and calculate the 1PC floor',
      `Linear consistency uses latest_ts ${oneLatestTs}; the request floor is latest_ts + 1 and max_commit_ts is only a representative safe-window bound.`,
      {
        source: tidbId,
        target: 'pd-1',
        dependsOn: [oneEligibility.id],
        branchId: 'one_pc',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'one_pc',
            purpose: 'latest_ts',
            source: 'pd',
            timestamp: oneLatestTs,
          },
          {
            kind: 'protocol_timestamp',
            laneId: 'one_pc',
            purpose: 'request_min_commit_ts',
            source: 'tidb_model_bound',
            timestamp: oneMinTs,
          },
          {
            kind: 'protocol_timestamp',
            laneId: 'one_pc',
            purpose: 'max_commit_ts',
            source: 'tidb_model_bound',
            timestamp: oneMaxTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'one_pc',
            from: 'selected',
            to: 'latest_ts',
          },
        ],
        metadata: {
          latestTs: oneLatestTs,
          minCommitTsFloor: oneMinTs,
          maxCommitTs: oneMaxTs,
          maxCommitTsPolicy: 'representative_safe_window_model_bound',
        },
      },
    )
    const oneDispatch = addProtocolEvent(
      'txn2pc',
      'one_pc_prewrite_dispatch',
      'Send Prewrite with TryOnePc',
      '1PC is a Prewrite wire request with TryOnePc=true, not a separate normal Commit phase.',
      {
        source: tidbId,
        target: byRegionId.get(24)?.leaderStoreId,
        regionId: 24,
        dependsOn: [oneLatest.id],
        branchId: 'one_pc-region-24',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'one_pc',
          from: 'latest_ts',
          to: 'prewriting',
        }],
        metadata: {
          tryOnePc: true,
          useAsyncCommit: true,
          normalCommitRpc: false,
        },
      },
    )
    const oneApply = raftSequence(
      'one_pc',
      24,
      'one_pc_prewrite',
      oneDispatch,
      'raft_apply_one_pc_mvcc',
    )
    const oneCommitTs = oneMinTs + 1
    const oneResult = addProtocolEvent(
      'txn2pc',
      'one_pc_result',
      'TiKV returned one_pc_commit_ts',
      `The Region returns synthetic one_pc_commit_ts ${oneCommitTs}; PD did not allocate this commit timestamp.`,
      {
        source: byRegionId.get(24)?.leaderStoreId,
        target: tidbId,
        regionId: 24,
        dependsOn: [oneApply.id],
        branchId: 'one_pc',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'one_pc',
            purpose: 'one_pc_commit_ts',
            source: 'tikv',
            timestamp: oneCommitTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'one_pc',
            from: 'prewriting',
            to: 'committing',
          },
        ],
        metadata: {
          onePcCommitTs: oneCommitTs,
          source: 'tikv_calculated',
          selected: '1pc',
          runtimeFallback: false,
        },
      },
    )
    const oneResponse = addProtocolEvent(
      'return',
      'protocol_client_response',
      '1PC returned committed',
      'The client response follows the one-Region Raft apply; there is no normal Commit RPC or background lock cleanup.',
      {
        source: tidbId,
        target: 'client',
        dependsOn: [oneResult.id],
        branchId: 'one_pc',
        deltas: [
          {
            kind: 'protocol_client_response',
            laneId: 'one_pc',
            commitTs: oneCommitTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'one_pc',
            from: 'committing',
            to: 'client_acknowledged',
          },
        ],
        metadata: {
          committed: true,
          clientBoundary: true,
          backgroundRequired: false,
        },
      },
    )
    const oneComplete = addProtocolEvent(
      'txn2pc',
      'protocol_branch_complete',
      '1PC fixture complete',
      'The single Prewrite/TryOnePc path is complete with no durable lock-CF intermediate.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [oneResponse.id],
        branchId: 'one_pc',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'one_pc',
          from: 'client_acknowledged',
          to: 'complete',
        }],
        metadata: { protocol: '1pc' },
      },
    )
    oneTransaction.phase = 'committed'
    oneTransaction.commitTs = oneCommitTs

    // Async Commit: two Region prewrites, response, then background Commit RPCs.
    const asyncRequest = addProtocolEvent(
      'client',
      'protocol_client_request',
      'Start the Async Commit fixture',
      'request-async represents two aggregate mutations in two Region batches.',
      {
        source: 'client',
        target: tidbId,
        dependsOn: [oneComplete.id],
        branchId: 'async_commit',
        deltas: [
          {
            kind: 'protocol_lab_focus',
            laneId: 'async_commit',
            phase: 'running',
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'async_commit',
            from: 'idle',
            to: 'requested',
          },
        ],
        metadata: {
          requestId: 'request-async',
          transactionId: 'txn-async',
          representation: 'aggregate_counts_only',
        },
      },
    )
    const asyncStartTs = allocateProtocolTs()
    const asyncTransaction: TransactionState = {
      id: 'txn-async',
      clientId: 'request-async',
      mode: 'optimistic',
      protocol: 'async_commit',
      startTs: asyncStartTs,
      commitTs: null,
      regionIds: [25, 26],
      primaryRegionId: 25,
      phase: 'active',
      conflict: false,
    }
    state.transactions.push(asyncTransaction)
    const asyncStart = addProtocolEvent(
      'tso',
      'protocol_start_ts',
      'PD allocated Async Commit start_ts',
      `request-async starts at synthetic timestamp ${asyncStartTs}.`,
      {
        source: tidbId,
        target: 'pd-1',
        dependsOn: [asyncRequest.id],
        branchId: 'async_commit',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'async_commit',
            purpose: 'start_ts',
            source: 'pd',
            timestamp: asyncStartTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'async_commit',
            from: 'requested',
            to: 'started',
          },
        ],
        metadata: { source: 'pd_tso', startTs: asyncStartTs },
      },
    )
    const asyncEligibility = addProtocolEvent(
      'txn2pc',
      'protocol_eligibility_check',
      'Check 1PC and Async Commit candidates',
      'Two Region batches reject 1PC before any TryOnePc RPC. The two-mutation profile remains within the pinned Async Commit client limits.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [asyncStart.id],
        branchId: 'async_commit',
        metadata: {
          onePcOutcome: 'rejected_before_rpc',
          onePcDecisionPoint: 'region_batching',
          asyncMutationLimit: 256,
          asyncTotalKeyBytesLimit: 4096,
          mutationCount: 2,
          totalKeyBytes: 16,
        },
      },
    )
    const asyncSelected = addProtocolEvent(
      'txn2pc',
      'protocol_selection',
      'Select Async Commit',
      'The client selects Async Commit before prewrite; no TiKV runtime fallback occurs in this fixture.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [asyncEligibility.id],
        branchId: 'async_commit',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'async_commit',
          from: 'started',
          to: 'selected',
        }],
        metadata: {
          selected: 'async_commit',
          useAsyncCommit: true,
          tryOnePc: false,
          runtimeFallback: false,
        },
      },
    )
    const asyncLatestTs = allocateProtocolTs()
    const asyncMinFloor = asyncLatestTs + 1
    const asyncMaxTs = asyncLatestTs + 80
    const asyncLatest = addProtocolEvent(
      'tso',
      'protocol_latest_ts_floor',
      'Get latest TSO and calculate the Async floor',
      `Linear consistency uses latest_ts ${asyncLatestTs}; request min_commit_ts is latest_ts + 1 and max_commit_ts is a representative bound.`,
      {
        source: tidbId,
        target: 'pd-1',
        dependsOn: [asyncSelected.id],
        branchId: 'async_commit',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'async_commit',
            purpose: 'latest_ts',
            source: 'pd',
            timestamp: asyncLatestTs,
          },
          {
            kind: 'protocol_timestamp',
            laneId: 'async_commit',
            purpose: 'request_min_commit_ts',
            source: 'tidb_model_bound',
            timestamp: asyncMinFloor,
          },
          {
            kind: 'protocol_timestamp',
            laneId: 'async_commit',
            purpose: 'max_commit_ts',
            source: 'tidb_model_bound',
            timestamp: asyncMaxTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'async_commit',
            from: 'selected',
            to: 'latest_ts',
          },
        ],
        metadata: {
          latestTs: asyncLatestTs,
          minCommitTsFloor: asyncMinFloor,
          maxCommitTs: asyncMaxTs,
        },
      },
    )
    const asyncPrewriteResults = new Map<number, TraceEvent>()
    let previousAsyncPrewriteResult: TraceEvent | null = null
    for (const [index, regionId] of [25, 26].entries()) {
      const dispatch = addProtocolEvent(
        'txn2pc',
        'async_prewrite_dispatch',
        `Send Async Prewrite to Region ${regionId}`,
        regionId === 25
          ? 'The primary Prewrite carries UseAsyncCommit and only a secondary count in this projection; no key list is retained.'
          : 'The secondary Prewrite carries UseAsyncCommit without a projected secondary list.',
        {
          source: tidbId,
          target: byRegionId.get(regionId)?.leaderStoreId,
          regionId,
          dependsOn: [asyncLatest.id],
          ...(previousAsyncPrewriteResult
            ? { presentationAfter: previousAsyncPrewriteResult.id }
            : {}),
          branchId: `async_commit-region-${regionId}`,
          deltas: index === 0
            ? [{
              kind: 'protocol_lane_stage',
              laneId: 'async_commit',
              from: 'latest_ts',
              to: 'prewriting',
            }]
            : [],
          metadata: {
            useAsyncCommit: true,
            tryOnePc: false,
            role: index === 0 ? 'primary' : 'secondary',
            secondaryCount: index === 0 ? 1 : 0,
            presentationScheduling:
              'deterministic_sibling_serialization_model_policy',
          },
        },
      )
      const apply = raftSequence(
        'async_commit',
        regionId,
        'prewrite',
        dispatch,
        'raft_apply_prewrite_mvcc',
      )
      const returnedMinCommitTs = asyncMinFloor + index + 1
      const result = addProtocolEvent(
        'txn2pc',
        'async_prewrite_result',
        `Region ${regionId} returned min_commit_ts`,
        `TiKV calculated synthetic min_commit_ts ${returnedMinCommitTs} after the prewrite applied.`,
        {
          source: byRegionId.get(regionId)?.leaderStoreId,
          target: tidbId,
          regionId,
          dependsOn: [apply.id],
          branchId: `async_commit-region-${regionId}`,
          deltas: [{
            kind: 'protocol_timestamp',
            laneId: 'async_commit',
            purpose: 'returned_min_commit_ts',
            source: 'tikv',
            timestamp: returnedMinCommitTs,
            regionId,
          }],
          metadata: {
            minCommitTs: returnedMinCommitTs,
            source: 'tikv_calculated',
          },
        },
      )
      asyncPrewriteResults.set(regionId, result)
      previousAsyncPrewriteResult = result
    }
    const asyncCommitTs = Math.max(
      ...lane(protocolLab, 'async_commit').regions.map((region) =>
        region.returnedMinCommitTs ?? 0),
    )
    const asyncDecision = addProtocolEvent(
      'txn2pc',
      'async_commit_decision',
      'All prewrites established Async Commit',
      `commit_ts ${asyncCommitTs} is the maximum min_commit_ts returned by the two Regions, not a PD commit_ts allocation.`,
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [
          asyncPrewriteResults.get(25)!.id,
          asyncPrewriteResults.get(26)!.id,
        ],
        branchId: 'async_commit',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'async_commit',
            purpose: 'async_commit_ts',
            source: 'tikv',
            timestamp: asyncCommitTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'async_commit',
            from: 'prewriting',
            to: 'prewritten',
          },
        ],
        metadata: {
          commitTs: asyncCommitTs,
          source: 'max_prewrite_min_commit_ts',
          runtimeFallback: false,
        },
      },
    )
    const asyncResponse = addProtocolEvent(
      'return',
      'protocol_client_response',
      'Async Commit returned committed',
      'The logical commit is acknowledged while durable Async Commit locks still await background Commit RPCs.',
      {
        source: tidbId,
        target: 'client',
        dependsOn: [asyncDecision.id],
        branchId: 'async_commit',
        deltas: [
          {
            kind: 'protocol_client_response',
            laneId: 'async_commit',
            commitTs: asyncCommitTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'async_commit',
            from: 'prewritten',
            to: 'client_acknowledged',
          },
        ],
        metadata: {
          committed: true,
          clientBoundary: true,
          locksRemain: 2,
        },
      },
    )
    const asyncBackgroundApplies = new Map<number, TraceEvent>()
    let previousAsyncBackgroundApply: TraceEvent | null = null
    for (const [index, regionId] of [25, 26].entries()) {
      const dispatch = addProtocolEvent(
        'txn2pc',
        'async_commit_background_dispatch',
        `Dispatch background Commit to Region ${regionId}`,
        'The response boundary is architectural; this fixture gives the background branch a deterministic display order.',
        {
          source: tidbId,
          target: byRegionId.get(regionId)?.leaderStoreId,
          regionId,
          dependsOn: [asyncResponse.id],
          ...(previousAsyncBackgroundApply
            ? { presentationAfter: previousAsyncBackgroundApply.id }
            : {}),
          path: 'background',
          branchId: `async_commit-background-${regionId}`,
          deltas: index === 0
            ? [{
              kind: 'protocol_lane_stage',
              laneId: 'async_commit',
              from: 'client_acknowledged',
              to: 'background',
            }]
            : [],
          metadata: {
            criticalPath: false,
            scheduling: 'deterministic_after_client_boundary_model_policy',
            presentationScheduling:
              'deterministic_sibling_serialization_model_policy',
          },
        },
      )
      const apply = raftSequence(
        'async_commit',
        regionId,
        'commit_async',
        dispatch,
        'raft_apply_commit_mvcc',
        'background',
      )
      asyncBackgroundApplies.set(regionId, apply)
      previousAsyncBackgroundApply = apply
    }
    const asyncComplete = addProtocolEvent(
      'txn2pc',
      'protocol_branch_complete',
      'Async Commit background cleanup complete',
      'Both Region locks are removed and both write-CF commit records are applied.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [
          asyncBackgroundApplies.get(25)!.id,
          asyncBackgroundApplies.get(26)!.id,
        ],
        path: 'background',
        branchId: 'async_commit',
        deltas: [
          {
            kind: 'protocol_background_complete',
            laneId: 'async_commit',
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'async_commit',
            from: 'background',
            to: 'complete',
          },
        ],
        metadata: { protocol: 'async_commit', remainingLocks: 0 },
      },
    )
    asyncTransaction.phase = 'committed'
    asyncTransaction.commitTs = asyncCommitTs

    // Regular 2PC: prewrite all, PD commit_ts, primary commit, response,
    // secondary background commit.
    const twoRequest = addProtocolEvent(
      'client',
      'protocol_client_request',
      'Start the regular 2PC fixture',
      'request-2pc is an aggregate representative profile of 257 mutations, not a projection of the displayed INSERT.',
      {
        source: 'client',
        target: tidbId,
        dependsOn: [asyncComplete.id],
        branchId: 'two_pc',
        deltas: [
          { kind: 'protocol_lab_focus', laneId: 'two_pc', phase: 'running' },
          {
            kind: 'protocol_lane_stage',
            laneId: 'two_pc',
            from: 'idle',
            to: 'requested',
          },
        ],
        metadata: {
          requestId: 'request-2pc',
          transactionId: 'txn-2pc',
          representation: 'aggregate_counts_only',
          mutationCount: 257,
          totalKeyBytes: 2056,
        },
      },
    )
    const twoStartTs = allocateProtocolTs()
    const twoTransaction: TransactionState = {
      id: 'txn-2pc',
      clientId: 'request-2pc',
      mode: 'optimistic',
      protocol: '2pc',
      startTs: twoStartTs,
      commitTs: null,
      regionIds: [27, 28],
      primaryRegionId: 27,
      phase: 'active',
      conflict: false,
    }
    state.transactions.push(twoTransaction)
    const twoStart = addProtocolEvent(
      'tso',
      'protocol_start_ts',
      'PD allocated regular 2PC start_ts',
      `request-2pc starts at synthetic timestamp ${twoStartTs}.`,
      {
        source: tidbId,
        target: 'pd-1',
        dependsOn: [twoRequest.id],
        branchId: 'two_pc',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'two_pc',
            purpose: 'start_ts',
            source: 'pd',
            timestamp: twoStartTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'two_pc',
            from: 'requested',
            to: 'started',
          },
        ],
        metadata: { source: 'pd_tso', startTs: twoStartTs },
      },
    )
    const twoEligibility = addProtocolEvent(
      'txn2pc',
      'protocol_eligibility_check',
      'Reject optimization candidates before RPC',
      '257 mutations exceed the pinned Async Commit client default of 256; two Region batches also reject 1PC before TryOnePc.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [twoStart.id],
        branchId: 'two_pc',
        metadata: {
          onePcDecisionPoint: 'region_batching',
          asyncDecisionPoint: 'client_precheck',
          mutationCount: 257,
          mutationLimit: 256,
          totalKeyBytes: 2056,
          totalKeyBytesLimit: 4096,
          runtimeFallback: false,
        },
      },
    )
    const twoSelected = addProtocolEvent(
      'txn2pc',
      'protocol_selection',
      'Select regular 2PC',
      'This is client-side selection, not a TiKV runtime fallback from an attempted optimization.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [twoEligibility.id],
        branchId: 'two_pc',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'two_pc',
          from: 'started',
          to: 'selected',
        }],
        metadata: {
          selected: '2pc',
          tryOnePc: false,
          useAsyncCommit: false,
          runtimeFallback: false,
        },
      },
    )
    const twoPrewriteResults = new Map<number, TraceEvent>()
    let previousTwoPcPrewriteResult: TraceEvent | null = null
    for (const [index, regionId] of [27, 28].entries()) {
      const dispatch = addProtocolEvent(
        'txn2pc',
        'two_pc_prewrite_dispatch',
        `Send regular Prewrite to Region ${regionId}`,
        'The Region receives neither TryOnePc nor UseAsyncCommit in this fixture.',
        {
          source: tidbId,
          target: byRegionId.get(regionId)?.leaderStoreId,
          regionId,
          dependsOn: [twoSelected.id],
          ...(previousTwoPcPrewriteResult
            ? { presentationAfter: previousTwoPcPrewriteResult.id }
            : {}),
          branchId: `two_pc-region-${regionId}`,
          deltas: index === 0
            ? [{
              kind: 'protocol_lane_stage',
              laneId: 'two_pc',
              from: 'selected',
              to: 'prewriting',
            }]
            : [],
          metadata: {
            tryOnePc: false,
            useAsyncCommit: false,
            presentationScheduling:
              'deterministic_sibling_serialization_model_policy',
          },
        },
      )
      const apply = raftSequence(
        'two_pc',
        regionId,
        'prewrite',
        dispatch,
        'raft_apply_prewrite_mvcc',
      )
      const result = addProtocolEvent(
        'txn2pc',
        'two_pc_prewrite_result',
        `Region ${regionId} completed regular Prewrite`,
        'The prewrite result follows Raft apply because this fixture pins enable-async-apply-prewrite=false.',
        {
          source: byRegionId.get(regionId)?.leaderStoreId,
          target: tidbId,
          regionId,
          dependsOn: [apply.id],
          branchId: `two_pc-region-${regionId}`,
          metadata: { asyncApplyPrewrite: false },
        },
      )
      twoPrewriteResults.set(regionId, result)
      previousTwoPcPrewriteResult = result
    }
    const allPrewritten = addProtocolEvent(
      'txn2pc',
      'two_pc_all_prewritten',
      'All regular 2PC prewrites completed',
      'Both Regions now contain tentative values and durable prewrite locks.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [
          twoPrewriteResults.get(27)!.id,
          twoPrewriteResults.get(28)!.id,
        ],
        branchId: 'two_pc',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'two_pc',
          from: 'prewriting',
          to: 'prewritten',
        }],
      },
    )
    const twoCommitTs = allocateProtocolTs()
    const twoCommitTimestamp = addProtocolEvent(
      'tso',
      'two_pc_commit_ts',
      'PD allocated regular 2PC commit_ts',
      `Only regular 2PC obtains commit_ts ${twoCommitTs} from PD after all prewrites.`,
      {
        source: tidbId,
        target: 'pd-1',
        dependsOn: [allPrewritten.id],
        branchId: 'two_pc',
        deltas: [
          {
            kind: 'protocol_timestamp',
            laneId: 'two_pc',
            purpose: 'commit_ts',
            source: 'pd',
            timestamp: twoCommitTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'two_pc',
            from: 'prewritten',
            to: 'commit_ts',
          },
        ],
        metadata: { source: 'pd_tso_after_prewrite', commitTs: twoCommitTs },
      },
    )
    const primaryDispatch = addProtocolEvent(
      'txn2pc',
      'two_pc_primary_commit_dispatch',
      'Commit the primary Region',
      'The primary Commit RPC begins the regular 2PC commit phase.',
      {
        source: tidbId,
        target: byRegionId.get(27)?.leaderStoreId,
        regionId: 27,
        dependsOn: [twoCommitTimestamp.id],
        branchId: 'two_pc-primary',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'two_pc',
          from: 'commit_ts',
          to: 'committing',
        }],
        metadata: { role: 'primary', commitTs: twoCommitTs },
      },
    )
    const primaryApply = raftSequence(
      'two_pc',
      27,
      'commit_primary',
      primaryDispatch,
      'raft_apply_commit_mvcc',
    )
    const twoResponse = addProtocolEvent(
      'return',
      'protocol_client_response',
      'Regular 2PC returned after primary commit',
      'The committed primary gates the client response; secondary commit continues in the background.',
      {
        source: tidbId,
        target: 'client',
        dependsOn: [primaryApply.id],
        branchId: 'two_pc',
        deltas: [
          {
            kind: 'protocol_client_response',
            laneId: 'two_pc',
            commitTs: twoCommitTs,
          },
          {
            kind: 'protocol_lane_stage',
            laneId: 'two_pc',
            from: 'committing',
            to: 'client_acknowledged',
          },
        ],
        metadata: {
          committed: true,
          clientBoundary: true,
          secondaryLockRemains: true,
        },
      },
    )
    const secondaryDispatch = addProtocolEvent(
      'txn2pc',
      'two_pc_secondary_commit_dispatch',
      'Dispatch secondary Commit in background',
      'Regular 2PC secondary cleanup is background work; it is distinct from the Async Commit protocol.',
      {
        source: tidbId,
        target: byRegionId.get(28)?.leaderStoreId,
        regionId: 28,
        dependsOn: [twoResponse.id],
        path: 'background',
        branchId: 'two_pc-secondary',
        deltas: [{
          kind: 'protocol_lane_stage',
          laneId: 'two_pc',
          from: 'client_acknowledged',
          to: 'background',
        }],
        metadata: {
          role: 'secondary',
          commitTs: twoCommitTs,
          criticalPath: false,
        },
      },
    )
    const secondaryApply = raftSequence(
      'two_pc',
      28,
      'commit_secondary',
      secondaryDispatch,
      'raft_apply_commit_mvcc',
      'background',
    )
    const twoComplete = addProtocolEvent(
      'txn2pc',
      'protocol_branch_complete',
      'Regular 2PC background cleanup complete',
      'The secondary lock is removed and its write-CF commit record is applied.',
      {
        source: tidbId,
        target: tidbId,
        dependsOn: [secondaryApply.id],
        path: 'background',
        branchId: 'two_pc',
        deltas: [
          { kind: 'protocol_background_complete', laneId: 'two_pc' },
          {
            kind: 'protocol_lane_stage',
            laneId: 'two_pc',
            from: 'background',
            to: 'complete',
          },
        ],
        metadata: { protocol: '2pc', remainingLocks: 0 },
      },
    )
    twoTransaction.phase = 'committed'
    twoTransaction.commitTs = twoCommitTs

    addProtocolEvent(
      'return',
      'protocol_lab_complete',
      'Commit-protocol comparison complete',
      'All three representative fixtures are committed and all modeled background lock cleanup is complete.',
      {
        source: tidbId,
        target: 'client',
        dependsOn: [oneComplete.id, asyncComplete.id, twoComplete.id],
        path: 'background',
        deltas: [{
          kind: 'protocol_lab_focus',
          laneId: null,
          phase: 'complete',
        }],
        metadata: {
          protocols: 3,
          committedTransactions: 3,
          remainingLocks: 0,
          latencyBenchmark: false,
        },
      },
    )

    state.metrics.statements += 3
    state.metrics.writes += 3
    state.metrics.commits += 3
    state.gc.obsoleteVersions += 5
    trimTransactions()
    advanceGc()
    return recordReceipt(
      id,
      'commit-protocols',
      analysis,
      null,
      null,
      'succeeded',
      null,
      builder,
      warnings,
    )
  }

  /**
   * Model-6 GC/Storage Lab. The two rounds pin the TiDB/TiKV v8.5.0
   * Compaction Filter profile: the first candidate is capped to the oldest
   * reported start_ts minus one; after that fixture transaction completes,
   * the second candidate advances without that bound. Resolve Locks,
   * Delete Ranges, global safe-point publication, and asynchronous storage
   * compaction remain separate stages.
   */
  function traceDetailedGcStorage(
    id: string,
    analysis: SqlAnalysis,
    builder: TraceBuilder,
    warnings: string[],
  ): TraceReceipt {
    const initialSafePoint = TSO_BASE
    const blockerStartTs = TSO_BASE + 80_000
    const blockedCandidate = TSO_BASE + 180_000
    const blockedSafePoint = blockerStartTs - 1
    const releasedCandidate = TSO_BASE + 220_000
    const regionIds = [8, 20] as const
    const regions = regionIds.map((regionId) => {
      const region = state.regions.find((candidate) => candidate.id === regionId)
      if (!region) throw new Error(`GC/Storage Lab requires Region ${regionId}.`)
      return region
    })
    const byRegionId = new Map(regions.map((region) => [region.id, region]))
    const storeIds = state.topology.tikv.map((store) => store.id) as StoreId[]
    if (
      storeIds.length !== 3 ||
      new Set(storeIds).size !== 3
    ) {
      throw new Error('GC/Storage Lab requires exactly three TiKV stores.')
    }

    state.tso.lastAllocated = Math.max(
      state.tso.lastAllocated,
      TSO_BASE + 1_000_000,
    )
    let gcLab: TraceGcLabSnapshot = createGcLabState({
      initialSafePoint,
      blockerTransactionId: 'txn-gc-blocker',
      blockerStartTs,
      storeIds,
      locks: [
        {
          id: 'stale-lock-a',
          regionId: 8,
          startTs: TSO_BASE + 30_000,
          primaryStatus: 'committed',
        },
        {
          id: 'stale-lock-b',
          regionId: 20,
          startTs: TSO_BASE + 55_000,
          primaryStatus: 'rolled_back',
        },
      ],
      deleteRanges: [{
        id: 'dropped-range-a',
        dropTs: TSO_BASE + 50_000,
      }],
      keyChains: [
        {
          id: 'chain-a',
          regionId: 8,
          versions: [
            {
              id: 'a-v1',
              commitTs: TSO_BASE + 20_000,
              writeType: 'put',
              valueStorage: 'write_and_default_cf',
            },
            {
              id: 'a-v2',
              commitTs: TSO_BASE + 60_000,
              writeType: 'put',
              valueStorage: 'write_cf_inline',
            },
            {
              id: 'a-v3',
              commitTs: TSO_BASE + 110_000,
              writeType: 'put',
              valueStorage: 'write_and_default_cf',
            },
            {
              id: 'a-v4',
              commitTs: TSO_BASE + 260_000,
              writeType: 'put',
              valueStorage: 'write_and_default_cf',
            },
          ],
        },
        {
          id: 'chain-b',
          regionId: 8,
          versions: [
            {
              id: 'b-v1',
              commitTs: TSO_BASE + 30_000,
              writeType: 'put',
              valueStorage: 'write_and_default_cf',
            },
            {
              id: 'b-v2',
              commitTs: TSO_BASE + 70_000,
              writeType: 'delete',
              valueStorage: 'write_cf_only',
            },
            {
              id: 'b-v3',
              commitTs: TSO_BASE + 250_000,
              writeType: 'put',
              valueStorage: 'write_and_default_cf',
            },
          ],
        },
        {
          id: 'chain-c',
          regionId: 20,
          versions: [
            {
              id: 'c-v1',
              commitTs: TSO_BASE + 90_000,
              writeType: 'put',
              valueStorage: 'write_and_default_cf',
            },
            {
              id: 'c-v2',
              commitTs: TSO_BASE + 150_000,
              writeType: 'put',
              valueStorage: 'write_and_default_cf',
            },
            {
              id: 'c-v3',
              commitTs: TSO_BASE + 280_000,
              writeType: 'put',
              valueStorage: 'write_cf_inline',
            },
          ],
        },
        {
          id: 'chain-d',
          regionId: 20,
          versions: [
            {
              id: 'd-v1',
              commitTs: TSO_BASE + 40_000,
              writeType: 'rollback',
              valueStorage: 'write_cf_only',
            },
            {
              id: 'd-v2',
              commitTs: TSO_BASE + 50_000,
              writeType: 'put',
              valueStorage: 'write_cf_inline',
            },
          ],
        },
      ],
    })

    function projection(): TraceStateSnapshot {
      return freezeTraceSnapshot({
        modelVersion: state.modelVersion,
        tsoLastAllocated: state.tso.lastAllocated,
        transaction: null,
        regions: [],
        gcLab,
      })
    }

    function addGcEvent(
      kind: string,
      label: string,
      detail: string,
      options: EventOptions = {},
    ): TraceEvent {
      const deltas = options.deltas ?? []
      for (const delta of deltas) {
        if (isGcLabDelta(delta)) {
          gcLab = reduceGcLabState(gcLab, delta)
        }
      }
      return builder.add('kv', kind, label, detail, {
        ...options,
        snapshot: projection(),
        deltas,
      })
    }

    const roundOneStart = addGcEvent(
      'gc_round_start',
      'TiDB GC leader started round 1',
      'The elected TiDB GC leader begins a deterministic v8.5.0 teaching round; this is not a SQL transaction.',
      {
        source: 'gc-worker',
        target: 'tidb-1',
        deltas: [{
          kind: 'gc_phase',
          round: 1,
          from: 'idle',
          to: 'preparing',
        }],
        metadata: {
          round: 1,
          runIntervalSeconds: 600,
          gcLeaderLeaseStore: 'mysql.tidb',
          modelTiming: true,
        },
      },
    )
    const roundOneCandidate = addGcEvent(
      'gc_safe_point_candidate',
      'Lifetime produced a candidate safe point',
      'The model candidate represents oracle time minus tidb_gc_life_time; numeric TSO spacing is stretched for teaching.',
      {
        source: 'tidb-1',
        target: 'pd-1',
        dependsOn: [roundOneStart.id],
        deltas: [{
          kind: 'gc_safe_point_candidate',
          round: 1,
          previous: initialSafePoint,
          candidate: blockedCandidate,
        }],
        metadata: {
          previousSafePoint: initialSafePoint,
          candidateSafePoint: blockedCandidate,
          lifeTimeSeconds: 600,
          modelTiming: true,
        },
      },
    )
    const roundOneBound = addGcEvent(
      'gc_min_start_ts_bound',
      'Global min start_ts capped the candidate',
      'Each TiDB reports a bounded minimum start_ts. The oldest active fixture is within max wait, so the allowed value is start_ts - 1.',
      {
        status: 'warning',
        source: 'tidb-2',
        target: 'gc-worker',
        dependsOn: [roundOneCandidate.id],
        transactionId: gcLab.blocker.transactionId,
        deltas: [{
          kind: 'gc_safe_point_bound',
          round: 1,
          globalMinStartTs: blockerStartTs,
          activeTransactionBound: blockedSafePoint,
          serviceSafePoint: blockedSafePoint,
          blocked: true,
        }],
        metadata: {
          candidateSafePoint: blockedCandidate,
          globalMinStartTs: blockerStartTs,
          activeTransactionBound: blockedSafePoint,
          gcMaxWaitSeconds: 86_400,
          killsTransaction: false,
        },
      },
    )
    const roundOneService = addGcEvent(
      'gc_service_safe_point',
      'PD service minimum accepted the bound',
      'The GC worker registers its service safe point. This fixture has no BR, CDC, or other service requesting an older value.',
      {
        source: 'gc-worker',
        target: 'pd-1',
        dependsOn: [roundOneBound.id],
        deltas: [{
          kind: 'gc_phase',
          round: 1,
          from: 'preparing',
          to: 'safe_point_bounded',
        }],
        metadata: {
          requestedSafePoint: blockedSafePoint,
          minimumServiceSafePoint: blockedSafePoint,
          externalServiceBlocker: false,
        },
      },
    )
    const roundOneStage = addGcEvent(
      'gc_mysql_safe_point_staged',
      'TiDB staged tikv_gc_safe_point',
      'Before starting the GC job, TiDB writes the human-readable mysql.tidb status value; it is not PD’s actual global GC point.',
      {
        source: 'tidb-1',
        target: 'gc-worker',
        dependsOn: [roundOneService.id],
        deltas: [{
          kind: 'gc_safe_point_stage',
          safePoint: blockedSafePoint,
        }],
        metadata: {
          store: 'mysql.tidb',
          variableName: 'tikv_gc_safe_point',
          pdGlobalPublished: false,
        },
      },
    )
    const roundOneResolveStart = addGcEvent(
      'gc_resolve_locks_start',
      'Region ScanLock resolution started',
      'TiDB v8.5.0 scans locks before the bounded safe point across all Regions. The cutaway expands two representative Regions.',
      {
        source: 'gc-worker',
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        dependsOn: [roundOneStage.id],
        deltas: [{
          kind: 'gc_phase',
          round: 1,
          from: 'safe_point_bounded',
          to: 'resolving_locks',
        }],
        metadata: {
          scanLockImplementation: 'REGION_SCAN_LOCK',
          scanLockModeVariableUsed: false,
          physicalScanLockAvailable: false,
          representativeRegions: 2,
        },
      },
    )
    const roundOneScanEight = addGcEvent(
      'gc_resolve_locks_scan',
      'Region 8 returned an old lock',
      'The GC leader checks the primary status before resolving the synthetic lock; no key bytes are retained.',
      {
        source: 'gc-worker',
        target: byRegionId.get(8)?.leaderStoreId,
        regionId: 8,
        dependsOn: [roundOneResolveStart.id],
        branchId: 'resolve-region-8',
        deltas: [{
          kind: 'gc_resolve_lock_scan',
          regionId: 8,
        }],
        metadata: { locksFound: 1, safePoint: blockedSafePoint },
      },
    )
    const roundOneResolveCommit = addGcEvent(
      'gc_resolve_lock_commit',
      'Committed primary resolved lock A',
      'The primary status is committed, so the representative old secondary is resolved as committed.',
      {
        source: byRegionId.get(8)?.leaderStoreId,
        target: 'gc-worker',
        regionId: 8,
        dependsOn: [roundOneScanEight.id],
        branchId: 'resolve-region-8',
        deltas: [{
          kind: 'gc_resolve_lock',
          lockId: 'stale-lock-a',
          action: 'commit',
        }],
        metadata: {
          lockId: 'stale-lock-a',
          primaryStatus: 'committed',
          normalTiKvWriteCommand: true,
          resolveLockRaftDetailModeled: false,
        },
      },
    )
    const roundOneScanTwenty = addGcEvent(
      'gc_resolve_locks_scan',
      'Region 20 returned an old lock',
      'A second representative Region is scanned independently through the pinned Region ScanLock implementation.',
      {
        source: 'gc-worker',
        target: byRegionId.get(20)?.leaderStoreId,
        regionId: 20,
        dependsOn: [roundOneResolveStart.id],
        presentationAfter: roundOneResolveCommit.id,
        branchId: 'resolve-region-20',
        deltas: [{
          kind: 'gc_resolve_lock_scan',
          regionId: 20,
        }],
        metadata: { locksFound: 1, safePoint: blockedSafePoint },
      },
    )
    const roundOneResolveRollback = addGcEvent(
      'gc_resolve_lock_rollback',
      'Rolled-back primary resolved lock B',
      'The primary status is rolled back, so the representative old secondary lock is rolled back.',
      {
        source: byRegionId.get(20)?.leaderStoreId,
        target: 'gc-worker',
        regionId: 20,
        dependsOn: [roundOneScanTwenty.id],
        branchId: 'resolve-region-20',
        deltas: [{
          kind: 'gc_resolve_lock',
          lockId: 'stale-lock-b',
          action: 'rollback',
        }],
        metadata: {
          lockId: 'stale-lock-b',
          primaryStatus: 'rolled_back',
          normalTiKvWriteCommand: true,
          resolveLockRaftDetailModeled: false,
        },
      },
    )
    const roundOneCache = addGcEvent(
      'gc_visibility_safe_point_saved',
      'Saved safe point became visible to TiDB caches',
      'After Resolve Locks, TiDB saves the safe point and observes the implementation cache barrier before range deletion.',
      {
        source: 'gc-worker',
        target: 'pd-1',
        dependsOn: [roundOneResolveCommit.id, roundOneResolveRollback.id],
        deltas: [
          {
            kind: 'gc_phase',
            round: 1,
            from: 'resolving_locks',
            to: 'caching_safe_point',
          },
          {
            kind: 'gc_visibility_safe_point_save',
            safePoint: blockedSafePoint,
          },
        ],
        metadata: {
          savedSafePoint: blockedSafePoint,
          implementationCacheBarrierSeconds: 100,
          liveTimingGuarantee: false,
        },
      },
    )
    const roundOneDeleteStart = addGcEvent(
      'gc_delete_ranges_start',
      'Delete Ranges found one eligible DDL range',
      'A synthetic dropped range with drop_ts below the safe point becomes eligible; this is separate from per-key MVCC filtering.',
      {
        source: 'gc-worker',
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        dependsOn: [roundOneCache.id],
        deltas: [
          {
            kind: 'gc_phase',
            round: 1,
            from: 'caching_safe_point',
            to: 'deleting_ranges',
          },
          {
            kind: 'gc_delete_range',
            rangeId: 'dropped-range-a',
            action: 'mark_eligible',
          },
        ],
        metadata: {
          rangeId: 'dropped-range-a',
          actualKeyRangeRetained: false,
          eligibleRanges: 1,
        },
      },
    )
    let deleteRangePresentationAfter: string | undefined
    const roundOneDeleteStores = storeIds.map((storeId) => {
      const event = addGcEvent(
        'gc_delete_range_store',
        `${storeId} received UnsafeDestroyRange`,
        'The pinned classic raftstore-v1 fixture sends the synthetic whole-range request to every relevant store and bypasses Region Raft.',
        {
          source: 'gc-worker',
          target: storeId,
          dependsOn: [roundOneDeleteStart.id],
          ...(deleteRangePresentationAfter
            ? { presentationAfter: deleteRangePresentationAfter }
            : {}),
          branchId: `delete-range-${storeId}`,
          metadata: {
            rangeId: 'dropped-range-a',
            raftstoreMode: 'v1_classic',
            request: 'UnsafeDestroyRange',
            bypassesRaft: true,
            actualKeyRangeRetained: false,
          },
        },
      )
      deleteRangePresentationAfter = event.id
      return event
    })
    const roundOneDeleteComplete = addGcEvent(
      'gc_delete_range_complete',
      'All relevant stores completed the range deletion',
      'The classic raftstore-v1 fan-out joins after direct RocksDB range deletion; TiCity never retains the destroyed key boundaries.',
      {
        source: 'gc-worker',
        target: 'gc-worker',
        dependsOn: roundOneDeleteStores.map((event) => event.id),
        deltas: [{
          kind: 'gc_delete_range',
          rangeId: 'dropped-range-a',
          action: 'delete',
        }],
        metadata: {
          rangeId: 'dropped-range-a',
          physicalRangeDelete: true,
          raftstoreMode: 'v1_classic',
          storeFanout: 3,
          bypassesRaft: true,
        },
      },
    )
    const roundOnePublish = addGcEvent(
      'gc_global_safe_point_publish',
      'TiDB published the global safe point to PD',
      'Distributed Do GC ends on the coordinator path here. TiKV detects the greater value and storage cleanup continues asynchronously.',
      {
        source: 'gc-worker',
        target: 'pd-1',
        dependsOn: [roundOneDeleteComplete.id],
        deltas: [
          {
            kind: 'gc_phase',
            round: 1,
            from: 'deleting_ranges',
            to: 'publishing_safe_point',
          },
          {
            kind: 'gc_safe_point_publish',
            safePoint: blockedSafePoint,
          },
        ],
        metadata: {
          safePoint: blockedSafePoint,
          distributedGc: true,
          coordinatorCompleteAfterPublish: true,
        },
      },
    )

    function storeDetectionEvents(
      round: 1 | 2,
      safePoint: number,
      parent: TraceEvent,
      previousPresentation: TraceEvent | null,
    ): readonly TraceEvent[] {
      let presentationAfter = previousPresentation?.id
      return storeIds.map((storeId, index) => {
        const event = addGcEvent(
          'gc_store_safe_point_detected',
          `${storeId} detected the greater safe point`,
          'The local TiKV GC manager observes PD. With the v8.5.0 default Compaction Filter enabled, it does not schedule the legacy per-Region Do GC loop.',
          {
            source: 'pd-1',
            target: storeId,
            dependsOn: [parent.id],
            ...(presentationAfter ? { presentationAfter } : {}),
            path: 'background',
            branchId: `round-${round}-${storeId}`,
            deltas: [
              ...(index === 0
                ? [{
                  kind: 'gc_phase' as const,
                  round,
                  from: 'publishing_safe_point' as const,
                  to: 'tikv_observing' as const,
                }]
                : []),
              {
                kind: 'gc_store_safe_point' as const,
                storeId,
                safePoint,
              },
            ],
            metadata: {
              storeId,
              safePoint,
              compactionFilterEnabled: true,
              legacyRegionGcScheduled: false,
            },
          },
        )
        presentationAfter = event.id
        return event
      })
    }

    function compactionEvents(
      round: 1 | 2,
      safePoint: number,
      detections: readonly TraceEvent[],
      filteredVersionIds: readonly string[],
      retainedAnchorIds: readonly string[],
      finishPhase: 'between_rounds' | 'complete',
    ): TraceEvent {
      const started = addGcEvent(
        'gc_compaction_filter_start',
        'RocksDB bottommost compaction opened GC filters',
        'All three stores are shown as active, while the version board counts one logical chain projection rather than multiplying replica copies.',
        {
          source: storeIds[0],
          target: 'gc-worker',
          dependsOn: detections.map((event) => event.id),
          path: 'background',
          deltas: [
            {
              kind: 'gc_phase',
              round,
              from: 'tikv_observing',
              to: 'compacting',
            },
            ...storeIds.map((storeId) => ({
              kind: 'gc_compaction_state' as const,
              storeId,
              from: 'eligible' as const,
              to: 'running' as const,
            })),
          ],
          metadata: {
            compactionLevel: 'bottommost_model_fixture',
            stores: 3,
            versionCountsMultipliedByReplicas: false,
            liveCompactionTimingGuarantee: false,
          },
        },
      )
      const filtered = addGcEvent(
        'gc_compaction_filter_apply',
        'Compaction Filter removed obsolete MVCC records',
        'Rollback/Lock records are discarded, a last Put at or below the safe point is retained as the snapshot anchor, and a last Delete can remove the whole old chain.',
        {
          source: storeIds[0],
          target: 'gc-worker',
          dependsOn: [started.id],
          path: 'background',
          deltas: [{
            kind: 'gc_compaction_filter',
            safePoint,
            filteredVersionIds,
            retainedAnchorIds,
          }],
          metadata: {
            filteredVersionsThisRound: filteredVersionIds.length,
            retainedAnchors: retainedAnchorIds.length,
            safePointInclusiveInPinnedSource: true,
            logicalProjectionOnly: true,
          },
        },
      )
      const storageComplete = addGcEvent(
        'gc_compaction_filter_complete',
        'All representative store filters completed',
        'The filtered SST output and corresponding long-value deletions make this physical storage step distinct from safe-point publication.',
        {
          source: storeIds[0],
          target: 'gc-worker',
          dependsOn: [filtered.id],
          path: 'background',
          deltas: storeIds.map((storeId) => ({
            kind: 'gc_compaction_state' as const,
            storeId,
            from: 'running' as const,
            to: 'complete' as const,
          })),
          metadata: {
            totalFilteredVersions: gcLab.storage.filteredVersionCount,
            compactionRaftEntriesCreated: 0,
            foregroundSqlBlocked: false,
          },
        },
      )
      return addGcEvent(
        round === 1 ? 'gc_round_complete' : 'gc_storage_lab_complete',
        round === 1
          ? 'Round 1 completed behind the blocker'
          : 'GC/Storage Lab completed',
        round === 1
          ? 'The safe point advanced only to start_ts - 1. The active fixture still protects its required snapshot.'
          : 'The second safe point is published and both representative storage rounds have completed. Compaction filtering itself creates no Raft entry.',
        {
          source: 'gc-worker',
          target: 'tidb-1',
          dependsOn: [storageComplete.id],
          path: 'background',
          deltas: [{
            kind: 'gc_phase',
            round,
            from: 'compacting',
            to: finishPhase,
          }],
          metadata: {
            round,
            safePoint,
            filteredVersions: gcLab.storage.filteredVersionCount,
            retainedAnchors: gcLab.storage.retainedAnchorCount,
            compactionRaftEntriesCreated: 0,
          },
        },
      )
    }

    const roundOneDetections = storeDetectionEvents(
      1,
      blockedSafePoint,
      roundOnePublish,
      null,
    )
    const roundOneComplete = compactionEvents(
      1,
      blockedSafePoint,
      roundOneDetections,
      ['a-v1', 'b-v1', 'b-v2', 'd-v1'],
      ['a-v2', 'd-v2'],
      'between_rounds',
    )
    const blockerComplete = addGcEvent(
      'gc_blocker_complete',
      'The teaching blocker completed',
      'This is an explicit fixture boundary. Its transaction commit protocol is deliberately not replayed inside the GC mechanism slice.',
      {
        source: 'tidb-2',
        target: 'gc-worker',
        dependsOn: [roundOneComplete.id],
        transactionId: gcLab.blocker.transactionId,
        deltas: [{
          kind: 'gc_blocker_state',
          from: 'active',
          to: 'completed',
        }],
        metadata: {
          transactionId: gcLab.blocker.transactionId,
          transactionProtocolReplayed: false,
          killedByGcMaxWait: false,
        },
      },
    )
    const roundTwoStart = addGcEvent(
      'gc_round_start',
      'TiDB GC leader started round 2',
      'A later deterministic run starts after the blocker completes; previous immutable snapshots remain unchanged.',
      {
        source: 'gc-worker',
        target: 'tidb-1',
        dependsOn: [blockerComplete.id],
        deltas: [{
          kind: 'gc_phase',
          round: 2,
          from: 'between_rounds',
          to: 'preparing',
        }],
        metadata: {
          round: 2,
          priorPublishedSafePoint: blockedSafePoint,
        },
      },
    )
    const roundTwoCandidate = addGcEvent(
      'gc_safe_point_candidate',
      'Lifetime produced the next candidate',
      'The candidate is greater than the first published safe point and remains a synthetic model timestamp.',
      {
        source: 'tidb-1',
        target: 'pd-1',
        dependsOn: [roundTwoStart.id],
        deltas: [{
          kind: 'gc_safe_point_candidate',
          round: 2,
          previous: blockedSafePoint,
          candidate: releasedCandidate,
        }],
        metadata: {
          previousSafePoint: blockedSafePoint,
          candidateSafePoint: releasedCandidate,
          lifeTimeSeconds: 600,
        },
      },
    )
    const roundTwoBound = addGcEvent(
      'gc_min_start_ts_clear',
      'No active transaction capped the candidate',
      'No reported active start_ts is older than the candidate in this fixture, and no external service requests an earlier point.',
      {
        source: 'tidb-2',
        target: 'gc-worker',
        dependsOn: [roundTwoCandidate.id],
        deltas: [{
          kind: 'gc_safe_point_bound',
          round: 2,
          globalMinStartTs: null,
          activeTransactionBound: null,
          serviceSafePoint: releasedCandidate,
          blocked: false,
        }],
        metadata: {
          candidateSafePoint: releasedCandidate,
          activeTransactionBlocker: false,
          externalServiceBlocker: false,
        },
      },
    )
    const roundTwoService = addGcEvent(
      'gc_service_safe_point',
      'PD service minimum accepted the candidate',
      'With no lower service constraint in this fixed fixture, the candidate becomes the round safe point.',
      {
        source: 'gc-worker',
        target: 'pd-1',
        dependsOn: [roundTwoBound.id],
        deltas: [{
          kind: 'gc_phase',
          round: 2,
          from: 'preparing',
          to: 'safe_point_bounded',
        }],
        metadata: {
          requestedSafePoint: releasedCandidate,
          minimumServiceSafePoint: releasedCandidate,
        },
      },
    )
    const roundTwoStage = addGcEvent(
      'gc_mysql_safe_point_staged',
      'TiDB staged the later tikv_gc_safe_point',
      'The mysql.tidb status value advances before round 2 starts; PD global publication still happens only after the coordinator stages.',
      {
        source: 'tidb-1',
        target: 'gc-worker',
        dependsOn: [roundTwoService.id],
        deltas: [{
          kind: 'gc_safe_point_stage',
          safePoint: releasedCandidate,
        }],
        metadata: {
          store: 'mysql.tidb',
          variableName: 'tikv_gc_safe_point',
          pdGlobalPublished: false,
        },
      },
    )
    const roundTwoResolveStart = addGcEvent(
      'gc_resolve_locks_start',
      'Region ScanLock resolution started round 2',
      'The same two representative Regions are scanned; the prior round left no unresolved fixture locks.',
      {
        source: 'gc-worker',
        target: regions[0].leaderStoreId,
        regionId: regions[0].id,
        dependsOn: [roundTwoStage.id],
        deltas: [{
          kind: 'gc_phase',
          round: 2,
          from: 'safe_point_bounded',
          to: 'resolving_locks',
        }],
        metadata: {
          scanLockImplementation: 'REGION_SCAN_LOCK',
          scanLockModeVariableUsed: false,
          physicalScanLockAvailable: false,
          unresolvedFixtureLocks: 0,
        },
      },
    )
    const roundTwoScanEight = addGcEvent(
      'gc_resolve_locks_scan',
      'Region 8 scan found no old fixture locks',
      'Resolve Locks remains a prerequisite even when this representative Region has nothing left to resolve.',
      {
        source: 'gc-worker',
        target: byRegionId.get(8)?.leaderStoreId,
        regionId: 8,
        dependsOn: [roundTwoResolveStart.id],
        branchId: 'round-2-resolve-region-8',
        deltas: [{
          kind: 'gc_resolve_lock_scan',
          regionId: 8,
        }],
        metadata: { locksFound: 0, safePoint: releasedCandidate },
      },
    )
    const roundTwoScanTwenty = addGcEvent(
      'gc_resolve_locks_scan',
      'Region 20 scan found no old fixture locks',
      'The second representative Region also returns an empty old-lock set.',
      {
        source: 'gc-worker',
        target: byRegionId.get(20)?.leaderStoreId,
        regionId: 20,
        dependsOn: [roundTwoResolveStart.id],
        presentationAfter: roundTwoScanEight.id,
        branchId: 'round-2-resolve-region-20',
        deltas: [{
          kind: 'gc_resolve_lock_scan',
          regionId: 20,
        }],
        metadata: { locksFound: 0, safePoint: releasedCandidate },
      },
    )
    const roundTwoCache = addGcEvent(
      'gc_visibility_safe_point_saved',
      'The later safe point became cache-visible',
      'TiDB saves the accepted value after Resolve Locks and crosses the cache barrier before Delete Ranges.',
      {
        source: 'gc-worker',
        target: 'pd-1',
        dependsOn: [roundTwoScanEight.id, roundTwoScanTwenty.id],
        deltas: [
          {
            kind: 'gc_phase',
            round: 2,
            from: 'resolving_locks',
            to: 'caching_safe_point',
          },
          {
            kind: 'gc_visibility_safe_point_save',
            safePoint: releasedCandidate,
          },
        ],
        metadata: {
          savedSafePoint: releasedCandidate,
          implementationCacheBarrierSeconds: 100,
          liveTimingGuarantee: false,
        },
      },
    )
    const roundTwoDelete = addGcEvent(
      'gc_delete_ranges_empty',
      'Delete Ranges had no pending fixture task',
      'The first round already completed the synthetic DDL range; no per-key GC work is folded into this stage.',
      {
        source: 'gc-worker',
        target: regions[0].leaderStoreId,
        dependsOn: [roundTwoCache.id],
        deltas: [{
          kind: 'gc_phase',
          round: 2,
          from: 'caching_safe_point',
          to: 'deleting_ranges',
        }],
        metadata: {
          eligibleRanges: 0,
          mvccFilteringPerformed: false,
        },
      },
    )
    const roundTwoPublish = addGcEvent(
      'gc_global_safe_point_publish',
      'TiDB published the later global safe point',
      'PD accepts the monotonic value; the coordinator can finish while TiKV storage work proceeds asynchronously.',
      {
        source: 'gc-worker',
        target: 'pd-1',
        dependsOn: [roundTwoDelete.id],
        deltas: [
          {
            kind: 'gc_phase',
            round: 2,
            from: 'deleting_ranges',
            to: 'publishing_safe_point',
          },
          {
            kind: 'gc_safe_point_publish',
            safePoint: releasedCandidate,
          },
        ],
        metadata: {
          safePoint: releasedCandidate,
          distributedGc: true,
        },
      },
    )
    const roundTwoDetections = storeDetectionEvents(
      2,
      releasedCandidate,
      roundTwoPublish,
      null,
    )
    compactionEvents(
      2,
      releasedCandidate,
      roundTwoDetections,
      ['a-v2', 'c-v1'],
      ['a-v3', 'c-v2', 'd-v2'],
      'complete',
    )

    state.gc.safePoint = gcLab.safePoint.published
    state.gc.blockedByStartTs = null
    state.gc.obsoleteVersions = 0
    state.gc.collectedVersions = gcLab.storage.filteredVersionCount
    state.gc.backlog = 0
    state.metrics.gcRuns += 2
    warnings.push(
      'GC/Storage Lab uses synthetic TSO spacing, aggregate logical chains, and a bottommost-compaction fixture; it is not a live timing or disk-usage measurement.',
    )
    return recordReceipt(
      id,
      'gc-safe-point',
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
          addReturn(builder, true, tidbId)
          returnedToClient = true
          for (const region of regions.slice(1)) {
            builder.add(
              'txn2pc',
              'commit_secondary',
              'Commit secondary in background',
              `After the client response, resolve the secondary lock in Region ${region.id}.`,
              {
                source: tidbId,
                target: region.leaderStoreId,
                regionId: region.id,
                transactionId: transaction.id,
                path: 'background',
                metadata: { commitTs },
              },
            )
            if (!raftMutation(
              region,
              'commit_secondary',
              transaction,
              tidbId,
              builder,
              'background',
            )) {
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
    if (
      scenarioId === 'tikv-failover' &&
      analysis.readOnly &&
      regions.length === 1
    ) {
      return traceRaftFailoverScenario(
        id,
        analysis,
        regions[0],
        builder,
        warnings,
      )
    }
    if (
      scenarioId === 'tiflash-mpp' &&
      analysis.readOnly &&
      analysis.accessPath === 'tiflash_mpp' &&
      regions.map((region) => region.id).join(',') === '24,25,26'
    ) {
      return traceDetailedTiFlashMpp(
        id,
        analysis,
        builder,
        warnings,
      )
    }
    if (analysis.readOnly) {
      return traceRead(id, analysis, scenarioId, regions, builder, warnings)
    }
    if (scenarioId === 'gc-safe-point') {
      return traceDetailedGcStorage(
        id,
        analysis,
        builder,
        warnings,
      )
    }
    if (scenarioId === 'commit-protocols') {
      return traceDetailedCommitProtocols(
        id,
        analysis,
        builder,
        warnings,
      )
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
        gcLifetimeSeconds: [600, 31_536_000],
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
    }

    const analysis = analyzeSql(scenario.sql)
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
