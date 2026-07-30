// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model'
import type { TraceStateSnapshot } from '../model/types'
import { MACHINE_PAGE_COPY, MACHINE_SCENARIOS, resolveMachineScenario } from './catalog'
import {
  adaptTraceReceipt,
  MACHINE_CSS,
  MACHINE_LANES,
  mountMachine,
  resolveMachineEventIndex,
} from './index'

describe('TiCity Machine replay', () => {
  it('draws TSO, transaction, Raft, KV, and TiFlash as separate lanes', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt: {
        id: 'receipt-1',
        events: [
          { id: '1', at: 0, domain: 'tso', label: 'allocate start_ts' },
          { id: '2', at: 1, domain: 'txn2pc', label: 'prewrite' },
          { id: '3', at: 2, domain: 'raft', label: 'quorum commit' },
          { id: '4', at: 3, domain: 'kv', label: 'apply MVCC write' },
          { id: '5', at: 4, domain: 'tiflash', label: 'learner apply' },
        ],
      },
    })

    expect(
      root.querySelectorAll('[data-lane]').map((node) => node.dataset.lane),
    ).toEqual([...MACHINE_LANES])
    expect(root.querySelectorAll('[data-event-domain="txn2pc"]')).toHaveLength(1)
    expect(root.querySelectorAll('[data-event-domain="raft"]')).toHaveLength(1)
    expect(root.querySelector('[data-lane="txn2pc"]')?.textContent).toContain('TXN')
    expect(root.querySelector('[data-lane="txn2pc"]')?.textContent)
      .toContain('Transaction commit')
    expect(root.querySelector('[data-lane="raft"]')?.textContent).toContain('Raft')
  })

  it('uses the same semantic domain tokens as the 3D city', () => {
    for (const domain of MACHINE_LANES) {
      expect(MACHINE_CSS).toContain(
        `[data-lane="${domain}"] { --lane-color: var(--domain-${domain}`,
      )
    }
  })

  it('renders an honest empty replay state', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    mountMachine(root as unknown as HTMLElement, {
      locale: 'ja',
      receipt: { id: 'empty', events: [] },
    })

    expect(root.textContent).toContain('再生できるイベントはありません')
  })

  it('exposes failed and warning events visually and accessibly', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt: {
        id: 'failed',
        events: [{
          id: 'rollback',
          at: 0,
          domain: 'txn2pc',
          label: 'rollback',
          status: 'failed',
        }],
      },
    })

    const marker = root.querySelector('[data-event-status="failed"]')
    expect(marker?.getAttribute('class')).toContain('is-failed')
    expect(marker?.getAttribute('aria-label')).toContain('failed')
    expect(root.textContent).toContain('status: failed')
  })

  it('renders time, duration, and causal structure around the current event', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      initialIndex: 1,
      receipt: {
        id: 'causal-trace',
        events: [
          { id: 'tso', at: 0, duration: 2, domain: 'tso', label: 'allocate start_ts' },
          { id: 'prewrite', at: 3, duration: 4, domain: 'txn2pc', label: 'prewrite primary' },
          { id: 'raft', at: 8, duration: 3, domain: 'raft', label: 'replicate proposal' },
        ],
      },
    })

    expect(root.querySelectorAll('[data-time-tick]')).toHaveLength(6)
    expect(root.querySelectorAll('[data-event-duration]')).toHaveLength(3)
    expect(root.querySelectorAll('[data-causal-from]')).toHaveLength(2)
    expect(root.querySelector('[data-event-index="1"]')?.getAttribute('aria-current')).toBe('step')
    expect(root.querySelector('[data-causal-to="prewrite"]')?.getAttribute('class')).toContain('is-current')
    expect(root.textContent).toContain('Duration')
    expect(root.textContent).toContain('4 ms')
  })

  it('renders explicit fork and join dependencies instead of inventing a serial chain', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      initialIndex: 3,
      receipt: {
        id: 'parallel-prewrite',
        events: [
          { id: 'start', at: 0, domain: 'txn2pc', label: 'start' },
          {
            id: 'region-a',
            at: 2,
            duration: 5,
            domain: 'raft',
            label: 'Region A prewrite',
            dependsOn: ['start'],
          },
          {
            id: 'region-b',
            at: 2,
            duration: 5,
            domain: 'raft',
            label: 'Region B prewrite',
            dependsOn: ['start'],
          },
          {
            id: 'join',
            at: 8,
            domain: 'tso',
            label: 'allocate commit_ts',
            dependsOn: ['region-a', 'region-b'],
          },
          {
            id: 'cleanup',
            at: 12,
            domain: 'kv',
            label: 'secondary cleanup',
            dependsOn: ['join'],
            criticalPath: false,
          },
        ],
      },
    })

    const edges = root.querySelectorAll('[data-causal-from]')
    expect(edges).toHaveLength(5)
    expect(root.querySelectorAll('[data-causal-from="start"]')).toHaveLength(2)
    expect(root.querySelectorAll('[data-causal-to="join"]')).toHaveLength(2)
    expect(
      root.querySelector('[data-causal-to="cleanup"]')?.getAttribute('data-causal-path'),
    ).toBe('background')
    expect(root.querySelector('[data-causal-from="region-a"][data-causal-to="region-b"]'))
      .toBeNull()
  })

  it('lets keyboard users select a timeline event and keeps focus on it', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    mountMachine(root as unknown as HTMLElement, {
      locale: 'ja',
      receipt: {
        id: 'keyboard-trace',
        events: [
          { id: 'sql', at: 0, domain: 'sql', label: 'SQLを受信' },
          { id: 'kv', at: 2, domain: 'kv', label: 'MVCCを読み取り' },
        ],
      },
    })

    const target = root.querySelector('[data-event-index="1"]')
    const keydown = new Event('keydown', { cancelable: true })
    Object.defineProperty(keydown, 'key', { value: 'Enter' })
    target?.dispatchEvent(keydown)

    const selected = root.querySelector('[data-event-index="1"]')
    expect(selected?.getAttribute('aria-current')).toBe('step')
    expect((globalThis.document as unknown as { activeElement: unknown }).activeElement).toBe(selected)
    expect(root.textContent).toContain('現在のイベント')
  })

  it('uses keyed bilingual scenario labels and includes the Lock Lab route', () => {
    expect(MACHINE_SCENARIOS).toContain('lock-deadlock')
    expect(resolveMachineScenario('?scenario=lock-deadlock')).toBe('lock-deadlock')
    expect(resolveMachineScenario('?scenario=unknown')).toBe('cross-region-transaction')

    for (const locale of ['ja', 'en'] as const) {
      for (const scenario of MACHINE_SCENARIOS) {
        expect(MACHINE_PAGE_COPY[locale].names[scenario].length).toBeGreaterThan(0)
      }
    }
    expect(MACHINE_PAGE_COPY.en.names['lock-deadlock']).toContain('deadlock')
    expect(MACHINE_PAGE_COPY.ja.names['lock-deadlock']).toContain('デッドロック')
  })

  it('preserves canonical parallel order and resolves an event cursor after adaptation', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const snapshot = Object.freeze({
      modelVersion: 'test-model',
      tsoLastAllocated: 1,
      transaction: null,
      regions: Object.freeze([]),
    }) satisfies TraceStateSnapshot
    const source = {
      id: 'parallel',
      events: [
        {
          id: 'root',
          atMs: 0,
          durationMs: 1,
          domain: 'txn2pc',
          kind: 'root',
          label: 'root',
          detail: '',
          dependsOn: [],
        },
        {
          id: 'z-parallel',
          atMs: 2,
          durationMs: 1,
          domain: 'kv',
          kind: 'parallel_lock',
          label: 'Z branch',
          detail: '',
          dependsOn: ['root'],
          branchId: 'client-z',
          snapshot,
        },
        {
          id: 'a-parallel',
          atMs: 2,
          durationMs: 1,
          domain: 'kv',
          kind: 'parallel_lock',
          label: 'A branch',
          detail: '',
          dependsOn: ['root'],
          branchId: 'client-a',
        },
      ],
    }
    const adapted = adaptTraceReceipt(source)

    expect(adapted.events.map((event) => event.id)).toEqual([
      'root',
      'z-parallel',
      'a-parallel',
    ])
    expect(adapted.events[1]?.kind).toBe('parallel_lock')
    expect(adapted.events[1]?.branchId).toBe('client-z')
    expect(adapted.events[1]?.snapshot).toBe(snapshot)
    expect(resolveMachineEventIndex(adapted, 'z-parallel')).toBe(1)

    let selectedId = ''
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt: source,
      initialEventId: 'z-parallel',
      onSeek(event) {
        selectedId = event?.id ?? ''
      },
    })

    expect(selectedId).toBe('z-parallel')
    expect(root.querySelector('[data-event-id="z-parallel"]')?.getAttribute('aria-current'))
      .toBe('step')
    const detail = root.querySelector('.tidb-machine__detail')
    expect(detail?.getAttribute('data-current-event-id')).toBe('z-parallel')
    expect(detail?.getAttribute('data-current-event-kind')).toBe('parallel_lock')
    expect(detail?.getAttribute('data-current-event-branch')).toBe('client-z')
  })

  it('keeps the acyclic causal DAG separate from a visibly cyclic waiter-to-holder graph', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 }).runScenario('lock-deadlock')
    const cycleEvent = receipt.events.find((event) => event.kind === 'deadlock_detected')
    expect(cycleEvent).toBeDefined()

    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt,
      initialEventId: cycleEvent?.id,
    })

    expect(root.querySelector('[data-graph-kind="causal-dag"]')).not.toBeNull()
    expect(root.querySelector('[data-graph-kind="wait-for"]')).not.toBeNull()
    expect(root.querySelector('[data-wait-for-graph="semantic"]')?.getAttribute('tabindex'))
      .toBe('0')
    const waitEdges = root.querySelectorAll('path[data-wait-for-edge]')
    expect(waitEdges).toHaveLength(2)
    const waitPairs = waitEdges.map((edge) =>
      `${edge.dataset.waitForFrom}->${edge.dataset.waitForTo}`)
    expect(waitPairs.some((pair) => {
      const [from, to] = pair.split('->')
      return waitPairs.includes(`${to}->${from}`)
    })).toBe(true)
    expect(waitEdges.every((edge) => edge.dataset.direction === 'waiter-to-holder')).toBe(true)

    const causalEdges = root.querySelectorAll('[data-causal-from]')
    const causalChildren = new Map<string, string[]>()
    for (const edge of causalEdges) {
      const from = edge.dataset.causalFrom
      const to = edge.dataset.causalTo
      if (!from || !to) continue
      causalChildren.set(from, [...(causalChildren.get(from) ?? []), to])
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const hasCycle = (node: string): boolean => {
      if (visiting.has(node)) return true
      if (visited.has(node)) return false
      visiting.add(node)
      for (const child of causalChildren.get(node) ?? []) {
        if (hasCycle(child)) return true
      }
      visiting.delete(node)
      visited.add(node)
      return false
    }
    expect([...causalChildren.keys()].some(hasCycle)).toBe(false)
  })

  it('separates detector, MODEL POLICY victim, non-retryability, and application retry without leaking SQL literals', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 }).runScenario('lock-deadlock')
    const retryEvent = receipt.events.find((event) => event.kind === 'application_retry_begin')
    expect(retryEvent?.snapshot?.lockLab?.applicationRetry?.status).toBe('started')
    expect(JSON.stringify(retryEvent?.snapshot)).not.toContain('LOCK-LAB-425')

    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt,
      initialEventId: retryEvent?.id,
    })

    expect(root.querySelector('[data-lock-detector="tikv-3"]')?.dataset.detectorScope)
      .toBe('cluster_wide')
    expect(root.querySelector('[data-selection-policy="model-policy"]')).not.toBeNull()
    expect(root.querySelector('[data-retryable="false"]')).not.toBeNull()
    expect(root.querySelector('[data-application-retry="started"]')?.dataset.retrySource)
      .toBe('application')
    expect(root.textContent).toContain('MODEL POLICY')
    expect(root.textContent).toContain('RETRYABLE=false')
    expect(root.textContent).toContain('Application, not an internal TiDB retry')
    const retryTransactionId =
      retryEvent?.snapshot?.lockLab?.applicationRetry?.newTransactionId
    expect(retryTransactionId).not.toBeNull()
    expect(root.querySelector(
      `[data-lock-transaction="${retryTransactionId}"] .tidb-machine__wait-node-client`,
    )?.textContent).toBe('client-b′')
    expect(root.querySelector(
      `[data-lock-transaction-summary="${retryTransactionId}"] span`,
    )?.textContent).toBe('client-b′')
    expect(root.textContent).not.toContain('LOCK-LAB-425')
    expect(root.textContent).not.toContain('stock - 1')
  })

  it('keeps the causal DAG separate from the exact 2-of-3 Pre-Vote and Vote semantic graph', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('tikv-failover')
    const voteEvent = receipt.events.find((event) =>
      event.kind === 'raft_vote_granted')
    expect(voteEvent?.snapshot?.raftLab?.election).toMatchObject({
      phase: 'vote',
      candidateStoreId: 'tikv-2',
      preVotesGranted: ['tikv-2', 'tikv-3'],
      votesGranted: ['tikv-2', 'tikv-3'],
    })

    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt,
      initialEventId: voteEvent?.id,
    })

    expect(root.querySelector('[data-graph-kind="causal-dag"]')).not.toBeNull()
    const graph = root.querySelector('[data-raft-election-graph="semantic"]')
    expect(graph).not.toBeNull()
    expect(graph?.getAttribute('data-graph-kind')).toBe('raft-election')
    expect(graph?.getAttribute('tabindex')).toBe('0')
    expect(graph?.getAttribute('aria-label')).toContain(
      'separate from the causal DAG above',
    )
    expect(graph?.getAttribute('data-election-candidate')).toBe('tikv-2')
    expect(graph?.getAttribute('data-election-quorum')).toBe('2')
    expect(graph?.getAttribute('data-edge-count')).toBe('4')
    expect(graph?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    expect(graph?.querySelectorAll('[data-raft-peer-node]')).toHaveLength(3)
    expect(graph?.querySelector('[data-raft-peer-node="tikv-1"]')
      ?.getAttribute('data-peer-health')).toBe('down')
    expect(graph?.querySelector('[data-raft-peer-node="tikv-1"]')
      ?.getAttribute('data-node-shape')).toBe('crossed')
    expect(graph?.querySelector('[data-raft-peer-node="tikv-2"]')
      ?.getAttribute('data-peer-role')).toBe('candidate')
    expect(graph?.querySelector('[data-raft-peer-node="tikv-2"]')
      ?.getAttribute('data-node-shape')).toBe('notched')

    const preVoteEdges = graph?.querySelectorAll(
      'path[data-raft-grant="pre_vote"]',
    ) ?? []
    const voteEdges = graph?.querySelectorAll(
      'path[data-raft-grant="vote"]',
    ) ?? []
    expect(preVoteEdges).toHaveLength(2)
    expect(voteEdges).toHaveLength(2)
    expect([...preVoteEdges, ...voteEdges].every((edge) =>
      edge.getAttribute('data-grant-to') === 'tikv-2')).toBe(true)
    expect(graph?.querySelectorAll(
      '[data-raft-grant-list="accessible"] li[data-raft-grant]',
    )).toHaveLength(4)

    expect(root.querySelectorAll('[data-raft-peer]')).toHaveLength(3)
    expect(root.textContent).toContain('2 of 3 voters (2-of-3)')
    expect(root.textContent).toContain(
      'Lowest live, up-to-date Store ID',
    )
    expect(root.textContent).toContain('10–20 ticks')
    expect(root.textContent).toContain('13 ticks')
    expect(root.textContent).toContain(
      'deterministic TiCity MODEL POLICY',
    )
    expect(root.querySelector('[data-raft-policy="model-policy"]')
      ?.getAttribute('data-candidate-policy'))
      .toBe('lowest_live_up_to_date_store_id_model_policy')
    expect(root.querySelector('[data-raft-policy="model-policy"]')
      ?.getAttribute('data-prevote-enabled')).toBe('true')
    expect(root.querySelector('[data-raft-policy="model-policy"]')?.textContent)
      .toContain('Pre-VoteEnabled')
  })

  it('shows the elected log, PD boundary, and same-logical-request TiDB retry in both locales', () => {
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('tikv-failover')
    const completeEvent = receipt.events.find((event) =>
      event.kind === 'raft_failover_complete')
    expect(completeEvent?.snapshot?.raftLab?.request.status).toBe('completed')

    for (const locale of ['en', 'ja'] as const) {
      const dom = installTestDom()
      const root = dom.mount(`machine-${locale}`)
      mountMachine(root as unknown as HTMLElement, {
        locale,
        receipt,
        initialEventId: completeEvent?.id,
      })

      const raftState = root.querySelector('[data-raft-lab-state="true"]')
      expect(raftState?.getAttribute('data-raft-event-kind'))
        .toBe('raft_failover_complete')
      expect(raftState?.getAttribute('data-raft-phase')).toBe('complete')
      expect(raftState?.textContent).toContain('tikv-1 → tikv-2')
      expect(raftState?.querySelector('[data-raft-peer="tikv-2"]')
        ?.getAttribute('data-peer-role')).toBe('leader')
      expect(raftState?.querySelector('[data-raft-log-entry="leader_noop"]')
        ?.getAttribute('data-raft-log-committed')).toBe('true')

      const pd = raftState?.querySelector(
        '[data-pd-role="observer_and_routing_only"]',
      )
      expect(pd?.getAttribute('data-pd-votes')).toBe('false')
      expect(pd?.getAttribute('data-pd-route-lookup')).toBe('true')
      expect(pd?.textContent).toContain(
        locale === 'en'
          ? 'does not choose a candidate, grant Pre-Votes or Votes, or elect the leader'
          : '候補選択・Pre-Vote・Vote・Leader選出は行いません',
      )

      const retry = raftState?.querySelector(
        '[data-retry-source="tidb_internal"]',
      )
      expect(retry?.getAttribute('data-same-logical-request')).toBe('true')
      expect(retry?.getAttribute('data-application-retry')).toBe('false')
      expect(retry?.getAttribute('data-client-visible-error')).toBe('false')
      expect(retry?.getAttribute('data-client-result')).toBe('success')
      expect(retry?.textContent).toContain('region-request-1')
      expect(retry?.textContent).toContain(
        locale === 'en'
          ? 'same logical request, not an application retry'
          : '同じlogical requestに対するTiDB内部retry',
      )
      expect(raftState?.textContent).not.toContain('SELECT *')
      expect(raftState?.textContent).not.toContain('result row:')
    }
  })

  it('keeps the causal DAG separate from an exact three-lane commit-protocol semantic graph', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('commit-protocols')
    const responseEvent = receipt.events.find((event) =>
      event.kind === 'protocol_client_response' &&
      event.branchId === 'async_commit')
    expect(responseEvent?.snapshot?.protocolLab?.focusLaneId)
      .toBe('async_commit')
    expect(responseEvent?.snapshot?.protocolLab?.lanes.map((lane) => [
      lane.id,
      lane.stage,
    ])).toEqual([
      ['one_pc', 'complete'],
      ['async_commit', 'client_acknowledged'],
      ['two_pc', 'idle'],
    ])

    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt,
      initialEventId: responseEvent?.id,
    })

    expect(root.querySelector('[data-graph-kind="causal-dag"]')).not.toBeNull()
    const graph = root.querySelector(
      '[data-protocol-graph="semantic"]',
    )
    expect(graph?.getAttribute('data-graph-kind'))
      .toBe('commit-protocol-comparison')
    expect(graph?.getAttribute('data-lane-count')).toBe('3')
    expect(graph?.getAttribute('data-focus-lane')).toBe('async_commit')
    expect(graph?.getAttribute('data-latency-benchmark')).toBe('false')
    expect(graph?.getAttribute('tabindex')).toBe('0')
    expect(graph?.getAttribute('aria-label')).toContain(
      'separate from the causal DAG above',
    )
    expect(graph?.querySelectorAll('[data-causal-from]')).toHaveLength(0)
    expect(graph?.querySelectorAll('[data-protocol-lane]')).toHaveLength(3)
    expect(graph?.querySelectorAll(
      '[data-protocol-mirror="accessible"] [data-protocol-mirror-lane]',
    )).toHaveLength(3)

    const semanticEdges = graph?.querySelectorAll(
      '[data-protocol-edge]',
    ) ?? []
    expect(semanticEdges.length).toBeGreaterThan(0)
    expect(semanticEdges.every((edge) =>
      Boolean(edge.dataset.protocol) &&
      Boolean(edge.dataset.edgeAction) &&
      Boolean(edge.dataset.edgePath) &&
      Boolean(edge.dataset.edgeState))).toBe(true)
    expect(semanticEdges.every((edge) =>
      edge.getAttribute('data-causal-from') === null &&
      edge.getAttribute('data-causal-to') === null)).toBe(true)

    const state = root.querySelector('[data-protocol-lab-state="true"]')
    expect(state?.getAttribute('data-protocol-event-id')).toBe(responseEvent?.id)
    expect(state?.getAttribute('data-protocol-event-kind'))
      .toBe('protocol_client_response')
    expect(state?.getAttribute('data-coordinator-layer'))
      .toBe('tidb_transaction_commit')
    expect(state?.getAttribute('data-raft-layer'))
      .toBe('per_region_consensus')
    expect(state?.querySelector('[data-protocol-lane="one_pc"]')
      ?.getAttribute('data-protocol-stage')).toBe('complete')
    const asyncLane = state?.querySelector(
      '[data-protocol-lane="async_commit"]',
    )
    expect(asyncLane?.getAttribute('data-protocol-stage'))
      .toBe('client_acknowledged')
    expect(asyncLane?.getAttribute('data-client-responded')).toBe('true')
    expect(asyncLane?.getAttribute('data-background-complete')).toBe('false')
    expect(state?.querySelector('[data-protocol-lane="two_pc"]')
      ?.getAttribute('data-protocol-stage')).toBe('idle')

    expect(asyncLane?.querySelector('[data-protocol-timestamp="start_ts"]')
      ?.getAttribute('data-timestamp-source')).toBe('pd')
    expect(asyncLane?.querySelector('[data-protocol-timestamp="latest_ts"]')
      ?.getAttribute('data-timestamp-source')).toBe('pd')
    expect(asyncLane?.querySelector(
      '[data-protocol-timestamp="request_min_commit_ts"]',
    )?.getAttribute('data-timestamp-source')).toBe('tidb_model_bound')
    expect(asyncLane?.querySelector('[data-protocol-timestamp="commit_ts"]')
      ?.getAttribute('data-timestamp-source'))
      .toBe('max_prewrite_min_commit_ts')
    expect(asyncLane?.querySelector('[data-protocol-region="25"]')
      ?.getAttribute('data-raft-stage')).toBe('applied')
    expect(asyncLane?.querySelector('[data-protocol-region="25"]')
      ?.getAttribute('data-mvcc-lock-cf')).toBe('prewrite')
    expect(asyncLane?.querySelector('[data-protocol-region="25"]')
      ?.getAttribute('data-mvcc-write-cf')).toBe('empty')
    expect(state?.querySelector('[data-transaction-raft-boundary="separate"]'))
      .not.toBeNull()
    expect(state?.querySelector('[data-model-simulated="true"]')
      ?.getAttribute('data-latency-benchmark')).toBe('false')
    expect(state?.textContent).toContain('1PC and Async Commit are not Raft modes')
    expect(state?.textContent).toContain('not a latency benchmark')
    expect(state?.textContent).not.toContain('INSERT INTO')
  })

  it('marks regular 2PC-only timestamp omissions and 1PC cleanup as not applicable in both projections', () => {
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('commit-protocols')
    const comparisonEvent = receipt.events.find((event) =>
      event.kind === 'protocol_comparison_start')
    expect(comparisonEvent?.snapshot?.protocolLab?.lanes.map((lane) => [
      lane.id,
      lane.stage,
    ])).toEqual([
      ['one_pc', 'idle'],
      ['async_commit', 'idle'],
      ['two_pc', 'idle'],
    ])

    for (const locale of ['en', 'ja'] as const) {
      const dom = installTestDom()
      const root = dom.mount(`machine-protocol-applicability-${locale}`)
      mountMachine(root as unknown as HTMLElement, {
        locale,
        receipt,
        initialEventId: comparisonEvent?.id,
      })

      for (const laneId of ['one_pc', 'async_commit', 'two_pc']) {
        const lane = root.querySelector(`[data-protocol-lane="${laneId}"]`)
        expect(lane?.getAttribute('data-protocol-stage')).toBe('idle')
        const profile = lane?.querySelector(
          '[data-protocol-eligibility]',
        )
        expect(profile?.getAttribute('data-protocol-state-scope'))
          .toBe('declared-static')
        expect(profile?.getAttribute('data-profile-visibility'))
          .toBe('comparison-start')
        expect(profile?.textContent).toContain(
          locale === 'en'
            ? 'Declared fixture profile / outcome (static)'
            : '宣言済みfixture profile / outcome（固定）',
        )
        expect(lane?.querySelector('[data-stage-state="idle"]')
          ?.getAttribute('data-protocol-state-scope'))
          .toBe('exact-event-temporal')
        expect(lane?.querySelector('[data-protocol-timestamps]')
          ?.getAttribute('data-protocol-state-scope'))
          .toBe('exact-event-temporal')
        expect(lane?.querySelector('[data-protocol-regions]')
          ?.getAttribute('data-protocol-state-scope'))
          .toBe('exact-event-temporal')
        expect(lane?.querySelector('[data-protocol-client-boundary]')
          ?.getAttribute('data-protocol-state-scope'))
          .toBe('exact-event-temporal')

        const mirrorCells = root.querySelector(
          `[data-protocol-mirror-lane="${laneId}"]`,
        )?.querySelectorAll('td')
        expect(mirrorCells?.[0]?.getAttribute('data-protocol-state-scope'))
          .toBe('exact-event-temporal')
        expect(mirrorCells?.[1]?.getAttribute('data-protocol-state-scope'))
          .toBe('declared-static')
        expect(mirrorCells?.[1]?.textContent).toContain(
          locale === 'en'
            ? 'Visible from comparison start'
            : '比較開始時から表示',
        )
        for (const cell of mirrorCells?.slice(2) ?? []) {
          expect(cell.getAttribute('data-protocol-state-scope'))
            .toBe('exact-event-temporal')
        }
      }
      expect(root.textContent).toContain(
        locale === 'en'
          ? 'Stage, timestamps, Regions, the client boundary, and cleanup reflect the selected exact event.'
          : 'stage、timestamp、Region、client境界、cleanupは選択したexact event時点です。',
      )
      expect(root.textContent).not.toContain(
        locale === 'en' ? 'TryOnePc sent' : 'TryOnePc送信',
      )

      const twoPc = root.querySelector('[data-protocol-lane="two_pc"]')
      for (const kind of [
        'latest_ts',
        'request_min_commit_ts',
        'max_commit_ts',
      ]) {
        const timestamp = twoPc?.querySelector(
          `[data-protocol-timestamp="${kind}"]`,
        )
        expect(timestamp?.getAttribute('class')).toContain('is-not-applicable')
        expect(timestamp?.getAttribute('data-timestamp-applicable')).toBe('false')
        expect(timestamp?.getAttribute('data-timestamp-source')).toBe('none')
        expect(timestamp?.getAttribute('data-timestamp-value')).toBe('')
        expect(timestamp?.textContent).toContain(
          locale === 'en' ? 'Not applicable' : '非該当',
        )
        expect(timestamp?.textContent).toContain(
          locale === 'en'
            ? 'Not used by this protocol'
            : 'このprotocolでは使用しません',
        )
        expect(timestamp?.textContent).not.toContain(
          locale === 'en' ? 'Not reached' : '未到達',
        )
      }
      expect(twoPc?.querySelector('[data-protocol-timestamp="start_ts"]')
        ?.getAttribute('data-timestamp-applicable')).toBe('true')
      expect(twoPc?.querySelector('[data-protocol-timestamp="commit_ts"]')
        ?.getAttribute('data-timestamp-applicable')).toBe('true')

      const onePcBoundary = root.querySelector(
        '[data-protocol-client-boundary="one_pc"]',
      )
      expect(onePcBoundary?.getAttribute('data-cleanup-state'))
        .toBe('not_required')
      expect(onePcBoundary?.querySelectorAll('strong')[1]?.textContent)
        .toBe(locale === 'en'
          ? 'Not required (no background cleanup)'
          : '不要（background cleanupなし）')

      const twoPcMirror = root.querySelector(
        '[data-protocol-mirror-lane="two_pc"]',
      )
      const twoPcTimestampSummary = twoPcMirror?.querySelectorAll('td')[2]
      expect(twoPcTimestampSummary?.textContent).toContain(
        locale === 'en'
          ? 'latest_ts: Not applicable (Not used by this protocol)'
          : 'latest_ts: 非該当 (このprotocolでは使用しません)',
      )
      const onePcMirror = root.querySelector(
        '[data-protocol-mirror-lane="one_pc"]',
      )
      expect(onePcMirror?.querySelectorAll('td')[5]?.textContent)
        .toBe(locale === 'en'
          ? 'Not required (no background cleanup)'
          : '不要（background cleanupなし）')
    }
  })

  it('shows eligibility, timestamp provenance, and the post-response background edge without conflating Region Raft', () => {
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('commit-protocols')
    const backgroundEvent = receipt.events.find((event) =>
      event.kind === 'two_pc_secondary_commit_dispatch')
    expect(backgroundEvent?.snapshot?.protocolLab).toBeDefined()

    for (const locale of ['en', 'ja'] as const) {
      const dom = installTestDom()
      const root = dom.mount(`machine-protocol-${locale}`)
      mountMachine(root as unknown as HTMLElement, {
        locale,
        receipt,
        initialEventId: backgroundEvent?.id,
      })

      const lane = root.querySelector('[data-protocol-lane="two_pc"]')
      expect(lane?.getAttribute('data-protocol-stage')).toBe('background')
      const eligibility = lane?.querySelector(
        '[data-protocol-eligibility="two_pc"]',
      )
      expect(eligibility?.getAttribute('data-selected-protocol')).toBe('2pc')
      expect(eligibility?.getAttribute('data-one-pc-eligible')).toBe('false')
      expect(eligibility?.getAttribute('data-async-commit-eligible')).toBe('false')
      expect(eligibility?.getAttribute('data-runtime-fallback')).toBe('false')
      expect(eligibility?.getAttribute('data-async-decision-point'))
        .toBe('client_precheck')

      const commitTs = lane?.querySelector(
        '[data-protocol-timestamp="commit_ts"]',
      )
      expect(commitTs?.getAttribute('data-timestamp-source'))
        .toBe('pd_tso_after_prewrite')
      expect(commitTs?.getAttribute('data-timestamp-value')).not.toBe('')

      const primary = lane?.querySelector('[data-protocol-region="27"]')
      const secondary = lane?.querySelector('[data-protocol-region="28"]')
      expect(primary?.getAttribute('data-region-role')).toBe('primary')
      expect(primary?.getAttribute('data-mvcc-write-cf')).toBe('commit')
      expect(secondary?.getAttribute('data-region-role')).toBe('secondary')
      expect(secondary?.getAttribute('data-mvcc-lock-cf')).toBe('prewrite')
      expect(primary?.getAttribute('data-consensus-layer'))
        .toBe('per_region_raft')
      expect(primary?.getAttribute('data-transaction-layer'))
        .toBe('tidb_transaction_commit')

      const backgroundEdge = lane?.querySelector(
        '[data-edge-action="background_secondary_cleanup"]',
      )
      expect(backgroundEdge?.getAttribute('data-edge-path')).toBe('background')
      expect(backgroundEdge?.getAttribute('data-edge-state')).toBe('current')
      expect(root.querySelector(
        `[data-causal-to="${backgroundEvent?.id}"]`,
      )?.getAttribute('data-causal-path')).toBe('background')
      expect(root.textContent).toContain(
        locale === 'en'
          ? 'Region count alone does not establish'
          : 'Region数だけで一般的なAsync Commit適格性は決まりません',
      )
      expect(root.textContent).toContain('257')
      expect(root.textContent).toContain('256')
    }
  })

  it('mounts and clears the Protocol Lab slot from the selected event snapshot', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const protocolReceipt = createTiDBSimulation({ seed: 425 })
      .runScenario('commit-protocols')
    const protocolEvent = protocolReceipt.events.find((event) =>
      event.kind === 'protocol_lab_complete')
    if (!protocolEvent?.snapshot?.protocolLab) {
      throw new Error('Expected an exact Protocol Lab snapshot.')
    }
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      initialIndex: 0,
      receipt: {
        id: 'protocol-slot-lifecycle',
        events: [
          {
            id: 'plain-event',
            atMs: 0,
            durationMs: 1,
            domain: 'sql',
            kind: 'plain',
            label: 'Plain event',
            detail: '',
          },
          {
            ...protocolEvent,
            id: 'protocol-event',
            atMs: 2,
          },
        ],
      },
    })

    const slot = root.querySelector(
      '.tidb-machine__protocol-slot',
    ) as unknown as HTMLElement
    expect(slot.hidden).toBe(true)
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelector('[data-event-id="plain-event"]')
      ?.getAttribute('data-event-has-protocol-snapshot')).toBe('false')
    expect(root.querySelector('[data-event-id="protocol-event"]')
      ?.getAttribute('data-event-has-protocol-snapshot')).toBe('true')

    root.querySelector('[data-event-id="protocol-event"]')
      ?.dispatchEvent(new Event('click'))
    expect(slot.hidden).toBe(false)
    expect(slot.getAttribute('aria-hidden')).toBe('false')
    expect(slot.querySelector('[data-protocol-lab-state="true"]')
      ?.getAttribute('data-protocol-phase')).toBe('complete')
    expect(slot.querySelectorAll(
      '[data-protocol-lane][data-protocol-stage="complete"]',
    )).toHaveLength(3)

    root.querySelector('[data-event-id="plain-event"]')
      ?.dispatchEvent(new Event('click'))
    expect(slot.hidden).toBe(true)
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.children).toHaveLength(0)
  })

  it('mounts independent Lock and Raft slots and clears both on an event without snapshots', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const lockReceipt = createTiDBSimulation({ seed: 425 })
      .runScenario('lock-deadlock')
    const raftReceipt = createTiDBSimulation({ seed: 425 })
      .runScenario('tikv-failover')
    const lockEvent = lockReceipt.events.find((event) =>
      event.kind === 'deadlock_detected')
    const raftEvent = raftReceipt.events.find((event) =>
      event.kind === 'raft_vote_granted')
    if (!lockEvent?.snapshot?.lockLab || !raftEvent?.snapshot?.raftLab) {
      throw new Error('Expected exact Lock and Raft snapshots.')
    }
    const combinedSnapshot: TraceStateSnapshot = {
      ...raftEvent.snapshot,
      lockLab: lockEvent.snapshot.lockLab,
    }
    const combinedEvent = {
      ...raftEvent,
      id: 'combined-semantic-event',
      atMs: 2,
      snapshot: combinedSnapshot,
    }
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      initialIndex: 0,
      receipt: {
        id: 'independent-semantic-slots',
        events: [
          {
            id: 'plain-event',
            atMs: 0,
            durationMs: 1,
            domain: 'sql',
            kind: 'plain',
            label: 'Plain event',
            detail: '',
          },
          combinedEvent,
        ],
      },
    })

    const lockSlot = root.querySelector(
      '.tidb-machine__lock-slot',
    ) as unknown as HTMLElement
    const raftSlot = root.querySelector(
      '.tidb-machine__raft-slot',
    ) as unknown as HTMLElement
    expect(lockSlot.hidden).toBe(true)
    expect(raftSlot.hidden).toBe(true)
    expect(lockSlot.getAttribute('aria-hidden')).toBe('true')
    expect(raftSlot.getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelector('[data-event-id="plain-event"]')
      ?.getAttribute('data-event-has-raft-snapshot')).toBe('false')
    expect(root.querySelector('[data-event-id="combined-semantic-event"]')
      ?.getAttribute('data-event-has-raft-snapshot')).toBe('true')

    root.querySelector('[data-event-id="combined-semantic-event"]')
      ?.dispatchEvent(new Event('click'))
    expect(lockSlot.hidden).toBe(false)
    expect(raftSlot.hidden).toBe(false)
    expect(lockSlot.getAttribute('aria-hidden')).toBe('false')
    expect(raftSlot.getAttribute('aria-hidden')).toBe('false')
    expect(root.querySelector('[data-lock-lab-state="true"]')).not.toBeNull()
    expect(root.querySelector('[data-raft-lab-state="true"]')).not.toBeNull()
  })

  it('projects the exact GC snapshot as two semantic rounds without rewriting the causal DAG', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('gc-safe-point')
    const boundEvent = receipt.events.find((event) =>
      event.kind === 'gc_min_start_ts_bound')
    const deleteStart = receipt.events.find((event) =>
      event.kind === 'gc_delete_ranges_start')
    const firstPublish = receipt.events.find((event) =>
      event.kind === 'gc_global_safe_point_publish')
    if (!boundEvent?.snapshot?.gcLab || !deleteStart || !firstPublish) {
      throw new Error('Expected exact GC/Storage Lab events.')
    }

    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt,
      initialEventId: boundEvent.id,
    })

    const lab = root.querySelector('[data-gc-machine-state="true"]')
    expect(lab?.getAttribute('data-gc-event-id')).toBe(boundEvent.id)
    expect(lab?.getAttribute('data-gc-phase')).toBe('preparing')
    expect(lab?.getAttribute('data-gc-round')).toBe('1')
    expect(root.querySelectorAll('[data-gc-pipeline-round]')).toHaveLength(2)
    expect(root.querySelectorAll('[data-gc-pipeline-stage]')).toHaveLength(18)
    expect(root.querySelector(
      '[data-gc-pipeline-round="1"] [data-gc-pipeline-stage="candidate"]',
    )?.getAttribute('data-gc-pipeline-state')).toBe('complete')
    expect(root.querySelector(
      '[data-gc-pipeline-round="1"] [data-gc-pipeline-stage="bound"]',
    )?.getAttribute('data-gc-pipeline-state')).toBe('current')
    expect(root.querySelector(
      '[data-gc-pipeline-round="2"] [data-gc-pipeline-stage="candidate"]',
    )?.getAttribute('data-gc-pipeline-state')).toBe('future')

    const roundOneStages = root.querySelectorAll(
      '[data-gc-pipeline-round="1"] [data-gc-pipeline-stage]',
    ).map((node) => node.getAttribute('data-gc-pipeline-stage'))
    expect(roundOneStages).toEqual([
      'candidate',
      'bound',
      'mysql_staged',
      'resolve_locks',
      'visibility_saved',
      'delete_range',
      'pd_published',
      'tikv_detected',
      'compaction_filter',
    ])
    expect(root.querySelector('[data-gc-semantic-graph="pipeline"]')
      ?.getAttribute('data-causal-dag-replaced')).toBe('false')
    expect(root.querySelector(`[data-event-id="${boundEvent.id}"]`)
      ?.getAttribute('data-event-has-gc-snapshot')).toBe('true')

    expect(root.querySelectorAll(
      `[data-causal-from="${deleteStart.id}"]`,
    )).toHaveLength(3)
    expect(root.querySelectorAll(
      `[data-causal-from="${firstPublish.id}"]`,
    )).toHaveLength(3)
    const firstDeleteStore = receipt.events.find((event) =>
      event.kind === 'gc_delete_range_store')
    const secondDeleteStore = receipt.events.find((event) =>
      event.kind === 'gc_delete_range_store' &&
      event.id !== firstDeleteStore?.id)
    expect(root.querySelector(
      `[data-causal-from="${firstDeleteStore?.id}"][data-causal-to="${secondDeleteStore?.id}"]`,
    )).toBeNull()

    const safePoint = boundEvent.snapshot.gcLab.safePoint
    expect(safePoint.activeTransactionBound)
      .toBe(boundEvent.snapshot.gcLab.blocker.startTs - 1)
    expect(lab?.textContent).toContain(
      `${safePoint.globalMinStartTs} - 1 = ${safePoint.activeTransactionBound}`,
    )
  })

  it('distinguishes safe-point stores, Store filters, and counted-once MVCC chains at the final exact event', () => {
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('gc-safe-point')
    const completeEvent = receipt.events.find((event) =>
      event.kind === 'gc_storage_lab_complete')
    if (!completeEvent?.snapshot?.gcLab) {
      throw new Error('Expected the final exact GC/Storage Lab snapshot.')
    }
    const final = completeEvent.snapshot.gcLab

    for (const locale of ['en', 'ja'] as const) {
      const dom = installTestDom()
      const root = dom.mount(`machine-${locale}`)
      mountMachine(root as unknown as HTMLElement, {
        locale,
        receipt: {
          id: `gc-final-${locale}`,
          events: [{
            ...completeEvent,
            id: `renamed-event-${locale}`,
            kind: 'presentation_label_does_not_drive_gc_state',
          }],
        },
      })

      const lab = root.querySelector('[data-gc-machine-state="true"]')
      expect(lab?.getAttribute('data-gc-phase')).toBe('complete')
      expect(lab?.getAttribute('data-gc-round')).toBe('2')
      expect(root.querySelectorAll('[data-safe-point-store]')).toHaveLength(3)
      expect(root.querySelector('[data-safe-point-store="mysql_staged"]')
        ?.getAttribute('data-safe-point-value')).toBe(String(final.safePoint.staged))
      expect(root.querySelector('[data-safe-point-store="mysql_staged"]')
        ?.getAttribute('data-gc-leader-lease-store'))
        .toBe(final.configuration.gcLeaderLeaseStore)
      expect(root.querySelector('[data-safe-point-store="visibility_saved"]')
        ?.getAttribute('data-safe-point-value'))
        .toBe(String(final.safePoint.visibilitySaved))
      expect(root.querySelector('[data-safe-point-store="visibility_saved"]')
        ?.getAttribute('data-visibility-cache-barrier-seconds'))
        .toBe(String(final.configuration.visibilityCacheBarrierSeconds))
      expect(root.querySelector('[data-safe-point-store="pd_global"]')
        ?.getAttribute('data-safe-point-value')).toBe(String(final.safePoint.published))

      const tikvStores = root.querySelectorAll('[data-gc-tikv-store]')
      expect(tikvStores).toHaveLength(3)
      expect(tikvStores.map((store) => [
        store.getAttribute('data-detected-safe-point'),
        store.getAttribute('data-compaction-state'),
        store.getAttribute('data-filter-active'),
      ])).toEqual(Array.from({ length: 3 }, () => [
        String(final.safePoint.published),
        'complete',
        'false',
      ]))
      expect(root.querySelectorAll('[data-unsafe-destroy-store]')).toHaveLength(3)
      expect(root.querySelectorAll(
        '[data-unsafe-destroy-store][data-unsafe-destroy-raft-bypass="true"][data-store-ack="aggregate_complete"]',
      )).toHaveLength(3)

      const storage = root.querySelector(
        '[data-storage-representation="logical_chains_counted_once"]',
      )
      expect(storage?.getAttribute('data-logical-chains-counted-once')).toBe('true')
      expect(storage?.getAttribute('data-replica-multiplier')).toBe('1')
      expect(root.querySelectorAll(
        '[data-gc-version-state="retained_anchor"][data-gc-write-type="put"]',
      )).toHaveLength(final.storage.retainedAnchorCount)
      expect(root.querySelectorAll(
        '[data-gc-version-state="filtered"]',
      )).toHaveLength(final.storage.filteredVersionCount)
      expect(root.querySelector(
        '[data-gc-version="b-v2"][data-gc-write-type="delete"][data-gc-version-state="filtered"]',
      )).not.toBeNull()
      expect(root.querySelectorAll(
        '[data-gc-version-state="filtered"][data-gc-write-type="put"][data-gc-value-storage="write_and_default_cf"]',
      )).toHaveLength(final.storage.deletedDefaultCfValues)

      expect(root.querySelector('[data-compaction-filter-raft-entry="false"]'))
        .not.toBeNull()
      expect(root.querySelector('[data-resolve-lock-raft-detail="outside-slice"]'))
        .not.toBeNull()
      expect(root.querySelector('[data-resolve-lock-raft-detail-modeled="false"]'))
        .not.toBeNull()
      expect(lab?.textContent).toContain(
        locale === 'en'
          ? 'no SQL text, literals, real keys/values'
          : 'SQL文、literal、実key/value',
      )
      expect(lab?.textContent).toContain(
        locale === 'en'
          ? 'Raft-entry detail is outside this GC slice'
          : 'Raft entry詳細はこのGC sliceの範囲外',
      )
    }
  })

  it('mounts and clears the GC slot strictly from the selected event snapshot', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('gc-safe-point')
    const gcEvent = receipt.events.find((event) =>
      event.kind === 'gc_compaction_filter_apply')
    if (!gcEvent?.snapshot?.gcLab) {
      throw new Error('Expected an exact GC snapshot.')
    }
    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      initialIndex: 0,
      receipt: {
        id: 'gc-slot-lifecycle',
        events: [
          {
            id: 'plain-event',
            atMs: 0,
            durationMs: 1,
            domain: 'kv',
            kind: 'plain',
            label: 'Plain event',
            detail: '',
          },
          {
            ...gcEvent,
            id: 'gc-event',
            atMs: 2,
          },
        ],
      },
    })

    const slot = root.querySelector(
      '.tidb-machine__gc-slot',
    ) as unknown as HTMLElement
    expect(slot.hidden).toBe(true)
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelector('[data-event-id="plain-event"]')
      ?.getAttribute('data-event-has-gc-snapshot')).toBe('false')
    expect(root.querySelector('[data-event-id="gc-event"]')
      ?.getAttribute('data-event-has-gc-snapshot')).toBe('true')

    root.querySelector('[data-event-id="gc-event"]')
      ?.dispatchEvent(new Event('click'))
    expect(slot.hidden).toBe(false)
    expect(slot.getAttribute('aria-hidden')).toBe('false')
    expect(slot.querySelector('[data-gc-machine-state="true"]')).not.toBeNull()

    root.querySelector('[data-event-id="plain-event"]')
      ?.dispatchEvent(new Event('click'))
    expect(slot.hidden).toBe(true)
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.children).toHaveLength(0)
  })

  it('renders the exact model-7 TiFlash learner and MPP topology at event 37', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('tiflash-mpp')
    const event = receipt.events.find((candidate) =>
      candidate.id === 'trace-1-event-37')
    if (!event?.snapshot?.tiflashMppLab) {
      throw new Error('Expected the Region 26 applied-index snapshot.')
    }

    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      receipt,
      initialEventId: event.id,
    })

    const lab = root.querySelector('[data-tiflash-mpp-machine-state="true"]')
    expect(lab?.getAttribute('data-tiflash-mpp-event-id')).toBe(event.id)
    expect(lab?.getAttribute('data-tiflash-mpp-model')).toBe('model-7')
    expect(root.querySelectorAll('[data-tiflash-learner-region]')).toHaveLength(3)
    expect(root.querySelectorAll('[data-mpp-fragment]')).toHaveLength(2)
    expect(root.querySelectorAll('[data-mpp-task]')).toHaveLength(4)
    expect(root.querySelectorAll('[data-mpp-tunnel]')).toHaveLength(6)
    expect(root.querySelectorAll('[data-mpp-persistent="false"]')).toHaveLength(6)
    expect(root.querySelectorAll('[data-tiflash-learner-voter="false"]'))
      .toHaveLength(3)
    expect(root.querySelector(
      '[data-tiflash-learner-region="26"][data-applied-index="261"]',
    )).not.toBeNull()
    expect(root.querySelector(
      '[data-tiflash-learner-region="26"][data-tiflash-read-gate="waiting_applied"]',
    )).not.toBeNull()
    expect(root.querySelector(
      '[data-tiflash-mpp-semantic-graph="fragment-task"]',
    )?.getAttribute('data-causal-dag-replaced')).toBe('false')
    expect(root.querySelector(
      '[data-provisioning-means-read-ready="false"]',
    )).not.toBeNull()
    expect(root.querySelector('[data-mpp-root-task="tidb-root"]')
      ?.getAttribute('data-mpp-retry-count')).toBe('0')
    expect(root.querySelector('[data-mpp-root-task="tidb-root"]')
      ?.getAttribute('data-mpp-fallback')).toBe('false')
    expect(lab?.textContent).not.toMatch(
      /SELECT\s|GROUP BY|SQL_DIGEST|inventory|customer/i,
    )
  })

  it('clears the TiFlash/MPP slot when replay leaves an event-owned snapshot', () => {
    const dom = installTestDom()
    const root = dom.mount('machine')
    const receipt = createTiDBSimulation({ seed: 425 })
      .runScenario('tiflash-mpp')
    const detailed = receipt.events.find((candidate) =>
      candidate.id === 'trace-1-event-37')
    if (!detailed) throw new Error('Expected a detailed TiFlash event.')

    mountMachine(root as unknown as HTMLElement, {
      locale: 'en',
      initialIndex: 0,
      receipt: {
        id: 'tiflash-slot-lifecycle',
        events: [
          {
            id: 'plain-event',
            atMs: 0,
            durationMs: 1,
            domain: 'sql',
            kind: 'plain',
            label: 'Plain event',
            detail: '',
          },
          {
            ...detailed,
            id: 'tiflash-event',
          },
        ],
      },
    })

    const slot = root.querySelector(
      '.tidb-machine__tiflash-slot',
    ) as unknown as HTMLElement
    expect(slot.hidden).toBe(true)
    expect(root.querySelector('[data-event-id="plain-event"]')
      ?.getAttribute('data-event-has-tiflash-mpp-snapshot')).toBe('false')
    expect(root.querySelector('[data-event-id="tiflash-event"]')
      ?.getAttribute('data-event-has-tiflash-mpp-snapshot')).toBe('true')

    root.querySelector('[data-event-id="tiflash-event"]')
      ?.dispatchEvent(new Event('click'))
    expect(slot.hidden).toBe(false)
    expect(slot.querySelector('[data-tiflash-mpp-machine-state="true"]'))
      .not.toBeNull()

    root.querySelector('[data-event-id="plain-event"]')
      ?.dispatchEvent(new Event('click'))
    expect(slot.hidden).toBe(true)
    expect(slot.children).toHaveLength(0)
  })
})
