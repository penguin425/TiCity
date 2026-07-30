/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import type {
  StoreId,
  TraceEvent,
  TraceRaftLabPeerSnapshot,
  TraceRaftLabSnapshot,
} from '../model/types'
import { createTiDBSimulation } from '../model/simulation'
import {
  RAFT_LAB_ELECTION_EDGE_CAPACITY,
  RAFT_LAB_PEER_CAPACITY,
} from './raft-lab'
import { projectRaftLab } from './raft-lab-projection'

function peer(
  storeId: StoreId,
  role: TraceRaftLabPeerSnapshot['role'],
  healthy: boolean,
  currentTerm: number,
  lastLogIndex = 42,
  lastLogTerm = 1,
): TraceRaftLabPeerSnapshot {
  return {
    storeId,
    role,
    healthy,
    currentTerm,
    votedFor:
      role === 'candidate' || role === 'leader'
        ? storeId
        : null,
    lastLogIndex,
    lastLogTerm,
    matchIndex: lastLogIndex,
    commitIndex: Math.min(42, lastLogIndex),
    appliedIndex: Math.min(42, lastLogIndex),
  }
}

function snapshot(
  overrides: Partial<TraceRaftLabSnapshot> = {},
): TraceRaftLabSnapshot {
  return {
    regionId: 0,
    phase: 'pre_vote',
    oldLeaderStoreId: 'tikv-1',
    leaderStoreId: null,
    failedStoreId: 'tikv-1',
    quorum: 2,
    liveVoterCount: 2,
    /* Deliberately shuffled: renderer slots must remain stable by store id. */
    peers: [
      peer('tikv-3', 'follower', true, 1),
      peer('tikv-1', 'offline', false, 1),
      peer('tikv-2', 'pre_candidate', true, 1),
    ],
    election: {
      phase: 'pre_vote',
      candidateStoreId: 'tikv-2',
      preVotesGranted: ['tikv-2', 'tikv-3'],
      votesGranted: [],
      prevoteEnabled: true,
      configuredElectionTimeoutTicks: 10,
      configuredMaxElectionTimeoutTicks: 20,
      elapsedTicks: 13,
      candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
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
      logicalRequestId: 'region-request-1',
      source: 'tidb_internal',
      attempt: 1,
      cachedLeaderStoreId: 'tikv-1',
      cacheState: 'invalidated',
      status: 'transport_error',
      backoffMs: 80,
      clientVisibleError: false,
    },
    pd: {
      role: 'observer_and_routing_only',
      observedLeaderStoreId: null,
      routeLookupCompleted: false,
    },
    ...overrides,
  }
}

function event(raftLab?: TraceRaftLabSnapshot): TraceEvent {
  return {
    id: 'raft-event',
    atMs: 10,
    durationMs: 3,
    domain: 'raft',
    kind: 'raft_pre_vote_granted',
    label: 'Region Raft Lab',
    detail: '',
    status: 'success',
    source: 'tikv-3',
    target: 'tikv-2',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-4',
      tsoLastAllocated: 100,
      transaction: null,
      regions: [],
      ...(raftLab ? { raftLab } : {}),
    },
  }
}

describe('Raft Lab model-to-world projection', () => {
  it('requires the snapshot.raftLab discriminator', () => {
    expect(projectRaftLab(null, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectRaftLab(event(), {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
    expect(projectRaftLab({
      ...event(),
      snapshot: undefined,
    }, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
  })

  it('maps offline old leader, pre-candidate, PreVote routes, term, and 2/3 quorum', () => {
    const source = event(snapshot())
    const before = JSON.stringify(source)
    const projection = projectRaftLab(source, {
      inspect: true,
      reducedMotion: false,
      pulse: 2,
    })!

    expect(projection).toMatchObject({
      mode: 'inspect',
      phase: 'pre-vote',
      pulse: 1,
      regionId: 0,
      previousTerm: 1,
      term: 1,
      previousLeaderPeer: 0,
      leaderPeer: -1,
      candidatePeer: 1,
      quorum: {
        acknowledgements: 2,
        required: 2,
        available: true,
        committed: false,
      },
    })
    expect(projection.peers.map((candidate) => ({
      storeId: candidate.storeId,
      role: candidate.role,
      health: candidate.health,
      shape: candidate.shape,
    }))).toEqual([
      {
        storeId: 'tikv-1',
        role: 'follower',
        health: 'down',
        shape: 'offline',
      },
      {
        storeId: 'tikv-2',
        role: 'pre-candidate',
        health: 'up',
        shape: 'double-ring',
      },
      {
        storeId: 'tikv-3',
        role: 'follower',
        health: 'up',
        shape: 'ring',
      },
    ])
    expect(projection.electionEdges[0]).toEqual(
      expect.objectContaining({
        id: 'prevote:granted:tikv-3:tikv-2',
        fromPeer: 2,
        toPeer: 1,
        status: 'granted',
      }),
    )
    expect(projection.electionEdges.slice(1).every(
      (edge) => !edge.visible,
    )).toBe(true)
    expect(projection.clientRetry).toEqual({
      visible: true,
      source: 'tidb_tikv_client',
      internal: true,
      attempt: 1,
      status: 'failed',
      reason: 'transport_error',
      previousTargetPeer: 0,
      targetPeer: -1,
    })
    expect(projection.pdObservation.electionAuthority).toBe(false)
    expect(JSON.stringify(source)).toBe(before)
  })

  it.each([
    ['raft_pre_vote_request', 'prevote', 'request', 'tikv-2', 'tikv-3'],
    ['raft_pre_vote_granted', 'prevote', 'granted', 'tikv-3', 'tikv-2'],
    ['raft_vote_request', 'vote', 'request', 'tikv-2', 'tikv-3'],
    ['raft_vote_granted', 'vote', 'granted', 'tikv-3', 'tikv-2'],
  ] as const)(
    'projects only the directed edge carried by %s',
    (kind, stage, status, sourceStoreId, targetStoreId) => {
      const projection = projectRaftLab({
        ...event(snapshot()),
        kind,
        source: sourceStoreId,
        target: targetStoreId,
      }, {
        inspect: true,
        reducedMotion: false,
      })!
      const sourcePeer = sourceStoreId === 'tikv-2' ? 1 : 2
      const targetPeer = targetStoreId === 'tikv-2' ? 1 : 2

      expect(projection.electionEdges[0]).toEqual({
        visible: true,
        id: `${stage}:${status}:${sourceStoreId}:${targetStoreId}`,
        stage,
        status,
        fromPeer: sourcePeer,
        toPeer: targetPeer,
      })
      expect(projection.electionEdges.slice(1).every(
        (edge) => !edge.visible,
      )).toBe(true)
    },
  )

  it('maps the no-op log through persist, commit, apply, internal reroute, and PD observation', () => {
    const detailed = snapshot({
      phase: 'confirming',
      leaderStoreId: 'tikv-2',
      peers: [
        peer('tikv-1', 'offline', false, 1),
        {
          ...peer('tikv-2', 'leader', true, 2, 43, 2),
          votedFor: 'tikv-2',
          commitIndex: 43,
          appliedIndex: 43,
        },
        {
          ...peer('tikv-3', 'follower', true, 2, 43, 2),
          votedFor: 'tikv-2',
          commitIndex: 43,
          appliedIndex: 42,
        },
      ],
      election: {
        phase: 'elected',
        candidateStoreId: 'tikv-2',
        preVotesGranted: ['tikv-2', 'tikv-3'],
        votesGranted: ['tikv-2', 'tikv-3'],
        prevoteEnabled: true,
        configuredElectionTimeoutTicks: 10,
        configuredMaxElectionTimeoutTicks: 20,
        elapsedTicks: 13,
        candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
      },
      log: {
        entryKind: 'leader_noop',
        index: 43,
        term: 2,
        persistedStoreIds: ['tikv-2', 'tikv-3'],
        committed: true,
        appliedStoreIds: ['tikv-2'],
      },
      request: {
        logicalRequestId: 'region-request-1',
        source: 'tidb_internal',
        attempt: 2,
        cachedLeaderStoreId: 'tikv-2',
        cacheState: 'refreshed',
        status: 'completed',
        backoffMs: 80,
        clientVisibleError: false,
      },
      pd: {
        role: 'observer_and_routing_only',
        observedLeaderStoreId: 'tikv-2',
        routeLookupCompleted: true,
      },
    })
    const source: TraceEvent = {
      ...event(detailed),
      kind: 'raft_apply',
      deltas: [{
        kind: 'raft_apply',
        regionId: 0,
        index: 43,
        term: 2,
        storeIds: ['tikv-2'],
      }],
    }
    const projection = projectRaftLab(source, {
      inspect: false,
      reducedMotion: true,
    })!

    expect(projection).toMatchObject({
      mode: 'overview',
      phase: 'apply',
      reducedMotion: true,
      previousTerm: 1,
      term: 2,
      previousLeaderPeer: 0,
      leaderPeer: 1,
      candidatePeer: 1,
      quorum: {
        acknowledgements: 2,
        required: 2,
        available: true,
        committed: true,
      },
      clientRetry: {
        visible: true,
        source: 'tidb_tikv_client',
        internal: true,
        attempt: 2,
        status: 'succeeded',
        reason: 'transport_error',
        previousTargetPeer: 0,
        targetPeer: 1,
      },
      pdObservation: {
        visible: true,
        status: 'observed',
        leaderPeer: 1,
        electionAuthority: false,
      },
    })
    expect(projection.peers[1].log).toEqual([
      { index: 42, term: 1, state: 'applied' },
      { index: 43, term: 2, state: 'applied' },
      { index: 44, term: 0, state: 'absent' },
    ])
    expect(projection.peers[2].log).toEqual([
      { index: 42, term: 1, state: 'applied' },
      { index: 43, term: 2, state: 'committed' },
      { index: 44, term: 0, state: 'absent' },
    ])
    expect(projection.peers[0].log.every(
      (cell) => cell.state === 'unavailable',
    )).toBe(true)
  })

  it('keeps every renderer dimension bounded and leaves event snapshots immutable', () => {
    const overCapacity = snapshot({
      peers: [
        peer('tikv-3', 'follower', true, 2),
        peer('tikv-3', 'follower', true, 2),
        peer('tikv-1', 'offline', false, 1),
        peer('tikv-2', 'candidate', true, 2),
      ],
      election: {
        phase: 'vote',
        candidateStoreId: 'tikv-2',
        preVotesGranted: ['tikv-2', 'tikv-3'],
        votesGranted: ['tikv-2', 'tikv-3'],
        prevoteEnabled: true,
        configuredElectionTimeoutTicks: 10,
        configuredMaxElectionTimeoutTicks: 20,
        elapsedTicks: 13,
        candidatePolicy: 'lowest_live_up_to_date_store_id_model_policy',
      },
    })
    const source = event(overCapacity)
    const before = JSON.stringify(source)
    const projection = projectRaftLab(source, {
      inspect: true,
      reducedMotion: false,
    })!

    expect(projection.peers).toHaveLength(RAFT_LAB_PEER_CAPACITY)
    expect(projection.peers.map((candidate) => candidate.storeId))
      .toEqual(['tikv-1', 'tikv-2', 'tikv-3'])
    expect(projection.electionEdges)
      .toHaveLength(RAFT_LAB_ELECTION_EDGE_CAPACITY)
    expect(projection.electionEdges.every((edge) =>
      edge.fromPeer >= -1 &&
      edge.fromPeer < RAFT_LAB_PEER_CAPACITY &&
      edge.toPeer >= -1 &&
      edge.toPeer < RAFT_LAB_PEER_CAPACITY,
    )).toBe(true)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('projects every model-4 failover event from the same immutable receipt', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('tikv-failover')
    const projected = receipt.events
      .map((traceEvent) => projectRaftLab(traceEvent, {
        inspect: true,
        reducedMotion: false,
        pulse: 0.5,
      }))
      .filter((candidate) => candidate !== null)
    const phases = new Set(projected.map((candidate) => candidate.phase))
    const final = projected.at(-1)!

    expect(projected).toHaveLength(receipt.events.length)
    expect([...phases]).toEqual(expect.arrayContaining([
      'baseline',
      'store-failure',
      'client-retry',
      'heartbeat-timeout',
      'pre-vote',
      'election',
      'leader-elected',
      'log-replication',
      'quorum-commit',
      'apply',
      'complete',
    ]))
    expect(final.peers).toHaveLength(3)
    expect(final.peers.filter((candidate) =>
      candidate.role === 'leader' && candidate.health === 'up',
    )).toHaveLength(1)
    expect(final.quorum).toMatchObject({
      acknowledgements: 2,
      required: 2,
      available: true,
      committed: true,
    })
    expect(final.clientRetry).toMatchObject({
      source: 'tidb_tikv_client',
      internal: true,
      attempt: 2,
      status: 'succeeded',
    })
    expect(final.pdObservation).toMatchObject({
      status: 'observed',
      electionAuthority: false,
    })
  })
})
