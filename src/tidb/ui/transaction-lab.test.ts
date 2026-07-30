// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model'
import type { TraceEvent } from '../model/types'
import { createLockLabPanel } from './lock-lab'
import { createTransactionLabPanel } from './transaction-lab'

function detailedEvent(): TraceEvent {
  return {
    id: 'trace-1-event-12',
    atMs: 120,
    durationMs: 30,
    domain: 'raft',
    kind: 'quorum_commit',
    label: 'Region 0 reached quorum',
    detail: 'Two of three voter logs are durable.',
    status: 'success',
    regionId: 0,
    dependsOn: ['trace-1-event-10'],
    path: 'critical',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-2',
      tsoLastAllocated: 1_000_000_002,
      transaction: {
        id: 'txn-1',
        mode: 'pessimistic',
        protocol: '2pc',
        stage: 'prewriting',
        startTs: 1_000_000_001,
        commitTs: null,
        regionIds: [0, 1],
        primaryRegionId: 0,
        clientResponded: false,
      },
      regions: [
        {
          regionId: 0,
          leaderStoreId: 'tikv-1',
          term: 1,
          proposedIndex: 1,
          persistedStoreIds: ['tikv-1', 'tikv-2'],
          acknowledgements: 2,
          quorum: 2,
          commitIndex: 1,
          appliedIndex: 1,
          peers: [
            {
              storeId: 'tikv-1',
              raftRole: 'leader',
              matchIndex: 1,
              appliedIndex: 1,
              healthy: true,
            },
            {
              storeId: 'tikv-2',
              raftRole: 'follower',
              matchIndex: 1,
              appliedIndex: 1,
              healthy: true,
            },
            {
              storeId: 'tikv-3',
              raftRole: 'follower',
              matchIndex: 0,
              appliedIndex: 0,
              healthy: true,
            },
          ],
          pessimisticLock: {
            transactionId: 'txn-1',
            leaderStoreId: 'tikv-1',
            storage: 'leader_memory',
            replicated: false,
          },
          mvcc: {
            defaultCf: 'value',
            lockCf: 'prewrite',
            writeCf: 'empty',
            startTs: 1_000_000_001,
            commitTs: null,
            primary: true,
          },
        },
        {
          regionId: 1,
          leaderStoreId: 'tikv-2',
          term: 1,
          proposedIndex: 1,
          persistedStoreIds: ['tikv-2'],
          acknowledgements: 1,
          quorum: 2,
          commitIndex: 0,
          appliedIndex: 0,
          peers: [
            {
              storeId: 'tikv-1',
              raftRole: 'follower',
              matchIndex: 0,
              appliedIndex: 0,
              healthy: true,
            },
            {
              storeId: 'tikv-2',
              raftRole: 'leader',
              matchIndex: 1,
              appliedIndex: 0,
              healthy: true,
            },
            {
              storeId: 'tikv-3',
              raftRole: 'follower',
              matchIndex: 0,
              appliedIndex: 0,
              healthy: true,
            },
          ],
          pessimisticLock: null,
          mvcc: {
            defaultCf: 'empty',
            lockCf: 'empty',
            writeCf: 'empty',
            startTs: null,
            commitTs: null,
            primary: false,
          },
        },
      ],
    },
  }
}

describe('Transaction Lab accessible projection', () => {
  it('shows the same event snapshot as a keyboard and screen-reader friendly DOM view', () => {
    const dom = installTestDom()
    dom.mount('transaction-lab')
    const panel = createTransactionLabPanel('en')
    const event = detailedEvent()

    panel.update(event, [event])

    expect(panel.root.hidden).toBe(false)
    expect(panel.root.textContent).toContain('MODEL / SIMULATED')
    expect(panel.root.textContent).toContain('Leader-memory pessimistic lock')
    expect(panel.root.textContent).toContain('2/2 quorum')
    expect(panel.root.querySelectorAll('[data-region-id]')).toHaveLength(2)
    expect(panel.root.querySelector('[data-key-role="primary"]')?.textContent)
      .toContain('PRIMARY')
    expect(panel.root.querySelector('[data-cf-state="prewrite"]')?.textContent)
      .toContain('LOCK CF')
  })

  it('stays hidden for legacy events and can switch locale without changing state', () => {
    installTestDom()
    const panel = createTransactionLabPanel('en')
    panel.update({
      id: 'legacy',
      atMs: 0,
      durationMs: 1,
      domain: 'sql',
      kind: 'legacy',
      label: 'Legacy event',
      detail: '',
      status: 'success',
      metadata: {},
    })
    expect(panel.root.hidden).toBe(true)

    const event = detailedEvent()
    panel.update(event)
    panel.setLocale('ja')
    expect(panel.root.hidden).toBe(false)
    expect(panel.root.textContent).toContain('Transaction Lab 内部断面')
    expect(panel.root.textContent).toContain('Leaderメモリ上の悲観ロック')
  })

  it('stays hidden while a GC/Storage Lab snapshot owns the cutaway', () => {
    installTestDom()
    const panel = createTransactionLabPanel('en')
    const gcEvent = createTiDBSimulation({ seed: 425 })
      .runScenario('gc-safe-point')
      .events.find((event) => event.snapshot?.gcLab)

    expect(gcEvent).toBeDefined()
    panel.update(gcEvent!)
    expect(panel.root.hidden).toBe(true)
  })

  it('is mutually exclusive with Lock Lab and keeps DOM nodes stable across loops', () => {
    installTestDom()
    const transactionPanel = createTransactionLabPanel('en')
    const lockPanel = createLockLabPanel('en')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('lock-deadlock')
    const lockEvent = receipt.events.find((event) =>
      event.kind === 'deadlock_detected')
    if (!lockEvent) throw new Error('Expected the Lock Lab deadlock event.')

    transactionPanel.update(lockEvent, [lockEvent])
    lockPanel.update(lockEvent, [lockEvent])
    expect(transactionPanel.root.hidden).toBe(true)
    expect(lockPanel.root.hidden).toBe(false)
    expect([
      transactionPanel.root,
      lockPanel.root,
    ].filter((root) => !root.hidden)).toHaveLength(1)

    const lockHeading = lockPanel.root.firstElementChild
    // A later loop iteration reuses the immutable event snapshot.
    transactionPanel.update(lockEvent, [...[lockEvent]])
    lockPanel.update(lockEvent, [...[lockEvent]])
    expect(lockPanel.root.firstElementChild).toBe(lockHeading)

    const transactionEvent = detailedEvent()
    transactionPanel.update(transactionEvent, [transactionEvent])
    lockPanel.update(transactionEvent, [transactionEvent])
    expect(transactionPanel.root.hidden).toBe(false)
    expect(lockPanel.root.hidden).toBe(true)
    expect([
      transactionPanel.root,
      lockPanel.root,
    ].filter((root) => !root.hidden)).toHaveLength(1)

    const transactionHeading = transactionPanel.root.firstElementChild
    transactionPanel.update(transactionEvent, [...[transactionEvent]])
    expect(transactionPanel.root.firstElementChild).toBe(transactionHeading)
  })
})
