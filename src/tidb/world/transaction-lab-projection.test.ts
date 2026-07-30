// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import type {
  TraceEvent,
  TraceRegionSnapshot,
} from '../model/types'
import { projectTransactionLab } from './transaction-lab-projection'

function region(
  regionId: number,
  leaderStoreId: 'tikv-1' | 'tikv-2' | 'tikv-3',
  primary: boolean,
): TraceRegionSnapshot {
  return {
    regionId,
    leaderStoreId,
    term: 1,
    proposedIndex: 4,
    persistedStoreIds: [leaderStoreId, leaderStoreId === 'tikv-1' ? 'tikv-2' : 'tikv-3'],
    acknowledgements: 2,
    quorum: 2,
    commitIndex: 4,
    appliedIndex: primary ? 4 : 3,
    peers: [
      {
        storeId: 'tikv-1',
        raftRole: leaderStoreId === 'tikv-1' ? 'leader' : 'follower',
        matchIndex: 4,
        appliedIndex: primary ? 4 : 3,
        healthy: true,
      },
      {
        storeId: 'tikv-2',
        raftRole: leaderStoreId === 'tikv-2' ? 'leader' : 'follower',
        matchIndex: leaderStoreId === 'tikv-2' ? 4 : 3,
        appliedIndex: 3,
        healthy: true,
      },
      {
        storeId: 'tikv-3',
        raftRole: leaderStoreId === 'tikv-3' ? 'leader' : 'follower',
        matchIndex: 4,
        appliedIndex: 3,
        healthy: true,
      },
    ],
    pessimisticLock: primary
      ? {
          transactionId: 'txn-1',
          leaderStoreId,
          storage: 'leader_memory',
          replicated: false,
        }
      : null,
    mvcc: {
      defaultCf: 'value',
      lockCf: 'prewrite',
      writeCf: primary ? 'commit' : 'empty',
      startTs: 101,
      commitTs: primary ? 102 : null,
      primary,
    },
  }
}

function event(): TraceEvent {
  return {
    id: 'event-1',
    atMs: 10,
    durationMs: 3,
    domain: 'raft',
    kind: 'apply',
    label: 'Apply',
    detail: '',
    status: 'success',
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-2',
      tsoLastAllocated: 102,
      transaction: {
        id: 'txn-1',
        mode: 'pessimistic',
        protocol: '2pc',
        stage: 'committing_primary',
        startTs: 101,
        commitTs: 102,
        regionIds: [0, 1],
        primaryRegionId: 0,
        clientResponded: false,
      },
      regions: [region(0, 'tikv-1', true), region(1, 'tikv-2', false)],
    },
  }
}

describe('Transaction Lab model-to-world projection', () => {
  it('keeps two Region roles, leaders, Raft, memory lock, and MVCC distinct', () => {
    const projection = projectTransactionLab(event(), {
      inspect: true,
      reducedMotion: false,
      pulse: 0.5,
    })!

    expect(projection.mode).toBe('inspect')
    expect(projection.phase).toBe('commit-primary')
    expect(projection.regions[0]).toMatchObject({
      id: 'region-0',
      keyRole: 'primary',
      leaderPeer: 0,
      quorumAcks: 2,
      apply: 'applied',
      lock: 'pessimistic-memory',
      mvcc: {
        lock: 'pending',
        default: 'committed',
        write: 'committed',
      },
    })
    expect(projection.regions[1]).toMatchObject({
      id: 'region-1',
      keyRole: 'secondary',
      leaderPeer: 1,
      lock: 'prewrite',
    })
    expect(projection.mutations.map((mutation) => mutation.state))
      .toEqual(['committed', 'prewriting'])
  })

  it('does not fabricate a cutaway for a legacy or non-two-Region event', () => {
    const legacy = { ...event(), snapshot: undefined }
    expect(projectTransactionLab(legacy, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()

    const detailed = event()
    const oneRegion: TraceEvent = {
      ...detailed,
      snapshot: {
        ...detailed.snapshot!,
        regions: [detailed.snapshot!.regions[0]],
      },
    }
    expect(projectTransactionLab(oneRegion, {
      inspect: true,
      reducedMotion: false,
    })).toBeNull()
  })
})
