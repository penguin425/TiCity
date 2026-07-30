/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import type {
  TraceEvent,
  TraceGcKeyChainSnapshot,
  TraceGcLabSnapshot,
} from '../model/types'
import { projectGcStorageLab } from './gc-storage-lab-projection'

function chain(
  id: string,
  regionId: number,
  states: readonly ('present' | 'retained_anchor' | 'filtered')[],
): TraceGcKeyChainSnapshot {
  return {
    id,
    regionId,
    versions: states.map((state, index) => ({
      id: `${id}-v${index + 1}`,
      commitTs: 100 + index * 20 + regionId,
      writeType: 'put',
      valueStorage: index === 0
        ? 'write_and_default_cf'
        : 'write_cf_inline',
      state,
    })),
  }
}

function snapshot(): TraceGcLabSnapshot {
  return {
    phase: 'compacting',
    round: 2,
    configuration: {
      gcEnabled: true,
      runIntervalSeconds: 600,
      lifeTimeSeconds: 600,
      maxWaitTimeSeconds: 86400,
      minStartTsReportIntervalSeconds: 30,
      scanLockImplementation: 'REGION_SCAN_LOCK',
      scanLockModeVariableUsed: false,
      physicalScanLockAvailable: false,
      resolveLockRaftDetailModeled: false,
      visibilityCacheBarrierSeconds: 100,
      gcLeaderLeaseStore: 'mysql.tidb',
      distributedGc: true,
      deleteRangeRequest: 'UnsafeDestroyRange',
      deleteRangeBypassesRaft: true,
      compactionFilterEnabled: true,
      compactionFilterRatioThreshold: 1.1,
      raftstoreMode: 'v1_classic',
    },
    safePoint: {
      previous: 149,
      candidate: 220,
      globalMinStartTs: null,
      activeTransactionBound: null,
      serviceSafePoint: 220,
      staged: 220,
      visibilitySaved: 220,
      published: 220,
      blocked: false,
    },
    blocker: {
      transactionId: 'txn-gc-blocker',
      startTs: 150,
      status: 'completed',
      reportedByTiDB: true,
      withinMaxWaitTime: true,
    },
    resolveLocks: {
      implementation: 'REGION_SCAN_LOCK',
      scannedRegionIds: [8, 20],
      locks: [
        {
          id: 'lock-commit',
          regionId: 8,
          startTs: 130,
          primaryStatus: 'committed',
          status: 'resolved_commit',
        },
        {
          id: 'lock-rollback',
          regionId: 20,
          startTs: 140,
          primaryStatus: 'rolled_back',
          status: 'resolved_rollback',
        },
      ],
    },
    deleteRanges: [{
      id: 'range-drop',
      dropTs: 125,
      status: 'deleted',
    }],
    stores: [
      {
        storeId: 'tikv-1',
        detectedSafePoint: 220,
        compaction: 'complete',
        filterActive: false,
      },
      {
        storeId: 'tikv-2',
        detectedSafePoint: 220,
        compaction: 'running',
        filterActive: true,
      },
      {
        storeId: 'tikv-3',
        detectedSafePoint: 149,
        compaction: 'idle',
        filterActive: false,
      },
    ],
    keyChains: [
      chain('chain-a', 8, [
        'filtered',
        'retained_anchor',
        'present',
        'present',
      ]),
      chain('chain-b', 8, ['filtered', 'filtered', 'present']),
      chain('chain-c', 20, ['filtered', 'retained_anchor', 'present']),
      chain('chain-d', 20, ['filtered', 'present']),
    ],
    storage: {
      representation: 'logical_chains_counted_once',
      compactionLevel: 'bottommost_model_fixture',
      initialVersionCount: 12,
      filteredVersionCount: 5,
      retainedAnchorCount: 2,
      presentVersionCount: 7,
      deletedDefaultCfValues: 4,
      compactionRaftEntriesCreated: 0,
    },
  }
}

function event(gcLab?: TraceGcLabSnapshot): TraceEvent {
  return {
    id: 'gc-event',
    atMs: 100,
    durationMs: 20,
    domain: 'kv',
    kind: 'gc_compaction_filter',
    label: 'Human-facing label is not projection state',
    detail: 'Synthetic aggregate fixture.',
    status: 'success',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-6',
      tsoLastAllocated: 220,
      transaction: null,
      regions: [],
      ...(gcLab ? { gcLab } : {}),
    },
  }
}

describe('GC/Storage Lab model-to-world projection', () => {
  it('requires the model-6 snapshot.gcLab discriminator', () => {
    expect(projectGcStorageLab(null, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectGcStorageLab(event(), {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectGcStorageLab({
      ...event(),
      snapshot: undefined,
    }, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
  })

  it('maps the exact safe point, stores, and logical versions without mutation', () => {
    const source = event(snapshot())
    const before = JSON.stringify(source)
    const projection = projectGcStorageLab(source, {
      inspect: true,
      reducedMotion: false,
      pulse: 3,
    })!

    expect(projection).toMatchObject({
      mode: 'inspect',
      phase: 'compacting',
      round: 2,
      pulse: 1,
      flowStep: 'compact',
      safePoint: {
        previous: 149,
        staged: 220,
        visibilitySaved: 220,
        published: 220,
        gateState: 'published',
      },
      blocker: {
        transactionId: 'txn-gc-blocker',
        status: 'completed',
      },
    })
    expect(projection.resolveLocks).toMatchObject({
      implementation: 'REGION_SCAN_LOCK',
      scannedRegionIds: [8, 20],
    })
    expect(projection.stores.map((store) => ({
      id: store.storeId,
      current: store.detectorCurrent,
      compaction: store.compaction,
    }))).toEqual([
      { id: 'tikv-1', current: true, compaction: 'complete' },
      { id: 'tikv-2', current: true, compaction: 'running' },
      { id: 'tikv-3', current: false, compaction: 'idle' },
    ])
    expect(projection.chains.map((candidate) => ({
      id: candidate.id,
      states: candidate.versions
        .filter((version) => version.visible)
        .map((version) => version.state),
    }))).toEqual([
      {
        id: 'chain-a',
        states: ['filtered', 'retained_anchor', 'present', 'present'],
      },
      { id: 'chain-b', states: ['filtered', 'filtered', 'present'] },
      { id: 'chain-c', states: ['filtered', 'retained_anchor', 'present'] },
      { id: 'chain-d', states: ['filtered', 'present'] },
    ])
    expect(projection.overflow.total).toBe(0)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('shows an active transaction as a blocked gate and preserves overview mode', () => {
    const detailed = snapshot()
    const blocked: TraceGcLabSnapshot = {
      ...detailed,
      phase: 'safe_point_bounded',
      round: 1,
      safePoint: {
        previous: 100,
        candidate: 200,
        globalMinStartTs: 150,
        activeTransactionBound: 149,
        serviceSafePoint: 149,
        staged: 100,
        visibilitySaved: 100,
        published: 100,
        blocked: true,
      },
      blocker: {
        ...detailed.blocker,
        status: 'active',
      },
    }
    const projection = projectGcStorageLab(event(blocked), {
      inspect: false,
      reducedMotion: true,
      pulse: -1,
    })!

    expect(projection.mode).toBe('overview')
    expect(projection.reducedMotion).toBe(true)
    expect(projection.pulse).toBe(0)
    expect(projection.flowStep).toBe('candidate')
    expect(projection.safePoint).toMatchObject({
      globalMinStartTs: 150,
      activeTransactionBound: 149,
      serviceSafePoint: 149,
      gateState: 'blocked',
    })
  })

  it('keeps visibility save, Delete Range, and PD publication in source order', () => {
    const base = snapshot()
    const steps = [
      ['caching_safe_point', 'visibility-save'],
      ['deleting_ranges', 'delete-ranges'],
      ['publishing_safe_point', 'publish-pd'],
    ] as const

    expect(steps.map(([phase]) => projectGcStorageLab(
      event({ ...base, phase }),
      { inspect: true, reducedMotion: false },
    )?.flowStep)).toEqual(steps.map(([, step]) => step))
  })

  it('bounds every renderer dimension and reports hidden items as overflow', () => {
    const detailed = snapshot()
    const extraLocks = Array.from({ length: 3 }, (_, index) => ({
      id: `extra-lock-${index}`,
      regionId: 20,
      startTs: 160 + index,
      primaryStatus: 'committed' as const,
      status: 'pending' as const,
    }))
    const oversized: TraceGcLabSnapshot = {
      ...detailed,
      resolveLocks: {
        ...detailed.resolveLocks,
        locks: [...detailed.resolveLocks.locks, ...extraLocks],
      },
      deleteRanges: [
        ...detailed.deleteRanges,
        { id: 'range-2', dropTs: 126, status: 'eligible' },
        { id: 'range-3', dropTs: 127, status: 'pending' },
      ],
      keyChains: [
        {
          ...detailed.keyChains[0],
          versions: [
            ...detailed.keyChains[0].versions,
            {
              id: 'chain-a-v5',
              commitTs: 300,
              writeType: 'put',
              valueStorage: 'write_cf_only',
              state: 'present',
            },
          ],
        },
        ...detailed.keyChains.slice(1),
        chain('chain-e', 20, ['present', 'present']),
      ],
    }
    const projection = projectGcStorageLab(event(oversized), {
      inspect: true,
      reducedMotion: false,
    })!

    expect(projection.resolveLocks.locks).toHaveLength(3)
    expect(projection.deleteRanges).toHaveLength(2)
    expect(projection.chains).toHaveLength(4)
    expect(projection.chains.every((candidate) =>
      candidate.versions.length === 4)).toBe(true)
    expect(projection.overflow).toEqual({
      stores: 0,
      locks: 2,
      deleteRanges: 1,
      chains: 1,
      versions: 3,
      total: 7,
    })
  })
})
