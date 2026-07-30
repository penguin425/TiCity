// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model'
import type {
  TraceEvent,
  TraceRaftLabSnapshot,
} from '../model/types'
import { createLockLabPanel } from './lock-lab'
import { createRaftLabPanel } from './raft-lab'
import { createTransactionLabPanel } from './transaction-lab'

function votingSnapshot(): TraceRaftLabSnapshot {
  return {
    regionId: 0,
    phase: 'vote',
    oldLeaderStoreId: 'tikv-1',
    leaderStoreId: null,
    failedStoreId: 'tikv-1',
    quorum: 2,
    liveVoterCount: 2,
    peers: [
      {
        storeId: 'tikv-1',
        role: 'offline',
        healthy: false,
        currentTerm: 8,
        votedFor: null,
        lastLogIndex: 41,
        lastLogTerm: 8,
        matchIndex: 41,
        commitIndex: 41,
        appliedIndex: 41,
      },
      {
        storeId: 'tikv-2',
        role: 'candidate',
        healthy: true,
        currentTerm: 9,
        votedFor: 'tikv-2',
        lastLogIndex: 41,
        lastLogTerm: 8,
        matchIndex: 41,
        commitIndex: 41,
        appliedIndex: 41,
      },
      {
        storeId: 'tikv-3',
        role: 'follower',
        healthy: true,
        currentTerm: 9,
        votedFor: 'tikv-2',
        lastLogIndex: 41,
        lastLogTerm: 8,
        matchIndex: 41,
        commitIndex: 41,
        appliedIndex: 41,
      },
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
    log: {
      entryKind: null,
      index: null,
      term: null,
      persistedStoreIds: [],
      committed: false,
      appliedStoreIds: [],
    },
    request: {
      logicalRequestId: 'logical-point-read-1',
      source: 'tidb_internal',
      attempt: 1,
      cachedLeaderStoreId: 'tikv-1',
      cacheState: 'invalidated',
      status: 'backoff',
      backoffMs: 40,
      clientVisibleError: false,
    },
    pd: {
      role: 'observer_and_routing_only',
      observedLeaderStoreId: null,
      routeLookupCompleted: false,
    },
  }
}

function completedSnapshot(): TraceRaftLabSnapshot {
  const voting = votingSnapshot()
  return {
    ...voting,
    phase: 'complete',
    leaderStoreId: 'tikv-2',
    peers: voting.peers.map((peer) => {
      if (peer.storeId === 'tikv-2') {
        return {
          ...peer,
          role: 'leader' as const,
          lastLogIndex: 42,
          lastLogTerm: 9,
          matchIndex: 42,
          commitIndex: 42,
          appliedIndex: 42,
        }
      }
      if (peer.storeId === 'tikv-3') {
        return {
          ...peer,
          role: 'follower' as const,
          lastLogIndex: 42,
          lastLogTerm: 9,
          matchIndex: 42,
          commitIndex: 42,
          appliedIndex: 42,
        }
      }
      return peer
    }),
    election: {
      ...voting.election,
      phase: 'elected',
    },
    log: {
      entryKind: 'leader_noop',
      index: 42,
      term: 9,
      persistedStoreIds: ['tikv-2', 'tikv-3'],
      committed: true,
      appliedStoreIds: ['tikv-2', 'tikv-3'],
    },
    request: {
      ...voting.request,
      attempt: 2,
      cachedLeaderStoreId: 'tikv-2',
      cacheState: 'refreshed',
      status: 'completed',
      backoffMs: 0,
    },
    pd: {
      ...voting.pd,
      observedLeaderStoreId: 'tikv-2',
      routeLookupCompleted: true,
    },
  }
}

function raftEvent(
  id: string,
  snapshot: TraceRaftLabSnapshot,
): TraceEvent {
  return {
    id,
    atMs: 180,
    durationMs: 30,
    domain: 'raft',
    kind: `raft_failure_${snapshot.phase}`,
    label: 'Synthetic event label is not inspector copy',
    detail: 'No SQL text, literal, row value, or encoded key.',
    status: snapshot.phase === 'complete' ? 'success' : 'active',
    regionId: snapshot.regionId,
    metadata: {},
    snapshot: {
      modelVersion: 'tidb-v8.5-model-4',
      tsoLastAllocated: 1_000_000_001,
      transaction: null,
      regions: [],
      raftLab: snapshot,
    },
  }
}

describe('Raft Failure Lab accessible projection', () => {
  it('renders the immutable event snapshots from the real failover trace', () => {
    installTestDom()
    const panel = createRaftLabPanel('en')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('tikv-failover')

    for (const event of receipt.events) {
      expect(() => panel.update(event, [event])).not.toThrow()
      expect(panel.root.hidden).toBe(false)
    }

    const failed = receipt.events.find((event) =>
      event.kind === 'tikv_process_unreachable')
    const completed = receipt.events.find((event) =>
      event.kind === 'raft_failover_complete')
    if (!failed || !completed) throw new Error('Expected failover boundary events.')

    panel.update(failed)
    expect(panel.root.querySelector('[data-raft-phase="leader_lost"]')?.textContent)
      .toBe('Phase: Leader lost')
    expect(panel.root.textContent).toContain('tikv-1 → No leader')

    panel.update(completed)
    expect(panel.root.querySelector('[data-raft-phase="complete"]')?.textContent)
      .toBe('Phase: Complete')
    expect(panel.root.querySelector('[data-client-result="success"]')?.textContent)
      .toContain('Succeeded with no client-visible error')
  })

  it('shows event-time election state, three voter peers, quorum, and model policies', () => {
    installTestDom()
    const panel = createRaftLabPanel('en')
    const event = raftEvent('raft-vote', votingSnapshot())

    panel.update(event, [event])

    expect(panel.root.hidden).toBe(false)
    expect(panel.root.getAttribute('tabindex')).toBe('0')
    expect(panel.root.textContent).toContain('MODEL / SIMULATED')
    expect(panel.root.textContent).toContain('Raft Failure Lab')

    const phase = panel.root.querySelector('[role="status"]')
    expect(phase?.getAttribute('aria-live')).toBe('polite')
    expect(phase?.getAttribute('aria-atomic')).toBe('true')
    expect(phase?.textContent).toBe('Phase: Vote')

    expect(panel.root.querySelectorAll('[data-raft-peer]')).toHaveLength(3)
    expect(panel.root.querySelector('[data-raft-peer="tikv-1"]')?.textContent)
      .toContain('Down')
    expect(panel.root.querySelector('[data-raft-peer="tikv-2"]')?.textContent)
      .toContain('Candidate')
    expect(panel.root.querySelector('[data-raft-peer="tikv-2"]')?.textContent)
      .toContain('Voted fortikv-2')

    const election = panel.root.querySelector('[data-election-phase="vote"]')
    expect(election?.getAttribute('data-election-quorum')).toBe('2')
    expect(election?.textContent).toContain('2 of 3 voters (2-of-3)')
    expect(election?.textContent).toContain('Pre-Votes granted2/2')
    expect(election?.textContent).toContain('Votes granted2/2')
    expect(election?.textContent).toContain(
      'Lowest live, up-to-date Store ID (TiCity MODEL POLICY)',
    )
    expect(election?.textContent).toContain(
      'exact candidate and tick progression are deterministic TiCity MODEL POLICY',
    )
  })

  it('states the PD and retry boundaries while client outcome changes from pending to success', () => {
    installTestDom()
    const panel = createRaftLabPanel('en')

    panel.update(raftEvent('raft-retry-pending', votingSnapshot()))

    const pd = panel.root.querySelector(
      '[data-pd-role="observer_and_routing_only"]',
    )
    expect(pd?.textContent).toContain('Observe and route metadata only')
    expect(pd?.textContent).toContain(
      'does not choose a Raft candidate, grant Pre-Votes or Votes, or elect the leader',
    )

    const pending = panel.root.querySelector(
      '[data-retry-source="tidb_internal"]',
    )
    expect(pending?.getAttribute('data-client-result')).toBe('pending')
    expect(pending?.getAttribute('data-client-visible-error')).toBe('false')
    expect(pending?.textContent).toContain('TiDB internal')
    expect(pending?.textContent).toContain('not an application retry')
    expect(pending?.textContent).toContain(
      'Response pending; no client-visible error returned',
    )

    panel.update(raftEvent('raft-complete', completedSnapshot()))
    const complete = panel.root.querySelector(
      '[data-request-status="completed"]',
    )
    expect(complete?.getAttribute('data-client-result')).toBe('success')
    expect(complete?.textContent).toContain(
      'Succeeded with no client-visible error',
    )
    expect(panel.root.querySelector('[data-log-entry="leader_noop"]')?.textContent)
      .toContain('tikv-2 · tikv-3')
  })

  it('is exclusive with Transaction and Lock Labs, caches, localizes, and disposes', () => {
    installTestDom()
    const raftPanel = createRaftLabPanel('en')
    const transactionPanel = createTransactionLabPanel('en')
    const lockPanel = createLockLabPanel('en')
    document.body.append(raftPanel.root)
    const event = raftEvent('raft-vote', votingSnapshot())

    raftPanel.update(event, [event])
    transactionPanel.update(event, [event])
    lockPanel.update(event, [event])
    expect(raftPanel.root.hidden).toBe(false)
    expect(transactionPanel.root.hidden).toBe(true)
    expect(lockPanel.root.hidden).toBe(true)
    expect([
      raftPanel.root,
      transactionPanel.root,
      lockPanel.root,
    ].filter((root) => !root.hidden)).toHaveLength(1)

    const firstChild = raftPanel.root.firstChild
    raftPanel.update(event, [...[event]])
    expect(raftPanel.root.firstChild).toBe(firstChild)

    raftPanel.setLocale('ja')
    expect(raftPanel.root.firstChild).not.toBe(firstChild)
    expect(raftPanel.root.textContent).toContain('フェーズ: Vote')
    expect(raftPanel.root.textContent).toContain('3 voter中2（2-of-3）')
    expect(raftPanel.root.textContent).toContain(
      'アプリケーションretryではありません',
    )

    raftPanel.update({
      id: 'ordinary',
      atMs: 0,
      durationMs: 1,
      domain: 'sql',
      kind: 'ordinary',
      label: 'Ordinary event',
      detail: '',
      status: 'success',
      metadata: {},
      snapshot: {
        modelVersion: 'tidb-v8.5-model-4',
        tsoLastAllocated: 100,
        transaction: null,
        regions: [],
      },
    })
    expect(raftPanel.root.hidden).toBe(true)
    expect(raftPanel.root.childNodes).toHaveLength(0)

    raftPanel.dispose()
    expect(raftPanel.root.parentNode).toBeNull()
    expect(() => raftPanel.dispose()).not.toThrow()
  })
})
