/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Pure exact-event model-to-renderer projection for the fixed-capacity
 * TiFlash MPP Lab. No state is reconstructed from labels or event kinds.
 */

import type {
  TiFlashMppStoreId,
  TraceEvent,
  TraceTiFlashMppLearnerSnapshot,
  TraceTiFlashMppReadGate,
  TraceTiFlashMppTaskId,
  TraceTiFlashMppTaskSnapshot,
  TraceTiFlashMppTunnelId,
  TraceTiFlashMppTunnelSnapshot,
} from '../model/types'
import {
  TIFLASH_MPP_LAB_FRAGMENT_CAPACITY,
  TIFLASH_MPP_LAB_LEARNER_CAPACITY,
  TIFLASH_MPP_LAB_STORE_CAPACITY,
  TIFLASH_MPP_LAB_TASK_CAPACITY,
  TIFLASH_MPP_LAB_TUNNEL_CAPACITY,
} from './tiflash-mpp-lab'
import type {
  TiFlashMppLabFragment,
  TiFlashMppLabGateReason,
  TiFlashMppLabGateState,
  TiFlashMppLabLearnerProjection,
  TiFlashMppLabProjection,
  TiFlashMppLabStoreProjection,
  TiFlashMppLabTaskProjection,
  TiFlashMppLabTunnelLocality,
  TiFlashMppLabTunnelProjection,
  TiFlashMppLabTunnelState,
} from './tiflash-mpp-lab'

export interface TiFlashMppLabProjectionOptions {
  readonly inspect: boolean
  readonly reducedMotion: boolean
  readonly pulse?: number
}

const STORE_ORDER = Object.freeze([
  'tiflash-1',
  'tiflash-2',
] as const)

const TASK_ORDER = Object.freeze([
  'task-scan-1',
  'task-scan-2',
  'task-final-1',
  'task-final-2',
] as const)

const TUNNEL_ORDER = Object.freeze([
  'tunnel-hash-1',
  'tunnel-hash-2',
  'tunnel-hash-3',
  'tunnel-hash-4',
  'tunnel-root-1',
  'tunnel-root-2',
] as const)

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function storeSlot(storeId: TiFlashMppStoreId): 0 | 1 {
  return storeId === 'tiflash-1' ? 0 : 1
}

function hiddenStore(): TiFlashMppLabStoreProjection {
  return {
    visible: false,
    storeId: '',
    active: false,
  }
}

function hiddenLearner(): TiFlashMppLabLearnerProjection {
  return {
    visible: false,
    regionId: -1,
    leaderStoreId: '',
    tiflashStoreId: '',
    storeSlot: -1,
    replicaAvailable: false,
    leaderCommitIndex: 0,
    replicatedIndex: 0,
    appliedIndex: 0,
    requestedReadIndex: null,
    gateState: 'idle',
    gateReason: 'not_requested',
  }
}

function hiddenTask(): TiFlashMppLabTaskProjection {
  return {
    visible: false,
    id: '',
    taskId: '',
    storeId: '',
    storeSlot: -1,
    fragment: 'scan_partial',
    stage: 'idle',
    regionIds: [],
  }
}

function hiddenTunnel(): TiFlashMppLabTunnelProjection {
  return {
    visible: false,
    id: '',
    senderTaskId: '',
    receiverTaskId: '',
    senderTaskSlot: -1,
    receiverTaskSlot: -1,
    locality: 'local',
    state: 'idle',
  }
}

function gateState(
  gate: TraceTiFlashMppReadGate,
  provisioningAvailable: boolean,
): TiFlashMppLabGateState {
  if (!provisioningAvailable) return 'unavailable'
  switch (gate) {
    case 'read_index_requested':
      return 'requesting'
    case 'read_index_returned':
    case 'waiting_applied':
      return 'waiting'
    case 'ready':
    case 'mvcc_checked':
    case 'validated':
      return 'ready'
    case 'unchecked':
    case 'safe_ts_checked':
      return 'idle'
  }
}

function gateReason(
  learner: TraceTiFlashMppLearnerSnapshot,
  provisioningAvailable: boolean,
): TiFlashMppLabGateReason {
  if (!provisioningAvailable) return 'replica_unavailable'
  /*
   * Preserve the model-owned gate decision before deriving an explanatory
   * fallback from indexes. In particular, a safe-TS fast path intentionally
   * has no required ReadIndex and must not be mislabeled "not requested."
   */
  if (learner.gateReason !== null) return learner.gateReason
  if (learner.requiredReadIndex === null) {
    return learner.readGate === 'read_index_requested'
      ? 'read_index_pending'
      : 'not_requested'
  }
  if (learner.learnerAppliedIndex < learner.requiredReadIndex) {
    return 'applied_index_behind'
  }
  return 'applied_index_ready'
}

function projectLearner(
  learner: TraceTiFlashMppLearnerSnapshot,
  provisioningAvailable: boolean,
): TiFlashMppLabLearnerProjection {
  return {
    visible: true,
    regionId: learner.regionId,
    leaderStoreId: learner.leaderStoreId,
    tiflashStoreId: learner.learnerStoreId,
    storeSlot: storeSlot(learner.learnerStoreId),
    replicaAvailable: provisioningAvailable,
    leaderCommitIndex: learner.leaderCommitIndex,
    replicatedIndex: learner.learnerReceivedIndex,
    appliedIndex: learner.learnerAppliedIndex,
    requestedReadIndex: learner.requiredReadIndex,
    gateState: gateState(learner.readGate, provisioningAvailable),
    gateReason: gateReason(learner, provisioningAvailable),
  }
}

function fragmentFor(
  task: TraceTiFlashMppTaskSnapshot,
): TiFlashMppLabFragment {
  return task.fragmentId === 'fragment-scan'
    ? 'scan_partial'
    : 'final_aggregate'
}

function projectTask(
  task: TraceTiFlashMppTaskSnapshot,
): TiFlashMppLabTaskProjection {
  return {
    visible: true,
    id: task.id,
    taskId: task.id,
    storeId: task.storeId,
    storeSlot: storeSlot(task.storeId),
    fragment: fragmentFor(task),
    stage: task.stage,
    regionIds: task.regionIds,
  }
}

function taskSlot(
  taskId: TraceTiFlashMppTaskId | 'tidb-root',
): -1 | 0 | 1 | 2 | 3 {
  if (taskId === 'tidb-root') return -1
  const index = TASK_ORDER.indexOf(taskId)
  return index >= 0 ? index as 0 | 1 | 2 | 3 : -1
}

function tunnelLocality(
  tunnel: TraceTiFlashMppTunnelSnapshot,
): TiFlashMppLabTunnelLocality {
  switch (tunnel.locality) {
    case 'local':
    case 'remote':
      return tunnel.locality
    case 'root':
      return 'tidb_root'
  }
}

function tunnelState(
  status: TraceTiFlashMppTunnelSnapshot['status'],
): TiFlashMppLabTunnelState {
  switch (status) {
    case 'registered':
      return 'registered'
    case 'sent':
      return 'streaming'
    case 'received':
      return 'finished'
  }
}

function projectTunnel(
  tunnel: TraceTiFlashMppTunnelSnapshot,
): TiFlashMppLabTunnelProjection {
  return {
    visible: true,
    id: tunnel.id,
    senderTaskId: tunnel.sourceTaskId,
    receiverTaskId: tunnel.targetTaskId,
    senderTaskSlot: taskSlot(tunnel.sourceTaskId),
    receiverTaskSlot: taskSlot(tunnel.targetTaskId),
    locality: tunnelLocality(tunnel),
    state: tunnelState(tunnel.status),
  }
}

/**
 * Converts only snapshot.tiflashMppLab into stable renderer slots. The legacy
 * aggregate TiFlash state and human-facing labels cannot activate this Lab.
 */
export function projectTiFlashMppLab(
  event: TraceEvent | null,
  options: TiFlashMppLabProjectionOptions,
): TiFlashMppLabProjection | null {
  const snapshot = event?.snapshot?.tiflashMppLab
  if (!event || !snapshot) return null

  const tasksById = new Map(
    snapshot.tasks.map((task) => [task.id, task] as const),
  )

  const stores = STORE_ORDER.map((storeId) => {
    const store = snapshot.stores.find(
      (candidate) => candidate.storeId === storeId,
    )
    if (!store) return hiddenStore()
    const active = snapshot.tasks.some(
      (task) => task.storeId === storeId && task.stage !== 'built',
    )
    return {
      visible: true,
      storeId: store.storeId,
      active,
    }
  })

  const learners = [...snapshot.learners]
    .sort((left, right) => left.regionId - right.regionId)
    .slice(0, TIFLASH_MPP_LAB_LEARNER_CAPACITY)
    .map((learner) =>
      projectLearner(
        learner,
        snapshot.configuration.provisioningAvailable,
      ))
  while (learners.length < TIFLASH_MPP_LAB_LEARNER_CAPACITY) {
    learners.push(hiddenLearner())
  }

  const tasks = TASK_ORDER.map((taskId) => {
    const task = tasksById.get(taskId)
    return task ? projectTask(task) : hiddenTask()
  })

  const tunnelsById = new Map(
    snapshot.tunnels.map((tunnel) => [tunnel.id, tunnel] as const),
  )
  const tunnels = TUNNEL_ORDER.map((tunnelId) => {
    const tunnel = tunnelsById.get(tunnelId)
    return tunnel
      ? projectTunnel(tunnel)
      : hiddenTunnel()
  })

  const overflow = {
    stores: Math.max(0, snapshot.stores.length - TIFLASH_MPP_LAB_STORE_CAPACITY),
    learners: Math.max(
      0,
      snapshot.learners.length - TIFLASH_MPP_LAB_LEARNER_CAPACITY,
    ),
    fragments: Math.max(
      0,
      snapshot.fragments.length - TIFLASH_MPP_LAB_FRAGMENT_CAPACITY,
    ),
    tasks: Math.max(0, snapshot.tasks.length - TIFLASH_MPP_LAB_TASK_CAPACITY),
    tunnels: Math.max(
      0,
      snapshot.tunnels.length - TIFLASH_MPP_LAB_TUNNEL_CAPACITY,
    ),
  }

  return {
    mode: options.inspect ? 'inspect' : 'overview',
    phase: snapshot.phase,
    reducedMotion: options.reducedMotion,
    pulse: clamp(options.pulse ?? 0, 0, 1),
    stores: stores as unknown as TiFlashMppLabProjection['stores'],
    learners: learners as unknown as TiFlashMppLabProjection['learners'],
    tasks: tasks as unknown as TiFlashMppLabProjection['tasks'],
    tunnels: tunnels as unknown as TiFlashMppLabProjection['tunnels'],
    root: {
      visible:
        snapshot.accessPathSelected ||
        snapshot.result.stage !== 'idle',
      taskId: 'tidb-root',
      state: snapshot.result.stage,
    },
    overflow: {
      ...overflow,
      total:
        overflow.stores +
        overflow.learners +
        overflow.fragments +
        overflow.tasks +
        overflow.tunnels,
    },
  }
}
