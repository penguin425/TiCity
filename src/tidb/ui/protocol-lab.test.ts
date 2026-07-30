// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model'
import type { TraceEvent } from '../model/types'
import { createProtocolLabPanel } from './protocol-lab'

function protocolEvents(): readonly TraceEvent[] {
  return createTiDBSimulation({ seed: 425 })
    .runScenario('commit-protocols')
    .events
}

function eventBy(
  events: readonly TraceEvent[],
  kind: string,
  branchId?: string,
): TraceEvent {
  const event = events.find((candidate) =>
    candidate.kind === kind &&
    (branchId === undefined || candidate.branchId === branchId))
  if (!event) {
    throw new Error(`Expected ${kind}${branchId ? ` in ${branchId}` : ''}.`)
  }
  return event
}

describe('Commit Protocol Lab accessible projection', () => {
  it('renders every immutable model-5 snapshot into three fixed comparison lanes', () => {
    installTestDom()
    const panel = createProtocolLabPanel('en')
    const events = protocolEvents()

    for (const event of events) {
      expect(() => panel.update(event, [event])).not.toThrow()
      expect(panel.root.hidden).toBe(false)
      expect(panel.root.querySelectorAll('[data-protocol-lane]')).toHaveLength(3)
    }

    const response = eventBy(
      events,
      'protocol_client_response',
      'async_commit',
    )
    panel.update(response)

    expect(panel.root.getAttribute('tabindex')).toBe('0')
    expect(panel.root.textContent).toContain('MODEL / SIMULATED')
    expect(panel.root.textContent).toContain('Commit Protocol Lab')
    expect(panel.root.getAttribute('data-protocol-phase')).toBe('running')

    const onePc = panel.root.querySelector('[data-protocol-lane="one_pc"]')
    const asyncCommit = panel.root.querySelector(
      '[data-protocol-lane="async_commit"]',
    )
    const twoPc = panel.root.querySelector('[data-protocol-lane="two_pc"]')
    expect(onePc?.getAttribute('data-selected-protocol')).toBe('1pc')
    expect(asyncCommit?.getAttribute('data-selected-protocol'))
      .toBe('async_commit')
    expect(twoPc?.getAttribute('data-selected-protocol')).toBe('2pc')
    expect(onePc?.querySelectorAll('[data-protocol-region]')).toHaveLength(1)
    expect(asyncCommit?.querySelectorAll('[data-protocol-region]'))
      .toHaveLength(2)
    expect(twoPc?.querySelectorAll('[data-protocol-region]')).toHaveLength(2)

    expect(asyncCommit?.textContent).toContain('2 aggregate mutations')
    expect(asyncCommit?.textContent).toContain('2/256 keys')
    expect(asyncCommit?.textContent).toContain(
      'Multi-Region representative fixture within both limits',
    )
    expect(asyncCommit?.textContent).toContain('latest_ts · PD')
    expect(asyncCommit?.textContent)
      .toContain('commit_ts · max Region min_commit_ts')
  })

  it('shows Region-local Raft quorum and MVCC without conflating them with transaction commit', () => {
    installTestDom()
    const panel = createProtocolLabPanel('en')
    const events = protocolEvents()
    const prewriteResult = events.find((candidate) =>
      candidate.kind === 'async_prewrite_result' &&
      candidate.regionId === 25)
    if (!prewriteResult) throw new Error('Expected Async Region 25 result.')

    panel.update(prewriteResult)

    const boundary = panel.root.querySelector(
      '[data-layer-boundary="transaction-vs-region-raft"]',
    )
    expect(boundary?.textContent).toContain(
      '1PC, Async Commit, and 2PC are transaction commit protocols',
    )
    expect(boundary?.textContent).toContain(
      'separate, Region-local Raft quorum',
    )
    expect(boundary?.textContent).toContain(
      'Per-Region Raft consensus (3 voters / quorum 2)',
    )

    const region = panel.root.querySelector(
      '[data-protocol-lane="async_commit"] ' +
      '[data-protocol-region="25"]',
    )
    expect(region?.getAttribute('data-raft-operation')).toBe('prewrite')
    expect(region?.getAttribute('data-raft-stage')).toBe('applied')
    expect(region?.getAttribute('data-mvcc-default')).toBe('value')
    expect(region?.getAttribute('data-mvcc-lock')).toBe('prewrite')
    expect(region?.getAttribute('data-mvcc-write')).toBe('empty')
    expect(region?.textContent).toContain('Persistence quorum2/2 · 3 voters')
    expect(region?.textContent).toContain('Async Commit lock metadataYes')
    expect(region?.textContent).not.toContain('Returned min_commit_tsNone')

    const onePcResponse = eventBy(
      events,
      'protocol_client_response',
      'one_pc',
    )
    panel.update(onePcResponse)
    const onePcRegion = panel.root.querySelector(
      '[data-protocol-lane="one_pc"] [data-protocol-region]',
    )
    expect(onePcRegion?.getAttribute('data-raft-operation'))
      .toBe('one_pc_prewrite')
    expect(onePcRegion?.getAttribute('data-mvcc-lock')).toBe('empty')
    expect(onePcRegion?.getAttribute('data-mvcc-write')).toBe('commit')
  })

  it('marks the client response separately from deterministic background cleanup', () => {
    installTestDom()
    const panel = createProtocolLabPanel('en')
    const events = protocolEvents()

    panel.update(eventBy(events, 'protocol_client_response', 'async_commit'))
    const asyncLane = panel.root.querySelector(
      '[data-protocol-lane="async_commit"]',
    )
    expect(asyncLane?.querySelector('[data-client-state="responded"]')
      ?.textContent).toContain('Committed response sent')
    expect(asyncLane?.querySelector('[data-background-state="pending"]')
      ?.textContent).toContain('Pending after client response')
    expect(asyncLane?.querySelectorAll('[data-mvcc-lock="prewrite"]'))
      .toHaveLength(2)

    panel.update(eventBy(events, 'protocol_branch_complete', 'async_commit'))
    expect(asyncLane?.querySelector('[data-background-state="complete"]')
      ?.textContent).toContain('Complete')
    expect(asyncLane?.querySelectorAll('[data-mvcc-lock="empty"]'))
      .toHaveLength(2)

    panel.update(eventBy(events, 'protocol_client_response', 'two_pc'))
    const twoPcLane = panel.root.querySelector(
      '[data-protocol-lane="two_pc"]',
    )
    expect(twoPcLane?.querySelector('[data-client-state="responded"]'))
      .not.toBeNull()
    expect(twoPcLane?.querySelector('[data-background-state="pending"]'))
      .not.toBeNull()
    expect(
      twoPcLane
        ?.querySelector('[data-region-role="primary"]')
        ?.getAttribute('data-mvcc-write'),
    ).toBe('commit')
    expect(
      twoPcLane
        ?.querySelector('[data-region-role="secondary"]')
        ?.getAttribute('data-mvcc-lock'),
    ).toBe('prewrite')

    const onePcLane = panel.root.querySelector(
      '[data-protocol-lane="one_pc"]',
    )
    expect(onePcLane?.querySelector('[data-background-state="not_required"]')
      ?.textContent).toContain('Not required')
  })

  it('keeps nodes stable, exposes one polite phase, localizes, and ignores event copy', () => {
    installTestDom()
    const panel = createProtocolLabPanel('en')
    document.body.append(panel.root)
    const events = protocolEvents()
    const first = eventBy(events, 'protocol_comparison_start')
    const complete = eventBy(events, 'protocol_lab_complete')

    panel.update(first, [first])
    const laneNodes = panel.root.querySelectorAll('[data-protocol-lane]')
    const regionSlots = panel.root.querySelectorAll('[data-region-slot]')
    expect(panel.root.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
    const live = panel.root.querySelector('[role="status"]')
    expect(live?.getAttribute('aria-live')).toBe('polite')
    expect(live?.getAttribute('aria-atomic')).toBe('true')

    const poisoned: TraceEvent = {
      ...complete,
      label: 'SELECT private_literal FROM secret_table',
      detail: 'encoded-key=private-key row-value=private-value',
    }
    panel.update(poisoned, [{
      ...poisoned,
      label: 'active-private-label',
    }])
    expect(panel.root.querySelectorAll('[data-protocol-lane]'))
      .toEqual(laneNodes)
    expect(panel.root.querySelectorAll('[data-region-slot]'))
      .toEqual(regionSlots)
    expect(panel.root.textContent).not.toContain('private_literal')
    expect(panel.root.textContent).not.toContain('private-key')
    expect(panel.root.textContent).not.toContain('active-private-label')
    expect(panel.root.textContent).toContain(
      'SQL text, literals, real or encoded keys, row values, and result rows',
    )
    expect(live?.textContent).toBe('Phase: Comparison complete')

    panel.setLocale('ja')
    expect(panel.root.querySelectorAll('[data-protocol-lane]'))
      .toEqual(laneNodes)
    expect(panel.root.textContent).toContain('コミットプロトコル Lab')
    expect(panel.root.textContent).toContain(
      '1PC・Async Commit・2PCはトランザクションのcommit方式',
    )
    expect(live?.textContent).toBe('フェーズ: 比較完了')

    panel.update(null)
    expect(panel.root.hidden).toBe(true)
    expect(panel.root.querySelectorAll('[data-protocol-lane]'))
      .toEqual(laneNodes)
    panel.dispose()
    expect(panel.root.parentNode).toBeNull()
  })
})
