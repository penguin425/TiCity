/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure model-3 Lock Lab state. This reducer owns only synthetic pessimistic
 * lock resources, wait queues, the wait-for graph, deadlock history, and the
 * explicit application retry boundary. It has no renderer or browser imports.
 */

import type {
  StoreId,
  TraceApplicationRetrySnapshot,
  TraceDeadlockSnapshot,
  TraceLockLabSnapshot,
  TraceLockResourceSnapshot,
  TraceLockTransactionSnapshot,
  TraceStateDelta,
  TraceWaitForEdgeSnapshot,
} from './types'

export type LockLabDelta = Extract<
  TraceStateDelta,
  {
    kind:
      | 'lock_transaction_begin'
      | 'lock_transaction_status'
      | 'lock_owner'
      | 'lock_wait_queue'
      | 'wait_for_edge'
      | 'deadlock_state'
      | 'deadlock_client_error'
      | 'application_retry'
  }
>

export interface LockLabResourceDefinition {
  id: string
  regionId: number
  leaderStoreId: StoreId
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Lock Lab invariant: ${message}`)
}

export function isLockLabDelta(delta: TraceStateDelta): delta is LockLabDelta {
  return delta.kind === 'lock_transaction_begin' ||
    delta.kind === 'lock_transaction_status' ||
    delta.kind === 'lock_owner' ||
    delta.kind === 'lock_wait_queue' ||
    delta.kind === 'wait_for_edge' ||
    delta.kind === 'deadlock_state' ||
    delta.kind === 'deadlock_client_error' ||
    delta.kind === 'application_retry'
}

export function freezeLockLabSnapshot(
  snapshot: TraceLockLabSnapshot,
): TraceLockLabSnapshot {
  return Object.freeze({
    ...snapshot,
    transactions: Object.freeze(snapshot.transactions.map((transaction) =>
      Object.freeze({
        ...transaction,
        heldResourceIds: Object.freeze([...transaction.heldResourceIds]),
      }))),
    resources: Object.freeze(snapshot.resources.map((resource) => Object.freeze({
      ...resource,
      waiterTransactionIds: Object.freeze([...resource.waiterTransactionIds]),
    }))),
    waitForEdges: Object.freeze(snapshot.waitForEdges.map((edge) =>
      Object.freeze({ ...edge }))),
    deadlock: snapshot.deadlock === null
      ? null
      : Object.freeze({
        ...snapshot.deadlock,
        cycleTransactionIds: Object.freeze([
          ...snapshot.deadlock.cycleTransactionIds,
        ]),
      }),
    applicationRetry: snapshot.applicationRetry === null
      ? null
      : Object.freeze({ ...snapshot.applicationRetry }),
  })
}

export function createLockLabState(
  detectorLeaderStoreId: StoreId,
  definitions: readonly LockLabResourceDefinition[],
): TraceLockLabSnapshot {
  invariant(definitions.length >= 2, 'at least two resources are required')
  invariant(
    new Set(definitions.map((definition) => definition.id)).size === definitions.length,
    'resource ids must be unique',
  )
  return freezeLockLabSnapshot({
    detectorScope: 'cluster_wide',
    detectorLeaderStoreId,
    transactions: [],
    resources: definitions.map((definition): TraceLockResourceSnapshot => ({
      ...definition,
      holderTransactionId: null,
      waiterTransactionIds: [],
      wakePolicy: 'smallest_start_ts_model_policy',
      storage: 'leader_memory',
    })),
    waitForEdges: [],
    deadlock: null,
    applicationRetry: null,
  })
}

function replaceTransaction(
  transactions: readonly TraceLockTransactionSnapshot[],
  transactionId: string,
  update: (
    transaction: TraceLockTransactionSnapshot,
  ) => TraceLockTransactionSnapshot,
): readonly TraceLockTransactionSnapshot[] {
  const index = transactions.findIndex((transaction) =>
    transaction.transactionId === transactionId)
  invariant(index >= 0, `unknown transaction ${transactionId}`)
  return transactions.map((transaction, candidateIndex) =>
    candidateIndex === index ? update(transaction) : transaction)
}

function replaceResource(
  resources: readonly TraceLockResourceSnapshot[],
  resourceId: string,
  update: (resource: TraceLockResourceSnapshot) => TraceLockResourceSnapshot,
): readonly TraceLockResourceSnapshot[] {
  const index = resources.findIndex((resource) => resource.id === resourceId)
  invariant(index >= 0, `unknown resource ${resourceId}`)
  return resources.map((resource, candidateIndex) =>
    candidateIndex === index ? update(resource) : resource)
}

function transactionById(
  state: TraceLockLabSnapshot,
  transactionId: string,
): TraceLockTransactionSnapshot {
  const transaction = state.transactions.find((candidate) =>
    candidate.transactionId === transactionId)
  invariant(transaction, `unknown transaction ${transactionId}`)
  return transaction
}

function resourceById(
  state: TraceLockLabSnapshot,
  resourceId: string,
): TraceLockResourceSnapshot {
  const resource = state.resources.find((candidate) => candidate.id === resourceId)
  invariant(resource, `unknown resource ${resourceId}`)
  return resource
}

function validateLockGraph(
  transactions: readonly TraceLockTransactionSnapshot[],
  resources: readonly TraceLockResourceSnapshot[],
  waitForEdges: readonly TraceWaitForEdgeSnapshot[],
): void {
  const transactionIds = new Set(transactions.map((transaction) =>
    transaction.transactionId))
  const resourceIds = new Set(resources.map((resource) => resource.id))
  invariant(transactionIds.size === transactions.length, 'transaction ids must be unique')
  invariant(resourceIds.size === resources.length, 'resource ids must be unique')

  for (const resource of resources) {
    invariant(
      new Set(resource.waiterTransactionIds).size ===
        resource.waiterTransactionIds.length,
      `${resource.id} queue contains a duplicate waiter`,
    )
    if (resource.holderTransactionId !== null) {
      const holder = transactions.find((transaction) =>
        transaction.transactionId === resource.holderTransactionId)
      invariant(holder, `${resource.id} has an unknown holder`)
      invariant(
        holder.heldResourceIds.includes(resource.id),
        `${resource.id} is missing from its holder transaction`,
      )
    }
    for (const waiterId of resource.waiterTransactionIds) {
      const waiter = transactions.find((transaction) =>
        transaction.transactionId === waiterId)
      invariant(waiter, `${resource.id} has an unknown waiter`)
      invariant(
        waiter.waitingForResourceId === resource.id,
        `${waiterId} queue and waiting resource disagree`,
      )
    }
  }

  for (const transaction of transactions) {
    invariant(
      new Set(transaction.heldResourceIds).size ===
        transaction.heldResourceIds.length,
      `${transaction.transactionId} has a duplicate held resource`,
    )
    for (const resourceId of transaction.heldResourceIds) {
      const resource = resources.find((candidate) => candidate.id === resourceId)
      invariant(resource, `${transaction.transactionId} holds an unknown resource`)
      invariant(
        resource.holderTransactionId === transaction.transactionId,
        `${transaction.transactionId} and ${resourceId} ownership disagree`,
      )
    }
    if (transaction.waitingForResourceId !== null) {
      const resource = resources.find((candidate) =>
        candidate.id === transaction.waitingForResourceId)
      invariant(resource, `${transaction.transactionId} waits for an unknown resource`)
      invariant(
        resource.waiterTransactionIds.includes(transaction.transactionId),
        `${transaction.transactionId} is absent from its wait queue`,
      )
      invariant(
        transaction.status === 'waiting' || transaction.status === 'victim',
        `${transaction.transactionId} has a waiting resource in status ${transaction.status}`,
      )
    }
    if (transaction.status === 'rolled_back') {
      invariant(
        transaction.heldResourceIds.length === 0 &&
        transaction.waitingForResourceId === null,
        `${transaction.transactionId} rolled back with live lock state`,
      )
    }
  }

  invariant(
    new Set(waitForEdges.map((edge) => edge.id)).size === waitForEdges.length,
    'wait-for edge ids must be unique',
  )
  invariant(
    new Set(waitForEdges.map((edge) => edge.waiterTransactionId)).size ===
      waitForEdges.length,
    'a transaction may have only one outgoing wait-for edge',
  )
  for (const edge of waitForEdges) {
    const resource = resources.find((candidate) => candidate.id === edge.resourceId)
    invariant(resource, `${edge.id} references an unknown resource`)
    invariant(resource.regionId === edge.regionId, `${edge.id} Region mismatch`)
    invariant(
      resource.holderTransactionId === edge.holderTransactionId,
      `${edge.id} does not point to the current holder`,
    )
    invariant(
      resource.waiterTransactionIds.includes(edge.waiterTransactionId),
      `${edge.id} waiter is absent from the queue`,
    )
    invariant(
      transactionIds.has(edge.waiterTransactionId) &&
      transactionIds.has(edge.holderTransactionId),
      `${edge.id} references an unknown transaction`,
    )
  }
}

export function reduceLockLabState(
  state: TraceLockLabSnapshot,
  delta: LockLabDelta,
): TraceLockLabSnapshot {
  let transactions = state.transactions
  let resources = state.resources
  let waitForEdges = state.waitForEdges
  let deadlock: TraceDeadlockSnapshot | null = state.deadlock
  let applicationRetry: TraceApplicationRetrySnapshot | null =
    state.applicationRetry

  if (delta.kind === 'lock_transaction_begin') {
    invariant(Number.isSafeInteger(delta.startTs) && delta.startTs > 0, 'start_ts must be a positive integer')
    invariant(
      !transactions.some((transaction) =>
        transaction.transactionId === delta.transactionId),
      `duplicate transaction ${delta.transactionId}`,
    )
    if (delta.retryOfTransactionId !== null) {
      const previous = transactionById(state, delta.retryOfTransactionId)
      invariant(previous.status === 'rolled_back', 'retry target must be rolled back')
      invariant(previous.clientId === delta.clientId, 'retry client must match')
      invariant(delta.startTs > previous.startTs, 'retry start_ts must increase')
      invariant(delta.attempt === previous.attempt + 1, 'retry attempt must increase by one')
      invariant(
        applicationRetry?.status === 'started' &&
        applicationRetry.newTransactionId === delta.transactionId,
        'retry transaction must follow the application retry begin boundary',
      )
    } else {
      invariant(delta.attempt === 1, 'initial transaction attempt must be one')
    }
    transactions = [
      ...transactions,
      {
        clientId: delta.clientId,
        transactionId: delta.transactionId,
        attempt: delta.attempt,
        retryOfTransactionId: delta.retryOfTransactionId,
        startTs: delta.startTs,
        commitTs: null,
        status: 'active',
        heldResourceIds: [],
        waitingForResourceId: null,
      },
    ]
  } else if (delta.kind === 'lock_transaction_status') {
    transactions = replaceTransaction(
      transactions,
      delta.transactionId,
      (transaction) => {
        invariant(
          transaction.status === delta.from,
          `${transaction.transactionId} status ${transaction.status} is not ${delta.from}`,
        )
        const transition = `${delta.from}:${delta.to}`
        invariant(
          transition === 'waiting:victim' ||
          transition === 'victim:rolled_back' ||
          transition === 'active:commit_handoff' ||
          transition === 'commit_handoff:completed',
          `unsupported status transition ${transition}`,
        )
        if (delta.to === 'rolled_back') {
          invariant(
            transaction.heldResourceIds.length === 0 &&
            transaction.waitingForResourceId === null,
            'victim must release locks and leave its queue before rollback completes',
          )
        }
        if (delta.to === 'completed') {
          invariant(
            delta.commitTs !== undefined &&
            Number.isSafeInteger(delta.commitTs) &&
            delta.commitTs > transaction.startTs,
            'completed transaction requires a newer commit_ts',
          )
        } else {
          invariant(delta.commitTs === undefined, 'commit_ts is only valid at completion')
        }
        return {
          ...transaction,
          status: delta.to,
          ...(delta.commitTs === undefined ? {} : { commitTs: delta.commitTs }),
        }
      },
    )
  } else if (delta.kind === 'lock_owner') {
    const resource = resourceById(state, delta.resourceId)
    invariant(resource.regionId === delta.regionId, 'resource Region mismatch')
    invariant(
      resource.leaderStoreId === delta.leaderStoreId,
      'resource leader mismatch',
    )
    const transaction = transactionById(state, delta.transactionId)
    if (delta.action === 'acquire') {
      invariant(transaction.status === 'active', 'only an active transaction can acquire')
      invariant(resource.holderTransactionId === null, 'resource already has a holder')
      invariant(resource.waiterTransactionIds.length === 0, 'queued resource must be woken before acquire')
      invariant(
        !transaction.heldResourceIds.includes(resource.id),
        'transaction already holds resource',
      )
      resources = replaceResource(resources, resource.id, (candidate) => ({
        ...candidate,
        holderTransactionId: transaction.transactionId,
      }))
      transactions = replaceTransaction(
        transactions,
        transaction.transactionId,
        (candidate) => ({
          ...candidate,
          heldResourceIds: [...candidate.heldResourceIds, resource.id].sort(),
        }),
      )
    } else {
      invariant(
        resource.holderTransactionId === transaction.transactionId,
        'only the holder can release a resource',
      )
      invariant(resource.waiterTransactionIds.length === 0, 'release must resolve the wait queue atomically')
      invariant(
        !waitForEdges.some((edge) =>
          edge.resourceId === resource.id &&
          edge.holderTransactionId === transaction.transactionId),
        'release must remove holder wait-for edges first',
      )
      resources = replaceResource(resources, resource.id, (candidate) => ({
        ...candidate,
        holderTransactionId: null,
      }))
      transactions = replaceTransaction(
        transactions,
        transaction.transactionId,
        (candidate) => ({
          ...candidate,
          heldResourceIds: candidate.heldResourceIds.filter((id) => id !== resource.id),
        }),
      )
    }
  } else if (delta.kind === 'lock_wait_queue') {
    const resource = resourceById(state, delta.resourceId)
    const transaction = transactionById(state, delta.transactionId)
    if (delta.action === 'enqueue') {
      invariant(transaction.status === 'active', 'only an active transaction can enqueue')
      invariant(resource.holderTransactionId !== null, 'cannot wait for an unheld resource')
      invariant(
        resource.holderTransactionId !== transaction.transactionId,
        'holder cannot wait for its own resource',
      )
      invariant(transaction.waitingForResourceId === null, 'transaction already waits')
      invariant(
        !resource.waiterTransactionIds.includes(transaction.transactionId),
        'transaction is already queued',
      )
      invariant(
        delta.position === resource.waiterTransactionIds.length,
        'queue position must append deterministically',
      )
      resources = replaceResource(resources, resource.id, (candidate) => ({
        ...candidate,
        waiterTransactionIds: [
          ...candidate.waiterTransactionIds,
          transaction.transactionId,
        ],
      }))
      transactions = replaceTransaction(
        transactions,
        transaction.transactionId,
        (candidate) => ({
          ...candidate,
          status: 'waiting',
          waitingForResourceId: resource.id,
        }),
      )
    } else {
      const position = resource.waiterTransactionIds.indexOf(transaction.transactionId)
      invariant(position >= 0, 'transaction is not queued')
      invariant(position === delta.position, 'dequeue position mismatch')
      invariant(
        !waitForEdges.some((edge) =>
          edge.resourceId === resource.id &&
          edge.waiterTransactionId === transaction.transactionId),
        'dequeue must remove the waiter edge first',
      )
      resources = replaceResource(resources, resource.id, (candidate) => ({
        ...candidate,
        waiterTransactionIds: candidate.waiterTransactionIds.filter(
          (id) => id !== transaction.transactionId,
        ),
      }))
      transactions = replaceTransaction(
        transactions,
        transaction.transactionId,
        (candidate) => ({
          ...candidate,
          status: candidate.status === 'waiting' ? 'active' : candidate.status,
          waitingForResourceId: null,
        }),
      )
    }
  } else if (delta.kind === 'wait_for_edge') {
    const resource = resourceById(state, delta.resourceId)
    invariant(resource.regionId === delta.regionId, 'wait-for edge Region mismatch')
    if (delta.action === 'add') {
      invariant(
        resource.holderTransactionId === delta.holderTransactionId,
        'edge holder must own the resource',
      )
      invariant(
        resource.waiterTransactionIds.includes(delta.waiterTransactionId),
        'edge waiter must be queued',
      )
      invariant(
        !waitForEdges.some((edge) => edge.id === delta.edgeId),
        `duplicate edge ${delta.edgeId}`,
      )
      waitForEdges = [
        ...waitForEdges,
        {
          id: delta.edgeId,
          waiterTransactionId: delta.waiterTransactionId,
          holderTransactionId: delta.holderTransactionId,
          resourceId: delta.resourceId,
          regionId: delta.regionId,
        },
      ]
    } else {
      const edge = waitForEdges.find((candidate) => candidate.id === delta.edgeId)
      invariant(edge, `unknown edge ${delta.edgeId}`)
      invariant(
        edge.waiterTransactionId === delta.waiterTransactionId &&
        edge.holderTransactionId === delta.holderTransactionId &&
        edge.resourceId === delta.resourceId,
        'removed edge does not match the registered edge',
      )
      waitForEdges = waitForEdges.filter((candidate) => candidate.id !== delta.edgeId)
    }
  } else if (delta.kind === 'deadlock_state') {
    if (delta.action === 'detect') {
      invariant(deadlock === null, 'a deadlock is already recorded')
      invariant(
        delta.cycleTransactionIds.length >= 3 &&
        delta.cycleTransactionIds[0] ===
          delta.cycleTransactionIds[delta.cycleTransactionIds.length - 1],
        'deadlock cycle must be closed',
      )
      for (let index = 0; index < delta.cycleTransactionIds.length - 1; index++) {
        invariant(
          waitForEdges.some((edge) =>
            edge.waiterTransactionId === delta.cycleTransactionIds[index] &&
            edge.holderTransactionId === delta.cycleTransactionIds[index + 1]),
          'deadlock cycle must correspond to current wait-for edges',
        )
      }
      deadlock = {
        id: delta.deadlockId,
        cycleTransactionIds: [...delta.cycleTransactionIds],
        victimTransactionId: null,
        selectionPolicy: delta.selectionPolicy,
        retryable: false,
        resolution: 'detected',
        clientErrorCode: null,
        clientErrorTransactionId: null,
      }
    } else {
      invariant(deadlock?.id === delta.deadlockId, 'deadlock id mismatch')
      if (delta.action === 'select_victim') {
        invariant(delta.victimTransactionId !== null, 'victim is required')
        invariant(
          delta.victimTransactionId === deadlock.cycleTransactionIds[0],
          'MODEL POLICY victim must be the cycle-closing waiter',
        )
        deadlock = {
          ...deadlock,
          victimTransactionId: delta.victimTransactionId,
          resolution: 'rolling_back',
        }
      } else {
        deadlock = {
          ...deadlock,
          resolution: 'resolved',
        }
      }
    }
  } else if (delta.kind === 'deadlock_client_error') {
    invariant(deadlock?.id === delta.deadlockId, 'deadlock id mismatch')
    invariant(deadlock.resolution === 'resolved', 'client error requires a resolved deadlock')
    invariant(deadlock.victimTransactionId === delta.transactionId, 'client error must target the victim')
    invariant(deadlock.clientErrorCode === null, 'client error was already returned')
    invariant(delta.errorCode === 1213 && delta.retryable === false, 'deadlock client error must be non-retryable Error 1213')
    const victim = transactionById(state, delta.transactionId)
    invariant(victim.status === 'rolled_back', 'client error requires a rolled-back victim')
    deadlock = {
      ...deadlock,
      clientErrorCode: delta.errorCode,
      clientErrorTransactionId: delta.transactionId,
    }
  } else if (delta.kind === 'application_retry') {
    if (delta.action === 'schedule') {
      invariant(applicationRetry === null, 'application retry already exists')
      const failed = transactionById(state, delta.retryOfTransactionId)
      invariant(failed.status === 'rolled_back', 'only a rolled-back transaction can retry')
      invariant(failed.clientId === delta.clientId, 'application retry client mismatch')
      invariant(
        Number.isSafeInteger(delta.fixedBackoffMs) && delta.fixedBackoffMs > 0,
        'fixed application backoff must be a positive integer',
      )
      applicationRetry = {
        source: 'application',
        clientId: delta.clientId,
        retryOfTransactionId: delta.retryOfTransactionId,
        fixedBackoffMs: delta.fixedBackoffMs,
        status: 'backoff',
        newTransactionId: null,
      }
    } else {
      invariant(applicationRetry !== null, 'application retry is not scheduled')
      invariant(
        applicationRetry.retryOfTransactionId === delta.retryOfTransactionId,
        'application retry target mismatch',
      )
      invariant(applicationRetry.clientId === delta.clientId, 'application retry client mismatch')
      invariant(
        applicationRetry.fixedBackoffMs === delta.fixedBackoffMs,
        'application retry backoff mismatch',
      )
      if (delta.action === 'begin') {
        invariant(delta.newTransactionId !== null, 'new transaction id is required')
        invariant(
          delta.newTransactionId !== delta.retryOfTransactionId &&
          !transactions.some((transaction) =>
            transaction.transactionId === delta.newTransactionId),
          'application retry requires a fresh transaction id',
        )
        applicationRetry = {
          ...applicationRetry,
          status: 'started',
          newTransactionId: delta.newTransactionId,
        }
      } else {
        invariant(
          delta.newTransactionId === applicationRetry.newTransactionId,
          'completed retry transaction mismatch',
        )
        const completed = transactionById(state, String(delta.newTransactionId))
        invariant(completed.status === 'completed', 'retry must commit before completion')
        applicationRetry = {
          ...applicationRetry,
          status: 'completed',
        }
      }
    }
  }

  validateLockGraph(transactions, resources, waitForEdges)
  return freezeLockLabSnapshot({
    detectorScope: state.detectorScope,
    detectorLeaderStoreId: state.detectorLeaderStoreId,
    transactions,
    resources,
    waitForEdges,
    deadlock,
    applicationRetry,
  })
}

/**
 * Detects a cycle caused by one newly registered waiter -> holder edge.
 * Neighbor ordering is lexical so equal logical state always yields the same
 * cycle. The returned sequence repeats the victim candidate at the end.
 */
export function detectWaitForCycle(
  edges: readonly TraceWaitForEdgeSnapshot[],
  closingEdgeId: string,
): readonly string[] | null {
  const closing = edges.find((edge) => edge.id === closingEdgeId)
  invariant(closing, `unknown closing edge ${closingEdgeId}`)
  const cycleClosingEdge = closing

  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const neighbors = adjacency.get(edge.waiterTransactionId) ?? []
    neighbors.push(edge.holderTransactionId)
    adjacency.set(edge.waiterTransactionId, neighbors)
  }
  for (const neighbors of adjacency.values()) neighbors.sort()

  const path: string[] = []
  const visited = new Set<string>()
  function visit(transactionId: string): boolean {
    path.push(transactionId)
    if (transactionId === cycleClosingEdge.waiterTransactionId) return true
    if (visited.has(transactionId)) {
      path.pop()
      return false
    }
    visited.add(transactionId)
    for (const neighbor of adjacency.get(transactionId) ?? []) {
      if (visit(neighbor)) return true
    }
    path.pop()
    return false
  }

  return visit(cycleClosingEdge.holderTransactionId)
    ? Object.freeze([cycleClosingEdge.waiterTransactionId, ...path])
    : null
}

/**
 * TiCity MODEL POLICY: choose the smallest start_ts, then use a lexical
 * transaction-id tie break. This is deterministic teaching behavior, not a
 * claim that TiDB or TiKV guarantees this fairness rule.
 */
export function selectWaiterByStartTs(
  state: TraceLockLabSnapshot,
  resourceId: string,
): string | null {
  const resource = resourceById(state, resourceId)
  const waiters = resource.waiterTransactionIds
    .map((transactionId) => transactionById(state, transactionId))
    .sort((left, right) =>
      left.startTs - right.startTs ||
      left.transactionId.localeCompare(right.transactionId))
  return waiters[0]?.transactionId ?? null
}
