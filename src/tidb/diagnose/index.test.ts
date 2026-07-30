// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { DIAGNOSE_SECTIONS, SYMPTOM_GUIDES, mountDiagnose, projectDiagnostics } from './index'

describe('TiDB diagnostic projections', () => {
  const snapshot = {
    topology: {
      nodes: [
        { id: 'pd-1', kind: 'pd', status: 'up', role: 'leader' },
        { id: 'tikv-1', kind: 'tikv', status: 'up' },
      ],
    },
    regions: [
      {
        id: 12,
        leaderStoreId: 'tikv-1',
        peerStoreIds: ['tikv-1', 'tikv-2', 'tikv-3'],
        sizeMiB: 96,
        hotScore: 84,
        health: 'healthy',
      },
    ],
    transactions: [
      {
        id: 'txn-7',
        state: 'prewriting',
        startTs: 101,
        primaryRegionId: 12,
        lockAgeMs: 240,
      },
    ],
    gc: { safePoint: 90, backlogVersions: 31, blockedBy: 'txn-7' },
    tiflash: { ready: false, lagMs: 820, progress: 0.84 },
  }

  it('projects all six diagnostic categories from one model snapshot', () => {
    const projections = projectDiagnostics(snapshot)
    expect(projections.map((projection) => projection.id)).toEqual([...DIAGNOSE_SECTIONS])
    expect(projections.every((projection) => projection.label === 'MODEL / SIMULATED')).toBe(true)
    expect(projections.find((projection) => projection.id === 'hot-regions')?.rows[0])
      .toMatchObject({ id: '12', hotScore: '84' })
    expect(projections.find((projection) => projection.id === 'gc')?.rows[0])
      .toMatchObject({ blockedBy: 'txn-7' })
  })

  it('projects event-time transaction, Raft, lock, and MVCC detail', () => {
    const projections = projectDiagnostics({
      transaction: {
        id: 'txn-detail-1',
        mode: 'pessimistic',
        protocol: '2pc',
        stage: 'prewritten',
        startTs: 101,
        commitTs: null,
        regionIds: [0, 1],
        primaryRegionId: 0,
      },
      regions: [{
        id: 0,
        leaderStoreId: 'tikv-1',
        peers: [
          { storeId: 'tikv-1' },
          { storeId: 'tikv-2' },
          { storeId: 'tikv-3' },
        ],
        term: 1,
        commitIndex: 4,
        appliedIndex: 4,
        proposedIndex: 4,
        acknowledgements: 2,
        quorum: 2,
        pessimisticLock: {
          storage: 'leader_memory',
        },
        mvcc: {
          lockCf: 'prewrite',
          defaultCf: 'value',
          writeCf: 'empty',
          primary: true,
        },
      }],
    })

    expect(projections.find((projection) => projection.id === 'transactions')?.rows[0])
      .toMatchObject({ id: 'txn-detail-1', phase: 'prewritten' })
    expect(projections.find((projection) => projection.id === 'regions')?.rows[0])
      .toMatchObject({
        raftAcks: '2/2',
        pessimisticLock: 'leader_memory',
        cfLock: 'prewrite',
        cfDefault: 'value',
        cfWrite: 'empty',
        primary: 'true',
      })
  })

  it('ships six symptom-first guides with real-cluster check SQL', () => {
    expect(SYMPTOM_GUIDES).toHaveLength(6)
    expect(SYMPTOM_GUIDES.every((guide) => guide.sql.trim().toUpperCase().startsWith('SELECT')))
      .toBe(true)
  })

  it('uses v8.5 GC variables and peer-level Region health checks', () => {
    const gc = SYMPTOM_GUIDES.find((guide) => guide.id === 'gc-backlog')!
    expect(gc.sql).toContain('@@GLOBAL.tidb_gc_life_time')
    expect(gc.sql).toContain('@@GLOBAL.tidb_gc_max_wait_time')
    expect(gc.sql).toContain("VARIABLE_NAME = 'tikv_gc_safe_point'")
    expect(gc.sql).not.toContain("'tikv_gc_life_time'")

    const region = SYMPTOM_GUIDES.find((guide) => guide.id === 'region-health')!
    expect(region.sql).toContain('INFORMATION_SCHEMA.TIKV_REGION_PEERS')
    expect(region.sql).toContain('p.IS_LEADER')
    expect(region.sql).toContain('p.STATUS')
    expect(region.sql).toContain('p.DOWN_SECONDS')
  })

  it('explains TiFlash lag as snapshot waiting rather than stale results', () => {
    const tiflash = SYMPTOM_GUIDES.find((guide) => guide.id === 'tiflash-lag')!
    expect(tiflash.en.guidance).toMatch(/requested snapshot/i)
    expect(tiflash.en.guidance).toMatch(/timeout, not stale results/i)
    expect(tiflash.ja.guidance).toContain('古い結果ではなく')
  })

  it('labels every rendered diagnostic value as simulated', () => {
    const dom = installTestDom()
    const root = dom.mount('diagnose')
    mountDiagnose(root as unknown as HTMLElement, { locale: 'en', snapshot })

    expect(root.querySelectorAll('[data-model-label="true"]').length).toBeGreaterThanOrEqual(6)
    expect(root.querySelectorAll('pre[tabindex="0"]')).toHaveLength(SYMPTOM_GUIDES.length)
    expect(root.querySelectorAll('[data-summary-metric]')).toHaveLength(DIAGNOSE_SECTIONS.length)
    expect(root.querySelectorAll('.tidb-diagnose__spark[role="img"]'))
      .toHaveLength(DIAGNOSE_SECTIONS.length)
    expect(root.querySelectorAll('.tidb-diagnose__guide-sql'))
      .toHaveLength(SYMPTOM_GUIDES.length)
    expect(root.textContent).toContain('MODEL / SIMULATED')
    expect(root.textContent).toContain('Model health summary')
    expect(root.textContent).toContain('txn-7')
  })
})
