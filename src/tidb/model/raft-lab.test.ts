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

function electionState(): TraceRaftLabSnapshot {
  let state = initial()
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
    prospectiveTerm: 2,
  })
  apply({
    kind: 'raft_pre_vote',
    action: 'grant',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    voterStoreId: 'tikv-3',
    prospectiveTerm: 2,
  })
  apply({
    kind: 'raft_term_vote',
    action: 'become_candidate',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    voterStoreId: 'tikv-2',
    term: 2,
  })
  apply({
    kind: 'raft_term_vote',
    action: 'grant',
    regionId: 0,
    candidateStoreId: 'tikv-2',
    voterStoreId: 'tikv-3',
    term: 2,
  })
  return state
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

