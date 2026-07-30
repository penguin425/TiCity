// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model'
import {
  DIAGNOSE_SECTIONS,
  DIAGNOSE_SUMMARY_SECTIONS,
  DIAGNOSE_CSS,
  SYMPTOM_GUIDES,
  mountDiagnose,
  projectDiagnostics,
} from './index'

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

  it('projects every diagnostic category from one model snapshot', () => {
    const projections = projectDiagnostics(snapshot)
    expect(projections.map((projection) => projection.id)).toEqual([...DIAGNOSE_SECTIONS])
    expect(projections.every((projection) => projection.label === 'MODEL / SIMULATED')).toBe(true)
    expect(projections.find((projection) => projection.id === 'hot-regions')?.rows[0])
      .toMatchObject({ id: '12', hotScore: '84' })
    expect(projections.find((projection) => projection.id === 'gc')?.rows[0])
      .toMatchObject({ blockedBy: 'txn-7' })
  })

  it('separates active lock waits, retained deadlock history, and application retry', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('lock-deadlock')
    const cycle = receipt.events.find((event) => event.kind === 'deadlock_detected')
    const error = receipt.events.find((event) => event.kind === 'deadlock_error_1213')
    const final = receipt.events.at(-1)
    expect(cycle?.snapshot?.lockLab).toBeDefined()
    expect(error?.snapshot?.lockLab).toBeDefined()
    expect(final?.snapshot?.lockLab).toBeDefined()

    const during = projectDiagnostics({
      ...simulation.state,
      lockLab: cycle?.snapshot?.lockLab,
    })
    expect(during.find((projection) => projection.id === 'transactions')?.rows)
      .toHaveLength(2)
    expect(during.find((projection) => projection.id === 'lock-waits')?.rows)
      .toEqual([
        expect.objectContaining({ direction: 'waiter → holder', resource: 'resource-b' }),
        expect.objectContaining({ direction: 'waiter → holder', resource: 'resource-a' }),
      ])
    expect(during.find((projection) => projection.id === 'deadlocks')?.rows[0])
      .toMatchObject({
        selectionPolicy: 'MODEL POLICY: cycle-closing waiter',
        internalRetryable: 'false',
        clientError: 'not_returned_yet',
        lockWaitTimeout: 'Error 1205 separate / not modeled',
        resolution: 'detected',
        detectorLeader: 'tikv-3',
      })
    expect(during.find((projection) => projection.id === 'application-retry')?.rows)
      .toEqual([])

    const afterError = projectDiagnostics({
      ...simulation.state,
      lockLab: error?.snapshot?.lockLab,
    })
    expect(afterError.find((projection) => projection.id === 'deadlocks')?.rows[0])
      .toMatchObject({
        clientError: 'Error 1213',
        internalRetryable: 'false',
        resolution: 'resolved',
      })
    expect(afterError.find((projection) => projection.id === 'application-retry')?.rows)
      .toEqual([])

    const after = projectDiagnostics({
      ...simulation.state,
      lockLab: final?.snapshot?.lockLab,
    })
    expect(after.find((projection) => projection.id === 'lock-waits')?.rows)
      .toEqual([])
    expect(after.find((projection) => projection.id === 'deadlocks')?.rows[0])
      .toMatchObject({
        internalRetryable: 'false',
        resolution: 'resolved',
      })
    expect(after.find((projection) => projection.id === 'application-retry')?.rows[0])
      .toMatchObject({
        source: 'application',
        status: 'completed',
        fixedBackoffMs: '120',
        boundary: 'whole transaction',
      })
    expect(after.find((projection) => projection.id === 'transactions')?.rows)
      .toHaveLength(3)

    for (const event of receipt.events) {
      if (!event.snapshot?.lockLab) continue
      const rendered = JSON.stringify(projectDiagnostics({
        ...simulation.state,
        lockLab: event.snapshot.lockLab,
      }))
      expect(rendered).not.toMatch(
        /SQL_DIGEST|SQL_DIGEST_TEXT|KEY_INFO|LOCK-LAB-425|inventory|select\s|update\s/i,
      )
    }
  })

  it('summarizes live lock contention separately from resolved history', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('lock-deadlock')
    const detected = receipt.events.find((event) => event.kind === 'deadlock_detected')!
    const final = receipt.events.at(-1)!
    const dom = installTestDom()
    const detectedRoot = dom.mount('detected')
    mountDiagnose(detectedRoot as unknown as HTMLElement, {
      locale: 'en',
      snapshot: {
        ...simulation.state,
        lockLab: detected.snapshot?.lockLab,
      },
    })

    expect(detectedRoot.querySelector('.tidb-diagnose__summary')?.getAttribute('data-tone'))
      .toBe('critical')
    expect(
      detectedRoot.querySelector(
        '[data-summary-metric="transactions"] .tidb-diagnose__metric-detail',
      )?.textContent,
    ).toContain('2 lock waits')
    expect(detectedRoot.textContent).toContain('Not returned yet')

    const finalRoot = dom.mount('final')
    mountDiagnose(finalRoot as unknown as HTMLElement, {
      locale: 'en',
      snapshot: {
        ...simulation.state,
        lockLab: final.snapshot?.lockLab,
      },
    })
    expect(finalRoot.querySelector('.tidb-diagnose__summary')?.getAttribute('data-tone'))
      .toBe('attention')
    expect(
      finalRoot.querySelector(
        '[data-summary-metric="transactions"] .tidb-diagnose__metric-detail',
      )?.textContent,
    ).toContain('0 lock waits')
    expect(finalRoot.textContent).toContain('Error 1213')
    expect(finalRoot.textContent).toContain('whole transaction')
  })

  it('localizes Lock Lab headings and explanatory values without changing model tokens', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('lock-deadlock')
    const final = receipt.events.at(-1)!
    const dom = installTestDom()
    const root = dom.mount('diagnose-ja')
    mountDiagnose(root as unknown as HTMLElement, {
      locale: 'ja',
      snapshot: {
        ...simulation.state,
        lockLab: final.snapshot?.lockLab,
      },
    })

    expect(root.getAttribute('lang')).toBe('ja')
    expect(root.textContent).toContain('現在のロック待機')
    expect(root.textContent).toContain('デッドロック履歴')
    expect(root.textContent).toContain('アプリケーション再試行')
    expect(root.textContent).toContain('MODEL POLICY：cycleを閉じた待機transaction')
    expect(root.textContent).toContain('Error 1205（別経路／未モデル化）')
    expect(root.textContent).toContain('transaction全体')
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
    expect(root.querySelectorAll('[data-summary-metric]'))
      .toHaveLength(DIAGNOSE_SUMMARY_SECTIONS.length)
    expect(root.querySelectorAll('.tidb-diagnose__spark[role="img"]'))
      .toHaveLength(DIAGNOSE_SUMMARY_SECTIONS.length)
    expect(root.querySelectorAll('.tidb-diagnose__guide-sql'))
      .toHaveLength(SYMPTOM_GUIDES.length)
    expect(root.textContent).toContain('MODEL / SIMULATED')
    expect(root.textContent).toContain('Model health summary')
    expect(root.textContent).toContain('txn-7')
  })

  it('keeps the dense deadlock table full-width without stretching cluster over it', () => {
    expect(DIAGNOSE_CSS).toContain('"deadlocks deadlocks"')
    expect(DIAGNOSE_CSS).toContain('"cluster application-retry"')
    expect(DIAGNOSE_CSS).not.toContain('"cluster deadlocks"')
    expect(DIAGNOSE_CSS).toContain('td[data-column="lockWaitTimeout"]')
  })
})
