import { describe, expect, it } from 'vitest'

import {
  createLockLabState,
  detectWaitForCycle,
  reduceLockLabState,
  selectWaiterByStartTs,
} from './lock-lab'
import type {
  LockLabDelta,
} from './lock-lab'
import type { TraceLockLabSnapshot } from './types'

function apply(
  state: TraceLockLabSnapshot,
  ...deltas: readonly LockLabDelta[]
): TraceLockLabSnapshot {
  return deltas.reduce(reduceLockLabState, state)
}

function begin(
  transactionId: string,
  startTs: number,
  clientId = transactionId,
  attempt = 1,
  retryOfTransactionId: string | null = null,
): LockLabDelta {
  return {
    kind: 'lock_transaction_begin',
    clientId,
    transactionId,
    attempt,
    retryOfTransactionId,
    startTs,
  }
}

describe('Lock Lab reducer', () => {
  it('creates a deeply frozen synthetic lock state', () => {
    const state = createLockLabState('tikv-3', [
      { id: 'resource-a', regionId: 6, leaderStoreId: 'tikv-1' },
      { id: 'resource-b', regionId: 7, leaderStoreId: 'tikv-2' },
    ])

    expect(state.detectorScope).toBe('cluster_wide')
    expect(state.detectorLeaderStoreId).toBe('tikv-3')
    expect(state.resources.map((resource) => resource.id))
      .toEqual(['resource-a', 'resource-b'])
    expect(state.resources.every((resource) =>
      resource.storage === 'leader_memory' &&
      resource.wakePolicy === 'smallest_start_ts_model_policy',
    )).toBe(true)
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.resources)).toBe(true)
    expect(Object.isFrozen(state.resources[0])).toBe(true)
    expect(Object.isFrozen(state.resources[0].waiterTransactionIds)).toBe(true)
  })

  it('records DATA_LOCK_WAITS edges as waiter to holder and detects only the closing cycle', () => {
    let state = createLockLabState('tikv-3', [
      { id: 'resource-a', regionId: 6, leaderStoreId: 'tikv-1' },
      { id: 'resource-b', regionId: 7, leaderStoreId: 'tikv-2' },
    ])
    state = apply(
      state,
      begin('txn-a', 101),
      begin('txn-b', 102),
      {
        kind: 'lock_owner',
        action: 'acquire',
        resourceId: 'resource-a',
        regionId: 6,
        transactionId: 'txn-a',
        leaderStoreId: 'tikv-1',
      },
      {
        kind: 'lock_owner',
        action: 'acquire',
        resourceId: 'resource-b',
        regionId: 7,
        transactionId: 'txn-b',
        leaderStoreId: 'tikv-2',
      },
      {
        kind: 'lock_wait_queue',
        action: 'enqueue',
        resourceId: 'resource-b',
        transactionId: 'txn-a',
        position: 0,
      },
      {
        kind: 'wait_for_edge',
        action: 'add',
        edgeId: 'a-to-b',
        waiterTransactionId: 'txn-a',
        holderTransactionId: 'txn-b',
        resourceId: 'resource-b',
        regionId: 7,
      },
    )

    expect(detectWaitForCycle(state.waitForEdges, 'a-to-b')).toBeNull()

    state = apply(
      state,
      {
        kind: 'lock_wait_queue',
        action: 'enqueue',
        resourceId: 'resource-a',
        transactionId: 'txn-b',
        position: 0,
      },
      {
        kind: 'wait_for_edge',
        action: 'add',
        edgeId: 'b-to-a',
        waiterTransactionId: 'txn-b',
        holderTransactionId: 'txn-a',
        resourceId: 'resource-a',
        regionId: 6,
      },
    )

    expect(state.waitForEdges).toEqual([
      expect.objectContaining({
        waiterTransactionId: 'txn-a',
        holderTransactionId: 'txn-b',
      }),
      expect.objectContaining({
        waiterTransactionId: 'txn-b',
        holderTransactionId: 'txn-a',
      }),
    ])
    expect(detectWaitForCycle(state.waitForEdges, 'b-to-a'))
      .toEqual(['txn-b', 'txn-a', 'txn-b'])
  })

  it('applies the deterministic smallest-start_ts MODEL POLICY with a stable tie break', () => {
    let state = createLockLabState('tikv-3', [
      { id: 'resource-a', regionId: 6, leaderStoreId: 'tikv-1' },
      { id: 'resource-b', regionId: 7, leaderStoreId: 'tikv-2' },
    ])
    state = apply(
      state,
      begin('holder', 100),
      begin('later', 300),
      begin('earlier-z', 200),
      begin('earlier-a', 200),
      {
        kind: 'lock_owner',
        action: 'acquire',
        resourceId: 'resource-a',
        regionId: 6,
        transactionId: 'holder',
        leaderStoreId: 'tikv-1',
      },
      ...['later', 'earlier-z', 'earlier-a'].flatMap(
        (transactionId, position): LockLabDelta[] => [
          {
            kind: 'lock_wait_queue',
            action: 'enqueue',
            resourceId: 'resource-a',
            transactionId,
            position,
          },
          {
            kind: 'wait_for_edge',
            action: 'add',
            edgeId: `${transactionId}-to-holder`,
            waiterTransactionId: transactionId,
            holderTransactionId: 'holder',
            resourceId: 'resource-a',
            regionId: 6,
          },
        ],
      ),
    )

    expect(state.resources[0].waiterTransactionIds)
      .toEqual(['later', 'earlier-z', 'earlier-a'])
    expect(selectWaiterByStartTs(state, 'resource-a')).toBe('earlier-a')
  })

  it('requires an application retry to replace a rolled-back transaction with a newer start_ts', () => {
    let state = createLockLabState('tikv-3', [
      { id: 'resource-a', regionId: 6, leaderStoreId: 'tikv-1' },
      { id: 'resource-b', regionId: 7, leaderStoreId: 'tikv-2' },
    ])
    state = apply(
      state,
      begin('holder', 90),
      begin('txn-b-1', 100, 'client-b'),
      {
        kind: 'lock_owner',
        action: 'acquire',
        resourceId: 'resource-a',
        regionId: 6,
        transactionId: 'holder',
        leaderStoreId: 'tikv-1',
      },
      {
        kind: 'lock_wait_queue',
        action: 'enqueue',
        resourceId: 'resource-a',
        transactionId: 'txn-b-1',
        position: 0,
      },
      {
        kind: 'wait_for_edge',
        action: 'add',
        edgeId: 'txn-b-1-to-holder',
        waiterTransactionId: 'txn-b-1',
        holderTransactionId: 'holder',
        resourceId: 'resource-a',
        regionId: 6,
      },
      {
        kind: 'lock_transaction_status',
        transactionId: 'txn-b-1',
        from: 'waiting',
        to: 'victim',
      },
      {
        kind: 'wait_for_edge',
        action: 'remove',
        edgeId: 'txn-b-1-to-holder',
        waiterTransactionId: 'txn-b-1',
        holderTransactionId: 'holder',
        resourceId: 'resource-a',
        regionId: 6,
      },
      {
        kind: 'lock_wait_queue',
        action: 'dequeue',
        resourceId: 'resource-a',
        transactionId: 'txn-b-1',
        position: 0,
      },
      {
        kind: 'lock_transaction_status',
        transactionId: 'txn-b-1',
        from: 'victim',
        to: 'rolled_back',
      },
      {
        kind: 'application_retry',
        action: 'schedule',
        clientId: 'client-b',
        retryOfTransactionId: 'txn-b-1',
        fixedBackoffMs: 120,
        newTransactionId: null,
      },
    )

    expect(() => reduceLockLabState(
      state,
      begin('txn-b-2', 100, 'client-b', 2, 'txn-b-1'),
    )).toThrow(/start_ts must increase/)

    state = apply(
      state,
      {
        kind: 'application_retry',
        action: 'begin',
        clientId: 'client-b',
        retryOfTransactionId: 'txn-b-1',
        fixedBackoffMs: 120,
        newTransactionId: 'txn-b-2',
      },
      begin('txn-b-2', 101, 'client-b', 2, 'txn-b-1'),
    )

    expect(state.applicationRetry).toMatchObject({
      source: 'application',
      retryOfTransactionId: 'txn-b-1',
      newTransactionId: 'txn-b-2',
      status: 'started',
    })
    expect(state.transactions.at(-1)).toMatchObject({
      transactionId: 'txn-b-2',
      attempt: 2,
      retryOfTransactionId: 'txn-b-1',
      startTs: 101,
    })
    expect(Object.isFrozen(state.transactions.at(-1)?.heldResourceIds)).toBe(true)
  })

  it('rejects an owner release while a waiter edge or queue would become stale', () => {
    let state = createLockLabState('tikv-3', [
      { id: 'resource-a', regionId: 6, leaderStoreId: 'tikv-1' },
      { id: 'resource-b', regionId: 7, leaderStoreId: 'tikv-2' },
    ])
    state = apply(
      state,
      begin('holder', 100),
      begin('waiter', 200),
      {
        kind: 'lock_owner',
        action: 'acquire',
        resourceId: 'resource-a',
        regionId: 6,
        transactionId: 'holder',
        leaderStoreId: 'tikv-1',
      },
      {
        kind: 'lock_wait_queue',
        action: 'enqueue',
        resourceId: 'resource-a',
        transactionId: 'waiter',
        position: 0,
      },
      {
        kind: 'wait_for_edge',
        action: 'add',
        edgeId: 'waiter-to-holder',
        waiterTransactionId: 'waiter',
        holderTransactionId: 'holder',
        resourceId: 'resource-a',
        regionId: 6,
      },
    )

    expect(() => reduceLockLabState(state, {
      kind: 'lock_owner',
      action: 'release',
      resourceId: 'resource-a',
      regionId: 6,
      transactionId: 'holder',
      leaderStoreId: 'tikv-1',
    })).toThrow(/wait queue atomically/)
    expect(() => reduceLockLabState(state, {
      kind: 'wait_for_edge',
      action: 'add',
      edgeId: 'reversed',
      waiterTransactionId: 'holder',
      holderTransactionId: 'waiter',
      resourceId: 'resource-a',
      regionId: 6,
    })).toThrow(/edge holder must own/)
  })
})
