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
    expect(root.querySelector('[data-lane="txn2pc"]')?.textContent).toContain('2PC')
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
})
