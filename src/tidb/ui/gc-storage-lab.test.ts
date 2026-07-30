// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { installTestDom } from '../../../test/dom'
import type {
  TraceEvent,
  TraceGcKeyChainSnapshot,
  TraceGcLabSnapshot,
} from '../model/types'
import { createGcStorageLabPanel } from './gc-storage-lab'

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
      commitTs: 108 + index * 20 + regionId,
      writeType: index === 1 ? 'delete' : 'put',
      valueStorage: index === 0
        ? 'write_and_default_cf'
        : 'write_cf_only',
      state,
    })),
  }
}

function detailedSnapshot(): TraceGcLabSnapshot {
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

function gcEvent(
  snapshot: TraceGcLabSnapshot,
  overrides: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    id: 'gc-event',
    atMs: 100,
    durationMs: 20,
    domain: 'kv',
    kind: 'gc_compaction_filter',
    label: 'GC event',
    detail: 'Synthetic aggregate fixture.',
    status: 'success',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-6',
      tsoLastAllocated: 220,
      transaction: null,
      regions: [],
      gcLab: snapshot,
    },
    ...overrides,
  }
}

describe('GC/Storage Lab accessible projection', () => {
  it('renders exact safe-point stages, source-accurate configuration, and store state', () => {
    installTestDom()
    const panel = createGcStorageLabPanel('en')
    panel.update(gcEvent(detailedSnapshot()))

    expect(panel.root.hidden).toBe(false)
    expect(panel.root.getAttribute('tabindex')).toBe('0')
    expect(panel.root.textContent).toContain('MODEL / SIMULATED')
    expect(panel.root.textContent).toContain('REGION_SCAN_LOCK')
    expect(panel.root.textContent).toContain('Uses tidb_gc_scan_lock_modeNo')
    expect(panel.root.textContent).toContain('PHYSICAL modeNo')
    expect(panel.root.textContent).toContain('ResolveLock Raft path expandedNo')
    expect(panel.root.textContent).toContain('Visibility cache barrier100 seconds')
    expect(panel.root.textContent).toContain('GC leader leasemysql.tidb')
    expect(panel.root.textContent).toContain(
      'Delete Range requestUnsafeDestroyRange',
    )
    expect(panel.root.textContent).toContain('Delete Range bypasses RaftYes')
    expect(panel.root.textContent).toContain('Raftstore modev1_classic')

    const phase = panel.root.querySelector('[role="status"]')
    expect(phase?.getAttribute('aria-live')).toBe('polite')
    expect(phase?.getAttribute('aria-atomic')).toBe('true')
    expect(phase?.textContent).toBe('Phase: Running Compaction Filters')
    expect(panel.root.querySelector('[data-gc-round]')?.textContent)
      .toBe('GC round: 2')

    const safePoint = panel.root.querySelector(
      '[data-safe-point-published="220"]',
    )
    expect(safePoint?.textContent).toContain('Staged safe point220')
    expect(safePoint?.textContent).toContain('Visibility safe point saved220')
    expect(safePoint?.textContent).toContain('Published to PD220')

    expect(panel.root.querySelectorAll('[data-gc-store-id]')).toHaveLength(3)
    expect(panel.root.querySelector('[data-gc-store-id="tikv-2"]')?.textContent)
      .toContain('CompactionRunning')
    expect(panel.root.querySelector('[data-gc-store-id="tikv-2"]')?.textContent)
      .toContain('Filter activeYes')
    expect(panel.root.querySelector('[data-gc-store-id="tikv-3"]')?.textContent)
      .toContain('Matches published valueNo')
  })

  it('exposes lock, Delete Range, and retained-versus-filtered MVCC semantics', () => {
    installTestDom()
    const panel = createGcStorageLabPanel('en')
    panel.update(gcEvent(detailedSnapshot()))

    expect(panel.root.querySelector('[data-scan-lock-implementation]')?.getAttribute(
      'data-scan-lock-implementation',
    )).toBe('REGION_SCAN_LOCK')
    expect(panel.root.querySelectorAll('[data-gc-lock-id]')).toHaveLength(2)
    expect(panel.root.querySelector('[data-gc-lock-id="lock-commit"]')?.textContent)
      .toContain('ResolutionResolved as commit')
    expect(panel.root.querySelector('[data-gc-lock-id="lock-rollback"]')?.textContent)
      .toContain('ResolutionResolved as rollback')
    expect(panel.root.querySelector('[data-delete-range-id="range-drop"]')?.textContent)
      .toContain('StateDeleted')

    expect(panel.root.querySelectorAll('[data-gc-chain-id]')).toHaveLength(4)
    expect(panel.root.querySelectorAll('[data-gc-version-id]')).toHaveLength(12)
    expect(panel.root.querySelector(
      '[data-gc-version-id="chain-a-v1"]',
    )?.getAttribute('data-gc-version-state')).toBe('filtered')
    expect(panel.root.querySelector(
      '[data-gc-version-id="chain-a-v2"]',
    )?.textContent).toContain(
      'Newest Put at or before safe point retained',
    )

    const summary = panel.root.querySelector(
      '.tidb-gc-storage-lab__storage-summary',
    )
    expect(summary?.textContent).toContain('Initial versions12')
    expect(summary?.textContent).toContain('Filtered versions5')
    expect(summary?.textContent).toContain('Retained anchors2')
    expect(summary?.textContent).toContain('Raft entries created by compaction0')
    expect(summary?.textContent).toContain('not a disk-byte gauge')
  })

  it('shows the active start_ts minus one boundary and switches locale', () => {
    installTestDom()
    const panel = createGcStorageLabPanel('en')
    const detailed = detailedSnapshot()
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
    panel.update(gcEvent(blocked))

    expect(panel.root.querySelector('[data-safe-point-blocked="true"]')?.textContent)
      .toContain('Active transaction bound149')
    expect(panel.root.querySelector('[data-gc-blocker-state="active"]')?.textContent)
      .toContain('start_ts150')
    expect(panel.root.textContent).toContain('start_ts - 1')
    expect(panel.root.textContent).toContain('24-hour max wait')

    panel.setLocale('ja')
    expect(panel.root.textContent).toContain('フェーズ: active transactionで上限を決定')
    expect(panel.root.textContent).toContain('active transaction上限149')
    expect(panel.root.textContent).toContain('実disk byte量ではありません')
  })

  it('does not retain or render event payloads, caches snapshots, hides, and disposes', () => {
    installTestDom()
    const panel = createGcStorageLabPanel('en')
    document.body.append(panel.root)
    const event = gcEvent(detailedSnapshot(), {
      label: 'TOP-SECRET-SQL-LABEL',
      detail: 'TOP-SECRET-ROW-VALUE',
      metadata: { privateLiteral: 'TOP-SECRET-LITERAL' },
    })
    const activePoison = {
      ...event,
      id: 'active-poison',
      label: 'TOP-SECRET-ACTIVE-EVENT',
    }

    panel.update(event, [activePoison])
    expect(panel.root.textContent).not.toContain('TOP-SECRET')
    const firstChild = panel.root.firstChild
    panel.update(event, [activePoison])
    expect(panel.root.firstChild).toBe(firstChild)

    panel.update({
      ...event,
      id: 'ordinary-event',
      snapshot: {
        modelVersion: 'tidb-v8.5-model-6',
        tsoLastAllocated: 220,
        transaction: null,
        regions: [],
      },
    })
    expect(panel.root.hidden).toBe(true)
    expect(panel.root.childNodes).toHaveLength(0)

    panel.dispose()
    expect(panel.root.parentNode).toBeNull()
    expect(() => panel.dispose()).not.toThrow()
  })
})
