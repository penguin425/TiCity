// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  createGcLabState,
  planGcCompaction,
  reduceGcLabState,
} from './gc-lab'
import type { GcLabVersionDefinition } from './gc-lab'
import { createTiDBSimulation } from './simulation'
import type { TraceGcLabSnapshot, TraceGcVersionSnapshot } from './types'

function labAt(oneBased: number): TraceGcLabSnapshot {
  const lab = createTiDBSimulation({ seed: 425 }).runScenario('gc-safe-point')
    .events[oneBased - 1]?.snapshot?.gcLab
  if (!lab) throw new Error('Missing GC fixture snapshot')
  return lab
}

function fixture(versions: readonly GcLabVersionDefinition[]): TraceGcLabSnapshot {
  return createGcLabState({
    initialSafePoint: 1,
    blockerTransactionId: 'transaction',
    blockerStartTs: 1_000,
    storeIds: ['tikv-1', 'tikv-2', 'tikv-3'],
    locks: [],
    deleteRanges: [],
    keyChains: [{ id: 'chain', regionId: 8, versions }],
  })
}

/** Independent MVCC read oracle: metadata-only writes never change the row. */
function visiblePut(versions: readonly TraceGcVersionSnapshot[], readTs: number): string | null {
  const writes = versions.filter((version) => version.commitTs <= readTs &&
    version.state !== 'filtered' && version.state !== 'gc_deleted' &&
    (version.writeType === 'put' || version.writeType === 'delete'))
  const newest = writes[writes.length - 1]
  return newest?.writeType === 'put' ? newest.id : null
}

describe('source-pinned complete-chain Compaction Filter invariants', () => {
  it('preserves every protected snapshot across all four WRITE types and safe-point boundaries', () => {
    const kinds = ['put', 'delete', 'rollback', 'lock'] as const
    for (let length = 1; length <= 4; length++) {
      for (let combination = 0; combination < 4 ** length; combination++) {
        const versions = Array.from({ length }, (_, index): GcLabVersionDefinition => {
          const writeType = kinds[Math.floor(combination / 4 ** index) % 4]
          return {
            id: `version-${index}`,
            commitTs: 10 * (index + 1),
            writeType,
            valueStorage: writeType === 'put'
              ? (index % 2 ? 'write_cf_inline' : 'write_and_default_cf')
              : 'write_cf_only',
          }
        })
        const input = fixture(versions).keyChains
        for (const safePoint of [5, 10, 15, 20, 25, 30, 35, 40, 45]) {
          const plan = planGcCompaction(input, safePoint)
          const removed = new Set(plan.filteredVersionIds)
          const anchors = new Set(plan.retainedAnchorIds)
          const output = input[0].versions.map((version): TraceGcVersionSnapshot => ({
            ...version,
            state: removed.has(version.id) ? 'filtered'
              : anchors.has(version.id) ? 'retained_anchor' : 'present',
          }))
          for (const readTs of [safePoint, safePoint + 1, safePoint + 10, 100]) {
            expect(visiblePut(output, readTs)).toBe(visiblePut(input[0].versions, readTs))
          }
          expect(plan.deletedDefaultCfValueIds).toEqual(input[0].versions
            .filter((version) => removed.has(version.id) && version.writeType === 'put' &&
              version.valueStorage === 'write_and_default_cf')
            .reverse().map((version) => version.id))
          expect(output.filter((version) => version.commitTs > safePoint)
            .every((version) => version.state === 'present')).toBe(true)
          const second = planGcCompaction([{ ...input[0], versions: output }], safePoint)
          expect(second.filteredVersionIds).toEqual([])
          expect(second.retainedAnchorIds).toEqual(plan.retainedAnchorIds)
          const cleaned = output.map((version): TraceGcVersionSnapshot =>
            second.eligibleDeleteMarkerIds.includes(version.id)
              ? { ...version, state: 'gc_deleted' } : version)
          for (const readTs of [safePoint, safePoint + 1, 100]) {
            expect(visiblePut(cleaned, readTs)).toBe(visiblePut(input[0].versions, readTs))
          }
        }
      }
    }
  })

  it('never resurrects filtered Put values or labels an older Put as the retained anchor', () => {
    const state = labAt(40)
    const correct = planGcCompaction(state.keyChains, state.safePoint.published)
    for (const badAnchor of ['a-v1', 'a-v2']) {
      expect(() => reduceGcLabState(state, {
        kind: 'gc_compaction_filter', safePoint: correct.safePoint,
        filteredVersionIds: correct.filteredVersionIds,
        retainedAnchorIds: [...correct.retainedAnchorIds.filter((id) => id !== 'a-v3'), badAnchor],
      })).toThrow(/anchor|filtered and retained/)
    }
    expect(() => reduceGcLabState(state, {
      kind: 'gc_compaction_filter', safePoint: correct.safePoint,
      filteredVersionIds: correct.filteredVersionIds.slice(1),
      retainedAnchorIds: correct.retainedAnchorIds,
    })).toThrow(/remove exactly the obsolete input/)
  })

  it('never promotes a Delete using records removed by the same still-running compaction', () => {
    const filtered = labAt(22)
    expect(filtered.compactionFilterApplied).toBe(true)
    expect(filtered.gcKeyCleanup.eligibleVersionIds).toEqual([])
    // This plan is safe only for a NEW compaction input, after the older Put
    // has gone. Replaying it inside the same compaction must not erase overlap.
    const laterInput = planGcCompaction(filtered.keyChains, filtered.safePoint.published)
    expect(laterInput.eligibleDeleteMarkerIds).toContain('b-v2')
    expect(() => reduceGcLabState(filtered, {
      kind: 'gc_compaction_filter', safePoint: laterInput.safePoint,
      filteredVersionIds: laterInput.filteredVersionIds,
      retainedAnchorIds: laterInput.retainedAnchorIds,
    })).toThrow(/exactly once per round/)
    expect(() => reduceGcLabState(filtered, {
      kind: 'gc_key_cleanup', safePoint: laterInput.safePoint,
      action: 'schedule', versionIds: ['b-v2'],
    })).toThrow(/not observed without older versions/)
    expect(labAt(26).compactionFilterApplied).toBe(false)
    expect(labAt(41).compactionFilterApplied).toBe(true)
  })

  it('records an empty filter pass before completing a compaction with only future versions', () => {
    const running = labAt(21)
    const untouched = fixture([{ id: 'future-put', commitTs: running.safePoint.published + 1,
      writeType: 'put', valueStorage: 'write_cf_inline' }])
    const noOpInput = { ...running, keyChains: untouched.keyChains, storage: untouched.storage }
    const complete = { kind: 'gc_compaction_state' as const,
      storeId: 'tikv-1' as const, from: 'running' as const, to: 'complete' as const }
    expect(() => reduceGcLabState(noOpInput, complete)).toThrow(/no input pass was recorded/)
    const filtered = reduceGcLabState(noOpInput, {
      kind: 'gc_compaction_filter', safePoint: running.safePoint.published,
      filteredVersionIds: [], retainedAnchorIds: [],
    })
    expect(reduceGcLabState(filtered, complete).keyChains[0].versions[0].state).toBe('present')
    expect(() => reduceGcLabState(filtered, {
      kind: 'gc_compaction_filter', safePoint: running.safePoint.published,
      filteredVersionIds: [], retainedAnchorIds: [],
    })).toThrow(/exactly once per round/)
  })

  it('can clean an eligible Delete in round one before the second round begins', () => {
    const running = labAt(21)
    const input = fixture([{ id: 'only-delete', commitTs: running.safePoint.published - 1,
      writeType: 'delete', valueStorage: 'write_cf_only' }])
    let lab = reduceGcLabState({ ...running, keyChains: input.keyChains, storage: input.storage }, {
      kind: 'gc_compaction_filter', safePoint: running.safePoint.published,
      filteredVersionIds: [], retainedAnchorIds: [],
    })
    lab = reduceGcLabState(lab, { kind: 'gc_key_cleanup', action: 'schedule',
      safePoint: running.safePoint.published, versionIds: ['only-delete'] })
    for (const storeId of ['tikv-1', 'tikv-2', 'tikv-3'] as const) {
      lab = reduceGcLabState(lab, { kind: 'gc_compaction_state', storeId,
        from: 'running', to: 'complete' })
    }
    lab = reduceGcLabState(lab, { kind: 'gc_phase', round: 1,
      from: 'compacting', to: 'cleaning_delete_markers' })
    lab = reduceGcLabState(lab, { kind: 'gc_key_cleanup', action: 'delete',
      safePoint: running.safePoint.published, versionIds: ['only-delete'] })
    const betweenRounds = reduceGcLabState(lab, { kind: 'gc_phase', round: 1,
      from: 'cleaning_delete_markers', to: 'between_rounds' })
    expect(betweenRounds.keyChains[0].versions[0].state).toBe('gc_deleted')
    expect(betweenRounds.storage.gcKeyDeletedVersionCount).toBe(1)
    expect(betweenRounds.storage.filteredVersionCount).toBe(0)
  })

  it('rejects impossible CF layouts and unsafe numeric timestamps', () => {
    expect(() => fixture([{ id: 'delete', commitTs: 10, writeType: 'delete',
      valueStorage: 'write_and_default_cf' }])).toThrow(/CF representation/)
    for (const invalid of [NaN, Infinity, -1, 0, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => planGcCompaction(fixture([{ id: 'put', commitTs: 10,
        writeType: 'put', valueStorage: 'write_cf_inline' }]).keyChains, invalid))
        .toThrow(/positive safe integer/)
      const preparing = labAt(1)
      expect(() => reduceGcLabState(preparing, {
        kind: 'gc_safe_point_candidate', round: 1,
        previous: preparing.safePoint.previous, candidate: invalid,
      })).toThrow(/positive safe integer/)
    }
  })
})

describe('GC coordinator, service caps, and inclusive ScanLock safety', () => {
  it('accepts a lower external service cap while preserving the active transaction limit', () => {
    const candidate = labAt(2)
    const capped = reduceGcLabState(candidate, {
      kind: 'gc_safe_point_bound', round: 1,
      globalMinStartTs: candidate.blocker.startTs,
      activeTransactionBound: candidate.blocker.startTs - 1,
      serviceSafePoint: candidate.safePoint.previous + 40_000, blocked: true,
    })
    expect(capped.safePoint.serviceSafePoint).toBeLessThan(capped.safePoint.activeTransactionBound!)
    expect(capped.safePoint.published).toBe(candidate.safePoint.previous)
    expect(capped.blocker.status).toBe('active')
    expect(() => reduceGcLabState(candidate, {
      kind: 'gc_safe_point_bound', round: 1,
      globalMinStartTs: candidate.blocker.startTs,
      activeTransactionBound: candidate.blocker.startTs - 1,
      serviceSafePoint: candidate.blocker.startTs, blocked: true,
    })).toThrow(/active transaction limit/)
    expect(() => reduceGcLabState(candidate, {
      kind: 'gc_safe_point_bound', round: 1,
      globalMinStartTs: null, activeTransactionBound: null,
      serviceSafePoint: candidate.safePoint.candidate!, blocked: false,
    })).toThrow(/crossed the reported active fixture/)
  })

  it('accepts an external service cap after the active transaction has completed', () => {
    const candidate = labAt(27)
    const accepted = reduceGcLabState(candidate, {
      kind: 'gc_safe_point_bound', round: 2, globalMinStartTs: null,
      activeTransactionBound: null,
      serviceSafePoint: candidate.safePoint.previous + 1, blocked: false,
    })
    expect(accepted.safePoint.serviceSafePoint).toBeLessThan(accepted.safePoint.candidate!)
    expect(accepted.safePoint.blocked).toBe(false)
    expect(() => reduceGcLabState(candidate, {
      kind: 'gc_safe_point_bound', round: 2, globalMinStartTs: null,
      activeTransactionBound: null,
      serviceSafePoint: candidate.safePoint.candidate! + 1, blocked: false,
    })).toThrow(/exceeds candidate/)
    expect(() => reduceGcLabState(candidate, {
      kind: 'gc_safe_point_bound', round: 2, globalMinStartTs: null,
      activeTransactionBound: null, serviceSafePoint: candidate.safePoint.previous, blocked: false,
    })).toThrow(/does not advance/)
  })

  it('resolves a lock at max_ts inclusively and leaves newer locks protected', () => {
    const scanned = labAt(7)
    const maximum = scanned.safePoint.serviceSafePoint!
    for (const offset of [0, 1]) {
      const state = { ...scanned, resolveLocks: { ...scanned.resolveLocks,
        locks: [...scanned.resolveLocks.locks, {
          id: 'boundary-lock', regionId: 8, startTs: maximum + offset,
          primaryStatus: 'committed' as const, status: 'pending' as const,
        }],
      } }
      const resolve = () => reduceGcLabState(state, {
        kind: 'gc_resolve_lock', lockId: 'boundary-lock', action: 'commit',
      })
      if (offset === 0) expect(resolve().resolveLocks.locks.at(-1)?.status).toBe('resolved_commit')
      else expect(resolve).toThrow(/newer than the ScanLock maximum/)
    }
  })

  it('blocks skipped coordinator stages, unresolved-lock visibility, and premature publication', () => {
    const start = labAt(1)
    expect(() => reduceGcLabState(start, {
      kind: 'gc_phase', round: 1, from: 'preparing', to: 'publishing_safe_point',
    })).toThrow(/cannot skip/)
    const unresolved = labAt(8)
    expect(() => reduceGcLabState(unresolved, {
      kind: 'gc_phase', round: 1, from: 'resolving_locks', to: 'caching_safe_point',
    })).toThrow(/scans and old-lock resolution/)
    const ranges = labAt(12)
    expect(() => reduceGcLabState(ranges, {
      kind: 'gc_phase', round: 1, from: 'deleting_ranges', to: 'publishing_safe_point',
    })).toThrow(/eligible DDL ranges/)
    expect(() => reduceGcLabState(start, {
      kind: 'gc_safe_point_publish', safePoint: start.safePoint.published,
    })).toThrow(/post-Delete-Range stage/)
  })

  it('does not restart compaction on an unchanged Store observation and distinguishes partial Store progress', () => {
    const partiallyObserved = labAt(18)
    expect(() => reduceGcLabState(partiallyObserved, {
      kind: 'gc_store_safe_point', storeId: 'tikv-1', safePoint: partiallyObserved.safePoint.published,
    })).toThrow(/unchanged Store safe point/)
    expect(() => reduceGcLabState(partiallyObserved, {
      kind: 'gc_phase', round: 1, from: 'tikv_observing', to: 'compacting',
    })).toThrow(/all representative Stores/)
    const running = labAt(21)
    expect(() => reduceGcLabState(running, {
      kind: 'gc_compaction_state', storeId: 'tikv-1', from: 'running', to: 'complete',
    })).toThrow(/unprocessed filter decisions/)
    const filtered = labAt(22)
    const oneCompleted = reduceGcLabState(filtered, {
      kind: 'gc_compaction_state', storeId: 'tikv-1', from: 'running', to: 'complete',
    })
    expect(oneCompleted.stores.map((store) => store.compaction)).toEqual(['complete', 'running', 'running'])
    expect(() => reduceGcLabState(oneCompleted, {
      kind: 'gc_phase', round: 1, from: 'compacting', to: 'between_rounds',
    })).toThrow(/completed representative compactions/)
  })

  it('keeps enqueue failures and pending GC-key work outside the successful scheduler fixture', () => {
    const secondFiltered = labAt(41)
    expect(() => reduceGcLabState(secondFiltered, {
      kind: 'gc_compaction_state', storeId: 'tikv-1', from: 'running', to: 'complete',
    })).toThrow(/successful scheduler fixture must enqueue/)
    const queued = labAt(43)
    expect(() => reduceGcLabState(queued, {
      kind: 'gc_phase', round: 2, from: 'compacting', to: 'complete',
    })).toThrow(/pending GC-key tasks/)
    expect(queued.keyChains.flatMap((chain) => chain.versions)
      .find((version) => version.id === 'b-v2')?.state).toBe('present')
  })

  it('keeps future locks and DDL drops at or above the safe point when the completed round advances', () => {
    const beforeComplete = labAt(44)
    const safePoint = beforeComplete.safePoint.published
    const completed = reduceGcLabState({
      ...beforeComplete,
      resolveLocks: { ...beforeComplete.resolveLocks, locks: [...beforeComplete.resolveLocks.locks, {
        id: 'future-lock', regionId: 8, startTs: safePoint + 1,
        primaryStatus: 'rolled_back', status: 'pending',
      }] },
      deleteRanges: [...beforeComplete.deleteRanges, { id: 'boundary-drop', dropTs: safePoint, status: 'pending' }],
    }, { kind: 'gc_phase', round: 2, from: 'cleaning_delete_markers', to: 'complete' })
    expect(completed.resolveLocks.locks.at(-1)?.status).toBe('pending')
    expect(completed.deleteRanges.at(-1)?.status).toBe('pending')
  })
})
