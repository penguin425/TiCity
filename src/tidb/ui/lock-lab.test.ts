// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import type {
  TraceEvent,
  TraceLockLabSnapshot,
} from '../model/types'
import { createLockLabPanel } from './lock-lab'

function deadlockSnapshot(): TraceLockLabSnapshot {
  return {
    detectorScope: 'cluster_wide',
    detectorLeaderStoreId: 'tikv-3',
    transactions: [
      {
        clientId: 'client-a',
        transactionId: 'txn-a',
        attempt: 1,
        retryOfTransactionId: null,
        startTs: 101,
        commitTs: null,
        status: 'waiting',
        heldResourceIds: ['resource-a'],
        waitingForResourceId: 'resource-b',
      },
      {
        clientId: 'client-b',
        transactionId: 'txn-b',
        attempt: 1,
        retryOfTransactionId: null,
        startTs: 102,
        commitTs: null,
        status: 'victim',
        heldResourceIds: ['resource-b'],
        waitingForResourceId: 'resource-a',
      },
    ],
    resources: [
      {
        id: 'resource-a',
        regionId: 6,
        leaderStoreId: 'tikv-1',
        holderTransactionId: 'txn-a',
        waiterTransactionIds: ['txn-b'],
        wakePolicy: 'smallest_start_ts_model_policy',
        storage: 'leader_memory',
      },
      {
        id: 'resource-b',
        regionId: 7,
        leaderStoreId: 'tikv-2',
        holderTransactionId: 'txn-b',
        waiterTransactionIds: ['txn-a'],
        wakePolicy: 'smallest_start_ts_model_policy',
        storage: 'leader_memory',
      },
    ],
    waitForEdges: [
      {
        id: 'edge-a-to-b',
        waiterTransactionId: 'txn-a',
        holderTransactionId: 'txn-b',
        resourceId: 'resource-b',
        regionId: 7,
      },
      {
        id: 'edge-b-to-a',
        waiterTransactionId: 'txn-b',
        holderTransactionId: 'txn-a',
        resourceId: 'resource-a',
        regionId: 6,
      },
    ],
    deadlock: {
      id: 'deadlock-1',
      cycleTransactionIds: ['txn-b', 'txn-a', 'txn-b'],
      victimTransactionId: 'txn-b',
      selectionPolicy: 'cycle_closing_waiter_model_policy',
      retryable: false,
      resolution: 'rolling_back',
      clientErrorCode: null,
      clientErrorTransactionId: null,
    },
    applicationRetry: null,
  }
}

function lockEvent(
  id: string,
  kind: string,
  lockLab: TraceLockLabSnapshot,
): TraceEvent {
  return {
    id,
    atMs: 120,
    durationMs: 20,
    domain: 'kv',
    kind,
    label: 'Model event label is not UI copy',
    detail: 'No SQL text, literal, row value, or encoded key.',
    status: 'failed',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-3',
      tsoLastAllocated: 103,
      transaction: null,
      regions: [],
      lockLab,
    },
  }
}

function applicationRetrySnapshot(): TraceLockLabSnapshot {
  const previous = deadlockSnapshot()
  return {
    ...previous,
    transactions: [
      {
        clientId: 'client-a',
        transactionId: 'txn-a',
        attempt: 1,
        retryOfTransactionId: null,
        startTs: 101,
        commitTs: 104,
        status: 'completed',
        heldResourceIds: [],
        waitingForResourceId: null,
      },
      {
        clientId: 'client-b',
        transactionId: 'txn-b',
        attempt: 1,
        retryOfTransactionId: null,
        startTs: 102,
        commitTs: null,
        status: 'rolled_back',
        heldResourceIds: [],
        waitingForResourceId: null,
      },
      {
        clientId: 'client-b',
        transactionId: 'txn-b-retry',
        attempt: 2,
        retryOfTransactionId: 'txn-b',
        startTs: 105,
        commitTs: null,
        status: 'active',
        heldResourceIds: [],
        waitingForResourceId: null,
      },
    ],
    resources: previous.resources.map((resource) => ({
      ...resource,
      holderTransactionId: null,
      waiterTransactionIds: [],
    })),
    waitForEdges: [],
    deadlock: previous.deadlock && {
      ...previous.deadlock,
      resolution: 'resolved',
      clientErrorCode: 1213,
      clientErrorTransactionId: 'txn-b',
    },
    applicationRetry: {
      source: 'application',
      clientId: 'client-b',
      retryOfTransactionId: 'txn-b',
      fixedBackoffMs: 120,
      status: 'started',
      newTransactionId: 'txn-b-retry',
    },
  }
}

describe('Lock Lab accessible projection', () => {
  it('projects transactions, ordered queues, waiter-to-holder edges, and detector state', () => {
    installTestDom()
    const panel = createLockLabPanel('en')
    const event = lockEvent(
      'lock-event-victim',
      'deadlock_victim_selected',
      deadlockSnapshot(),
    )

    panel.update(event)

    expect(panel.root.hidden).toBe(false)
    expect(panel.root.getAttribute('tabindex')).toBe('0')
    expect(panel.root.textContent).toContain('MODEL / SIMULATED')
    expect(panel.root.textContent).toContain('TiKV deadlock detector')
    expect(panel.root.textContent).toContain('tikv-3')

    const phase = panel.root.querySelector('[role="status"]')
    expect(phase?.getAttribute('aria-live')).toBe('polite')
    expect(phase?.getAttribute('aria-atomic')).toBe('true')
    expect(phase?.textContent).toBe('Phase: Selecting a victim')

    expect(panel.root.querySelectorAll('[data-transaction-id]')).toHaveLength(2)
    expect(panel.root.querySelector('[data-transaction-id="txn-a"]')?.textContent)
      .toContain('start_ts101')
    expect(panel.root.querySelector('[data-transaction-id="txn-b"]')?.textContent)
      .toContain('StateVictim')

    const resourceA = panel.root.querySelector(
      '[data-lock-resource-id="resource-a"]',
    )
    expect(resourceA?.textContent).toContain('Holdertxn-a')
    expect(resourceA?.querySelector('ol')?.tagName.toLowerCase()).toBe('ol')
    expect(resourceA?.querySelectorAll('ol li')).toHaveLength(1)
    expect(resourceA?.querySelector('ol li')?.textContent).toBe('txn-b')

    expect(panel.root.querySelectorAll('[data-edge-direction="waiter-to-holder"]'))
      .toHaveLength(2)
    expect(panel.root.querySelector('[data-wait-for-edge-id="edge-a-to-b"]')?.textContent)
      .toBe('txn-a waits for txn-b, which holds resource-b in Region 7.')
  })

  it('shows the non-retryable victim boundary and explicit application B to B-prime retry', () => {
    installTestDom()
    const panel = createLockLabPanel('en')
    const victim = lockEvent(
      'lock-event-rollback',
      'deadlock_victim_rollback',
      deadlockSnapshot(),
    )

    panel.update(victim)
    const deadlock = panel.root.querySelector('[data-deadlock-id="deadlock-1"]')
    expect(deadlock?.getAttribute('data-victim-transaction-id')).toBe('txn-b')
    expect(deadlock?.getAttribute('data-retryable')).toBe('false')
    expect(deadlock?.textContent).toContain('Not returned yet')
    expect(deadlock?.textContent).not.toContain('Client errorError 1213')
    expect(deadlock?.textContent).toContain('TiDB internal retryablefalse')
    expect(deadlock?.textContent).toContain('not an internal single-statement retry')

    panel.update(lockEvent(
      'lock-event-retry',
      'application_retry_begin',
      applicationRetrySnapshot(),
    ))
    expect(panel.root.querySelector('[data-deadlock-id="deadlock-1"]')?.textContent)
      .toContain('Client errorError 1213')
    const retry = panel.root.querySelector('[data-retry-source="application"]')
    expect(retry?.textContent).toContain('B → B′')
    expect(retry?.textContent).toContain('txn-b → txn-b-retry')
    expect(retry?.textContent).toContain('New start_ts105')
    expect(retry?.textContent).toContain('Retry sourceapplication')
  })

  it('hides non-Lock snapshots, caches updates, switches locale, and disposes', () => {
    installTestDom()
    const panel = createLockLabPanel('en')
    document.body.append(panel.root)
    panel.update({
      id: 'ordinary-snapshot',
      atMs: 0,
      durationMs: 1,
      domain: 'sql',
      kind: 'route',
      label: 'Ordinary trace',
      detail: '',
      status: 'success',
      metadata: {},
      snapshot: {
        modelVersion: 'tidb-v8.5-model-3',
        tsoLastAllocated: 100,
        transaction: null,
        regions: [],
      },
    })

    expect(panel.root.hidden).toBe(true)
    expect(panel.root.childNodes).toHaveLength(0)

    const event = lockEvent(
      'lock-event-victim',
      'deadlock_victim_selected',
      deadlockSnapshot(),
    )
    panel.update(event)
    const cachedFirstChild = panel.root.firstChild
    panel.update(event)
    expect(panel.root.firstChild).toBe(cachedFirstChild)

    panel.setLocale('ja')
    expect(panel.root.firstChild).not.toBe(cachedFirstChild)
    expect(panel.root.textContent).toContain('悲観ロック Lock Lab')
    expect(panel.root.textContent).toContain('フェーズ: Victim選択')
    expect(panel.root.textContent).toContain(
      'txn-a は resource-b（Region 7）を保持する txn-b を待機しています。',
    )

    panel.dispose()
    expect(panel.root.parentNode).toBeNull()
    expect(() => panel.dispose()).not.toThrow()
  })

  it('distinguishes commit completion from post-commit lock release', () => {
    installTestDom()
    const panel = createLockLabPanel('en')
    const snapshot = applicationRetrySnapshot()

    panel.update(lockEvent('commit', 'commit_summary', snapshot))
    expect(panel.root.querySelector('[data-lock-phase]')?.textContent)
      .toBe('Phase: Commit completed')

    panel.update(lockEvent('release', 'lock_release_after_commit', snapshot))
    expect(panel.root.querySelector('[data-lock-phase]')?.textContent)
      .toBe('Phase: Releasing locks after commit')
  })
})
