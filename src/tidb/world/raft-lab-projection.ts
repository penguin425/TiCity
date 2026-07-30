/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Pure model-to-renderer projection for the one-Region Raft failure Lab.
 */

import type {
  TraceEvent,
  TraceRaftLabPeerSnapshot,
  TraceRaftLabPhase,
  TraceRaftLabSnapshot,
  StoreId,
} from '../model/types'
import type {
  RaftLabClientRetryProjection,
  RaftLabElectionEdgeProjection,
  RaftLabLogCellProjection,
  RaftLabLogCellState,
  RaftLabOptionalPeerSlot,
  RaftLabPdObservationProjection,
  RaftLabPeerProjection,
  RaftLabPeerShape,
  RaftLabPhase,
  RaftLabProjection,
} from './raft-lab'

export interface RaftLabProjectionOptions {
  readonly inspect: boolean
  readonly reducedMotion: boolean
  readonly pulse?: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function phaseFromSnapshot(phase: TraceRaftLabPhase): RaftLabPhase {
  switch (phase) {
    case 'healthy':
    case 'requesting':
      return 'baseline'
    case 'leader_lost':
      return 'store-failure'
    case 'backoff':
      return 'client-retry'
    case 'timeout':
      return 'heartbeat-timeout'
    case 'pre_vote':
      return 'pre-vote'
    case 'vote':
      return 'election'
    case 'elected':
      return 'leader-elected'
    case 'confirming':
      return 'log-replication'
    case 'routing':
    case 'serving':
      return 'client-retry'
    case 'complete':
      return 'complete'
  }
}

function hasDelta(
  event: TraceEvent,
  kind: 'raft_propose' | 'raft_persist' | 'raft_commit' | 'raft_apply',
): boolean {
  return event.deltas?.some((delta) => delta.kind === kind) ?? false
}

function phaseFor(
  event: TraceEvent,
  snapshot: TraceRaftLabSnapshot,
): RaftLabPhase {
  if (hasDelta(event, 'raft_apply')) return 'apply'
  if (hasDelta(event, 'raft_commit')) return 'quorum-commit'
  if (
    hasDelta(event, 'raft_propose') ||
    hasDelta(event, 'raft_persist')
  ) {
    return 'log-replication'
  }
  return phaseFromSnapshot(snapshot.phase)
}

function peerShape(peer: TraceRaftLabPeerSnapshot): RaftLabPeerShape {
  if (!peer.healthy || peer.role === 'offline') return 'offline'
  switch (peer.role) {
    case 'pre_candidate':
      return 'double-ring'
    case 'candidate':
      return 'diamond'
    case 'leader':
      return 'crown'
    case 'follower':
      return 'ring'
  }
}

function rendererRole(
  peer: TraceRaftLabPeerSnapshot,
): RaftLabPeerProjection['role'] {
  switch (peer.role) {
    case 'pre_candidate':
      return 'pre-candidate'
    case 'offline':
      return 'follower'
    case 'candidate':
    case 'follower':
    case 'leader':
      return peer.role
  }
}

function targetLogIndex(snapshot: TraceRaftLabSnapshot): number {
  if (snapshot.log.index !== null) return snapshot.log.index
  let maximum = 0
  for (const peer of snapshot.peers) {
    maximum = Math.max(maximum, peer.lastLogIndex)
  }
  return maximum
}

function previousTerm(snapshot: TraceRaftLabSnapshot): number {
  const oldLeader = snapshot.peers.find(
    (peer) => peer.storeId === snapshot.oldLeaderStoreId,
  )
  if (oldLeader) return oldLeader.currentTerm
  let minimum = Number.POSITIVE_INFINITY
  for (const peer of snapshot.peers) {
    if (peer.currentTerm > 0) minimum = Math.min(minimum, peer.currentTerm)
  }
  return Number.isFinite(minimum) ? minimum : 0
}

function logCellState(
  snapshot: TraceRaftLabSnapshot,
  peer: TraceRaftLabPeerSnapshot,
  index: number,
): RaftLabLogCellState {
  if (!peer.healthy) return 'unavailable'
  if (
    peer.appliedIndex >= index ||
    (
      snapshot.log.index === index &&
      snapshot.log.appliedStoreIds.includes(peer.storeId)
    )
  ) {
    return 'applied'
  }
  if (
    peer.commitIndex >= index ||
    (
      snapshot.log.index === index &&
      snapshot.log.committed &&
      peer.lastLogIndex >= index
    )
  ) {
    return 'committed'
  }
  if (
    peer.lastLogIndex >= index ||
    (
      snapshot.log.index === index &&
      snapshot.log.persistedStoreIds.includes(peer.storeId)
    )
  ) {
    return 'persisted'
  }
  return 'absent'
}

function logCell(
  snapshot: TraceRaftLabSnapshot,
  peer: TraceRaftLabPeerSnapshot,
  index: number,
  target: number,
  oldTerm: number,
): RaftLabLogCellProjection {
  let term = 0
  if (snapshot.log.index === index && snapshot.log.term !== null) {
    term = snapshot.log.term
  } else if (index === peer.lastLogIndex) {
    term = peer.lastLogTerm
  } else if (index < target) {
    /*
     * The model deliberately retains only a three-cell teaching window.
     * Its immediate predecessor belongs to the pre-failover term; older
     * compacted history is not reconstructed.
     */
    term = oldTerm
  }
  return {
    index,
    term,
    state: logCellState(snapshot, peer, index),
  }
}

function hiddenPeer(): RaftLabPeerProjection {
  const hiddenCell = (): RaftLabLogCellProjection => ({
    index: -1,
    term: 0,
    state: 'absent',
  })
  return {
    visible: false,
    storeId: '',
    role: 'follower',
    health: 'up',
    shape: 'ring',
    term: 0,
    matchIndex: 0,
    commitIndex: 0,
    appliedIndex: 0,
    votedForStoreId: null,
    previousLeader: false,
    log: [hiddenCell(), hiddenCell(), hiddenCell()],
  }
}

function peerProjection(
  snapshot: TraceRaftLabSnapshot,
  peer: TraceRaftLabPeerSnapshot | undefined,
  target: number,
  oldTerm: number,
): RaftLabPeerProjection {
  if (!peer) return hiddenPeer()
  const firstIndex = Math.max(0, target - 1)
  return {
    visible: true,
    storeId: peer.storeId,
    role: rendererRole(peer),
    health: peer.healthy ? 'up' : 'down',
    shape: peerShape(peer),
    term: peer.currentTerm,
    matchIndex: peer.matchIndex,
    commitIndex: peer.commitIndex,
    appliedIndex: peer.appliedIndex,
    votedForStoreId: peer.votedFor,
    previousLeader: peer.storeId === snapshot.oldLeaderStoreId,
    log: [
      logCell(snapshot, peer, firstIndex, target, oldTerm),
      logCell(snapshot, peer, firstIndex + 1, target, oldTerm),
      logCell(snapshot, peer, firstIndex + 2, target, oldTerm),
    ],
  }
}

function orderedPeers(
  snapshot: TraceRaftLabSnapshot,
): readonly TraceRaftLabPeerSnapshot[] {
  return [...snapshot.peers]
    .sort((left, right) => left.storeId.localeCompare(right.storeId))
    .slice(0, 3)
}

function slotForStore(
  peers: readonly TraceRaftLabPeerSnapshot[],
  storeId: StoreId | null,
): RaftLabOptionalPeerSlot {
  if (storeId === null) return -1
  const slot = peers.findIndex((peer) => peer.storeId === storeId)
  return slot >= 0 && slot < 3 ? slot as 0 | 1 | 2 : -1
}

function emptyEdge(): RaftLabElectionEdgeProjection {
  return {
    visible: false,
    id: '',
    stage: 'prevote',
    status: 'request',
    fromPeer: -1,
    toPeer: -1,
  }
}

function electionEdges(
  event: TraceEvent,
  peers: readonly TraceRaftLabPeerSnapshot[],
): RaftLabProjection['electionEdges'] {
  const edges: RaftLabElectionEdgeProjection[] = []
  const edgeKind:
    | readonly ['prevote' | 'vote', 'request' | 'granted']
    | null = (() => {
      switch (event.kind) {
        case 'raft_pre_vote_request':
          return ['prevote', 'request'] as const
        case 'raft_pre_vote_granted':
          return ['prevote', 'granted'] as const
        case 'raft_vote_request':
          return ['vote', 'request'] as const
        case 'raft_vote_granted':
          return ['vote', 'granted'] as const
        default:
          return null
      }
    })()
  if (edgeKind !== null) {
    const fromPeer = peers.findIndex((peer) => peer.storeId === event.source)
    const toPeer = peers.findIndex((peer) => peer.storeId === event.target)
    if (
      fromPeer >= 0 &&
      fromPeer < 3 &&
      toPeer >= 0 &&
      toPeer < 3 &&
      fromPeer !== toPeer
    ) {
      edges.push({
        visible: true,
        id: `${edgeKind[0]}:${edgeKind[1]}:${event.source}:${event.target}`,
        stage: edgeKind[0],
        status: edgeKind[1],
        fromPeer: fromPeer as 0 | 1 | 2,
        toPeer: toPeer as 0 | 1 | 2,
      })
    }
  }
  return [
    edges[0] ?? emptyEdge(),
    edges[1] ?? emptyEdge(),
    edges[2] ?? emptyEdge(),
    edges[3] ?? emptyEdge(),
    edges[4] ?? emptyEdge(),
    edges[5] ?? emptyEdge(),
  ]
}

function clientRetry(
  snapshot: TraceRaftLabSnapshot,
  peers: readonly TraceRaftLabPeerSnapshot[],
): RaftLabClientRetryProjection {
  const request = snapshot.request
  const status: RaftLabClientRetryProjection['status'] = (() => {
    switch (request.status) {
      case 'idle':
      case 'sent':
        return 'idle'
      case 'transport_error':
        return 'failed'
      case 'backoff':
        return 'backoff'
      case 'retrying':
        return 'rerouted'
      case 'served':
      case 'completed':
        return 'succeeded'
    }
  })()
  const retried =
    request.attempt >= 2 ||
    request.status === 'retrying' ||
    request.status === 'served' ||
    request.status === 'completed'
  return {
    visible: request.status !== 'idle',
    source: 'tidb_tikv_client',
    internal: true,
    attempt: request.attempt,
    status,
    reason:
      request.status === 'transport_error' ||
      request.status === 'backoff' ||
      retried
        ? 'transport_error'
        : 'none',
    previousTargetPeer: slotForStore(peers, snapshot.oldLeaderStoreId),
    targetPeer: retried
      ? slotForStore(
        peers,
        request.cachedLeaderStoreId ?? snapshot.leaderStoreId,
      )
      : -1,
  }
}

function pdObservation(
  snapshot: TraceRaftLabSnapshot,
  peers: readonly TraceRaftLabPeerSnapshot[],
): RaftLabPdObservationProjection {
  const visible =
    snapshot.pd.observedLeaderStoreId !== null ||
    snapshot.pd.routeLookupCompleted
  return {
    visible,
    status: snapshot.pd.routeLookupCompleted
      ? 'observed'
      : visible
        ? 'pending'
        : 'idle',
    leaderPeer: slotForStore(peers, snapshot.pd.observedLeaderStoreId),
    electionAuthority: false,
  }
}

function relevantAcknowledgements(snapshot: TraceRaftLabSnapshot): number {
  if (snapshot.log.index !== null) return snapshot.log.persistedStoreIds.length
  if (
    snapshot.election.phase === 'vote' ||
    snapshot.election.phase === 'elected'
  ) {
    return snapshot.election.votesGranted.length
  }
  if (snapshot.election.phase === 'pre_vote') {
    return snapshot.election.preVotesGranted.length
  }
  return snapshot.liveVoterCount
}

export function projectRaftLab(
  event: TraceEvent | null,
  options: RaftLabProjectionOptions,
): RaftLabProjection | null {
  const snapshot = event?.snapshot?.raftLab
  if (!event || !snapshot) return null

  const peers = orderedPeers(snapshot)
  const target = targetLogIndex(snapshot)
  const oldTerm = previousTerm(snapshot)
  const projectedPeers = [
    peerProjection(snapshot, peers[0], target, oldTerm),
    peerProjection(snapshot, peers[1], target, oldTerm),
    peerProjection(snapshot, peers[2], target, oldTerm),
  ] as const
  let term = oldTerm
  for (const peer of snapshot.peers) term = Math.max(term, peer.currentTerm)
  if (snapshot.log.term !== null) term = Math.max(term, snapshot.log.term)

  return {
    mode: options.inspect ? 'inspect' : 'overview',
    phase: phaseFor(event, snapshot),
    reducedMotion: options.reducedMotion,
    pulse: clamp(options.pulse ?? 0, 0, 1),
    regionId: snapshot.regionId,
    previousTerm: oldTerm,
    term,
    previousLeaderPeer: slotForStore(peers, snapshot.oldLeaderStoreId),
    leaderPeer: slotForStore(peers, snapshot.leaderStoreId),
    candidatePeer: slotForStore(
      peers,
      snapshot.election.candidateStoreId,
    ),
    peers: projectedPeers,
    electionEdges: electionEdges(event, peers),
    quorum: {
      acknowledgements: relevantAcknowledgements(snapshot),
      required: snapshot.quorum,
      available: snapshot.liveVoterCount >= snapshot.quorum,
      committed: snapshot.log.committed,
    },
    clientRetry: clientRetry(snapshot, peers),
    pdObservation: pdObservation(snapshot, peers),
  }
}
