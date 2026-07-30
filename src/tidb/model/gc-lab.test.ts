/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import {
  createGcLabState,
  reduceGcLabState,
} from './gc-lab'
import { createTiDBSimulation } from './simulation'
import type {
  TraceEvent,
  TraceGcLabSnapshot,
  TraceReceipt,
} from './types'

const EXPECTED_KINDS = [
  'gc_round_start',
  'gc_safe_point_candidate',
  'gc_min_start_ts_bound',
  'gc_service_safe_point',
  'gc_mysql_safe_point_staged',
  'gc_resolve_locks_start',
  'gc_resolve_locks_scan',
  'gc_resolve_lock_commit',
  'gc_resolve_locks_scan',
  'gc_resolve_lock_rollback',
  'gc_visibility_safe_point_saved',
  'gc_delete_ranges_start',
  'gc_delete_range_store',
  'gc_delete_range_store',
  'gc_delete_range_store',
  'gc_delete_range_complete',
  'gc_global_safe_point_publish',
  'gc_store_safe_point_detected',
  'gc_store_safe_point_detected',
  'gc_store_safe_point_detected',
  'gc_compaction_filter_start',
  'gc_compaction_filter_apply',
  'gc_compaction_filter_complete',
  'gc_round_complete',
  'gc_blocker_complete',
  'gc_round_start',
  'gc_safe_point_candidate',
  'gc_min_start_ts_clear',
  'gc_service_safe_point',
  'gc_mysql_safe_point_staged',
  'gc_resolve_locks_start',
  'gc_resolve_locks_scan',
  'gc_resolve_locks_scan',
  'gc_visibility_safe_point_saved',
  'gc_delete_ranges_empty',
  'gc_global_safe_point_publish',
  'gc_store_safe_point_detected',
  'gc_store_safe_point_detected',
  'gc_store_safe_point_detected',
  'gc_compaction_filter_start',
  'gc_compaction_filter_apply',
  'gc_compaction_filter_complete',
  'gc_storage_lab_complete',
] as const

function runGcLab(seed = 2026): TraceReceipt {
  return createTiDBSimulation({ seed }).runScenario('gc-safe-point')
}

function eventAt(receipt: TraceReceipt, oneBased: number): TraceEvent {
  const event = receipt.events[oneBased - 1]
  if (!event) throw new Error(`Missing GC/Storage Lab event ${oneBased}`)
  return event
}

function labAt(
  receipt: TraceReceipt,
  oneBased: number,
): TraceGcLabSnapshot {
  const lab = eventAt(receipt, oneBased).snapshot?.gcLab
  if (!lab) throw new Error(`Event ${oneBased} has no GC/Storage Lab snapshot`)
  return lab
}

describe('model-6 GC/Storage Lab trace', () => {
  it('publishes one deterministic immutable 43-event causal DAG', () => {
    const first = runGcLab()
    const second = runGcLab()

    expect(first).toEqual(second)
    expect(first.id).toBe('trace-1')
    expect(first.events).toHaveLength(43)
    expect(first.events.map((event) => event.kind)).toEqual(EXPECTED_KINDS)
    expect(first.events.map((event) => event.id)).toEqual(
      EXPECTED_KINDS.map((_, index) => `trace-1-event-${index + 1}`),
    )
    expect(first.events.every((event) => event.domain === 'kv')).toBe(true)
    expect(first.events.every((event) => event.snapshot?.gcLab)).toBe(true)
    expect(first.events.some((event) => event.domain === 'raft')).toBe(false)

    const byId = new Map(first.events.map((event) => [event.id, event]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (event: TraceEvent): void => {
      expect(visiting.has(event.id), `cycle at ${event.id}`).toBe(false)
      if (visited.has(event.id)) return
      visiting.add(event.id)
      for (const dependencyId of event.dependsOn ?? []) {
        const dependency = byId.get(dependencyId)
        expect(dependency, `${event.id} -> ${dependencyId}`).toBeDefined()
        if (!dependency) continue
        expect(dependency.atMs + dependency.durationMs)
          .toBeLessThanOrEqual(event.atMs)
        visit(dependency)
      }
      visiting.delete(event.id)
      visited.add(event.id)
    }
    for (const event of first.events) visit(event)
    expect(visited.size).toBe(43)

    expect(eventAt(first, 13).dependsOn).toEqual(['trace-1-event-12'])
    expect(eventAt(first, 14).dependsOn).toEqual(['trace-1-event-12'])
    expect(eventAt(first, 15).dependsOn).toEqual(['trace-1-event-12'])
    expect(eventAt(first, 16).dependsOn).toEqual([
      'trace-1-event-13',
      'trace-1-event-14',
      'trace-1-event-15',
    ])
    expect(eventAt(first, 18).dependsOn).toEqual(['trace-1-event-17'])
    expect(eventAt(first, 19).dependsOn).toEqual(['trace-1-event-17'])
    expect(eventAt(first, 20).dependsOn).toEqual(['trace-1-event-17'])
    expect(eventAt(first, 21).dependsOn).toEqual([
      'trace-1-event-18',
      'trace-1-event-19',
      'trace-1-event-20',
    ])
    expect(eventAt(first, 37).dependsOn).toEqual(['trace-1-event-36'])
    expect(eventAt(first, 38).dependsOn).toEqual(['trace-1-event-36'])
    expect(eventAt(first, 39).dependsOn).toEqual(['trace-1-event-36'])
    expect(eventAt(first, 40).dependsOn).toEqual([
      'trace-1-event-37',
      'trace-1-event-38',
      'trace-1-event-39',
    ])

    for (const event of first.events) {
      expect(Object.isFrozen(event)).toBe(true)
      expect(Object.isFrozen(event.snapshot)).toBe(true)
      expect(Object.isFrozen(event.snapshot?.gcLab)).toBe(true)
      expect(Object.isFrozen(event.snapshot?.gcLab?.stores)).toBe(true)
      expect(Object.isFrozen(event.snapshot?.gcLab?.keyChains)).toBe(true)
      expect(Object.isFrozen(event.deltas)).toBe(true)
    }
    const filterDelta = eventAt(first, 22).deltas?.find((delta) =>
      delta.kind === 'gc_compaction_filter')
    if (filterDelta?.kind !== 'gc_compaction_filter') {
      throw new Error('Missing first Compaction Filter delta')
    }
    expect(Object.isFrozen(filterDelta.filteredVersionIds)).toBe(true)
    expect(Object.isFrozen(filterDelta.retainedAnchorIds)).toBe(true)
  })

  it('caps round 1 to global min start_ts - 1 without killing the transaction', () => {
    const receipt = runGcLab()
    const candidate = labAt(receipt, 2)
    const bounded = labAt(receipt, 3)
    const immutableBounded = structuredClone(bounded)

    expect(candidate.safePoint).toMatchObject({
      previous: 1_000_000_000,
      candidate: 1_000_180_000,
      published: 1_000_000_000,
    })
    expect(bounded.safePoint).toMatchObject({
      candidate: 1_000_180_000,
      globalMinStartTs: 1_000_080_000,
      activeTransactionBound: 1_000_079_999,
      serviceSafePoint: 1_000_079_999,
      blocked: true,
    })
    expect(bounded.blocker).toMatchObject({
      status: 'active',
      withinMaxWaitTime: true,
    })
    expect(eventAt(receipt, 3).metadata).toMatchObject({
      gcMaxWaitSeconds: 86_400,
      killsTransaction: false,
    })
    expect(labAt(receipt, 25).blocker.status).toBe('completed')
    expect(labAt(receipt, 25).safePoint.blocked).toBe(false)
    expect(bounded).toEqual(immutableBounded)
  })

  it('keeps Resolve Locks, cached visibility, Delete Ranges, and PD publication ordered', () => {
    const receipt = runGcLab()

    expect(labAt(receipt, 8).resolveLocks.locks).toEqual([
      expect.objectContaining({
        id: 'stale-lock-a',
        status: 'resolved_commit',
      }),
      expect.objectContaining({
        id: 'stale-lock-b',
        status: 'pending',
      }),
    ])
    expect(labAt(receipt, 10).resolveLocks.locks).toEqual([
      expect.objectContaining({
        id: 'stale-lock-a',
        status: 'resolved_commit',
      }),
      expect.objectContaining({
        id: 'stale-lock-b',
        status: 'resolved_rollback',
      }),
    ])
    expect(labAt(receipt, 11).safePoint).toMatchObject({
      staged: 1_000_079_999,
      visibilitySaved: 1_000_079_999,
      published: 1_000_000_000,
    })
    expect(labAt(receipt, 12).deleteRanges[0].status).toBe('eligible')
    expect(labAt(receipt, 15).deleteRanges[0].status).toBe('eligible')
    expect(labAt(receipt, 16).deleteRanges[0].status).toBe('deleted')
    expect(labAt(receipt, 17).safePoint.published).toBe(1_000_079_999)
    expect(eventAt(receipt, 11).metadata).toMatchObject({
      implementationCacheBarrierSeconds: 100,
      liveTimingGuarantee: false,
    })
    for (const number of [13, 14, 15]) {
      expect(eventAt(receipt, number).metadata).toMatchObject({
        raftstoreMode: 'v1_classic',
        request: 'UnsafeDestroyRange',
        bypassesRaft: true,
      })
    }
  })

  it('uses asynchronous per-store detection and the v8.5.0 Compaction Filter path', () => {
    const receipt = runGcLab()

    for (const number of [18, 19, 20, 21, 22, 23, 24, 37, 38, 39, 40, 41, 42, 43]) {
      expect(eventAt(receipt, number).path, `event ${number}`).toBe('background')
    }
    expect(labAt(receipt, 20).stores).toEqual([
      expect.objectContaining({
        storeId: 'tikv-1',
        detectedSafePoint: 1_000_079_999,
        compaction: 'eligible',
      }),
      expect.objectContaining({
        storeId: 'tikv-2',
        detectedSafePoint: 1_000_079_999,
        compaction: 'eligible',
      }),
      expect.objectContaining({
        storeId: 'tikv-3',
        detectedSafePoint: 1_000_079_999,
        compaction: 'eligible',
      }),
    ])
    expect(labAt(receipt, 21).stores.every((store) =>
      store.compaction === 'running' && store.filterActive)).toBe(true)
    expect(eventAt(receipt, 18).metadata).toMatchObject({
      compactionFilterEnabled: true,
      legacyRegionGcScheduled: false,
    })
    expect(labAt(receipt, 23).stores.every((store) =>
      store.compaction === 'complete' && !store.filterActive)).toBe(true)
    expect(labAt(receipt, 23).storage.compactionRaftEntriesCreated).toBe(0)
  })

  it('retains Put anchors, removes a Delete chain, and advances after release', () => {
    const receipt = runGcLab()
    const roundOne = labAt(receipt, 22)
    const final = labAt(receipt, 43)
    const version = (
      lab: TraceGcLabSnapshot,
      id: string,
    ) => lab.keyChains.flatMap((chain) => chain.versions)
      .find((candidate) => candidate.id === id)

    expect(roundOne.storage).toMatchObject({
      representation: 'logical_chains_counted_once',
      compactionLevel: 'bottommost_model_fixture',
      initialVersionCount: 12,
      filteredVersionCount: 4,
      retainedAnchorCount: 2,
      presentVersionCount: 8,
      deletedDefaultCfValues: 2,
      compactionRaftEntriesCreated: 0,
    })
    expect(version(roundOne, 'a-v2')?.state).toBe('retained_anchor')
    expect(version(roundOne, 'd-v2')?.state).toBe('retained_anchor')
    expect(version(roundOne, 'b-v1')?.state).toBe('filtered')
    expect(version(roundOne, 'b-v2')?.state).toBe('filtered')
    expect(version(roundOne, 'b-v3')?.state).toBe('present')

    expect(final.phase).toBe('complete')
    expect(final.round).toBe(2)
    expect(final.safePoint).toMatchObject({
      previous: 1_000_079_999,
      candidate: 1_000_220_000,
      serviceSafePoint: 1_000_220_000,
      staged: 1_000_220_000,
      visibilitySaved: 1_000_220_000,
      published: 1_000_220_000,
      blocked: false,
    })
    expect(final.storage).toMatchObject({
      initialVersionCount: 12,
      filteredVersionCount: 6,
      retainedAnchorCount: 3,
      presentVersionCount: 6,
      deletedDefaultCfValues: 3,
      compactionRaftEntriesCreated: 0,
    })
    expect(version(final, 'a-v2')?.state).toBe('filtered')
    expect(version(final, 'a-v3')?.state).toBe('retained_anchor')
    expect(version(final, 'c-v1')?.state).toBe('filtered')
    expect(version(final, 'c-v2')?.state).toBe('retained_anchor')
    expect(version(final, 'd-v2')?.state).toBe('retained_anchor')
  })

  it('retains only synthetic aggregate identifiers in event snapshots', () => {
    const receipt = runGcLab()
    const projection = JSON.stringify(
      receipt.events.map((event) => ({
        snapshot: event.snapshot,
        deltas: event.deltas,
      })),
    )

    expect(projection).not.toContain('archived')
    expect(projection).not.toContain('orders')
    expect(projection).not.toContain('WHERE')
    expect(projection).not.toContain('encoded')
    expect(projection).not.toContain('rowValue')
    expect(projection).toContain('logical_chains_counted_once')
  })

  it('rejects invalid filter ids in the pure reducer', () => {
    const state = createGcLabState({
      initialSafePoint: 1_000,
      blockerTransactionId: 'txn-fixture',
      blockerStartTs: 1_100,
      storeIds: ['tikv-1', 'tikv-2', 'tikv-3'],
      locks: [],
      deleteRanges: [],
      keyChains: [{
        id: 'chain-fixture',
        regionId: 8,
        versions: [{
          id: 'version-fixture',
          commitTs: 1_050,
          writeType: 'put',
          valueStorage: 'write_cf_inline',
        }],
      }],
    })

    expect(() => reduceGcLabState(state, {
      kind: 'gc_compaction_filter',
      safePoint: 1_000,
      filteredVersionIds: ['unknown-version'],
      retainedAnchorIds: [],
    })).toThrow(/unknown version/)
  })
})
