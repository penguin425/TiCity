/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type {
  TraceEvent,
  TraceLockLabSnapshot,
  TraceLockTransactionSnapshot,
} from '../model/types'
import {
  LOCK_LAB_EDGE_CAPACITY,
  LOCK_LAB_RESOURCE_CAPACITY,
  LOCK_LAB_TRANSACTION_CAPACITY,
  LOCK_LAB_WAITERS_PER_RESOURCE,
} from './lock-lab'
import type {
  LockLabApplicationRetryProjection,
  LockLabDeadlockProjection,
  LockLabDetectorProjection,
  LockLabPhase,
  LockLabProjection,
  LockLabResourceProjection,
  LockLabResourceSlot,
  LockLabTransactionProjection,
  LockLabTransactionShape,
  LockLabTransactionSlot,
  LockLabWaitForEdgeProjection,
} from './lock-lab'

export interface LockLabProjectionOptions {
  readonly inspect: boolean
  readonly reducedMotion: boolean
  readonly pulse?: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function shapeFor(slot: LockLabTransactionSlot): LockLabTransactionShape {
  if (slot === 0) return 'cylinder'
  if (slot === 1) return 'diamond'
  return 'double-ring'
}

function emptyTransaction(
  slot: LockLabTransactionSlot,
): LockLabTransactionProjection {
  return {
    visible: false,
    id: '',
    clientId: '',
    attempt: 0,
    retryOfTransactionId: null,
    startTs: 0,
    commitTs: null,
    status: 'active',
    shape: shapeFor(slot),
  }
}

function projectTransaction(
  transaction: TraceLockTransactionSnapshot,
  slot: LockLabTransactionSlot,
): LockLabTransactionProjection {
  return {
    visible: true,
    id: transaction.transactionId,
    clientId: transaction.clientId,
    attempt: transaction.attempt,
    retryOfTransactionId: transaction.retryOfTransactionId,
    startTs: transaction.startTs,
    commitTs: transaction.commitTs,
    status: transaction.status,
    shape: shapeFor(slot),
  }
}

function emptyResource(): LockLabResourceProjection {
  return {
    visible: false,
    id: '',
    regionId: -1,
    leaderStoreId: '',
    holderSlot: -1,
    waiterSlots: [-1, -1],
  }
}

function emptyEdge(): LockLabWaitForEdgeProjection {
  return {
    visible: false,
    id: '',
    waiterSlot: -1,
    holderSlot: -1,
    resourceSlot: -1,
    cycle: false,
  }
}

function isCycleEdge(
  snapshot: TraceLockLabSnapshot,
  waiterTransactionId: string,
  holderTransactionId: string,
): boolean {
  const cycle = snapshot.deadlock?.cycleTransactionIds
  if (!cycle) return false
  for (let index = 0; index + 1 < cycle.length; index++) {
    if (
      cycle[index] === waiterTransactionId &&
      cycle[index + 1] === holderTransactionId
    ) {
      return true
    }
  }
  return false
}

function phaseFor(snapshot: TraceLockLabSnapshot): LockLabPhase {
  const retry = snapshot.applicationRetry
  if (retry?.status === 'backoff' || retry?.status === 'started') return 'retry'

  for (const transaction of snapshot.transactions) {
    if (transaction.status === 'victim') return 'victim'
  }
  if (snapshot.deadlock?.resolution === 'detected') return 'cycle'
  if (snapshot.deadlock?.resolution === 'rolling_back') return 'rollback'

  let visibleTransactions = 0
  let completedTransactions = 0
  for (const transaction of snapshot.transactions) {
    visibleTransactions++
    if (transaction.status === 'waiting') return 'waiting'
    if (transaction.status === 'completed') completedTransactions++
  }
  if (
    visibleTransactions > 0 &&
    visibleTransactions === completedTransactions
  ) {
    return 'complete'
  }
  if (snapshot.deadlock?.resolution === 'resolved') return 'resolved'
  for (const resource of snapshot.resources) {
    if (resource.holderTransactionId !== null) return 'acquiring'
  }
  return 'idle'
}

function detectorProjection(
  snapshot: TraceLockLabSnapshot,
  event: TraceEvent,
  pulse: number,
): LockLabDetectorProjection {
  const resolution = snapshot.deadlock?.resolution
  const lookupActive =
    event.kind === 'deadlock_detector_lookup' ||
    event.kind === 'deadlock_detected'
  return {
    active:
      lookupActive ||
      resolution === 'detected' ||
      resolution === 'rolling_back',
    scope: snapshot.detectorScope,
    leaderStoreId: snapshot.detectorLeaderStoreId,
    state: resolution === 'resolved'
      ? 'resolved'
      : resolution === 'rolling_back'
        ? 'victim-selected'
        : resolution === 'detected' || lookupActive
          ? 'detecting'
          : 'idle',
    pulse,
  }
}

/**
 * Converts the model-owned Lock Lab discriminator into bounded renderer slots.
 * A legacy event, even one with Regions, must not accidentally create this lab.
 */
export function projectLockLab(
  event: TraceEvent | null,
  options: LockLabProjectionOptions,
): LockLabProjection | null {
  const snapshot = event?.snapshot?.lockLab
  if (!event || !snapshot) return null

  const transactions: [
    LockLabTransactionProjection,
    LockLabTransactionProjection,
    LockLabTransactionProjection,
  ] = [
    emptyTransaction(0),
    emptyTransaction(1),
    emptyTransaction(2),
  ]
  const transactionSlots = new Map<string, LockLabTransactionSlot>()
  let nextInitialSlot: 0 | 1 | 2 = 0
  let transactionOverflow = 0
  for (const transaction of snapshot.transactions) {
    let slot: LockLabTransactionSlot | null = null
    if (transaction.retryOfTransactionId !== null || transaction.attempt > 1) {
      if (!transactions[2].visible) slot = 2
    } else if (nextInitialSlot < 2) {
      slot = nextInitialSlot
      nextInitialSlot = (nextInitialSlot + 1) as 1 | 2
    }
    if (slot === null || transactionSlots.has(transaction.transactionId)) {
      transactionOverflow++
      continue
    }
    transactions[slot] = projectTransaction(transaction, slot)
    transactionSlots.set(transaction.transactionId, slot)
  }

  const resources: [
    LockLabResourceProjection,
    LockLabResourceProjection,
  ] = [emptyResource(), emptyResource()]
  const resourceSlots = new Map<string, LockLabResourceSlot>()
  let waiterOverflow = 0
  for (const resource of snapshot.resources) {
    waiterOverflow += Math.max(
      0,
      resource.waiterTransactionIds.length - LOCK_LAB_WAITERS_PER_RESOURCE,
    )
  }
  const visibleResourceCount = Math.min(
    snapshot.resources.length,
    LOCK_LAB_RESOURCE_CAPACITY,
  )
  for (let index = 0; index < visibleResourceCount; index++) {
    const resource = snapshot.resources[index]
    const slot = index as LockLabResourceSlot
    resourceSlots.set(resource.id, slot)
    resources[slot] = {
      visible: true,
      id: resource.id,
      regionId: resource.regionId,
      leaderStoreId: resource.leaderStoreId,
      holderSlot: resource.holderTransactionId === null
        ? -1
        : transactionSlots.get(resource.holderTransactionId) ?? -1,
      waiterSlots: [
        transactionSlots.get(resource.waiterTransactionIds[0] ?? '') ?? -1,
        transactionSlots.get(resource.waiterTransactionIds[1] ?? '') ?? -1,
      ],
    }
  }

  const edges: [
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
    LockLabWaitForEdgeProjection,
  ] = [
    emptyEdge(),
    emptyEdge(),
    emptyEdge(),
    emptyEdge(),
    emptyEdge(),
    emptyEdge(),
  ]
  const visibleEdgeCount = Math.min(
    snapshot.waitForEdges.length,
    LOCK_LAB_EDGE_CAPACITY,
  )
  for (let index = 0; index < visibleEdgeCount; index++) {
    const edge = snapshot.waitForEdges[index]
    const waiterSlot = transactionSlots.get(edge.waiterTransactionId) ?? -1
    const holderSlot = transactionSlots.get(edge.holderTransactionId) ?? -1
    const resourceSlot = resourceSlots.get(edge.resourceId) ?? -1
    edges[index] = {
      visible:
        waiterSlot >= 0 &&
        holderSlot >= 0 &&
        resourceSlot >= 0 &&
        waiterSlot !== holderSlot,
      id: edge.id,
      waiterSlot,
      holderSlot,
      resourceSlot,
      cycle: isCycleEdge(
        snapshot,
        edge.waiterTransactionId,
        edge.holderTransactionId,
      ),
    }
  }

  const deadlock: LockLabDeadlockProjection = snapshot.deadlock === null
    ? {
        visible: false,
        id: '',
        victimSlot: -1,
        selectionPolicy: 'cycle_closing_waiter_model_policy',
        retryable: false,
        resolution: 'none',
      }
    : {
        visible: true,
        id: snapshot.deadlock.id,
        victimSlot: snapshot.deadlock.victimTransactionId === null
          ? -1
          : transactionSlots.get(snapshot.deadlock.victimTransactionId) ?? -1,
        selectionPolicy: snapshot.deadlock.selectionPolicy,
        retryable: snapshot.deadlock.retryable,
        resolution: snapshot.deadlock.resolution,
      }

  const applicationRetry: LockLabApplicationRetryProjection =
    snapshot.applicationRetry === null
      ? {
          visible: false,
          source: 'application',
          clientId: '',
          retryOfTransactionId: '',
          fixedBackoffMs: 0,
          status: 'none',
          newTransactionSlot: -1,
        }
      : {
          visible: true,
          source: snapshot.applicationRetry.source,
          clientId: snapshot.applicationRetry.clientId,
          retryOfTransactionId:
            snapshot.applicationRetry.retryOfTransactionId,
          fixedBackoffMs: snapshot.applicationRetry.fixedBackoffMs,
          status: snapshot.applicationRetry.status,
          newTransactionSlot:
            snapshot.applicationRetry.newTransactionId === null
              ? -1
              : transactionSlots.get(
                snapshot.applicationRetry.newTransactionId,
              ) ?? -1,
        }

  const overflow = {
    transactions: transactionOverflow,
    resources: Math.max(
      0,
      snapshot.resources.length - LOCK_LAB_RESOURCE_CAPACITY,
    ),
    waiters: waiterOverflow,
    edges: Math.max(
      0,
      snapshot.waitForEdges.length - LOCK_LAB_EDGE_CAPACITY,
    ),
    total: 0,
  }
  overflow.total =
    overflow.transactions +
    overflow.resources +
    overflow.waiters +
    overflow.edges

  return {
    mode: options.inspect ? 'inspect' : 'overview',
    phase: phaseFor(snapshot),
    reducedMotion: options.reducedMotion,
    transactions,
    resources,
    edges,
    detector: detectorProjection(
      snapshot,
      event,
      clamp(options.pulse ?? 0, 0, 1),
    ),
    deadlock,
    applicationRetry,
    overflow,
  }
}
