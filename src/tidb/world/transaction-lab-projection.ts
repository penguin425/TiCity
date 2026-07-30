// SPDX-License-Identifier: Apache-2.0

import type {
  TraceEvent,
  TraceRegionSnapshot,
  TraceStateSnapshot,
} from '../model/types'
import type {
  TransactionLabApplyState,
  TransactionLabKeyRole,
  TransactionLabLockState,
  TransactionLabMutationState,
  TransactionLabPeerLogState,
  TransactionLabPhase,
  TransactionLabProjection,
  TransactionLabRegionProjection,
} from './transaction-lab'

export interface TransactionLabProjectionOptions {
  readonly inspect: boolean
  readonly reducedMotion: boolean
  readonly pulse?: number
}

function phaseFor(
  snapshot: TraceStateSnapshot,
  event: TraceEvent,
): TransactionLabPhase {
  const stage = snapshot.transaction?.stage
  if (event.status === 'failed' || stage === 'rolled_back') return 'failed'
  switch (stage) {
    case 'locking':
      return 'locking'
    case 'prewriting':
    case 'prewritten':
      return 'prewrite'
    case 'committing_primary':
    case 'client_acknowledged':
      return 'commit-primary'
    case 'committing_secondary':
      return 'secondary-cleanup'
    case 'complete':
      return 'complete'
    default:
      return 'idle'
  }
}

function keyRole(region: TraceRegionSnapshot): TransactionLabKeyRole {
  return region.mvcc.primary ? 'primary' : 'secondary'
}

function peerLog(
  region: TraceRegionSnapshot,
  peerIndex: number,
): TransactionLabPeerLogState {
  const peer = region.peers[peerIndex]
  if (!peer?.healthy) return 'unavailable'
  const proposed = region.proposedIndex
  if (proposed === null) return 'idle'
  if (peer.appliedIndex >= proposed) return 'applied'
  if (
    region.commitIndex >= proposed &&
    peer.matchIndex >= proposed
  ) {
    return 'committed'
  }
  return region.persistedStoreIds.includes(peer.storeId)
    ? 'appended'
    : 'idle'
}

function applyState(region: TraceRegionSnapshot): TransactionLabApplyState {
  if (region.proposedIndex === null) return 'idle'
  if (region.appliedIndex >= region.proposedIndex) return 'applied'
  return region.commitIndex >= region.proposedIndex ? 'ready' : 'idle'
}

function lockState(region: TraceRegionSnapshot): TransactionLabLockState {
  if (region.pessimisticLock !== null) return 'pessimistic-memory'
  return region.mvcc.lockCf === 'prewrite' ? 'prewrite' : 'none'
}

function mutationState(region: TraceRegionSnapshot): TransactionLabMutationState {
  if (region.mvcc.writeCf === 'commit') return 'committed'
  if (
    region.mvcc.defaultCf === 'value' ||
    region.mvcc.lockCf === 'prewrite'
  ) {
    return 'prewriting'
  }
  return region.pessimisticLock === null ? 'empty' : 'buffered'
}

function regionProjection(
  region: TraceRegionSnapshot,
): TransactionLabRegionProjection {
  const leaderPeer = Math.max(
    0,
    region.peers.findIndex((peer) => peer.storeId === region.leaderStoreId),
  ) as 0 | 1 | 2
  return {
    id: `region-${region.regionId}`,
    keyRole: keyRole(region),
    leaderPeer,
    peers: [
      {
        storeId: region.peers[0]?.storeId ?? 'tikv-1',
        log: peerLog(region, 0),
      },
      {
        storeId: region.peers[1]?.storeId ?? 'tikv-2',
        log: peerLog(region, 1),
      },
      {
        storeId: region.peers[2]?.storeId ?? 'tikv-3',
        log: peerLog(region, 2),
      },
    ],
    quorumAcks: region.acknowledgements,
    apply: applyState(region),
    lock: lockState(region),
    mvcc: {
      lock: region.mvcc.lockCf === 'prewrite' ? 'pending' : 'empty',
      default: region.mvcc.defaultCf === 'value'
        ? region.mvcc.commitTs === null ? 'pending' : 'committed'
        : 'empty',
      write: region.mvcc.writeCf === 'commit' ? 'committed' : 'empty',
    },
  }
}

export function projectTransactionLab(
  event: TraceEvent | null,
  options: TransactionLabProjectionOptions,
): TransactionLabProjection | null {
  const snapshot = event?.snapshot
  if (
    !event ||
    !snapshot ||
    snapshot.lockLab !== undefined ||
    snapshot.raftLab !== undefined ||
    snapshot.protocolLab !== undefined ||
    snapshot.regions.length !== 2
  ) {
    return null
  }
  const first = regionProjection(snapshot.regions[0])
  const second = regionProjection(snapshot.regions[1])
  return {
    mode: options.inspect ? 'inspect' : 'overview',
    phase: phaseFor(snapshot, event),
    reducedMotion: options.reducedMotion,
    coordinatorActive:
      snapshot.transaction !== null &&
      snapshot.transaction.stage !== 'complete' &&
      snapshot.transaction.stage !== 'rolled_back',
    tso: {
      active: event.domain === 'tso',
      pulse: Math.max(0, Math.min(1, options.pulse ?? 0)),
    },
    mutations: [
      { keyRole: first.keyRole, state: mutationState(snapshot.regions[0]) },
      { keyRole: second.keyRole, state: mutationState(snapshot.regions[1]) },
    ],
    regions: [first, second],
  }
}
