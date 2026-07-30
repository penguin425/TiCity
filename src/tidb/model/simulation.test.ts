import { describe, expect, it } from 'vitest'

import { TIDB_SCENARIOS } from './scenarios'
import { createTiDBSimulation } from './simulation'
import { TIDB_MODEL_VERSION } from './types'
import type { RegionState, ScenarioId, TraceEvent } from './types'

function expectRegionInvariants(regions: readonly RegionState[]): void {
  const ordered = [...regions].sort((a, b) => a.startKey - b.startKey)
  expect(ordered[0]?.startKey).toBe(0)
  for (let index = 0; index < ordered.length; index++) {
    const region = ordered[index]
    expect(region.endKey).toBeGreaterThan(region.startKey)
    expect(region.peers).toHaveLength(3)
    expect(new Set(region.peers.map((peer) => peer.storeId)).size).toBe(3)
    expect(region.peers.filter((peer) => peer.raftRole === 'leader')).toHaveLength(1)
    expect(region.peers.find((peer) => peer.raftRole === 'leader')?.storeId)
      .toBe(region.leaderStoreId)
    expect(region.appliedIndex).toBeLessThanOrEqual(region.commitIndex)
    for (const peer of region.peers) {
      expect(peer.appliedIndex).toBeLessThanOrEqual(region.commitIndex)
    }
    if (index > 0) expect(ordered[index - 1].endKey).toBe(region.startKey)
  }
}

describe('TiDB topology and deterministic clock', () => {
  it('starts with the documented v8.5 teaching topology', () => {
    const state = createTiDBSimulation().state

    expect(state.topology.tiproxy).toHaveLength(2)
    expect(state.topology.tidb).toHaveLength(3)
    expect(state.topology.pd).toHaveLength(3)
    expect(state.topology.pd.filter((node) => node.leader)).toHaveLength(1)
    expect(state.topology.tikv).toHaveLength(3)
    expect(state.topology.tiflash).toHaveLength(1)
    expect(state.regions).toHaveLength(36)
    expectRegionInvariants(state.regions)
  })

  it('produces the same state for the same seed and elapsed fixed steps', () => {
    const chunked = createTiDBSimulation({ seed: 425 })
    const framed = createTiDBSimulation({ seed: 425 })
    chunked.setControl('qps', 73)
    framed.setControl('qps', 73)

    chunked.update(2)
    for (let index = 0; index < 120; index++) framed.update(1 / 60)

    expect(chunked.state).toEqual(framed.state)
  })

  it('is reproducible after reset', () => {
    const sim = createTiDBSimulation({ seed: 99 })
    sim.update(3)
    const first = structuredClone(sim.state)

    sim.reset()
    sim.update(3)

    expect(sim.state).toEqual(first)
  })

  it('gives step, slow, and live playback modes observable behavior', () => {
    const sim = createTiDBSimulation()
    const tick = sim.state.tick

    sim.setPlayback('step')
    expect(sim.state.tick).toBe(tick + 1)
    expect(sim.state.controls.paused).toBe(true)

    sim.setPlayback('slow')
    expect(sim.state.controls.paused).toBe(false)
    expect(sim.state.controls.playbackSpeed).toBe(1)

    sim.setPlayback('live')
    expect(sim.state.controls.playbackSpeed).toBe(4)
  })
})

describe('transactions, Raft, GC, and TiFlash', () => {
  it('keeps transaction phases separate from per-Region Raft quorum', () => {
    const sim = createTiDBSimulation({ seed: 7 })
    const analysis = sim.submitSql(
      'UPDATE accounts SET balance = balance + 1 WHERE id = 7',
    ).analysis
    const receipt = sim.requestTrace({
      analysis,
      regionIds: [0, 12, 24],
      forceProtocol: '2pc',
    })

    expect(receipt?.committed).toBe(true)
    expect(receipt?.protocol).toBe('2pc')
    expect(receipt?.events.some((event) => event.domain === 'txn2pc' && event.kind === 'prewrite'))
      .toBe(true)
    expect(receipt?.events.some((event) => event.domain === 'raft' && event.kind === 'quorum_commit'))
      .toBe(true)
    expect(receipt?.events.find((event) => event.domain === 'txn2pc' && event.kind === 'prewrite')?.id)
      .not.toBe(receipt?.events.find((event) => event.domain === 'raft' && event.kind === 'quorum_commit')?.id)
    expect(receipt?.commitTs).toBeGreaterThan(receipt?.startTs ?? Number.MAX_SAFE_INTEGER)
    expectRegionInvariants(sim.state.regions)
  })

  it.each([
    [[0], 'auto', '1pc'],
    [[0, 1], 'auto', 'async_commit'],
    [[0, 1, 2], 'auto', 'async_commit'],
    [[0, 1, 2], '2pc', '2pc'],
  ] as const)('resolves eligible Regions %j in %s mode to %s', (regionIds, forced, expected) => {
    const sim = createTiDBSimulation()
    const analysis = sim.submitSql('INSERT INTO events (id) VALUES (1)').analysis
    const receipt = sim.requestTrace({ analysis, regionIds, forceProtocol: forced })

    expect(receipt?.protocol).toBe(expected)
    expect(receipt?.committed).toBe(true)
  })

  it('keeps reads and model-only EXPLAIN separate from transaction commit', () => {
    const sim = createTiDBSimulation()
    const read = sim.submitSql('SELECT * FROM accounts WHERE id = 7').receipt
    const explain = sim.submitSql('EXPLAIN SELECT * FROM accounts WHERE id = 7').receipt

    for (const receipt of [read, explain]) {
      expect(receipt?.succeeded).toBe(true)
      expect(receipt?.committed).toBe(false)
      expect(receipt?.outcome).toBe('succeeded')
      expect(receipt?.protocol).toBeNull()
      expect(receipt?.replay.commitProtocol).toBeNull()
    }
  })

  it('does not retain SQL literals and deep-freezes the published receipt model', () => {
    const sim = createTiDBSimulation()
    const secret = 'customer-secret-425'
    const receipt = sim.submitSql(
      `SELECT * FROM accounts WHERE note = '${secret}' AND id = 7`,
    ).receipt!

    expect(JSON.stringify(receipt)).not.toContain(secret)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.analysis)).toBe(true)
    expect(Object.isFrozen(receipt.analysis.plan)).toBe(true)
    expect(Object.isFrozen(receipt.analysis.plan[0]?.children)).toBe(true)
  })

  it('returns Async Commit after prewrite and resolves commit records in the background', () => {
    const sim = createTiDBSimulation()
    const analysis = sim.submitSql(
      'INSERT INTO events (id, account_id) VALUES (1, 7)',
    ).analysis
    const receipt = sim.requestTrace({
      analysis,
      regionIds: [0, 1, 2],
      forceProtocol: 'async_commit',
    })!
    const kinds = receipt.events.map((event) => event.kind)

    expect(receipt.committed).toBe(true)
    expect(kinds).toContain('min_commit_ts')
    expect(kinds).not.toContain('commit_ts')
    expect(kinds).not.toContain('commit_primary')
    expect(kinds.indexOf('complete')).toBeLessThan(kinds.indexOf('commit_background'))
    expect(receipt.events.filter((event) => event.kind === 'commit_background'))
      .toHaveLength(3)
    const responseIndex = kinds.indexOf('complete')
    expect(receipt.events.slice(0, responseIndex + 1).every((event) =>
      event.path === 'critical',
    )).toBe(true)
    expect(receipt.events.slice(responseIndex + 1).every((event) =>
      event.path === 'background',
    )).toBe(true)
  })

  it('does not elect or serve a Region after two of three voters are lost', () => {
    const sim = createTiDBSimulation()
    const region = sim.state.regions[0]
    for (const peer of region.peers.slice(1)) peer.healthy = false
    const analysis = sim.submitSql('SELECT * FROM accounts WHERE id = 7').analysis
    const receipt = sim.requestTrace({ analysis, regionIds: [region.id] })!

    expect(receipt.succeeded).toBe(false)
    expect(receipt.outcome).toBe('failed')
    expect(receipt.events.some((event) => event.kind === 'leader_election')).toBe(false)
    expect(receipt.events.some((event) => event.kind === 'point_get')).toBe(false)
  })

  it('holds the GC safe point behind an active old transaction', () => {
    const sim = createTiDBSimulation()
    sim.runScenario('gc-safe-point')
    const blocked = sim.state.gc.safePoint
    expect(sim.state.gc.blockedByStartTs).not.toBeNull()
    expect(sim.state.gc.backlog).toBeGreaterThan(0)
    expect(sim.state.lastTrace?.events.some((event) =>
      event.kind === 'gc_safe_point_blocked' &&
      event.metadata.gcMaxWaitSeconds === 86_400,
    )).toBe(true)

    sim.update(sim.state.controls.gcLifetimeSeconds + 2)

    expect(sim.state.gc.safePoint).toBe(blocked)
  })

  it('makes TiFlash visibility lag deterministic and never models direct TiFlash writes', () => {
    const sim = createTiDBSimulation()
    sim.setControl('qps', 0)
    sim.setControl('tiflashLagSeconds', 2)
    const write = sim.submitSql('INSERT INTO events (id) VALUES (1)').receipt

    expect(write?.events.some((event) =>
      event.domain === 'tiflash' && event.kind === 'direct_write',
    )).toBe(false)
    expect(sim.state.tiflash.targetTs).toBeGreaterThan(sim.state.tiflash.resolvedTs)
    sim.update(1)
    expect(sim.state.tiflash.resolvedTs).toBeLessThan(sim.state.tiflash.targetTs)
    sim.update(1.1)
    expect(sim.state.tiflash.resolvedTs).toBe(sim.state.tiflash.targetTs)
  })

  it('queues TiFlash replication only for the demo table with a replica', () => {
    const sim = createTiDBSimulation()
    sim.setControl('qps', 0)
    const targetBefore = sim.state.tiflash.targetTs

    sim.submitSql('UPDATE accounts SET balance = 1 WHERE id = 7')
    expect(sim.state.tiflash.targetTs).toBe(targetBefore)

    sim.submitSql('INSERT INTO events (id, account_id) VALUES (1, 7)')
    expect(sim.state.tiflash.targetTs).toBeGreaterThan(targetBefore)

    const tikvAggregate = sim.submitSql('SELECT count(*) FROM accounts').receipt!
    expect(tikvAggregate.events.some((event) => event.domain === 'tiflash')).toBe(false)
  })

  it('clears modeled TiFlash pending lag after an MPP snapshot catches up', () => {
    const sim = createTiDBSimulation()
    sim.setControl('qps', 0)
    sim.setControl('tiflashLagSeconds', 2)
    sim.submitSql('INSERT INTO events (id, account_id) VALUES (1, 7)')

    const receipt = sim.submitSql('SELECT count(*) FROM events').receipt!

    expect(receipt.succeeded).toBe(true)
    expect(sim.state.tiflash.resolvedTs).toBe(sim.state.tiflash.targetTs)
    expect(sim.state.tiflash.pendingVersions).toBe(0)
    expect(sim.state.tiflash.lagSeconds).toBe(0)
  })
})

describe('model-2 detailed cross-Region transaction', () => {
  function detailedReceipt() {
    return createTiDBSimulation({ seed: 2026 })
      .runScenario('cross-region-transaction')
  }

  function event(receiptEvents: readonly TraceEvent[], kind: string): TraceEvent {
    const found = receiptEvents.find((candidate) => candidate.kind === kind)
    if (!found) throw new Error(`Expected event ${kind}`)
    return found
  }

  it('publishes a deterministic, acyclic causal graph with two parallel prewrite branches', () => {
    const first = detailedReceipt()
    const second = detailedReceipt()

    expect(TIDB_MODEL_VERSION).toBe('tidb-v8.5-model-4')
    expect(first).toEqual(second)

    const byId = new Map(first.events.map((candidate) => [candidate.id, candidate]))
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const visit = (candidate: TraceEvent): void => {
      expect(visiting.has(candidate.id), `cycle at ${candidate.id}`).toBe(false)
      if (visited.has(candidate.id)) return
      visiting.add(candidate.id)
      for (const dependencyId of candidate.dependsOn ?? []) {
        const dependency = byId.get(dependencyId)
        expect(dependency, `${candidate.id} dependency ${dependencyId}`).toBeDefined()
        if (!dependency) continue
        expect(dependency.atMs + dependency.durationMs).toBeLessThanOrEqual(candidate.atMs)
        visit(dependency)
      }
      visiting.delete(candidate.id)
      visited.add(candidate.id)
    }
    for (const candidate of first.events) visit(candidate)
    expect(visited.size).toBe(first.events.length)

    const prewrites = first.events.filter((candidate) => candidate.kind === 'prewrite')
    expect(prewrites).toHaveLength(2)
    expect(new Set(prewrites.map((candidate) => candidate.regionId)).size).toBe(2)
    expect(new Set(prewrites.map((candidate) => candidate.atMs)).size).toBe(1)
    expect(prewrites[0].dependsOn).toEqual(prewrites[1].dependsOn)

    const proposals = first.events.filter((candidate) =>
      candidate.kind === 'raft_propose' &&
      candidate.metadata.operation === 'prewrite',
    )
    expect(proposals).toHaveLength(2)
    expect(new Set(proposals.map((candidate) => candidate.atMs)).size).toBe(1)

    const join = event(first.events, 'all_prewrite_complete')
    const prewriteTerminals = first.events.filter((candidate) =>
      candidate.kind === 'mvcc_prewrite',
    )
    expect(new Set(join.dependsOn)).toEqual(new Set(
      prewriteTerminals.map((candidate) => candidate.id),
    ))
    const commitTs = event(first.events, 'commit_ts')
    expect(commitTs.dependsOn).toEqual([join.id])
    expect(commitTs.atMs).toBeGreaterThanOrEqual(join.atMs + join.durationMs)
  })

  it('keeps pessimistic locks only in leader memory without advancing Raft', () => {
    const receipt = detailedReceipt()
    const locks = receipt.events.filter((candidate) =>
      candidate.kind === 'pessimistic_lock',
    )

    expect(locks).toHaveLength(2)
    for (const lock of locks) {
      const region = lock.snapshot?.regions.find((candidate) =>
        candidate.regionId === lock.regionId,
      )
      expect(lock.metadata.storage).toBe('leader_memory')
      expect(lock.metadata.replicated).toBe(false)
      expect(lock.metadata.raftIndexBefore).toBe(lock.metadata.raftIndexAfter)
      expect(lock.deltas?.some((delta) => delta.kind.startsWith('raft_'))).toBe(false)
      expect(region?.pessimisticLock).toEqual({
        transactionId: lock.transactionId,
        leaderStoreId: region?.leaderStoreId,
        storage: 'leader_memory',
        replicated: false,
      })
      expect(region?.commitIndex).toBe(0)
      expect(region?.appliedIndex).toBe(0)
    }

    const start = event(receipt.events, 'start_ts')
    expect(start.snapshot?.transaction?.startTs).toBe(receipt.startTs)
    expect(receipt.events.filter((candidate) => candidate.kind === 'raft_propose'))
      .toHaveLength(4)
  })

  it('models 2-of-3 Raft persistence, apply indexes, and MVCC column families', () => {
    const receipt = detailedReceipt()
    const firstSnapshot = receipt.events[0].snapshot

    expect(firstSnapshot?.regions).toHaveLength(2)
    expect(new Set(firstSnapshot?.regions.map((region) => region.leaderStoreId)).size)
      .toBe(2)
    for (const candidate of receipt.events) {
      expect(candidate.snapshot, candidate.kind).toBeDefined()
      expect(candidate.deltas, candidate.kind).toBeDefined()
      expect(candidate.path, candidate.kind).toMatch(/^(critical|background)$/)
      for (const region of candidate.snapshot?.regions ?? []) {
        expect(region.peers).toHaveLength(3)
        expect(region.quorum).toBe(2)
        expect(region.appliedIndex).toBeLessThanOrEqual(region.commitIndex)
        for (const peer of region.peers) {
          expect(peer.appliedIndex).toBeLessThanOrEqual(region.commitIndex)
        }
      }
    }

    const persists = receipt.events.filter((candidate) => candidate.kind === 'raft_persist')
    const quorums = receipt.events.filter((candidate) => candidate.kind === 'quorum_commit')
    expect(persists).toHaveLength(4)
    expect(quorums).toHaveLength(4)
    for (const persisted of persists) {
      const region = persisted.snapshot?.regions.find((candidate) =>
        candidate.regionId === persisted.regionId,
      )
      expect(region?.persistedStoreIds).toHaveLength(2)
      expect(region?.acknowledgements).toBe(2)
      expect(persisted.metadata.voters).toBe(3)
    }
    for (const quorum of quorums) {
      expect(quorum.metadata.acknowledgements).toBe(2)
      expect(quorum.metadata.quorum).toBe(2)
      expect(quorum.metadata.voters).toBe(3)
    }

    const prewritten = receipt.events.filter((candidate) =>
      candidate.kind === 'mvcc_prewrite',
    )
    expect(prewritten).toHaveLength(2)
    for (const candidate of prewritten) {
      const region = candidate.snapshot?.regions.find((item) =>
        item.regionId === candidate.regionId,
      )
      expect(region?.pessimisticLock).toBeNull()
      expect(region?.mvcc).toMatchObject({
        defaultCf: 'value',
        lockCf: 'prewrite',
        writeCf: 'empty',
        startTs: receipt.startTs,
        commitTs: null,
      })
    }

    const finalSnapshot = receipt.events.at(-1)?.snapshot
    for (const region of finalSnapshot?.regions ?? []) {
      expect(region.pessimisticLock).toBeNull()
      expect(region.mvcc).toMatchObject({
        defaultCf: 'value',
        lockCf: 'empty',
        writeCf: 'commit',
        startTs: receipt.startTs,
        commitTs: receipt.commitTs,
      })
    }
  })

  it('responds after primary commit and resolves the secondary only in the background', () => {
    const receipt = detailedReceipt()
    const commitTimestamp = event(receipt.events, 'commit_ts')
    const allPrewritten = event(receipt.events, 'all_prewrite_complete')
    const primaryCommitted = event(receipt.events, 'mvcc_primary_commit')
    const response = event(receipt.events, 'complete')
    const secondary = event(receipt.events, 'commit_secondary')
    const secondaryCommitted = event(receipt.events, 'mvcc_secondary_commit')
    const cleanup = event(receipt.events, 'secondary_cleanup_complete')

    expect(receipt.startTs).not.toBeNull()
    expect(receipt.commitTs).toBeGreaterThan(receipt.startTs ?? Number.MAX_SAFE_INTEGER)
    expect(commitTimestamp.atMs).toBeGreaterThanOrEqual(
      allPrewritten.atMs + allPrewritten.durationMs,
    )
    expect(response.atMs).toBeGreaterThanOrEqual(
      primaryCommitted.atMs + primaryCommitted.durationMs,
    )
    expect(secondary.atMs).toBeGreaterThanOrEqual(response.atMs + response.durationMs)
    expect(secondaryCommitted.atMs).toBeGreaterThanOrEqual(
      secondary.atMs + secondary.durationMs,
    )
    expect(cleanup.atMs).toBeGreaterThanOrEqual(
      secondaryCommitted.atMs + secondaryCommitted.durationMs,
    )
    expect(response.path).toBe('critical')
    for (const candidate of receipt.events.slice(receipt.events.indexOf(secondary))) {
      expect(candidate.path).toBe('background')
      expect(candidate.snapshot?.transaction?.clientResponded).toBe(true)
    }
  })

  it('deep-freezes graph projections and keeps SQL text and literals out of ReplaySpec', () => {
    const receipt = detailedReceipt()
    const candidate = event(receipt.events, 'mvcc_prewrite')

    expect(JSON.stringify(receipt.replay)).not.toMatch(/balance|425|SET|WHERE/i)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.events)).toBe(true)
    expect(Object.isFrozen(candidate)).toBe(true)
    expect(Object.isFrozen(candidate.dependsOn)).toBe(true)
    expect(Object.isFrozen(candidate.deltas)).toBe(true)
    expect(Object.isFrozen(candidate.snapshot)).toBe(true)
    expect(Object.isFrozen(candidate.snapshot?.transaction)).toBe(true)
    expect(Object.isFrozen(candidate.snapshot?.transaction?.regionIds)).toBe(true)
    expect(Object.isFrozen(candidate.snapshot?.regions)).toBe(true)
    expect(Object.isFrozen(candidate.snapshot?.regions[0])).toBe(true)
    expect(Object.isFrozen(candidate.snapshot?.regions[0]?.peers)).toBe(true)
    expect(Object.isFrozen(candidate.snapshot?.regions[0]?.mvcc)).toBe(true)
  })
})

describe('model-3 Lock Lab deadlock and application retry', () => {
  function runLockLab(seed = 2026) {
    const simulation = createTiDBSimulation({ seed })
    return {
      simulation,
      receipt: simulation.runScenario('lock-deadlock'),
    }
  }

  function lockEvent(
    events: readonly TraceEvent[],
    kind: string,
    predicate: (candidate: TraceEvent) => boolean = () => true,
  ): TraceEvent {
    const found = events.find((candidate) =>
      candidate.kind === kind && predicate(candidate))
    if (!found) throw new Error(`Expected Lock Lab event ${kind}`)
    return found
  }

  it('publishes a deterministic acyclic DAG with parallel initial lock acquisition', () => {
    const first = runLockLab()
    const second = runLockLab()

    expect(first.receipt).toEqual(second.receipt)
    expect(first.simulation.state).toEqual(second.simulation.state)

    const byId = new Map(first.receipt.events.map((candidate) => [
      candidate.id,
      candidate,
    ]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (candidate: TraceEvent): void => {
      expect(visiting.has(candidate.id), `cycle at ${candidate.id}`).toBe(false)
      if (visited.has(candidate.id)) return
      visiting.add(candidate.id)
      for (const dependencyId of candidate.dependsOn ?? []) {
        const dependency = byId.get(dependencyId)
        expect(dependency, `${candidate.id} -> ${dependencyId}`).toBeDefined()
        if (!dependency) continue
        expect(dependency.atMs + dependency.durationMs)
          .toBeLessThanOrEqual(candidate.atMs)
        visit(dependency)
      }
      visiting.delete(candidate.id)
      visited.add(candidate.id)
    }
    for (const candidate of first.receipt.events) visit(candidate)
    expect(visited.size).toBe(first.receipt.events.length)

    const initialLocks = first.receipt.events.filter((candidate) =>
      candidate.kind === 'lock_acquired')
    expect(initialLocks).toHaveLength(2)
    expect(new Set(initialLocks.map((candidate) => candidate.atMs)).size).toBe(1)
    expect(initialLocks[0].dependsOn).toEqual(initialLocks[1].dependsOn)
    expect(new Set(initialLocks.map((candidate) =>
      candidate.metadata.resourceId))).toEqual(
      new Set(['resource-a', 'resource-b']),
    )

    const firstWait = first.receipt.events.find((candidate) =>
      candidate.kind === 'lock_wait_enqueued')
    expect(new Set(firstWait?.dependsOn)).toEqual(
      new Set(initialLocks.map((candidate) => candidate.id)),
    )
    for (const candidate of first.receipt.events) {
      expect(candidate.snapshot, candidate.kind).toBeDefined()
      expect(candidate.deltas, candidate.kind).toBeDefined()
      expect(candidate.path).toBe('critical')
    }
  })

  it('models waiter-to-holder edges, cycle detection, and explicitly labelled MODEL POLICY choices', () => {
    const { receipt } = runLockLab()
    const waits = receipt.events.filter((candidate) =>
      candidate.kind === 'lock_wait_enqueued')
    expect(waits).toHaveLength(2)
    const [waitA, waitB] = waits
    const transactionAId = String(waitA.metadata.waiterTransactionId)
    const transactionBId = String(waitB.metadata.waiterTransactionId)

    expect(waitA.snapshot?.lockLab?.waitForEdges).toEqual([
      expect.objectContaining({
        waiterTransactionId: transactionAId,
        holderTransactionId: transactionBId,
      }),
    ])
    expect(waitA.snapshot?.lockLab?.deadlock).toBeNull()
    expect(waitB.snapshot?.lockLab?.waitForEdges).toEqual([
      expect.objectContaining({
        waiterTransactionId: transactionAId,
        holderTransactionId: transactionBId,
      }),
      expect.objectContaining({
        waiterTransactionId: transactionBId,
        holderTransactionId: transactionAId,
      }),
    ])
    expect(waitB.snapshot?.lockLab?.deadlock).toBeNull()

    const lookup = lockEvent(receipt.events, 'deadlock_detector_lookup')
    expect(lookup.metadata).toMatchObject({
      detectorScope: 'cluster_wide',
      detectorLeaderStoreId: 'tikv-3',
      pdRole: 'leader_lookup_only',
      rowData: false,
    })
    const detected = lockEvent(receipt.events, 'deadlock_detected')
    expect(detected.snapshot?.lockLab?.deadlock).toMatchObject({
      cycleTransactionIds: [transactionBId, transactionAId, transactionBId],
      victimTransactionId: null,
      retryable: false,
      resolution: 'detected',
      clientErrorCode: null,
      clientErrorTransactionId: null,
    })
    const victim = lockEvent(receipt.events, 'deadlock_victim_selected')
    expect(victim.transactionId).toBe(transactionBId)
    expect(victim.metadata.selectionPolicy)
      .toBe('MODEL POLICY: cycle-closing waiter')
    expect(victim.snapshot?.lockLab?.deadlock).toMatchObject({
      victimTransactionId: transactionBId,
      selectionPolicy: 'cycle_closing_waiter_model_policy',
      retryable: false,
      resolution: 'rolling_back',
    })

    const rollback = lockEvent(receipt.events, 'deadlock_victim_rollback')
    const rolledBack = rollback.snapshot?.lockLab?.transactions.find(
      (transaction) => transaction.transactionId === transactionBId,
    )
    expect(rolledBack).toMatchObject({
      status: 'rolled_back',
      heldResourceIds: [],
      waitingForResourceId: null,
    })
    expect(rollback.snapshot?.lockLab?.resources.find((resource) =>
      resource.id === 'resource-a')?.waiterTransactionIds).not.toContain(
      transactionBId,
    )
    expect(rollback.snapshot?.lockLab?.waitForEdges.some((edge) =>
      edge.waiterTransactionId === transactionBId ||
      edge.holderTransactionId === transactionBId,
    )).toBe(false)
    expect(rollback.snapshot?.lockLab?.waitForEdges).toEqual([])
    expect(rollback.snapshot?.lockLab?.resources.find((resource) =>
      resource.id === 'resource-b')?.holderTransactionId).toBe(transactionAId)

    const wake = lockEvent(receipt.events, 'lock_waiter_woken')
    expect(wake.metadata.wakePolicy).toBe('smallest_start_ts_model_policy')
    expect(wake.transactionId).toBe(transactionAId)
    expect(wake.snapshot?.lockLab?.waitForEdges).toEqual([])
    expect(wake.snapshot?.lockLab?.resources.find((resource) =>
      resource.id === 'resource-b')?.holderTransactionId).toBe(transactionAId)
  })

  it('keeps Error 1213 separate from a joined whole-transaction application retry', () => {
    const { receipt } = runLockLab()
    const error = lockEvent(receipt.events, 'deadlock_error_1213')
    const backoff = lockEvent(receipt.events, 'application_retry_backoff')
    const releaseA = lockEvent(
      receipt.events,
      'lock_release_after_commit',
      (candidate) => candidate.branchId === 'client-a',
    )
    const retryBegin = lockEvent(receipt.events, 'application_retry_begin')
    const rollback = lockEvent(receipt.events, 'deadlock_victim_rollback')

    expect(error.dependsOn).toEqual([rollback.id])
    expect(error.metadata).toMatchObject({
      errorCode: 1213,
      retryable: false,
      transactionRolledBack: true,
      retryBoundary: 'application',
    })
    expect(rollback.snapshot?.lockLab?.deadlock).toMatchObject({
      clientErrorCode: null,
      clientErrorTransactionId: null,
    })
    expect(error.snapshot?.lockLab?.deadlock).toMatchObject({
      clientErrorCode: 1213,
      clientErrorTransactionId: error.transactionId,
    })
    expect(backoff.dependsOn).toEqual([error.id])
    expect(backoff.durationMs).toBe(120)
    expect(backoff.snapshot?.lockLab?.applicationRetry).toMatchObject({
      source: 'application',
      status: 'backoff',
      fixedBackoffMs: 120,
    })
    expect(new Set(retryBegin.dependsOn)).toEqual(
      new Set([backoff.id, releaseA.id]),
    )
    expect(retryBegin.atMs).toBeGreaterThanOrEqual(
      backoff.atMs + backoff.durationMs,
    )
    expect(retryBegin.atMs).toBeGreaterThanOrEqual(
      releaseA.atMs + releaseA.durationMs,
    )

    const originalTransactionId = String(error.transactionId)
    const retryTransactionId = String(retryBegin.transactionId)
    expect(retryTransactionId).not.toBe(originalTransactionId)
    const original = retryBegin.snapshot?.lockLab?.transactions.find(
      (transaction) => transaction.transactionId === originalTransactionId,
    )
    const retry = retryBegin.snapshot?.lockLab?.transactions.find(
      (transaction) => transaction.transactionId === retryTransactionId,
    )
    expect(original?.status).toBe('rolled_back')
    expect(retry).toMatchObject({
      clientId: 'client-b',
      attempt: 2,
      retryOfTransactionId: originalTransactionId,
      status: 'active',
    })
    expect(retry?.startTs).toBeGreaterThan(original?.startTs ?? Number.MAX_SAFE_INTEGER)
    expect(retryBegin.snapshot?.lockLab?.applicationRetry).toMatchObject({
      source: 'application',
      status: 'started',
      newTransactionId: retryTransactionId,
    })

    const retryLocks = receipt.events.filter((candidate) =>
      candidate.kind === 'retry_lock_acquired')
    expect(retryLocks.map((candidate) => candidate.metadata.resourceId))
      .toEqual(['resource-a', 'resource-b'])
    expect(retryLocks.map((candidate) => candidate.metadata.acquisitionOrder))
      .toEqual([1, 2])
    expect(retryLocks.every((candidate) =>
      candidate.snapshot?.lockLab?.waitForEdges.length === 0,
    )).toBe(true)
  })

  it('uses commit handoff summaries, releases locks afterwards, and ends cleanly', () => {
    const { simulation, receipt } = runLockLab()
    const handoffs = receipt.events.filter((candidate) =>
      candidate.kind === 'commit_handoff')
    const summaries = receipt.events.filter((candidate) =>
      candidate.kind === 'commit_summary')
    const releases = receipt.events.filter((candidate) =>
      candidate.kind === 'lock_release_after_commit')

    expect(handoffs).toHaveLength(2)
    expect(summaries).toHaveLength(2)
    expect(releases).toHaveLength(2)
    for (const summary of summaries) {
      const release = releases.find((candidate) =>
        candidate.transactionId === summary.transactionId)
      expect(summary.metadata.commitMechanism).toBe('summary_boundary')
      expect(release?.atMs).toBeGreaterThanOrEqual(
        summary.atMs + summary.durationMs,
      )
    }
    expect(receipt.events.some((candidate) => candidate.domain === 'raft')).toBe(false)
    expect(receipt.events.flatMap((candidate) => candidate.deltas ?? [])
      .some((delta) => delta.kind.startsWith('raft_'))).toBe(false)

    const final = receipt.events.at(-1)?.snapshot?.lockLab
    expect(final?.resources.every((resource) =>
      resource.holderTransactionId === null &&
      resource.waiterTransactionIds.length === 0,
    )).toBe(true)
    expect(final?.waitForEdges).toEqual([])
    expect(final?.deadlock).toMatchObject({
      retryable: false,
      resolution: 'resolved',
    })
    expect(final?.applicationRetry).toMatchObject({
      source: 'application',
      status: 'completed',
    })
    expect(final?.transactions.map((transaction) => transaction.status))
      .toEqual(['completed', 'rolled_back', 'completed'])
    expect(simulation.state.transactions.map((transaction) => transaction.phase))
      .toEqual(['committed', 'rolled_back', 'committed'])
    expect(simulation.state.metrics).toMatchObject({
      statements: 3,
      writes: 3,
      commits: 2,
      rollbacks: 1,
      conflicts: 1,
      raftEntries: 0,
      lockWaits: 2,
      deadlocks: 1,
      retries: 1,
    })
  })

  it('never advances Raft indexes or exposes SQL literals and deeply freezes projections', () => {
    const { receipt } = runLockLab()
    const initialRegions = receipt.events[0].snapshot?.regions ?? []

    for (const candidate of receipt.events) {
      expect(candidate.snapshot?.regions.map((region) => ({
        regionId: region.regionId,
        commitIndex: region.commitIndex,
        appliedIndex: region.appliedIndex,
      }))).toEqual(initialRegions.map((region) => ({
        regionId: region.regionId,
        commitIndex: region.commitIndex,
        appliedIndex: region.appliedIndex,
      })))
      for (const region of candidate.snapshot?.regions ?? []) {
        expect(region.appliedIndex).toBeLessThanOrEqual(region.commitIndex)
      }
    }

    expect(receipt).toMatchObject({
      scenarioId: 'lock-deadlock',
      startTs: null,
      commitTs: null,
      succeeded: true,
      committed: false,
      outcome: 'succeeded',
      protocol: null,
    })
    expect(JSON.stringify(receipt)).not.toMatch(/LOCK-LAB-425|stock\s*=\s*stock|WHERE/i)
    const final = receipt.events.at(-1)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(final?.snapshot)).toBe(true)
    expect(Object.isFrozen(final?.snapshot?.lockLab)).toBe(true)
    expect(Object.isFrozen(final?.snapshot?.lockLab?.transactions)).toBe(true)
    expect(Object.isFrozen(
      final?.snapshot?.lockLab?.transactions[0]?.heldResourceIds,
    )).toBe(true)
    expect(Object.isFrozen(final?.snapshot?.lockLab?.resources)).toBe(true)
    expect(Object.isFrozen(
      final?.snapshot?.lockLab?.resources[0]?.waiterTransactionIds,
    )).toBe(true)
    expect(Object.isFrozen(
      final?.snapshot?.lockLab?.deadlock?.cycleTransactionIds,
    )).toBe(true)
  })

  it('keeps the existing optimistic prewrite conflict separate from Lock Lab', () => {
    const simulation = createTiDBSimulation({ seed: 2026 })
    const receipt = simulation.runScenario('optimistic-conflict')

    expect(receipt.outcome).toBe('rolled_back')
    expect(simulation.state.transactions).toHaveLength(1)
    expect(simulation.state.transactions[0]).toMatchObject({
      mode: 'optimistic',
      phase: 'rolled_back',
      conflict: true,
    })
    expect(receipt.events.some((candidate) =>
      candidate.kind === 'write_conflict')).toBe(true)
    expect(receipt.events.some((candidate) =>
      candidate.kind === 'lock_wait_enqueued' ||
      candidate.kind === 'deadlock_detected' ||
      candidate.snapshot?.lockLab !== undefined,
    )).toBe(false)
    expect(simulation.state.metrics).toMatchObject({
      lockWaits: 0,
      deadlocks: 0,
      retries: 0,
    })
  })
})

describe('model-4 Region Raft failure and TiDB-internal retry', () => {
  function receipt() {
    return createTiDBSimulation({ seed: 425 }).runScenario('tikv-failover')
  }

  function event(events: readonly TraceEvent[], kind: string): TraceEvent {
    const found = events.find((candidate) => candidate.kind === kind)
    if (!found) throw new Error(`Expected event ${kind}`)
    return found
  }

  it('publishes a deterministic, acyclic, fully snapshotted failover trace', () => {
    const first = receipt()
    const second = receipt()
    expect(first).toEqual(second)
    expect(first.events).toHaveLength(27)
    expect(first.events.every((candidate) => candidate.snapshot?.raftLab))
      .toBe(true)

    const byId = new Map(first.events.map((candidate) => [candidate.id, candidate]))
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const visit = (candidate: TraceEvent): void => {
      expect(visiting.has(candidate.id), `cycle at ${candidate.id}`).toBe(false)
      if (visited.has(candidate.id)) return
      visiting.add(candidate.id)
      for (const dependencyId of candidate.dependsOn ?? []) {
        const dependency = byId.get(dependencyId)
        expect(dependency, `${candidate.id} dependency ${dependencyId}`).toBeDefined()
        if (!dependency) continue
        expect(dependency.atMs + dependency.durationMs).toBeLessThanOrEqual(candidate.atMs)
        visit(dependency)
      }
      visiting.delete(candidate.id)
      visited.add(candidate.id)
    }
    for (const candidate of first.events) visit(candidate)
    expect(visited.size).toBe(first.events.length)
  })

  it('separates failure, pre-vote, term vote, election, no-op, routing, and retry', () => {
    const trace = receipt()
    const kinds = trace.events.map((candidate) => candidate.kind)
    const ordered = [
      'region_request_attempt',
      'tikv_process_unreachable',
      'region_request_transport_error',
      'region_request_backoff',
      'raft_election_timeout',
      'raft_pre_vote_start',
      'raft_pre_vote_request',
      'raft_pre_vote_granted',
      'raft_candidate_term',
      'raft_vote_request',
      'raft_vote_granted',
      'raft_leader_elected',
      'raft_leader_noop_propose',
      'raft_leader_noop_persist',
      'raft_leader_noop_commit',
      'raft_leader_noop_apply',
      'pd_observes_region_leader',
      'region_cache_refreshed',
      'region_request_retry',
      'point_get_recovered',
      'raft_failover_complete',
      'raft_follower_noop_apply',
    ]
    let prior = -1
    for (const kind of ordered) {
      const index = kinds.indexOf(kind)
      expect(index, kind).toBeGreaterThan(prior)
      prior = index
    }

    const failed = event(trace.events, 'tikv_process_unreachable')
      .snapshot!.raftLab!
    expect(failed).toMatchObject({
      phase: 'leader_lost',
      oldLeaderStoreId: 'tikv-1',
      leaderStoreId: null,
      failedStoreId: 'tikv-1',
      liveVoterCount: 2,
    })
    expect(failed.peers.find((peer) => peer.storeId === 'tikv-1'))
      .toMatchObject({ role: 'offline', healthy: false, lastLogIndex: 42 })

    const preVote = event(trace.events, 'raft_pre_vote_granted')
      .snapshot!.raftLab!
    expect(preVote.election).toMatchObject({
      phase: 'pre_vote',
      candidateStoreId: 'tikv-2',
      preVotesGranted: ['tikv-2', 'tikv-3'],
      configuredElectionTimeoutTicks: 10,
      configuredMaxElectionTimeoutTicks: 20,
      elapsedTicks: 13,
      candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
    })
    expect(preVote.peers.find((peer) => peer.storeId === 'tikv-2')?.currentTerm)
      .toBe(1)

    const elected = event(trace.events, 'raft_leader_elected')
      .snapshot!.raftLab!
    expect(elected).toMatchObject({
      phase: 'elected',
      leaderStoreId: 'tikv-2',
      quorum: 2,
    })
    expect(elected.election.votesGranted).toEqual(['tikv-2', 'tikv-3'])
    expect(elected.peers.find((peer) => peer.storeId === 'tikv-2'))
      .toMatchObject({ role: 'leader', currentTerm: 2, votedFor: 'tikv-2' })

    const committed = event(trace.events, 'raft_leader_noop_commit')
      .snapshot!.raftLab!
    expect(committed.log).toMatchObject({
      entryKind: 'leader_noop',
      index: 43,
      term: 2,
      persistedStoreIds: ['tikv-2', 'tikv-3'],
      committed: true,
    })
    expect(event(trace.events, 'raft_leader_noop_propose').metadata.userDataMutation)
      .toBe(false)

    const final = trace.events.at(-1)!.snapshot!.raftLab!
    expect(final.request).toMatchObject({
      logicalRequestId: 'region-request-1',
      source: 'tidb_internal',
      attempt: 2,
      cacheState: 'refreshed',
      status: 'completed',
      clientVisibleError: false,
    })
    expect(final.log.appliedStoreIds).toEqual(['tikv-2', 'tikv-3'])
    expect(final.peers.find((peer) => peer.storeId === 'tikv-1'))
      .toMatchObject({ appliedIndex: 42, healthy: false })
    expect(final.pd).toEqual({
      role: 'observer_and_routing_only',
      observedLeaderStoreId: 'tikv-2',
      routeLookupCompleted: true,
    })
  })

  it('keeps the read, PD, and privacy boundaries explicit', () => {
    const sim = createTiDBSimulation({ seed: 425 })
    const trace = sim.runScenario('tikv-failover')
    expect(trace.succeeded).toBe(true)
    expect(trace.committed).toBe(false)
    expect(trace.protocol).toBeNull()
    expect(sim.state.metrics).toMatchObject({
      statements: 1,
      reads: 1,
      writes: 0,
      raftEntries: 1,
      leaderElections: 1,
    })
    expect(trace.events.filter((candidate) =>
      candidate.deltas?.some((delta) =>
        delta.kind === 'raft_propose' &&
        delta.operation !== 'leader_noop',
      ),
    )).toEqual([])
    expect(event(trace.events, 'raft_leader_elected').metadata.pdParticipatedInElection)
      .toBe(false)
    expect(event(trace.events, 'raft_failover_complete').metadata.applicationRetry)
      .toBe(false)
    expect(JSON.stringify(trace.events.map((candidate) => ({
      snapshot: candidate.snapshot,
      deltas: candidate.deltas,
      metadata: candidate.metadata,
    })))).not.toMatch(
      /SELECT \*|accounts|id = 425|row value|result row:/i,
    )
    for (const candidate of trace.events) {
      const snapshot = candidate.snapshot!.raftLab!
      expect(Object.isFrozen(candidate.snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.peers)).toBe(true)
      expect(Object.isFrozen(snapshot.election.preVotesGranted)).toBe(true)
      expect(Object.isFrozen(snapshot.election.votesGranted)).toBe(true)
      expect(Object.isFrozen(snapshot.log.persistedStoreIds)).toBe(true)
      expect(Object.isFrozen(snapshot.log.appliedStoreIds)).toBe(true)
    }
  })
})

describe('guided scenarios', () => {
  it('ships all nine decision-complete scenario receipts', () => {
    const expected: ScenarioId[] = [
      'point-read',
      'cross-region-transaction',
      'optimistic-conflict',
      'lock-deadlock',
      'commit-protocols',
      'hotspot-split',
      'tikv-failover',
      'gc-safe-point',
      'tiflash-mpp',
    ]
    expect(TIDB_SCENARIOS.map((scenario) => scenario.id)).toEqual(expected)

    for (const id of expected) {
      const sim = createTiDBSimulation({ seed: 2026 })
      const receipt = sim.runScenario(id)
      expect(receipt.scenarioId).toBe(id)
      expect(receipt.events.length, id).toBeGreaterThan(2)
      expect(receipt.replay.scenarioId).toBe(id)
      expectRegionInvariants(sim.state.regions)
    }
  })

  it('splits a hot sequential Region without gaps or overlaps', () => {
    const sim = createTiDBSimulation()
    const receipt = sim.runScenario('hotspot-split')

    expect(sim.state.regions).toHaveLength(37)
    expect(sim.state.metrics.regionSplits).toBe(1)
    expect(receipt.events.findIndex((event) => event.kind === 'submit'))
      .toBeLessThan(receipt.events.findIndex((event) => event.kind === 'region_split'))
    expect(sim.state.transactions.at(-1)?.regionIds).toContain(35)
    expect(sim.state.regions.find((region) => region.id === 35)?.endKey)
      .toBe(Math.max(...sim.state.regions.map((region) => region.endKey)))
    expectRegionInvariants(sim.state.regions)
  })

  it('compares 1PC, Async Commit, and 2PC in the commit protocol scenario', () => {
    const sim = createTiDBSimulation()
    const receipt = sim.runScenario('commit-protocols')
    const selected = receipt.events
      .filter((event) => event.kind === 'protocol_selection')
      .map((event) => event.metadata.selected)

    expect(selected).toEqual(['1pc', 'async_commit', '2pc'])
    expect(sim.state.transactions.map((transaction) => transaction.protocol))
      .toEqual(['1pc', 'async_commit', '2pc'])
    expect(receipt.outcome).toBe('succeeded')
    expect(receipt.protocol).toBeNull()
  })

  it('elects a live voter after the TiKV leader fails', () => {
    const sim = createTiDBSimulation()
    const receipt = sim.runScenario('tikv-failover')
    const region = sim.state.regions[0]

    expect(sim.state.metrics.leaderElections).toBe(1)
    expect(region.term).toBeGreaterThan(1)
    expect(region.peers.find((peer) => peer.raftRole === 'leader')?.healthy).toBe(true)
    expect(receipt.events.some((event) => event.kind === 'raft_leader_elected')).toBe(true)
  })

  it('creates distinct receipt objects across deterministic scenario resets', () => {
    const sim = createTiDBSimulation()
    const first = sim.runScenario('point-read')
    const second = sim.runScenario('tikv-failover')

    expect(first.id).toBe('trace-1')
    expect(second.id).toBe('trace-1')
    expect(second).not.toBe(first)
    expect(second.events).not.toEqual(first.events)
  })
})
