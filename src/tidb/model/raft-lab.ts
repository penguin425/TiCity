/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure model-4 Region Raft failure state. This reducer owns one representative
 * Region's peer roles, election, current-term empty entry, and TiDB-internal
 * Region request retry. It has no renderer or browser imports.
 */

import type {
  StoreId,
  TraceRaftLabPeerSnapshot,
  TraceRaftLabSnapshot,
  TraceStateDelta,
} from './types'

export type RaftLabDelta = Extract<
  TraceStateDelta,
  {
    kind:
      | 'raft_peer_health'
      | 'raft_election_timeout'
      | 'raft_pre_vote'
      | 'raft_term_vote'
      | 'raft_leader_elected'
      | 'raft_region_request'
      | 'raft_pd_state'
      | 'raft_propose'
      | 'raft_persist'
      | 'raft_commit'
      | 'raft_apply'
  }
>

export interface RaftLabPeerDefinition {
  storeId: StoreId
  lastLogIndex: number
  lastLogTerm: number
  commitIndex: number
  appliedIndex: number
}

const RAFT_LAB_QUORUM = 2 as const
const ELECTION_TIMEOUT_TICKS = 10 as const
const MAX_ELECTION_TIMEOUT_TICKS = 20 as const
const TEACHING_ELAPSED_TICKS = 13 as const
const CANDIDATE_POLICY =
  'lowest_live_up_to_date_store_id_model_policy' as const

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Raft Lab invariant: ${message}`)
}

function compareLog(
  left: Pick<TraceRaftLabPeerSnapshot, 'lastLogTerm' | 'lastLogIndex'>,
  right: Pick<TraceRaftLabPeerSnapshot, 'lastLogTerm' | 'lastLogIndex'>,
): number {
  if (left.lastLogTerm !== right.lastLogTerm) {
    return left.lastLogTerm - right.lastLogTerm
  }
  return left.lastLogIndex - right.lastLogIndex
}

function peerById(
  state: TraceRaftLabSnapshot,
  storeId: StoreId,
): TraceRaftLabPeerSnapshot {
  const peer = state.peers.find((candidate) => candidate.storeId === storeId)
  invariant(peer, `unknown peer ${storeId}`)
  return peer
}

function replacePeer(
  peers: readonly TraceRaftLabPeerSnapshot[],
  storeId: StoreId,
  update: (
    peer: TraceRaftLabPeerSnapshot,
  ) => TraceRaftLabPeerSnapshot,
): readonly TraceRaftLabPeerSnapshot[] {
  let found = false
  const next = peers.map((peer) => {
    if (peer.storeId !== storeId) return peer
    found = true
    return update(peer)
  })
  invariant(found, `unknown peer ${storeId}`)
  return next
}

function uniqueStoreIds(
  values: readonly StoreId[],
  label: string,
): void {
  invariant(new Set(values).size === values.length, `${label} must be unique`)
}

function validateRaftLab(state: TraceRaftLabSnapshot): void {
  invariant(state.peers.length === 3, 'the representative Region requires three voters')
  uniqueStoreIds(state.peers.map((peer) => peer.storeId), 'peer ids')
  invariant(state.quorum === RAFT_LAB_QUORUM, 'three voters require a two-voter quorum')

  const healthyPeers = state.peers.filter((peer) => peer.healthy)
  invariant(
    state.liveVoterCount === healthyPeers.length,
    'live voter count must match peer health',
  )

  let leaderCount = 0
  for (const peer of state.peers) {
    invariant(
      Number.isSafeInteger(peer.currentTerm) && peer.currentTerm > 0,
      `${peer.storeId} current term must be positive`,
    )
    invariant(
      Number.isSafeInteger(peer.lastLogIndex) && peer.lastLogIndex >= 0,
      `${peer.storeId} last log index must be non-negative`,
    )
    invariant(
      Number.isSafeInteger(peer.lastLogTerm) && peer.lastLogTerm > 0,
      `${peer.storeId} last log term must be positive`,
    )
    invariant(
      peer.appliedIndex <= peer.commitIndex &&
        peer.commitIndex <= peer.lastLogIndex &&
        peer.matchIndex <= peer.lastLogIndex,
      `${peer.storeId} must satisfy applied <= commit <= lastLog and match <= lastLog`,
    )
    if (peer.healthy) {
      invariant(peer.role !== 'offline', `${peer.storeId} is healthy but offline`)
    } else {
      invariant(peer.role === 'offline', `${peer.storeId} is down but not offline`)
    }
    if (peer.role === 'leader') {
      leaderCount++
      invariant(peer.healthy, 'the leader must be healthy')
      invariant(
        state.leaderStoreId === peer.storeId,
        'leader role and leaderStoreId disagree',
      )
    }
    if (peer.votedFor !== null) {
      invariant(
        state.peers.some((candidate) => candidate.storeId === peer.votedFor),
        `${peer.storeId} voted for an unknown peer`,
      )
    }
  }
  invariant(
    state.leaderStoreId === null ? leaderCount === 0 : leaderCount === 1,
    'the Region must have zero or one leader',
  )
  if (state.failedStoreId !== null) {
    invariant(
      !peerById(state, state.failedStoreId).healthy,
      'failed store must own an unhealthy peer',
    )
  }

  uniqueStoreIds(state.election.preVotesGranted, 'pre-votes')
  uniqueStoreIds(state.election.votesGranted, 'votes')
  for (const storeId of [
    ...state.election.preVotesGranted,
    ...state.election.votesGranted,
  ]) {
    invariant(peerById(state, storeId).healthy, `${storeId} cannot vote while down`)
  }
  if (state.election.candidateStoreId !== null) {
    invariant(
      peerById(state, state.election.candidateStoreId).healthy,
      'candidate must be healthy',
    )
  }
  if (state.election.phase === 'elected') {
    invariant(
      state.election.votesGranted.length >= state.quorum,
      'a leader requires a voting quorum',
    )
    invariant(
      state.leaderStoreId === state.election.candidateStoreId,
      'elected candidate must become leader',
    )
  }

  uniqueStoreIds(state.log.persistedStoreIds, 'persisted stores')
  uniqueStoreIds(state.log.appliedStoreIds, 'applied stores')
  if (state.log.entryKind === null) {
    invariant(
      state.log.index === null &&
        state.log.term === null &&
        state.log.persistedStoreIds.length === 0 &&
        !state.log.committed &&
        state.log.appliedStoreIds.length === 0,
      'an empty log projection cannot carry progress',
    )
  } else {
    invariant(
      state.log.index !== null && state.log.term !== null,
      'the no-op requires an index and term',
    )
    for (const storeId of state.log.persistedStoreIds) {
      const peer = peerById(state, storeId)
      invariant(peer.healthy, `${storeId} cannot persist while down`)
      invariant(
        peer.lastLogIndex >= state.log.index &&
          peer.lastLogTerm === state.log.term,
        `${storeId} persisted state does not contain the no-op`,
      )
    }
    if (state.log.committed) {
      invariant(
        state.log.persistedStoreIds.length >= state.quorum,
        'the no-op cannot commit before two voters persist it',
      )
    }
    for (const storeId of state.log.appliedStoreIds) {
      invariant(state.log.committed, `${storeId} cannot apply an uncommitted entry`)
      invariant(
        state.log.persistedStoreIds.includes(storeId),
        `${storeId} cannot apply an entry it did not persist`,
      )
      invariant(
        peerById(state, storeId).appliedIndex >= state.log.index,
        `${storeId} applied state lags the recorded no-op`,
      )
    }
  }

  invariant(state.request.source === 'tidb_internal', 'retry owner must remain TiDB')
  invariant(!state.request.clientVisibleError, 'the modeled recovery cannot expose an error')
  invariant(state.request.backoffMs >= 0, 'backoff must be non-negative')
  if (state.request.attempt === 2) {
    invariant(
      state.request.cacheState === 'refreshed',
      'attempt 2 requires refreshed Region routing',
    )
    invariant(
      state.request.cachedLeaderStoreId === state.leaderStoreId,
      'attempt 2 must target the elected leader',
    )
  }
  if (state.request.status === 'completed') {
    invariant(state.phase === 'complete', 'completed request requires complete phase')
    invariant(state.request.attempt === 2, 'completion must follow the internal retry')
    invariant(state.leaderStoreId !== null, 'completion requires a leader')
    invariant(
      state.log.index !== null &&
        state.log.appliedStoreIds.includes(state.leaderStoreId),
      'the new leader must apply its current-term no-op before completion',
    )
  }
  if (state.pd.routeLookupCompleted) {
    invariant(
      state.pd.observedLeaderStoreId === state.leaderStoreId &&
        state.leaderStoreId !== null,
      'PD routing metadata must name the elected leader',
    )
  }
}

export function isRaftLabDelta(delta: TraceStateDelta): delta is RaftLabDelta {
  return delta.kind === 'raft_peer_health' ||
    delta.kind === 'raft_election_timeout' ||
    delta.kind === 'raft_pre_vote' ||
    delta.kind === 'raft_term_vote' ||
    delta.kind === 'raft_leader_elected' ||
    delta.kind === 'raft_region_request' ||
    delta.kind === 'raft_pd_state' ||
    delta.kind === 'raft_propose' ||
    delta.kind === 'raft_persist' ||
    delta.kind === 'raft_commit' ||
    delta.kind === 'raft_apply'
}

export function freezeRaftLabSnapshot(
  snapshot: TraceRaftLabSnapshot,
): TraceRaftLabSnapshot {
  return Object.freeze({
    ...snapshot,
    peers: Object.freeze(snapshot.peers.map((peer) => Object.freeze({ ...peer }))),
    election: Object.freeze({
      ...snapshot.election,
      preVotesGranted: Object.freeze([...snapshot.election.preVotesGranted]),
      votesGranted: Object.freeze([...snapshot.election.votesGranted]),
    }),
    log: Object.freeze({
      ...snapshot.log,
      persistedStoreIds: Object.freeze([...snapshot.log.persistedStoreIds]),
      appliedStoreIds: Object.freeze([...snapshot.log.appliedStoreIds]),
    }),
    request: Object.freeze({ ...snapshot.request }),
    pd: Object.freeze({ ...snapshot.pd }),
  })
}

export function createRaftLabState(
  regionId: number,
  oldLeaderStoreId: StoreId,
  definitions: readonly RaftLabPeerDefinition[],
  logicalRequestId = 'region-request-1',
  backoffMs = 80,
): TraceRaftLabSnapshot {
  invariant(Number.isSafeInteger(regionId) && regionId >= 0, 'Region id must be non-negative')
  invariant(definitions.length === 3, 'exactly three voter definitions are required')
  uniqueStoreIds(definitions.map((peer) => peer.storeId), 'peer definitions')
  invariant(
    definitions.some((peer) => peer.storeId === oldLeaderStoreId),
    'old leader must be a configured voter',
  )
  invariant(logicalRequestId.length > 0, 'logical request id is required')
  invariant(Number.isFinite(backoffMs) && backoffMs >= 0, 'backoff must be non-negative')

  const peers = definitions.map((definition): TraceRaftLabPeerSnapshot => {
    invariant(
      definition.appliedIndex <= definition.commitIndex &&
        definition.commitIndex <= definition.lastLogIndex,
      `${definition.storeId} initial indexes are inconsistent`,
    )
    invariant(definition.lastLogTerm > 0, 'initial log term must be positive')
    return {
      ...definition,
      role: definition.storeId === oldLeaderStoreId ? 'leader' : 'follower',
      healthy: true,
      currentTerm: definition.lastLogTerm,
      votedFor: null,
      matchIndex: definition.lastLogIndex,
    }
  })

  const snapshot = freezeRaftLabSnapshot({
    regionId,
    phase: 'healthy',
    oldLeaderStoreId,
    leaderStoreId: oldLeaderStoreId,
    failedStoreId: null,
    quorum: RAFT_LAB_QUORUM,
    liveVoterCount: peers.length,
    peers,
    election: {
      phase: 'idle',
      candidateStoreId: null,
      preVotesGranted: [],
      votesGranted: [],
      prevoteEnabled: true,
      configuredElectionTimeoutTicks: ELECTION_TIMEOUT_TICKS,
      configuredMaxElectionTimeoutTicks: MAX_ELECTION_TIMEOUT_TICKS,
      elapsedTicks: TEACHING_ELAPSED_TICKS,
      candidatePolicy: CANDIDATE_POLICY,
    },
    log: {
      entryKind: null,
      index: null,
      term: null,
      persistedStoreIds: [],
      committed: false,
      appliedStoreIds: [],
    },
    request: {
      logicalRequestId,
      source: 'tidb_internal',
      attempt: 0,
      cachedLeaderStoreId: oldLeaderStoreId,
      cacheState: 'cached',
      status: 'idle',
      backoffMs,
      clientVisibleError: false,
    },
    pd: {
      role: 'observer_and_routing_only',
      observedLeaderStoreId: null,
      routeLookupCompleted: false,
    },
  })
  validateRaftLab(snapshot)
  return snapshot
}

export function reduceRaftLabState(
  state: TraceRaftLabSnapshot,
  delta: RaftLabDelta,
): TraceRaftLabSnapshot {
  invariant(delta.regionId === state.regionId, 'delta Region does not match the lab')
  let peers = state.peers
  let phase = state.phase
  let leaderStoreId = state.leaderStoreId
  let failedStoreId = state.failedStoreId
  let election = state.election
  let log = state.log
  let request = state.request
  let pd = state.pd

  if (delta.kind === 'raft_peer_health') {
    invariant(delta.from === 'up' && delta.to === 'down', 'only an up-to-down failure is modeled')
    const peer = peerById(state, delta.storeId)
    invariant(peer.healthy, `${delta.storeId} is already down`)
    invariant(failedStoreId === null, 'the vertical slice models one failed store')
    peers = replacePeer(peers, delta.storeId, (candidate) => ({
      ...candidate,
      healthy: false,
      role: 'offline',
    }))
    failedStoreId = delta.storeId
    if (leaderStoreId === delta.storeId) leaderStoreId = null
    phase = 'leader_lost'
  } else if (delta.kind === 'raft_election_timeout') {
    invariant(leaderStoreId === null, 'election timeout requires no live leader')
    invariant(
      delta.configuredElectionTimeoutTicks === ELECTION_TIMEOUT_TICKS &&
        delta.configuredMaxElectionTimeoutTicks === MAX_ELECTION_TIMEOUT_TICKS &&
        delta.elapsedTicks === TEACHING_ELAPSED_TICKS &&
        delta.candidatePolicy === CANDIDATE_POLICY,
      'timeout and candidate policy must remain the documented teaching contract',
    )
    const eligible = peers
      .filter((peer) => peer.healthy)
      .filter((peer) => !peers.some((other) =>
        other.healthy && compareLog(other, peer) > 0))
      .sort((left, right) => left.storeId.localeCompare(right.storeId))
    invariant(eligible.length >= state.quorum, 'election requires a live quorum')
    invariant(
      eligible[0]?.storeId === delta.candidateStoreId,
      'candidate must follow the explicit deterministic model policy',
    )
    phase = 'timeout'
    election = {
      ...election,
      phase: 'timeout',
      candidateStoreId: delta.candidateStoreId,
    }
  } else if (delta.kind === 'raft_pre_vote') {
    invariant(election.candidateStoreId === delta.candidateStoreId, 'pre-vote candidate changed')
    const candidate = peerById(state, delta.candidateStoreId)
    const voter = peerById(state, delta.voterStoreId)
    invariant(candidate.healthy && voter.healthy, 'only live voters can pre-vote')
    const nextTerm = Math.max(...peers.map((peer) => peer.currentTerm)) + 1
    invariant(delta.prospectiveTerm === nextTerm, 'pre-vote must probe the next term')
    if (delta.action === 'start') {
      invariant(election.phase === 'timeout', 'pre-vote must follow election timeout')
      invariant(
        delta.voterStoreId === delta.candidateStoreId,
        'the pre-candidate begins with its own pre-vote',
      )
      peers = replacePeer(peers, delta.candidateStoreId, (peer) => ({
        ...peer,
        role: 'pre_candidate',
      }))
      phase = 'pre_vote'
      election = {
        ...election,
        phase: 'pre_vote',
        preVotesGranted: [delta.candidateStoreId],
      }
    } else {
      invariant(election.phase === 'pre_vote', 'pre-vote grant requires pre-vote phase')
      invariant(
        !election.preVotesGranted.includes(delta.voterStoreId),
        `${delta.voterStoreId} already pre-voted`,
      )
      invariant(
        compareLog(candidate, voter) >= 0,
        'a voter cannot endorse a less up-to-date candidate',
      )
      election = {
        ...election,
        preVotesGranted: [...election.preVotesGranted, delta.voterStoreId],
      }
    }
  } else if (delta.kind === 'raft_term_vote') {
    invariant(election.candidateStoreId === delta.candidateStoreId, 'vote candidate changed')
    const candidate = peerById(state, delta.candidateStoreId)
    const voter = peerById(state, delta.voterStoreId)
    invariant(candidate.healthy && voter.healthy, 'only live voters can vote')
    if (delta.action === 'become_candidate') {
      invariant(
        election.phase === 'pre_vote' &&
          election.preVotesGranted.length >= state.quorum,
        'candidate term can advance only after pre-vote quorum',
      )
      invariant(
        delta.voterStoreId === delta.candidateStoreId,
        'candidate must cast its own first vote',
      )
      invariant(
        delta.term === Math.max(...peers.map((peer) => peer.currentTerm)) + 1,
        'candidate term must advance monotonically',
      )
      peers = replacePeer(peers, delta.candidateStoreId, (peer) => ({
        ...peer,
        role: 'candidate',
        currentTerm: delta.term,
        votedFor: delta.candidateStoreId,
      }))
      phase = 'vote'
      election = {
        ...election,
        phase: 'vote',
        votesGranted: [delta.candidateStoreId],
      }
    } else {
      invariant(election.phase === 'vote', 'vote grant requires candidate phase')
      invariant(
        delta.term === candidate.currentTerm,
        'voter and candidate must agree on the election term',
      )
      invariant(
        voter.votedFor === null || voter.currentTerm < delta.term,
        `${voter.storeId} already voted in this term`,
      )
      invariant(
        !election.votesGranted.includes(delta.voterStoreId),
        `${delta.voterStoreId} already granted a vote`,
      )
      invariant(
        compareLog(candidate, voter) >= 0,
        'a voter cannot elect a less up-to-date candidate',
      )
      peers = replacePeer(peers, delta.voterStoreId, (peer) => ({
        ...peer,
        currentTerm: delta.term,
        votedFor: delta.candidateStoreId,
      }))
      election = {
        ...election,
        votesGranted: [...election.votesGranted, delta.voterStoreId],
      }
    }
  } else if (delta.kind === 'raft_leader_elected') {
    invariant(leaderStoreId === null, 'a previous leader is still active')
    invariant(
      delta.oldLeaderStoreId === state.oldLeaderStoreId &&
        delta.newLeaderStoreId === election.candidateStoreId,
      'leader transition does not match the election',
    )
    uniqueStoreIds(delta.votesGranted, 'leader election votes')
    invariant(
      delta.quorum === state.quorum &&
        delta.votesGranted.length >= state.quorum &&
        delta.votesGranted.every((storeId) =>
          election.votesGranted.includes(storeId)),
      'leader election requires recorded two-of-three votes',
    )
    const candidate = peerById(state, delta.newLeaderStoreId)
    invariant(candidate.currentTerm === delta.term, 'leader term must match candidate term')
    peers = peers.map((peer): TraceRaftLabPeerSnapshot => ({
      ...peer,
      role: !peer.healthy
        ? 'offline'
        : peer.storeId === delta.newLeaderStoreId
          ? 'leader'
          : 'follower',
      currentTerm: peer.healthy ? Math.max(peer.currentTerm, delta.term) : peer.currentTerm,
    }))
    leaderStoreId = delta.newLeaderStoreId
    phase = 'elected'
    election = {
      ...election,
      phase: 'elected',
      votesGranted: [...delta.votesGranted],
    }
  } else if (delta.kind === 'raft_propose') {
    invariant(delta.operation === 'leader_noop', 'Raft Lab proposes only the leader no-op')
    invariant(leaderStoreId !== null, 'no-op proposal requires an elected leader')
    const leader = peerById(state, leaderStoreId)
    invariant(election.phase === 'elected', 'no-op proposal must follow election')
    invariant(delta.term === leader.currentTerm, 'no-op term must match leader term')
    invariant(delta.index === leader.lastLogIndex + 1, 'no-op index must extend the leader log')
    invariant(log.entryKind === null, 'the vertical slice models one no-op entry')
    peers = replacePeer(peers, leaderStoreId, (peer) => ({
      ...peer,
      lastLogIndex: delta.index,
      lastLogTerm: delta.term ?? peer.lastLogTerm,
      matchIndex: delta.index,
    }))
    phase = 'confirming'
    log = {
      entryKind: 'leader_noop',
      index: delta.index,
      term: delta.term ?? leader.currentTerm,
      persistedStoreIds: [],
      committed: false,
      appliedStoreIds: [],
    }
  } else if (delta.kind === 'raft_persist') {
    invariant(
      log.entryKind === 'leader_noop' &&
        log.index === delta.index &&
        log.term === delta.term,
      'persist must match the proposed no-op',
    )
    uniqueStoreIds(delta.storeIds, 'persist delta stores')
    invariant(delta.storeIds.length > 0, 'at least one peer must persist')
    for (const storeId of delta.storeIds) {
      const peer = peerById({ ...state, peers } as TraceRaftLabSnapshot, storeId)
      invariant(peer.healthy, `${storeId} cannot persist while down`)
      peers = replacePeer(peers, storeId, (candidate) => ({
        ...candidate,
        lastLogIndex: delta.index,
        lastLogTerm: delta.term ?? candidate.lastLogTerm,
        matchIndex: delta.index,
      }))
    }
    log = {
      ...log,
      persistedStoreIds: [...delta.storeIds],
    }
  } else if (delta.kind === 'raft_commit') {
    invariant(
      log.entryKind === 'leader_noop' &&
        log.index === delta.index &&
        log.term === delta.term,
      'commit must match the proposed no-op',
    )
    invariant(
      delta.quorum === state.quorum &&
        delta.acknowledgements === log.persistedStoreIds.length &&
        delta.acknowledgements >= state.quorum,
      'commit requires the recorded two-voter persistence quorum',
    )
    for (const storeId of log.persistedStoreIds) {
      peers = replacePeer(peers, storeId, (peer) => ({
        ...peer,
        commitIndex: Math.max(peer.commitIndex, delta.index),
      }))
    }
    log = { ...log, committed: true }
  } else if (delta.kind === 'raft_apply') {
    invariant(
      log.entryKind === 'leader_noop' &&
        log.committed &&
        log.index === delta.index &&
        log.term === delta.term,
      'apply requires the committed no-op',
    )
    const stores = delta.storeIds ?? (leaderStoreId === null ? [] : [leaderStoreId])
    uniqueStoreIds(stores, 'apply delta stores')
    invariant(stores.length > 0, 'apply requires at least one store')
    for (const storeId of stores) {
      invariant(
        log.persistedStoreIds.includes(storeId),
        `${storeId} cannot apply before persistence`,
      )
      invariant(
        !log.appliedStoreIds.includes(storeId),
        `${storeId} already applied this no-op`,
      )
      peers = replacePeer(peers, storeId, (peer) => ({
        ...peer,
        appliedIndex: Math.max(peer.appliedIndex, delta.index),
      }))
    }
    log = {
      ...log,
      appliedStoreIds: [...log.appliedStoreIds, ...stores],
    }
  } else if (delta.kind === 'raft_pd_state') {
    invariant(delta.role === 'observer_and_routing_only', 'PD cannot vote in Region Raft')
    invariant(
      leaderStoreId === delta.leaderStoreId,
      'PD metadata must name the current Region leader',
    )
    if (delta.action === 'observe_leader') {
      invariant(
        leaderStoreId !== null &&
          log.appliedStoreIds.includes(leaderStoreId),
        'PD observation follows new-leader confirmation',
      )
      pd = { ...pd, observedLeaderStoreId: delta.leaderStoreId }
    } else {
      invariant(
        pd.observedLeaderStoreId === delta.leaderStoreId,
        'routing lookup requires the observed leader metadata',
      )
      pd = { ...pd, routeLookupCompleted: true }
      phase = 'routing'
    }
  } else if (delta.kind === 'raft_region_request') {
    invariant(
      delta.logicalRequestId === request.logicalRequestId &&
        delta.source === request.source &&
        delta.backoffMs === request.backoffMs &&
        !delta.clientVisibleError,
      'request delta must preserve the same internal retry contract',
    )
    if (delta.action === 'send') {
      invariant(request.status === 'idle' && delta.attempt === 1, 'attempt 1 must start once')
      invariant(
        delta.targetStoreId === state.oldLeaderStoreId,
        'attempt 1 must use the cached old leader',
      )
      request = { ...request, attempt: 1, status: 'sent' }
      phase = 'requesting'
    } else if (delta.action === 'transport_error') {
      invariant(
        request.status === 'sent' &&
          request.attempt === 1 &&
          delta.attempt === 1 &&
          delta.targetStoreId === state.oldLeaderStoreId &&
          failedStoreId === state.oldLeaderStoreId &&
          leaderStoreId === null,
        'transport error must follow old-leader failure before Raft proposal',
      )
      request = { ...request, status: 'transport_error' }
      phase = 'leader_lost'
    } else if (delta.action === 'backoff') {
      invariant(
        request.status === 'transport_error' &&
          delta.attempt === 1 &&
          delta.targetStoreId === null,
        'backoff must follow the retryable transport error',
      )
      request = {
        ...request,
        cachedLeaderStoreId: null,
        cacheState: 'invalidated',
        status: 'backoff',
      }
      phase = 'backoff'
    } else if (delta.action === 'refresh') {
      invariant(
        request.status === 'backoff' &&
          request.cacheState === 'invalidated' &&
          pd.routeLookupCompleted &&
          leaderStoreId !== null &&
          delta.targetStoreId === leaderStoreId,
        'cache refresh requires PD routing metadata for the elected leader',
      )
      request = {
        ...request,
        cachedLeaderStoreId: leaderStoreId,
        cacheState: 'refreshed',
      }
      phase = 'routing'
    } else if (delta.action === 'retry') {
      invariant(
        request.status === 'backoff' &&
          request.cacheState === 'refreshed' &&
          delta.attempt === 2 &&
          delta.targetStoreId === leaderStoreId &&
          leaderStoreId !== null &&
          log.appliedStoreIds.includes(leaderStoreId),
        'attempt 2 requires a confirmed elected leader and refreshed cache',
      )
      request = { ...request, attempt: 2, status: 'retrying' }
      phase = 'serving'
    } else if (delta.action === 'serve') {
      invariant(
        request.status === 'retrying' &&
          request.attempt === 2 &&
          delta.attempt === 2 &&
          delta.targetStoreId === leaderStoreId &&
          leaderStoreId !== null &&
          log.appliedStoreIds.includes(leaderStoreId),
        'the new leader can serve only after applying its current-term no-op',
      )
      request = { ...request, status: 'served' }
      phase = 'serving'
    } else {
      invariant(
        request.status === 'served' &&
          request.attempt === 2 &&
          delta.attempt === 2 &&
          delta.targetStoreId === leaderStoreId,
        'client completion must follow the served internal retry',
      )
      request = { ...request, status: 'completed' }
      phase = 'complete'
    }
  }

  const next = freezeRaftLabSnapshot({
    ...state,
    phase,
    leaderStoreId,
    failedStoreId,
    liveVoterCount: peers.filter((peer) => peer.healthy).length,
    peers,
    election,
    log,
    request,
    pd,
  })
  validateRaftLab(next)
  return next
}

