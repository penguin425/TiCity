/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'

import type {
  StoreId,
  TraceEvent,
  TraceLockLabSnapshot,
  TraceLockResourceSnapshot,
  TraceLockTransactionSnapshot,
} from '../model/types'
import {
  LOCK_LAB_EDGE_CAPACITY,
  LOCK_LAB_RESOURCE_CAPACITY,
  LOCK_LAB_TRANSACTION_CAPACITY,
} from './lock-lab'
import { projectLockLab } from './lock-lab-projection'

function transaction(
  transactionId: string,
  clientId: string,
  startTs: number,
  status: TraceLockTransactionSnapshot['status'],
  attempt = 1,
  retryOfTransactionId: string | null = null,
): TraceLockTransactionSnapshot {
  return {
    clientId,
    transactionId,
    attempt,
    retryOfTransactionId,
    startTs,
    commitTs: status === 'completed' ? startTs + 10 : null,
    status,
    heldResourceIds: [],
    waitingForResourceId: status === 'waiting' ? 'resource-a' : null,
  }
}

function resource(
  id: string,
  regionId: number,
  leaderStoreId: StoreId,
  holderTransactionId: string | null,
  waiterTransactionIds: readonly string[],
): TraceLockResourceSnapshot {
  return {
    id,
    regionId,
    leaderStoreId,
    holderTransactionId,
    waiterTransactionIds,
    wakePolicy: 'smallest_start_ts_model_policy',
    storage: 'leader_memory',
  }
}

function event(lockLab?: TraceLockLabSnapshot): TraceEvent {
  return {
    id: 'lock-event',
    atMs: 10,
    durationMs: 3,
    domain: 'kv',
    kind: 'deadlock_victim_selected',
    label: 'Lock Lab',
    detail: '',
    status: 'failed',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-3',
      tsoLastAllocated: 104,
      transaction: null,
      regions: [],
      ...(lockLab ? { lockLab } : {}),
    },
  }
}

function detailedSnapshot(): TraceLockLabSnapshot {
  return {
    detectorScope: 'cluster_wide',
    detectorLeaderStoreId: 'tikv-3',
    transactions: [
      transaction('txn-a', 'client-a', 101, 'waiting'),
      transaction('txn-b-1', 'client-b', 102, 'victim'),
      transaction('txn-b-2', 'client-b', 104, 'active', 2, 'txn-b-1'),
    ],
    resources: [
      resource('resource-a', 6, 'tikv-1', 'txn-a', ['txn-b-1']),
      resource('resource-b', 7, 'tikv-2', 'txn-b-1', ['txn-a', 'txn-b-2']),
    ],
    waitForEdges: [
      {
        id: 'a-to-b',
        waiterTransactionId: 'txn-a',
        holderTransactionId: 'txn-b-1',
        resourceId: 'resource-b',
        regionId: 7,
      },
      {
        id: 'b-to-a',
        waiterTransactionId: 'txn-b-1',
        holderTransactionId: 'txn-a',
        resourceId: 'resource-a',
        regionId: 6,
      },
    ],
    deadlock: {
      id: 'deadlock-1',
      cycleTransactionIds: ['txn-b-1', 'txn-a', 'txn-b-1'],
      victimTransactionId: 'txn-b-1',
      selectionPolicy: 'cycle_closing_waiter_model_policy',
      retryable: false,
      resolution: 'rolling_back',
      clientErrorCode: null,
      clientErrorTransactionId: null,
    },
    applicationRetry: {
      source: 'application',
      clientId: 'client-b',
      retryOfTransactionId: 'txn-b-1',
      fixedBackoffMs: 120,
      status: 'started',
      newTransactionId: 'txn-b-2',
    },
  }
}

describe('Lock Lab model-to-world projection', () => {
  it('requires the snapshot.lockLab discriminator', () => {
    expect(projectLockLab(null, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectLockLab(event(), {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectLockLab({
      ...event(),
      snapshot: undefined,
    }, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
  })

  it('maps A, B, B-prime, queues, directed cycle, detector, victim, and application retry', () => {
    const snapshot = detailedSnapshot()
    const source = event(snapshot)
    const before = JSON.stringify(source)
    const projection = projectLockLab(source, {
      inspect: true,
      reducedMotion: false,
      pulse: 2,
    })!

    expect(projection.mode).toBe('inspect')
    expect(projection.phase).toBe('retry')
    expect(projection.transactions.map((candidate) => ({
      id: candidate.id,
      shape: candidate.shape,
    }))).toEqual([
      { id: 'txn-a', shape: 'cylinder' },
      { id: 'txn-b-1', shape: 'diamond' },
      { id: 'txn-b-2', shape: 'double-ring' },
    ])
    expect(projection.resources[0]).toMatchObject({
      id: 'resource-a',
      holderSlot: 0,
      waiterSlots: [1, -1],
    })
    expect(projection.resources[1]).toMatchObject({
      id: 'resource-b',
      holderSlot: 1,
      waiterSlots: [0, 2],
    })
    expect(projection.edges.slice(0, 2)).toEqual([
      expect.objectContaining({
        id: 'a-to-b',
        waiterSlot: 0,
        holderSlot: 1,
        resourceSlot: 1,
        cycle: true,
        visible: true,
      }),
      expect.objectContaining({
        id: 'b-to-a',
        waiterSlot: 1,
        holderSlot: 0,
        resourceSlot: 0,
        cycle: true,
        visible: true,
      }),
    ])
    expect(projection.detector).toMatchObject({
      active: true,
      scope: 'cluster_wide',
      leaderStoreId: 'tikv-3',
      state: 'victim-selected',
      pulse: 1,
    })
    expect(projection.deadlock).toMatchObject({
      visible: true,
      victimSlot: 1,
      retryable: false,
      resolution: 'rolling_back',
    })
    expect(projection.applicationRetry).toMatchObject({
      visible: true,
      source: 'application',
      newTransactionSlot: 2,
      fixedBackoffMs: 120,
    })
    expect(projection.overflow.total).toBe(0)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('limits every renderer dimension, reports overflow, and leaves input untouched', () => {
    const transactions = [
      transaction('txn-a', 'client-a', 101, 'waiting'),
      transaction('txn-b', 'client-b', 102, 'waiting'),
      transaction('txn-c', 'client-c', 103, 'active'),
      transaction('txn-b-2', 'client-b', 104, 'active', 2, 'txn-b'),
    ]
    const waitForEdges = Array.from({ length: 8 }, (_, index) => ({
      id: `edge-${index}`,
      waiterTransactionId: index % 2 === 0 ? 'txn-a' : 'txn-b',
      holderTransactionId: index % 2 === 0 ? 'txn-b' : 'txn-a',
      resourceId: index % 2 === 0 ? 'resource-b' : 'resource-a',
      regionId: index % 2 === 0 ? 7 : 6,
    }))
    const snapshot: TraceLockLabSnapshot = {
      detectorScope: 'cluster_wide',
      detectorLeaderStoreId: 'tikv-3',
      transactions,
      resources: [
        resource(
          'resource-a',
          6,
          'tikv-1',
          'txn-a',
          ['txn-b', 'txn-c', 'txn-b-2'],
        ),
        resource(
          'resource-b',
          7,
          'tikv-2',
          'txn-b',
          ['txn-a', 'txn-c', 'txn-b-2', 'txn-a'],
        ),
        resource('resource-c', 8, 'tikv-3', 'txn-c', []),
      ],
      waitForEdges,
      deadlock: null,
      applicationRetry: null,
    }
    const source = event(snapshot)
    const before = JSON.stringify(source)
    const projection = projectLockLab(source, {
      inspect: false,
      reducedMotion: true,
    })!

    expect(projection.mode).toBe('overview')
    expect(projection.transactions).toHaveLength(LOCK_LAB_TRANSACTION_CAPACITY)
    expect(projection.transactions.map((candidate) => candidate.id))
      .toEqual(['txn-a', 'txn-b', 'txn-b-2'])
    expect(projection.resources).toHaveLength(LOCK_LAB_RESOURCE_CAPACITY)
    expect(projection.edges).toHaveLength(LOCK_LAB_EDGE_CAPACITY)
    expect(projection.edges.every((edge) =>
      edge.waiterSlot >= -1 &&
      edge.waiterSlot < LOCK_LAB_TRANSACTION_CAPACITY &&
      edge.holderSlot >= -1 &&
      edge.holderSlot < LOCK_LAB_TRANSACTION_CAPACITY,
    )).toBe(true)
    expect(projection.resources[0].waiterSlots).toEqual([1, -1])
    expect(projection.overflow).toEqual({
      transactions: 1,
      resources: 1,
      waiters: 3,
      edges: 2,
      total: 7,
    })
    expect(JSON.stringify(source)).toBe(before)
  })

  it('derives stable teaching phases without consulting legacy transaction state', () => {
    const base = detailedSnapshot()
    const withoutRetry: TraceLockLabSnapshot = {
      ...base,
      applicationRetry: null,
    }
    expect(projectLockLab(event({
      ...withoutRetry,
      deadlock: {
        ...withoutRetry.deadlock!,
        victimTransactionId: null,
        resolution: 'detected',
      },
      transactions: withoutRetry.transactions.map((candidate) => ({
        ...candidate,
        status: 'waiting' as const,
      })),
    }), {
      inspect: true,
      reducedMotion: false,
    })?.phase).toBe('cycle')

    expect(projectLockLab(event({
      ...withoutRetry,
      deadlock: {
        ...withoutRetry.deadlock!,
        resolution: 'resolved',
      },
      waitForEdges: [],
      transactions: withoutRetry.transactions.map((candidate) => ({
        ...candidate,
        status: 'completed' as const,
      })),
    }), {
      inspect: true,
      reducedMotion: false,
    })?.phase).toBe('complete')
  })
})
