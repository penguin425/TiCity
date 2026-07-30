// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model'
import {
  DIAGNOSE_SECTIONS,
  DIAGNOSE_SUMMARY_SECTIONS,
  DIAGNOSE_CSS,
  SYMPTOM_GUIDES,
  mountDiagnose,
  projectDiagnostics,
} from './index'

describe('TiDB diagnostic projections', () => {
  const snapshot = {
    topology: {
      nodes: [
        { id: 'pd-1', kind: 'pd', status: 'up', role: 'leader' },
        { id: 'tikv-1', kind: 'tikv', status: 'up' },
      ],
    },
    regions: [
      {
        id: 12,
        leaderStoreId: 'tikv-1',
        peerStoreIds: ['tikv-1', 'tikv-2', 'tikv-3'],
        sizeMiB: 96,
        hotScore: 84,
        health: 'healthy',
      },
    ],
    transactions: [
      {
        id: 'txn-7',
        state: 'prewriting',
        startTs: 101,
        primaryRegionId: 12,
        lockAgeMs: 240,
      },
    ],
    gc: { safePoint: 90, backlogVersions: 31, blockedBy: 'txn-7' },
    tiflash: { ready: false, lagMs: 820, progress: 0.84 },
  }

  it('projects every diagnostic category from one model snapshot', () => {
    const projections = projectDiagnostics(snapshot)
    expect(projections.map((projection) => projection.id)).toEqual([...DIAGNOSE_SECTIONS])
    expect(projections.every((projection) => projection.label === 'MODEL / SIMULATED')).toBe(true)
    expect(projections.find((projection) => projection.id === 'hot-regions')?.rows[0])
      .toMatchObject({ id: '12', hotScore: '84' })
    expect(projections.find((projection) => projection.id === 'gc')?.rows[0])
      .toMatchObject({ blockedBy: 'txn-7' })
  })

  it('separates active lock waits, retained deadlock history, and application retry', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('lock-deadlock')
    const cycle = receipt.events.find((event) => event.kind === 'deadlock_detected')
    const error = receipt.events.find((event) => event.kind === 'deadlock_error_1213')
    const final = receipt.events.at(-1)
    expect(cycle?.snapshot?.lockLab).toBeDefined()
    expect(error?.snapshot?.lockLab).toBeDefined()
    expect(final?.snapshot?.lockLab).toBeDefined()

    const during = projectDiagnostics({
      ...simulation.state,
      lockLab: cycle?.snapshot?.lockLab,
    })
    expect(during.find((projection) => projection.id === 'transactions')?.rows)
      .toHaveLength(2)
    expect(during.find((projection) => projection.id === 'lock-waits')?.rows)
      .toEqual([
        expect.objectContaining({ direction: 'waiter → holder', resource: 'resource-b' }),
        expect.objectContaining({ direction: 'waiter → holder', resource: 'resource-a' }),
      ])
    expect(during.find((projection) => projection.id === 'deadlocks')?.rows[0])
      .toMatchObject({
        selectionPolicy: 'MODEL POLICY: cycle-closing waiter',
        internalRetryable: 'false',
        clientError: 'not_returned_yet',
        lockWaitTimeout: 'Error 1205 separate / not modeled',
        resolution: 'detected',
        detectorLeader: 'tikv-3',
      })
    expect(during.find((projection) => projection.id === 'application-retry')?.rows)
      .toEqual([])

    const afterError = projectDiagnostics({
      ...simulation.state,
      lockLab: error?.snapshot?.lockLab,
    })
    expect(afterError.find((projection) => projection.id === 'deadlocks')?.rows[0])
      .toMatchObject({
        clientError: 'Error 1213',
        internalRetryable: 'false',
        resolution: 'resolved',
      })
    expect(afterError.find((projection) => projection.id === 'application-retry')?.rows)
      .toEqual([])

    const after = projectDiagnostics({
      ...simulation.state,
      lockLab: final?.snapshot?.lockLab,
    })
    expect(after.find((projection) => projection.id === 'lock-waits')?.rows)
      .toEqual([])
    expect(after.find((projection) => projection.id === 'deadlocks')?.rows[0])
      .toMatchObject({
        internalRetryable: 'false',
        resolution: 'resolved',
      })
    expect(after.find((projection) => projection.id === 'application-retry')?.rows[0])
      .toMatchObject({
        source: 'application',
        status: 'completed',
        fixedBackoffMs: '120',
        boundary: 'whole transaction',
      })
    expect(after.find((projection) => projection.id === 'transactions')?.rows)
      .toHaveLength(3)

    for (const event of receipt.events) {
      if (!event.snapshot?.lockLab) continue
      const rendered = JSON.stringify(projectDiagnostics({
        ...simulation.state,
        lockLab: event.snapshot.lockLab,
      }))
      expect(rendered).not.toMatch(
        /SQL_DIGEST|SQL_DIGEST_TEXT|KEY_INFO|LOCK-LAB-425|inventory|select\s|update\s/i,
      )
    }
  })

  it('summarizes live lock contention separately from resolved history', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('lock-deadlock')
    const detected = receipt.events.find((event) => event.kind === 'deadlock_detected')!
    const final = receipt.events.at(-1)!
    const dom = installTestDom()
    const detectedRoot = dom.mount('detected')
    mountDiagnose(detectedRoot as unknown as HTMLElement, {
      locale: 'en',
      snapshot: {
        ...simulation.state,
        lockLab: detected.snapshot?.lockLab,
      },
    })

    expect(detectedRoot.querySelector('.tidb-diagnose__summary')?.getAttribute('data-tone'))
      .toBe('critical')
    expect(
      detectedRoot.querySelector(
        '[data-summary-metric="transactions"] .tidb-diagnose__metric-detail',
      )?.textContent,
    ).toContain('2 lock waits')
    expect(detectedRoot.textContent).toContain('Not returned yet')

    const finalRoot = dom.mount('final')
    mountDiagnose(finalRoot as unknown as HTMLElement, {
      locale: 'en',
      snapshot: {
        ...simulation.state,
        lockLab: final.snapshot?.lockLab,
      },
    })
    expect(finalRoot.querySelector('.tidb-diagnose__summary')?.getAttribute('data-tone'))
      .toBe('attention')
    expect(
      finalRoot.querySelector(
        '[data-summary-metric="transactions"] .tidb-diagnose__metric-detail',
      )?.textContent,
    ).toContain('0 lock waits')
    expect(finalRoot.textContent).toContain('Error 1213')
    expect(finalRoot.textContent).toContain('whole transaction')
  })

  it('localizes Lock Lab headings and explanatory values without changing model tokens', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('lock-deadlock')
    const final = receipt.events.at(-1)!
    const dom = installTestDom()
    const root = dom.mount('diagnose-ja')
    mountDiagnose(root as unknown as HTMLElement, {
      locale: 'ja',
      snapshot: {
        ...simulation.state,
        lockLab: final.snapshot?.lockLab,
      },
    })

    expect(root.getAttribute('lang')).toBe('ja')
    expect(root.textContent).toContain('現在のロック待機')
    expect(root.textContent).toContain('デッドロック履歴')
    expect(root.textContent).toContain('アプリケーション再試行')
    expect(root.textContent).toContain('MODEL POLICY：cycleを閉じた待機transaction')
    expect(root.textContent).toContain('Error 1205（別経路／未モデル化）')
    expect(root.textContent).toContain('transaction全体')
  })

  it('projects Raft peers, election, and TiDB-internal request retry at exact events', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('tikv-failover')
    const transport = receipt.events.find((event) =>
      event.kind === 'region_request_transport_error')!
    const vote = receipt.events.find((event) =>
      event.kind === 'raft_vote_granted')!
    const committed = receipt.events.find((event) =>
      event.kind === 'raft_leader_noop_commit')!
    const final = receipt.events.at(-1)!

    const atTransport = projectDiagnostics({
      ...simulation.state,
      raftLab: transport.snapshot?.raftLab,
    })
    expect(atTransport.find((projection) => projection.id === 'raft-peers')?.rows)
      .toEqual([
        expect.objectContaining({
          store: 'tikv-1',
          raftRole: 'offline',
          peerHealth: 'down',
          currentLeader: 'false',
          lastLog: '42 / 1',
        }),
        expect.objectContaining({ store: 'tikv-2', raftRole: 'follower' }),
        expect.objectContaining({ store: 'tikv-3', raftRole: 'follower' }),
      ])
    expect(
      atTransport.find((projection) =>
        projection.id === 'region-request-retry')?.rows[0],
    ).toMatchObject({
      logicalRequest: 'region-request-1',
      retrySource: 'tidb_internal',
      internalAttempt: '1',
      cacheState: 'cached',
      requestStatus: 'transport_error',
      clientVisibleError: 'false',
      applicationRetry: 'false',
      boundary: 'same logical Region request',
    })

    const atVote = projectDiagnostics({
      ...simulation.state,
      raftLab: vote.snapshot?.raftLab,
    })
    expect(atVote.find((projection) => projection.id === 'raft-election')?.rows[0])
      .toMatchObject({
        electionPhase: 'vote',
        candidate: 'tikv-2',
        preVotesGranted: 'tikv-2, tikv-3',
        votesGranted: 'tikv-2, tikv-3',
        electionQuorum: '2/2',
        liveVoters: '2/3',
        configuredTimeout: '10–20 ticks',
        teachingElapsed: '13 ticks · MODEL POLICY',
        candidatePolicy: 'MODEL POLICY: lowest live up-to-date Store ID',
        pdRole: 'observer_and_routing_only',
      })

    const atCommit = projectDiagnostics({
      ...simulation.state,
      raftLab: committed.snapshot?.raftLab,
    })
    expect(
      atCommit.find((projection) => projection.id === 'raft-peers')?.rows
        .filter((row) => row.peerCommitIndex === '43'),
    ).toHaveLength(2)

    const atFinal = projectDiagnostics({
      ...simulation.state,
      raftLab: final.snapshot?.raftLab,
    })
    expect(atFinal.find((projection) =>
      projection.id === 'region-request-retry')?.rows[0]).toMatchObject({
      retrySource: 'tidb_internal',
      internalAttempt: '2',
      cachedLeader: 'tikv-2',
      cacheState: 'refreshed',
      requestStatus: 'completed',
      clientVisibleError: 'false',
      applicationRetry: 'false',
    })
    expect(atFinal.find((projection) => projection.id === 'raft-election')?.rows[0])
      .toMatchObject({
        currentLeader: 'tikv-2',
        pdObservedLeader: 'tikv-2',
        pdRouteLookup: 'true',
      })

    for (const event of receipt.events) {
      if (!event.snapshot?.raftLab) continue
      const rendered = JSON.stringify(projectDiagnostics({
        ...simulation.state,
        raftLab: event.snapshot.raftLab,
      }))
      expect(rendered).not.toMatch(
        /SELECT \*|accounts|id = 425|row value|result row:/i,
      )
    }
  })

  it('renders the Raft MODEL POLICY, PD boundary, and retry boundary bilingually', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('tikv-failover')
    const vote = receipt.events.find((event) =>
      event.kind === 'raft_vote_granted')!
    const final = receipt.events.at(-1)!
    const dom = installTestDom()

    const english = dom.mount('raft-diagnose-en')
    mountDiagnose(english as unknown as HTMLElement, {
      locale: 'en',
      snapshot: {
        ...simulation.state,
        raftLab: vote.snapshot?.raftLab,
      },
    })
    expect(english.dataset.activeLab).toBe('raft')
    expect(english.textContent).toContain('Raft leader election')
    expect(english.textContent).toContain(
      'MODEL POLICY: lowest live, up-to-date Store ID',
    )
    expect(english.textContent).toContain('Observe and route metadata only')
    expect(english.textContent).toContain('same logical Region request')
    expect(
      english.querySelector('[data-diagnose-section="raft-election"]'),
    ).not.toBeNull()

    const japanese = dom.mount('raft-diagnose-ja')
    mountDiagnose(japanese as unknown as HTMLElement, {
      locale: 'ja',
      snapshot: {
        ...simulation.state,
        raftLab: final.snapshot?.raftLab,
      },
    })
    expect(japanese.textContent).toContain('Raft leader選出')
    expect(japanese.textContent).toContain(
      'MODEL POLICY：稼働中でlogが最新のStore ID最小',
    )
    expect(japanese.textContent).toContain('観測とroute metadataのみ')
    expect(japanese.textContent).toContain('同じlogical Region request')
    expect(japanese.textContent).toContain('TiDB内部')
  })

  it('projects Protocol Lab selection, timestamp provenance, and client boundaries', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('commit-protocols')
    const comparisonStart = receipt.events.find((event) =>
      event.kind === 'protocol_comparison_start')!
    const asyncResponse = receipt.events.find((event) =>
      event.kind === 'protocol_client_response' &&
      event.branchId === 'async_commit')!
    const twoPcResponse = receipt.events.find((event) =>
      event.kind === 'protocol_client_response' &&
      event.branchId === 'two_pc')!

    const atComparisonStart = projectDiagnostics({
      ...simulation.state,
      protocolLab: comparisonStart.snapshot?.protocolLab,
    })
    expect(
      atComparisonStart.find((projection) =>
        projection.id === 'protocol-selection')?.rows,
    ).toEqual([
      expect.objectContaining({
        lane: 'one_pc',
        profileScope:
          'declared_fixture_profile_visible_from_comparison_start',
        selected: '1pc',
      }),
      expect.objectContaining({
        lane: 'async_commit',
        profileScope:
          'declared_fixture_profile_visible_from_comparison_start',
        selected: 'async_commit',
      }),
      expect.objectContaining({
        lane: 'two_pc',
        profileScope:
          'declared_fixture_profile_visible_from_comparison_start',
        selected: '2pc',
      }),
    ])
    expect(
      atComparisonStart.find((projection) =>
        projection.id === 'protocol-client-path')?.rows,
    ).toEqual([
      expect.objectContaining({
        lane: 'one_pc',
        stage: 'idle',
        startTs: '—',
        clientResponded: 'false',
      }),
      expect.objectContaining({
        lane: 'async_commit',
        stage: 'idle',
        startTs: '—',
        clientResponded: 'false',
      }),
      expect.objectContaining({
        lane: 'two_pc',
        stage: 'idle',
        startTs: '—',
        clientResponded: 'false',
      }),
    ])

    const atAsyncResponse = projectDiagnostics({
      ...simulation.state,
      protocolLab: asyncResponse.snapshot?.protocolLab,
    })
    expect(
      atAsyncResponse.find((projection) =>
        projection.id === 'protocol-selection')?.rows,
    ).toEqual([
      expect.objectContaining({
        lane: 'one_pc',
        profileScope:
          'declared_fixture_profile_visible_from_comparison_start',
        selected: '1pc',
        onePcEligible: 'true',
        asyncCommitEligible: 'true',
        regionCount: '1',
        mutationCount: '2',
        asyncKeyCountLimit: '256',
        asyncTotalKeyBytesLimit: '4096',
        runtimeFallback: 'false',
        representation: 'aggregate_counts_only',
      }),
      expect.objectContaining({
        lane: 'async_commit',
        selected: 'async_commit',
        onePcEligible: 'false',
        asyncCommitEligible: 'true',
        onePcRejectedBeforeRpc: 'true',
      }),
      expect.objectContaining({
        lane: 'two_pc',
        selected: '2pc',
        mutationCount: '257',
        asyncCommitEligible: 'false',
        asyncRejectedAtClientPrecheck: 'true',
      }),
    ])
    expect(
      atAsyncResponse.find((projection) =>
        projection.id === 'protocol-client-path')?.rows[1],
    ).toMatchObject({
      lane: 'async_commit',
      stage: 'client_acknowledged',
      startTsSource: 'pd_tso',
      latestTsSource: 'pd_tso',
      requestMinCommitTsSource: 'latest_ts_plus_one',
      maxCommitTsSource: 'representative_safe_window_model_bound',
      commitTsSource: 'max_prewrite_min_commit_ts',
      clientResponded: 'true',
      backgroundState: 'in_progress_after_response',
      clientBoundary: 'response_before_cleanup_completion',
      backgroundScheduling:
        'deterministic_after_client_boundary_model_policy',
    })

    const atTwoPcResponse = projectDiagnostics({
      ...simulation.state,
      protocolLab: twoPcResponse.snapshot?.protocolLab,
    })
    expect(
      atTwoPcResponse.find((projection) =>
        projection.id === 'protocol-client-path')?.rows[2],
    ).toMatchObject({
      lane: 'two_pc',
      stage: 'client_acknowledged',
      latestTs: '—',
      latestTsSource: '—',
      requestMinCommitTs: '—',
      maxCommitTs: '—',
      commitTsSource: 'pd_tso_after_prewrite',
      clientResponded: 'true',
      backgroundState: 'in_progress_after_response',
    })
  })

  it('keeps transaction coordination separate from per-Region Raft and MVCC state', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('commit-protocols')
    const asyncResponse = receipt.events.find((event) =>
      event.kind === 'protocol_client_response' &&
      event.branchId === 'async_commit')!
    const twoPcResponse = receipt.events.find((event) =>
      event.kind === 'protocol_client_response' &&
      event.branchId === 'two_pc')!
    const persisted = receipt.events.find((event) =>
      event.kind === 'protocol_raft_persist_quorum' &&
      event.branchId === 'one_pc-region-24')!

    const atPersist = projectDiagnostics({
      protocolLab: persisted.snapshot?.protocolLab,
    })
    expect(
      atPersist.find((projection) =>
        projection.id === 'protocol-region-state')?.rows[0],
    ).toMatchObject({
      lane: 'one_pc',
      region: '24',
      raftOperation: 'one_pc_prewrite',
      raftStage: 'persisted_quorum',
      raftAcks: '2/2',
      coordinatorLayer: 'tidb_transaction_commit',
      raftLayer: 'per_region_consensus',
      cfDefault: 'empty',
      cfLock: 'empty',
      cfWrite: 'empty',
    })

    const atAsyncResponse = projectDiagnostics({
      protocolLab: asyncResponse.snapshot?.protocolLab,
    })
    const asyncRegions = atAsyncResponse.find((projection) =>
      projection.id === 'protocol-region-state')?.rows
      .filter((row) => row.lane === 'async_commit')
    expect(asyncRegions).toEqual([
      expect.objectContaining({
        region: '25',
        role: 'primary',
        mutationCount: '1',
        raftOperation: 'prewrite',
        raftStage: 'applied',
        cfDefault: 'value',
        cfLock: 'prewrite',
        cfWrite: 'empty',
        asyncCommit: 'true',
        secondaryCount: '1',
        returnedMinCommitTsSource: 'tikv_prewrite_result',
        asyncApplyPrewrite: 'false',
      }),
      expect.objectContaining({
        region: '26',
        role: 'secondary',
        secondaryCount: '0',
        returnedMinCommitTsSource: 'tikv_prewrite_result',
      }),
    ])

    const atTwoPcResponse = projectDiagnostics({
      protocolLab: twoPcResponse.snapshot?.protocolLab,
    })
    const twoPcRegions = atTwoPcResponse.find((projection) =>
      projection.id === 'protocol-region-state')?.rows
      .filter((row) => row.lane === 'two_pc')
    expect(twoPcRegions).toEqual([
      expect.objectContaining({
        role: 'primary',
        raftOperation: 'commit_primary',
        cfLock: 'empty',
        cfWrite: 'commit',
      }),
      expect.objectContaining({
        role: 'secondary',
        raftOperation: 'prewrite',
        cfLock: 'prewrite',
        cfWrite: 'empty',
      }),
    ])
  })

  it('renders Protocol Lab bilingually and treats post-response work as neutral', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('commit-protocols')
    const background = receipt.events.find((event) =>
      event.kind === 'async_commit_background_dispatch' &&
      event.regionId === 25)!
    const dom = installTestDom()

    const english = dom.mount('protocol-diagnose-en')
    mountDiagnose(english as unknown as HTMLElement, {
      locale: 'en',
      snapshot: {
        ...simulation.state,
        protocolLab: background.snapshot?.protocolLab,
      },
    })
    expect(english.dataset.activeLab).toBe('protocol')
    expect(english.textContent).toContain(
      'Declared fixture profile / outcome (static)',
    )
    expect(english.textContent).toContain(
      'Declared representative profile / outcome; visible from comparison start',
    )
    expect(english.textContent).toContain(
      'Exact-event client path and timestamps',
    )
    expect(english.textContent).toContain(
      'Exact-event Region Raft / MVCC state',
    )
    expect(english.textContent).toContain('PD TSO')
    expect(english.textContent).toContain('running after client response')
    expect(
      english.querySelector(
        '[data-diagnose-section="protocol-client-path"]',
      )?.getAttribute('data-tone'),
    ).toBe('neutral')
    expect(
      english.querySelector(
        '[data-table-section="protocol-client-path"] tbody tr:nth-child(2)',
      )?.getAttribute('data-tone'),
    ).toBe('neutral')

    const japanese = dom.mount('protocol-diagnose-ja')
    mountDiagnose(japanese as unknown as HTMLElement, {
      locale: 'ja',
      snapshot: {
        ...simulation.state,
        protocolLab: background.snapshot?.protocolLab,
      },
    })
    expect(japanese.textContent).toContain(
      '宣言済みfixture profile / outcome（固定）',
    )
    expect(japanese.textContent).toContain(
      '宣言済みの代表profile / outcome（比較開始時から表示）',
    )
    expect(japanese.textContent).toContain(
      'Exact-event client応答 / timestamp',
    )
    expect(japanese.textContent).toContain(
      'Exact-event Region Raft / MVCC状態',
    )
    expect(japanese.textContent).toContain('client応答後に進行中')
    expect(japanese.textContent).toContain('集計数のみ（SQL・key・value・rowなし）')
  })

  it('projects only aggregate Protocol Lab teaching data at every detailed event', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const receipt = simulation.runScenario('commit-protocols')
    for (const event of receipt.events) {
      if (!event.snapshot?.protocolLab) continue
      const protocolProjections = projectDiagnostics({
        protocolLab: event.snapshot.protocolLab,
      }).filter((projection) => projection.id.startsWith('protocol-'))
      expect(protocolProjections.every((projection) =>
        projection.label === 'MODEL / SIMULATED')).toBe(true)
      expect(JSON.stringify(protocolProjections)).not.toMatch(
        /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|KEY_INFO|SQL_DIGEST|row value|result row|inventory|accounts/i,
      )
    }
  })

  it('projects event-time transaction, Raft, lock, and MVCC detail', () => {
    const projections = projectDiagnostics({
      transaction: {
        id: 'txn-detail-1',
        mode: 'pessimistic',
        protocol: '2pc',
        stage: 'prewritten',
        startTs: 101,
        commitTs: null,
        regionIds: [0, 1],
        primaryRegionId: 0,
      },
      regions: [{
        id: 0,
        leaderStoreId: 'tikv-1',
        peers: [
          { storeId: 'tikv-1' },
          { storeId: 'tikv-2' },
          { storeId: 'tikv-3' },
        ],
        term: 1,
        commitIndex: 4,
        appliedIndex: 4,
        proposedIndex: 4,
        acknowledgements: 2,
        quorum: 2,
        pessimisticLock: {
          storage: 'leader_memory',
        },
        mvcc: {
          lockCf: 'prewrite',
          defaultCf: 'value',
          writeCf: 'empty',
          primary: true,
        },
      }],
    })

    expect(projections.find((projection) => projection.id === 'transactions')?.rows[0])
      .toMatchObject({ id: 'txn-detail-1', phase: 'prewritten' })
    expect(projections.find((projection) => projection.id === 'regions')?.rows[0])
      .toMatchObject({
        raftAcks: '2/2',
        pessimisticLock: 'leader_memory',
        cfLock: 'prewrite',
        cfDefault: 'value',
        cfWrite: 'empty',
        primary: 'true',
      })
  })

  it('ships six symptom-first guides with real-cluster check SQL', () => {
    expect(SYMPTOM_GUIDES).toHaveLength(6)
    expect(SYMPTOM_GUIDES.every((guide) => guide.sql.trim().toUpperCase().startsWith('SELECT')))
      .toBe(true)
  })

  it('uses v8.5 GC variables and peer-level Region health checks', () => {
    const gc = SYMPTOM_GUIDES.find((guide) => guide.id === 'gc-backlog')!
    expect(gc.sql).toContain('@@GLOBAL.tidb_gc_life_time')
    expect(gc.sql).toContain('@@GLOBAL.tidb_gc_max_wait_time')
    expect(gc.sql).toContain("VARIABLE_NAME = 'tikv_gc_safe_point'")
    expect(gc.sql).not.toContain("'tikv_gc_life_time'")

    const region = SYMPTOM_GUIDES.find((guide) => guide.id === 'region-health')!
    expect(region.sql).toContain('INFORMATION_SCHEMA.TIKV_REGION_PEERS')
    expect(region.sql).toContain('p.IS_LEADER')
    expect(region.sql).toContain('p.STATUS')
    expect(region.sql).toContain('p.DOWN_SECONDS')
  })

  it('explains TiFlash lag as snapshot waiting rather than stale results', () => {
    const tiflash = SYMPTOM_GUIDES.find((guide) => guide.id === 'tiflash-lag')!
    expect(tiflash.en.guidance).toMatch(/requested snapshot/i)
    expect(tiflash.en.guidance).toMatch(/timeout, not stale results/i)
    expect(tiflash.ja.guidance).toContain('古い結果ではなく')
  })

  it('labels every rendered diagnostic value as simulated', () => {
    const dom = installTestDom()
    const root = dom.mount('diagnose')
    mountDiagnose(root as unknown as HTMLElement, { locale: 'en', snapshot })

    expect(root.querySelectorAll('[data-model-label="true"]').length).toBeGreaterThanOrEqual(6)
    expect(root.querySelectorAll('pre[tabindex="0"]')).toHaveLength(SYMPTOM_GUIDES.length)
    expect(root.querySelectorAll('[data-summary-metric]'))
      .toHaveLength(DIAGNOSE_SUMMARY_SECTIONS.length)
    expect(root.querySelectorAll('.tidb-diagnose__spark[role="img"]'))
      .toHaveLength(DIAGNOSE_SUMMARY_SECTIONS.length)
    expect(root.querySelectorAll('.tidb-diagnose__guide-sql'))
      .toHaveLength(SYMPTOM_GUIDES.length)
    expect(root.textContent).toContain('MODEL / SIMULATED')
    expect(root.textContent).toContain('Model health summary')
    expect(root.textContent).toContain('txn-7')
  })

  it('keeps the dense deadlock table full-width without stretching cluster over it', () => {
    expect(DIAGNOSE_CSS).toContain('"deadlocks deadlocks"')
    expect(DIAGNOSE_CSS).toContain('"cluster application-retry"')
    expect(DIAGNOSE_CSS).not.toContain('"cluster deadlocks"')
    expect(DIAGNOSE_CSS).toContain('"cluster raft-peers"')
    expect(DIAGNOSE_CSS).toContain('"cluster raft-election"')
    expect(DIAGNOSE_CSS).toContain('"cluster region-request-retry"')
    expect(DIAGNOSE_CSS).toContain('"protocol-selection protocol-selection"')
    expect(DIAGNOSE_CSS).toContain('"protocol-client-path protocol-client-path"')
    expect(DIAGNOSE_CSS).toContain('"protocol-region-state protocol-region-state"')
    expect(DIAGNOSE_CSS).toContain('td[data-column="lockWaitTimeout"]')
  })
})
