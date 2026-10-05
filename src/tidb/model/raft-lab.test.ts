/*
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest'

import {
  createRaftLabState,
  reduceRaftLabState,
  type RaftLabDelta,
} from './raft-lab'
import type { TraceRaftLabSnapshot } from './types'

function initial(): TraceRaftLabSnapshot {
  return createRaftLabState(
    0,
    'tikv-1',
    (['tikv-1', 'tikv-2', 'tikv-3'] as const).map((storeId) => ({
      storeId,
      lastLogIndex: 42,
      lastLogTerm: 1,
      commitIndex: 42,
      appliedIndex: 42,
    })),
  )
}

function electionState(startingState = initial()): TraceRaftLabSnapshot {
  let state = startingState
  const nextTerm = state.peers.find((peer) => peer.storeId === 'tikv-2')!.currentTerm + 1
  const apply = (delta: RaftLabDelta): void => {
    state = reduceRaftLabState(state, delta)
  }
  apply({
    kind: 'raft_region_request',
    action: 'send',
    regionId: 0,
    logicalRequestId: 'region-request-1',
    attempt: 1,
    targetStoreId: 'tikv-1',
    backoffMs: 80,
    source: 'tidb_internal',
    clientVisibleError: false,
  })
  apply({
    kind: 'raft_peer_health',
    regionId: 0,
    storeId: 'tikv-1',
    from: 'up',
    to: 'down',
  })
  apply({
    kind: 'raft_region_request',
    action: 'transport_error',
    regionId: 0,
    logicalRequestId: 'region-request-1',
    attempt: 1,
    targetStoreId: 'tikv-1',
    backoffMs: 80,
    source: 'tidb_internal',
    clientVisibleError: false,
  })
  apply({
    kind: 'raft_region_request',
    action: 'backoff',
    regionId: 0,
    logicalRequestId: 'region-request-1',
    attempt: 1,
    targetStoreId: null,
    backoffMs: 80,
    source: 'tidb_internal',
    clientVisibleError: false,
  })
  apply({
    kind: 'raft_election_timeout',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    configuredElectionTimeoutTicks: 10,
    configuredMaxElectionTimeoutTicks: 20,
    elapsedTicks: 13,
    candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
  })
  apply({
    kind: 'raft_pre_vote',
    action: 'start',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    voterStoreId: 'tikv-2',
    prospectiveTerm: nextTerm,
  })
  apply({
    kind: 'raft_pre_vote',
    action: 'grant',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    voterStoreId: 'tikv-3',
    prospectiveTerm: nextTerm,
  })
  apply({
    kind: 'raft_term_vote',
    action: 'become_candidate',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    voterStoreId: 'tikv-2',
    term: nextTerm,
  })
  apply({
    kind: 'raft_term_vote',
    action: 'grant',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    voterStoreId: 'tikv-3',
    term: nextTerm,
  })
  return state
}

function electedState(startingState = initial()): TraceRaftLabSnapshot {
  const state = electionState(startingState)
  return reduceRaftLabState(state, {
    kind: 'raft_leader_elected',
    regionId: 0,
    oldLeaderStoreId: 'tikv-1',
    newLeaderStoreId: 'tikv-2',
    term: state.peers.find((peer) => peer.storeId === 'tikv-2')!.currentTerm,
    votesGranted: ['tikv-2', 'tikv-3'],
    quorum: 2,
  })
}

function proposedState(): TraceRaftLabSnapshot {
  return reduceRaftLabState(electedState(), {
    kind: 'raft_propose',
    regionId: 0,
    index: 43,
    operation: 'leader_noop',
    term: 2,
  })
}

describe('Raft Lab pure state', () => {
  it('starts with one leader, three voters, and frozen baseline indexes', () => {
    const state = initial()
    expect(state).toMatchObject({
      regionId: 0,
      phase: 'healthy',
      leaderStoreId: 'tikv-1',
      quorum: 2,
      liveVoterCount: 3,
    })
    expect(state.peers).toHaveLength(3)
    expect(state.peers.filter((peer) => peer.role === 'leader'))
      .toEqual([expect.objectContaining({ storeId: 'tikv-1' })])
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.peers)).toBe(true)
    expect(Object.isFrozen(state.election)).toBe(true)
    expect(Object.isFrozen(state.log)).toBe(true)
  })

  it('rejects a candidate that violates the explicit deterministic policy', () => {
    let state = initial()
    state = reduceRaftLabState(state, {
      kind: 'raft_peer_health',
      regionId: 0,
      storeId: 'tikv-1',
      from: 'up',
      to: 'down',
    })
    expect(() => reduceRaftLabState(state, {
      kind: 'raft_election_timeout',
      regionId: 0,
      candidateStoreId: 'tikv-3',
      configuredElectionTimeoutTicks: 10,
      configuredMaxElectionTimeoutTicks: 20,
      elapsedTicks: 13,
      candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
    })).toThrow(/candidate must follow/)
  })

  it('requires a recorded two-voter election quorum', () => {
    const state = electionState()
    expect(() => reduceRaftLabState(state, {
      kind: 'raft_leader_elected',
      regionId: 0,
      oldLeaderStoreId: 'tikv-1',
      newLeaderStoreId: 'tikv-2',
      term: 2,
      votesGranted: ['tikv-2'],
      quorum: 2,
    })).toThrow(/two-of-three votes/)
  })

  it('lets a behind live voter elect an up-to-date candidate', () => {
    let state = electionState(createRaftLabState(
      0,
      'tikv-1',
      (['tikv-1', 'tikv-2', 'tikv-3'] as const).map((storeId) => ({
        storeId,
        lastLogIndex: storeId === 'tikv-3' ? 41 : 42,
        lastLogTerm: 1,
        commitIndex: storeId === 'tikv-3' ? 41 : 42,
        appliedIndex: storeId === 'tikv-3' ? 41 : 42,
      })),
    ))

    expect(state.liveVoterCount).toBe(2)
    expect(state.election.preVotesGranted).toEqual(['tikv-2', 'tikv-3'])
    expect(state.election.votesGranted).toEqual(['tikv-2', 'tikv-3'])
    state = reduceRaftLabState(state, {
      kind: 'raft_leader_elected',
      regionId: 0,
      oldLeaderStoreId: 'tikv-1',
      newLeaderStoreId: 'tikv-2',
      term: 2,
      votesGranted: ['tikv-2', 'tikv-3'],
      quorum: 2,
    })

    expect(state.leaderStoreId).toBe('tikv-2')
    expect(state.peers.find((peer) => peer.storeId === 'tikv-3'))
      .toMatchObject({ role: 'follower', lastLogIndex: 41 })
    expect(state.log.committed).toBe(false)
  })

  it('keeps the current election term independent of the last-entry term', () => {
    const state = electedState(createRaftLabState(0, 'tikv-1',
      (['tikv-1', 'tikv-2', 'tikv-3'] as const).map((storeId) => ({
        storeId,
        currentTerm: 5,
        lastLogTerm: 1,
        lastLogIndex: 42,
        commitIndex: 42,
        appliedIndex: 42,
      })),
    ))
    expect(state.peers.find((peer) => peer.storeId === 'tikv-2'))
      .toMatchObject({ currentTerm: 6, lastLogTerm: 1, lastLogIndex: 42 })
    expect(state.peers.find((peer) => peer.storeId === 'tikv-1')?.currentTerm).toBe(5)
  })

  it('prefers a newer last-entry term over a longer uncommitted log', () => {
    let state = electedState(createRaftLabState(0, 'tikv-1',
      (['tikv-1', 'tikv-2', 'tikv-3'] as const).map((storeId) => ({
        storeId,
        currentTerm: 2,
        lastLogTerm: storeId === 'tikv-2' ? 2 : 1,
        lastLogIndex: storeId === 'tikv-2' ? 41 : 42,
        commitIndex: 40,
        appliedIndex: 40,
      })),
    ))
    expect(state.leaderStoreId).toBe('tikv-2')
    expect(state.peers.find((peer) => peer.storeId === 'tikv-2'))
      .toMatchObject({ currentTerm: 3, lastLogIndex: 41, lastLogTerm: 2 })
    state = reduceRaftLabState(state, {
      kind: 'raft_propose', regionId: 0, index: 42, term: 3, operation: 'leader_noop',
    })
    state = reduceRaftLabState(state, {
      kind: 'raft_persist', regionId: 0, index: 42, term: 3, storeIds: ['tikv-2', 'tikv-3'],
    })
    expect(state.peers.find((peer) => peer.storeId === 'tikv-3'))
      .toMatchObject({ lastLogIndex: 42, lastLogTerm: 3, matchIndex: 42, commitIndex: 40, appliedIndex: 40 })
  })

  it('rejects replacement of a follower entry that is already committed', () => {
    const proposed = proposedState()
    const state: TraceRaftLabSnapshot = {
      ...proposed,
      peers: proposed.peers.map((peer) => peer.storeId === 'tikv-3'
        ? { ...peer, lastLogIndex: 43, commitIndex: 43, matchIndex: 43 }
        : peer),
    }
    expect(() => reduceRaftLabState(state, {
      kind: 'raft_persist', regionId: 0, index: 43, term: 2, storeIds: ['tikv-3'],
    })).toThrow(/committed prefix/)
    expect(state.peers.find((peer) => peer.storeId === 'tikv-3'))
      .toMatchObject({ commitIndex: 43, lastLogTerm: 1 })
  })

  it('rejects a stale local campaign instead of inventing knowledge of another voter term', () => {
    const state = createRaftLabState(0, 'tikv-1',
      (['tikv-1', 'tikv-2', 'tikv-3'] as const).map((storeId) => ({
        storeId,
        currentTerm: storeId === 'tikv-3' ? 7 : 5,
        lastLogTerm: 1,
        lastLogIndex: 42,
        commitIndex: 42,
        appliedIndex: 42,
      })),
    )
    expect(() => electionState(state)).toThrow(/stale-term pre-vote/)
  })

  it('does not decrease a voter term when a stale real-vote request arrives', () => {
    const voted = electionState()
    const state: TraceRaftLabSnapshot = {
      ...voted,
      peers: voted.peers.map((peer) => peer.storeId === 'tikv-3'
        ? { ...peer, currentTerm: 3, votedFor: null } : peer),
      election: { ...voted.election, votesGranted: ['tikv-2'] },
    }
    expect(() => reduceRaftLabState(state, {
      kind: 'raft_term_vote',
      action: 'grant',
      regionId: 0,
      candidateStoreId: 'tikv-2',
      voterStoreId: 'tikv-3',
      term: 2,
    })).toThrow(/cannot decrease/)
  })

  it('advances the leader log at proposal but its match index only at persistence', () => {
    let state = proposedState()
    expect(state.peers.find((peer) => peer.storeId === 'tikv-2'))
      .toMatchObject({ lastLogIndex: 43, lastLogTerm: 2, matchIndex: 42, commitIndex: 42, appliedIndex: 42 })
    expect(state.log.persistedStoreIds).toEqual([])
    state = reduceRaftLabState(state, {
      kind: 'raft_persist', regionId: 0, index: 43, term: 2, storeIds: ['tikv-2'],
    })
    expect(state.peers.find((peer) => peer.storeId === 'tikv-2')?.matchIndex).toBe(43)
    expect(state.log.persistedStoreIds).toEqual(['tikv-2'])
  })

  it.each([
    ['tikv-2', 'tikv-3'],
    ['tikv-3', 'tikv-2'],
  ] as const)('accumulates independent persistence acknowledgements from %s then %s', (first, second) => {
    let state = proposedState()
    state = reduceRaftLabState(state, {
      kind: 'raft_persist', regionId: 0, index: 43, term: 2, storeIds: [first],
    })
    expect(() => reduceRaftLabState(state, {
      kind: 'raft_commit', regionId: 0, index: 43, term: 2, acknowledgements: 1, quorum: 2,
    })).toThrow(/persistence quorum/)
    state = reduceRaftLabState(state, {
      kind: 'raft_persist', regionId: 0, index: 43, term: 2, storeIds: [second],
    })
    expect(new Set(state.log.persistedStoreIds)).toEqual(new Set(['tikv-2', 'tikv-3']))
    const repeated = reduceRaftLabState(state, {
      kind: 'raft_persist', regionId: 0, index: 43, term: 2, storeIds: [first],
    })
    expect(repeated).toEqual(state)
    state = reduceRaftLabState(repeated, {
      kind: 'raft_commit', regionId: 0, index: 43, term: 2, acknowledgements: 2, quorum: 2,
    })
    expect(state.log.committed).toBe(true)
    expect(state.peers.find((peer) => peer.storeId === 'tikv-1')?.commitIndex).toBe(42)
    expect(reduceRaftLabState(state, {
      kind: 'raft_persist', regionId: 0, index: 43, term: 2, storeIds: [first],
    })).toEqual(state)
  })

  it('allows PD observation and an internal retry before the no-op applies, but waits to serve', () => {
    let state = electedState()
    const apply = (delta: RaftLabDelta): void => { state = reduceRaftLabState(state, delta) }
    apply({
      kind: 'raft_pd_state', action: 'observe_leader', regionId: 0,
      leaderStoreId: 'tikv-2', role: 'observer_and_routing_only',
    })
    apply({
      kind: 'raft_pd_state', action: 'route_lookup', regionId: 0,
      leaderStoreId: 'tikv-2', role: 'observer_and_routing_only',
    })
    apply({
      kind: 'raft_region_request', action: 'refresh', regionId: 0,
      logicalRequestId: 'region-request-1', attempt: 1, targetStoreId: 'tikv-2',
      backoffMs: 80, source: 'tidb_internal', clientVisibleError: false,
    })
    apply({
      kind: 'raft_region_request', action: 'retry', regionId: 0,
      logicalRequestId: 'region-request-1', attempt: 2, targetStoreId: 'tikv-2',
      backoffMs: 80, source: 'tidb_internal', clientVisibleError: false,
    })
    expect(state.request.status).toBe('retrying')
    expect(state.log.appliedStoreIds).toEqual([])
    const serve: RaftLabDelta = {
      kind: 'raft_region_request', action: 'serve', regionId: 0,
      logicalRequestId: 'region-request-1', attempt: 2, targetStoreId: 'tikv-2',
      backoffMs: 80, source: 'tidb_internal', clientVisibleError: false,
    }
    expect(() => apply(serve)).toThrow(/applying its current-term no-op/)
    apply({ kind: 'raft_propose', regionId: 0, index: 43, term: 2, operation: 'leader_noop' })
    apply({ kind: 'raft_persist', regionId: 0, index: 43, term: 2, storeIds: ['tikv-2', 'tikv-3'] })
    apply({ kind: 'raft_commit', regionId: 0, index: 43, term: 2, acknowledgements: 2, quorum: 2 })
    expect(() => apply(serve)).toThrow(/applying its current-term no-op/)
    apply({ kind: 'raft_apply', regionId: 0, index: 43, term: 2, storeIds: ['tikv-2'] })
    apply(serve)
    expect(state.request.status).toBe('served')
  })

  it('rejects negative or fractional persisted indexes and supports an empty follower log', () => {
    const definitions = initial().peers.map((peer) => ({
      storeId: peer.storeId, currentTerm: 1, lastLogIndex: peer.lastLogIndex,
      lastLogTerm: peer.lastLogTerm, commitIndex: peer.commitIndex, appliedIndex: peer.appliedIndex,
    }))
    for (const invalid of [-1, 1.5]) {
      expect(() => createRaftLabState(0, 'tikv-1', definitions.map((peer) => ({
        ...peer, commitIndex: invalid, appliedIndex: invalid,
      })))).toThrow(/index must be a non-negative integer/)
    }
    const state = createRaftLabState(0, 'tikv-1', definitions.map((peer) => peer.storeId === 'tikv-3'
      ? { ...peer, lastLogIndex: 0, lastLogTerm: 0, commitIndex: 0, appliedIndex: 0 }
      : peer))
    expect(state.peers.find((peer) => peer.storeId === 'tikv-3'))
      .toMatchObject({ currentTerm: 1, lastLogIndex: 0, lastLogTerm: 0 })
  })

  it('does not commit or apply the current-term no-op out of order', () => {
    let state = electionState()
    state = reduceRaftLabState(state, {
      kind: 'raft_leader_elected',
      regionId: 0,
      oldLeaderStoreId: 'tikv-1',
      newLeaderStoreId: 'tikv-2',
      term: 2,
      votesGranted: ['tikv-2', 'tikv-3'],
      quorum: 2,
    })
    state = reduceRaftLabState(state, {
      kind: 'raft_propose',
      regionId: 0,
      index: 43,
      operation: 'leader_noop',
      term: 2,
    })

    expect(() => reduceRaftLabState(state, {
      kind: 'raft_commit',
      regionId: 0,
      index: 43,
      term: 2,
      acknowledgements: 2,
      quorum: 2,
    })).toThrow(/persistence quorum/)
    expect(() => reduceRaftLabState(state, {
      kind: 'raft_apply',
      regionId: 0,
      index: 43,
      term: 2,
      storeIds: ['tikv-2'],
    })).toThrow(/committed no-op/)
  })

  it('completes only the same TiDB-internal request after routing refresh', () => {
    let state = electionState()
    const apply = (delta: RaftLabDelta): void => {
      state = reduceRaftLabState(state, delta)
    }
    apply({
      kind: 'raft_leader_elected',
      regionId: 0,
      oldLeaderStoreId: 'tikv-1',
      newLeaderStoreId: 'tikv-2',
      term: 2,
      votesGranted: ['tikv-2', 'tikv-3'],
      quorum: 2,
    })
    apply({
      kind: 'raft_propose',
      regionId: 0,
      index: 43,
      operation: 'leader_noop',
      term: 2,
    })
    apply({
      kind: 'raft_persist',
      regionId: 0,
      index: 43,
      term: 2,
      storeIds: ['tikv-2', 'tikv-3'],
    })
    apply({
      kind: 'raft_commit',
      regionId: 0,
      index: 43,
      term: 2,
      acknowledgements: 2,
      quorum: 2,
    })
    apply({
      kind: 'raft_apply',
      regionId: 0,
      index: 43,
      term: 2,
      storeIds: ['tikv-2'],
    })

    expect(() => apply({
      kind: 'raft_region_request',
      action: 'retry',
      regionId: 0,
      logicalRequestId: 'region-request-1',
      attempt: 2,
      targetStoreId: 'tikv-2',
      backoffMs: 80,
      source: 'tidb_internal',
      clientVisibleError: false,
    })).toThrow(/refreshed cache/)

    apply({
      kind: 'raft_pd_state',
      action: 'observe_leader',
      regionId: 0,
      leaderStoreId: 'tikv-2',
      role: 'observer_and_routing_only',
    })
    apply({
      kind: 'raft_pd_state',
      action: 'route_lookup',
      regionId: 0,
      leaderStoreId: 'tikv-2',
      role: 'observer_and_routing_only',
    })
    apply({
      kind: 'raft_region_request',
      action: 'refresh',
      regionId: 0,
      logicalRequestId: 'region-request-1',
      attempt: 1,
      targetStoreId: 'tikv-2',
      backoffMs: 80,
      source: 'tidb_internal',
      clientVisibleError: false,
    })
    apply({
      kind: 'raft_region_request',
      action: 'retry',
      regionId: 0,
      logicalRequestId: 'region-request-1',
      attempt: 2,
      targetStoreId: 'tikv-2',
      backoffMs: 80,
      source: 'tidb_internal',
      clientVisibleError: false,
    })
    apply({
      kind: 'raft_region_request',
      action: 'serve',
      regionId: 0,
      logicalRequestId: 'region-request-1',
      attempt: 2,
      targetStoreId: 'tikv-2',
      backoffMs: 80,
      source: 'tidb_internal',
      clientVisibleError: false,
    })
    apply({
      kind: 'raft_region_request',
      action: 'complete',
      regionId: 0,
      logicalRequestId: 'region-request-1',
      attempt: 2,
      targetStoreId: 'tikv-2',
      backoffMs: 80,
      source: 'tidb_internal',
      clientVisibleError: false,
    })

    expect(state).toMatchObject({
      phase: 'complete',
      leaderStoreId: 'tikv-2',
      request: {
        source: 'tidb_internal',
        attempt: 2,
        status: 'completed',
        clientVisibleError: false,
      },
    })
  })
})
