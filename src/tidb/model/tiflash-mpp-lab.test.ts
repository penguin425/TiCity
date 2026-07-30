/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import {
  createTiDBSimulation,
  createTiFlashMppLabState,
  isTiFlashMppLabDelta,
  reduceTiFlashMppLabState,
  TIDB_MODEL_VERSION,
} from './index'
import type {
  TraceEvent,
  TraceReceipt,
  TraceTiFlashMppLabSnapshot,
} from './types'

function run(seed = 2026): {
  receipt: TraceReceipt
  resolvedTs: number
} {
  const simulation = createTiDBSimulation({ seed })
  const receipt = simulation.runScenario('tiflash-mpp')
  return {
    receipt,
    resolvedTs: simulation.state.tiflash.resolvedTs,
  }
}

function finalLab(receipt: TraceReceipt): TraceTiFlashMppLabSnapshot {
  const lab = receipt.events.at(-1)?.snapshot?.tiflashMppLab
  if (!lab) throw new Error('Missing final TiFlash/MPP Lab snapshot.')
  return lab
}

function event(
  receipt: TraceReceipt,
  kind: string,
  regionId?: number,
): TraceEvent {
  const found = receipt.events.find((candidate) =>
    candidate.kind === kind &&
    (regionId === undefined || candidate.regionId === regionId))
  if (!found) {
    throw new Error(`Missing ${kind}${regionId === undefined ? '' : ` Region ${regionId}`}.`)
  }
  return found
}

describe('model-7 TiFlash learner and MPP vertical slice', () => {
  it('is deterministic, bounded, fully snapshotted, and versioned', () => {
    const first = run()
    const second = run()

    expect(TIDB_MODEL_VERSION).toBe('tidb-v8.5-model-7')
    expect(first).toEqual(second)
    expect(first.receipt.succeeded).toBe(true)
    expect(first.receipt.events).toHaveLength(56)
    expect(first.receipt.events.length).toBeLessThanOrEqual(57)
    expect(first.receipt.events.map((candidate, index) => candidate.id))
      .toEqual(first.receipt.events.map((_, index) =>
        `trace-1-event-${index + 1}`))

    for (const candidate of first.receipt.events) {
      expect(candidate.snapshot?.tiflashMppLab, candidate.kind).toBeDefined()
      expect(candidate.deltas?.length, candidate.kind).toBeGreaterThan(0)
      expect(candidate.deltas?.every(isTiFlashMppLabDelta), candidate.kind)
        .toBe(true)
    }
  })

  it('publishes exact v8.5.0 pins and the fixed task/tunnel fixture', () => {
    const lab = finalLab(run().receipt)

    expect(lab.pins).toEqual({
      tiflash: '6e12ba23c70f358f2ffbee837feac24118a3e988',
      tiflashProxy: 'b877a976997acb7c552db970c01546b4e82bce18',
      tidb: 'd13e52ed6e22cc5789bed7c64c861578cd2ed55b',
      tikv: 'a2c58c94f89cbb410e66d8f85c236308d6fc64f0',
      pd: 'd190c0e9082de46128b756f93b1291768dda645a',
      clientGo: '006dfb024c26859f2e3757172296d84ef36ff585',
    })
    expect(lab.learners.map((learner) => learner.regionId)).toEqual([24, 25, 26])
    expect(lab.learners.every((learner) =>
      learner.role === 'learner' && !learner.voter)).toBe(true)
    expect(lab.stores).toHaveLength(2)
    expect(lab.fragments).toHaveLength(2)
    expect(lab.tasks).toHaveLength(4)
    expect(lab.tasks.every((task) => !task.root)).toBe(true)
    expect(lab.tasks.filter((task) => task.feedsTiDBRoot)).toHaveLength(2)
    expect(lab.tunnels).toHaveLength(6)
    expect(lab.tunnels.filter((tunnel) =>
      tunnel.exchangeType === 'hash_partition')).toHaveLength(4)
    expect(lab.tunnels.filter((tunnel) =>
      tunnel.exchangeType === 'pass_through')).toHaveLength(2)
    expect(lab.tunnels.map((tunnel) => tunnel.locality).sort()).toEqual([
      'local',
      'local',
      'remote',
      'remote',
      'root',
      'root',
    ])
    expect(lab.result).toMatchObject({
      taskId: 'tidb-root',
      rootStreamCount: 2,
      stage: 'client_complete',
      clientComplete: true,
    })
  })

  it('uses self safe-ts only for Region 24 and ReadIndex plus apply for 25/26', () => {
    const receipt = run().receipt
    const lab = finalLab(receipt)
    const byRegion = new Map(lab.learners.map((learner) =>
      [learner.regionId, learner]))

    expect(byRegion.get(24)).toMatchObject({
      readIndexSkipped: true,
      requiredReadIndex: null,
      gateReason: 'self_safe_ts',
      readGate: 'validated',
      learnerAppliedIndex: 241,
    })
    expect(byRegion.get(25)).toMatchObject({
      readIndexSkipped: false,
      requiredReadIndex: 251,
      gateReason: 'read_index_applied',
      readGate: 'validated',
      learnerAppliedIndex: 251,
    })
    expect(byRegion.get(26)).toMatchObject({
      readIndexSkipped: false,
      requiredReadIndex: 261,
      gateReason: 'read_index_applied',
      readGate: 'validated',
      learnerAppliedIndex: 261,
    })

    for (const regionId of [25, 26]) {
      const waiting = event(receipt, 'tiflash_learner_wait_applied', regionId)
      const applied = event(receipt, 'tiflash_learner_applied_advance', regionId)
      const ready = event(
        receipt,
        'tiflash_snapshot_gate_ready_read_index',
        regionId,
      )
      expect(applied.dependsOn).toContain(
        event(receipt, 'tiflash_dm_committed_flush', regionId).id,
      )
      expect(applied.atMs).toBeGreaterThanOrEqual(
        waiting.atMs + waiting.durationMs,
      )
      expect(ready.dependsOn).toContain(applied.id)
      expect(ready.snapshot?.tiflashMppLab?.learners.find((learner) =>
        learner.regionId === regionId)?.learnerAppliedIndex)
        .toBe(regionId === 25 ? 251 : 261)
    }

    const scanStart = event(receipt, 'tiflash_dm_snapshot_scans_started')
    const lockCheck = event(receipt, 'tiflash_mvcc_lock_checks_complete')
    expect(scanStart.dependsOn).toEqual([lockCheck.id])
  })

  it('keeps persistent learner replication distinct from ephemeral exchange', () => {
    const receipt = run().receipt
    const exchangeEvents = receipt.events.filter((candidate) =>
      candidate.deltas?.some((delta) =>
        delta.kind === 'tiflash_mpp_tunnel_data'))
    const replicationEvents = receipt.events.filter((candidate) =>
      candidate.deltas?.some((delta) =>
        delta.kind.startsWith('tiflash_replica_')))

    expect(exchangeEvents.length).toBeGreaterThan(0)
    expect(replicationEvents.length).toBeGreaterThan(0)
    expect(exchangeEvents.every((candidate) =>
      candidate.deltas?.every((delta) =>
        !delta.kind.startsWith('tiflash_replica_')))).toBe(true)
    expect(replicationEvents.every((candidate) =>
      candidate.deltas?.every((delta) =>
        delta.kind.startsWith('tiflash_replica_')))).toBe(true)

    const appliedDuringExchange = exchangeEvents.map((candidate) =>
      candidate.snapshot?.tiflashMppLab?.learners.map((learner) =>
        learner.learnerAppliedIndex))
    expect(appliedDuringExchange.every((indexes) =>
      JSON.stringify(indexes) === JSON.stringify([241, 251, 261]))).toBe(true)
    expect(finalLab(receipt).tunnels.every((tunnel) =>
      tunnel.persistence === 'ephemeral_query_blocks')).toBe(true)
  })

  it('forms an acyclic time-valid event DAG', () => {
    const receipt = run().receipt
    const byId = new Map(receipt.events.map((candidate) =>
      [candidate.id, candidate]))
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
        expect(candidate.atMs).toBeGreaterThanOrEqual(
          dependency.atMs + dependency.durationMs,
        )
        visit(dependency)
      }
      visiting.delete(candidate.id)
      visited.add(candidate.id)
    }

    for (const candidate of receipt.events) visit(candidate)
    expect(visited.size).toBe(receipt.events.length)
  })

  it('deep-freezes snapshots and deltas and retains aggregate synthetic data only', () => {
    const { receipt, resolvedTs } = run()
    const lab = finalLab(receipt)

    for (const candidate of receipt.events) {
      expect(Object.isFrozen(candidate)).toBe(true)
      expect(Object.isFrozen(candidate.snapshot)).toBe(true)
      expect(Object.isFrozen(candidate.snapshot?.tiflashMppLab)).toBe(true)
      expect(Object.isFrozen(candidate.deltas)).toBe(true)
      expect(candidate.deltas?.every(Object.isFrozen)).toBe(true)
    }
    expect(Object.isFrozen(lab.pins)).toBe(true)
    expect(Object.isFrozen(lab.configuration)).toBe(true)
    expect(Object.isFrozen(lab.stores)).toBe(true)
    expect(Object.isFrozen(lab.stores[0]?.regionIds)).toBe(true)
    expect(Object.isFrozen(lab.learners)).toBe(true)
    expect(Object.isFrozen(lab.fragments[0]?.operatorTokens)).toBe(true)
    expect(Object.isFrozen(lab.tasks[0]?.regionIds)).toBe(true)
    expect(Object.isFrozen(lab.tunnels)).toBe(true)
    expect(Object.isFrozen(lab.result)).toBe(true)
    expect(Object.isFrozen(lab.retry)).toBe(true)

    const serialized = JSON.stringify(receipt.events)
    expect(serialized).not.toMatch(
      /\bSELECT\b|\bINSERT\b|account_id|balance|encoded_key/i,
    )
    expect(serialized).not.toContain('events GROUP BY')
    expect(lab.configuration.representation).toBe('aggregate_counts_only')
    expect(lab.retry).toEqual({
      retryCount: 0,
      fallbackToTiKV: false,
      failureCode: null,
    })
    expect(lab.configuration.staleRead).toBe(false)
    expect(resolvedTs).toBeLessThan(receipt.startTs ?? Number.MAX_SAFE_INTEGER)
  })

  it('rejects invalid readiness, replication, and topology transitions', () => {
    const initial = createTiFlashMppLabState()

    expect(() => reduceTiFlashMppLabState(initial, {
      kind: 'tiflash_replica_applied_advance',
      regionId: 25,
      from: 250,
      to: 251,
    })).toThrow(/DeltaMerge flush/)

    expect(() => reduceTiFlashMppLabState(initial, {
      kind: 'tiflash_mpp_tasks_build',
      taskCount: 4,
    })).toThrow(/scheduling/)

    const query = reduceTiFlashMppLabState(initial, {
      kind: 'tiflash_mpp_query_received',
      queryToken: 'query-mpp-1',
      queryClass: 'grouped_aggregate',
    })
    const withTs = reduceTiFlashMppLabState(query, {
      kind: 'tiflash_mpp_snapshot_tso',
      timestamp: 1_000_000_001,
    })
    expect(() => reduceTiFlashMppLabState(withTs, {
      kind: 'tiflash_mpp_snapshot_gate',
      regionId: 25,
      action: 'ready_read_index',
    })).toThrow(/gate action|before learner apply/)
  })
})
