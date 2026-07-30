// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model/simulation'
import type { TraceEvent, TraceReceipt } from '../model/types'
import { createTiFlashMppLabPanel } from './tiflash-mpp-lab'

function trace(): TraceReceipt {
  return createTiDBSimulation({ seed: 425 }).runScenario('tiflash-mpp')
}

function detailedEvents(receipt: TraceReceipt): TraceEvent[] {
  return receipt.events.filter(
    (event) => event.snapshot?.tiflashMppLab !== undefined,
  )
}

describe('TiFlash MPP Lab accessible projection', () => {
  it('renders provisioning separately from three exact Region snapshot gates', () => {
    installTestDom()
    const receipt = trace()
    const waiting = detailedEvents(receipt).find(
      (event) => event.id === 'trace-1-event-37',
    )
    expect(waiting).toBeDefined()
    expect(waiting?.id).toBe('trace-1-event-37')
    expect(waiting?.snapshot?.tiflashMppLab?.learners.some(
      (learner) => learner.readGate === 'waiting_applied',
    )).toBe(true)

    const panel = createTiFlashMppLabPanel('en')
    panel.update(waiting!)

    expect(panel.root.hidden).toBe(false)
    expect(panel.root.getAttribute('tabindex')).toBe('0')
    expect(panel.root.getAttribute('role')).toBe('region')
    expect(panel.root.dataset.resultRepresentation)
      .toBe('aggregate_counts_only')
    expect(panel.root.dataset.resultRowsProjected).toBe('false')
    expect(panel.root.querySelector('[role="status"]')?.getAttribute(
      'aria-live',
    )).toBe('polite')
    expect(panel.root.querySelector(
      '[data-provisioning-meaning="placement_only_not_snapshot_readiness"]',
    )).not.toBeNull()
    expect(panel.root.textContent).toContain(
      'Provisioning available means placement is complete only',
    )
    expect(panel.root.querySelectorAll('[data-region-id]')).toHaveLength(3)
    expect(panel.root.querySelectorAll(
      '[data-learner-voter="false"]',
    )).toHaveLength(3)

    const snapshot = waiting!.snapshot!.tiflashMppLab!
    const advanced = snapshot.learners.find(
      (learner) => learner.regionId === 26,
    )!
    expect(advanced.readGate).toBe('waiting_applied')
    expect(advanced.learnerAppliedIndex).toBe(advanced.requiredReadIndex)
    const row = panel.root.querySelector(
      `[data-region-id="${advanced.regionId}"]`,
    )
    expect(row?.textContent).toContain(String(advanced.leaderCommitIndex))
    expect(row?.textContent).toContain(String(advanced.learnerReceivedIndex))
    expect(row?.textContent).toContain(String(advanced.learnerAppliedIndex))
    expect(row?.textContent).toContain(String(advanced.requiredReadIndex))
    expect(row?.textContent).toContain(
      'Applied index reached required ReadIndex',
    )
  })

  it('shows two fragments, four tasks, six local/remote/root tunnels, and root gather', () => {
    installTestDom()
    const receipt = trace()
    const complete = detailedEvents(receipt).at(-1)!
    const panel = createTiFlashMppLabPanel('en')
    panel.update(complete)

    expect(panel.root.querySelectorAll(
      '.tidb-tiflash-mpp-lab__fragment',
    )).toHaveLength(2)
    expect(panel.root.querySelectorAll('[data-task-id]')).toHaveLength(4)
    expect(panel.root.querySelectorAll('[data-tunnel-id]')).toHaveLength(6)
    expect(panel.root.querySelectorAll(
      '[data-tunnel-persistence="ephemeral_query_blocks"]',
    )).toHaveLength(6)
    expect(panel.root.textContent).toContain('table_full_scan')
    expect(panel.root.textContent).toContain('exchange_receiver')
    expect(panel.root.textContent).toContain('local')
    expect(panel.root.textContent).toContain('cross-store')
    expect(panel.root.textContent).toContain('TiDB root')
    expect(panel.root.querySelector('[data-root-stage]')?.getAttribute(
      'data-root-stage',
    )).toBe('client_complete')
    expect(panel.root.querySelector('[data-root-stage]')?.textContent)
      .toContain('Client completeYes')
    expect(panel.root.textContent).toContain(
      'Learners are non-voters and never join the TiKV quorum',
    )
  })

  it('switches to Japanese while preserving exact synthetic state', () => {
    installTestDom()
    const complete = detailedEvents(trace()).at(-1)!
    const panel = createTiFlashMppLabPanel('en')
    panel.update(complete)
    panel.setLocale('ja')

    expect(panel.root.textContent).toContain('TiFlash Replication / MPP Lab')
    expect(panel.root.textContent).toContain(
      'provisioning availableはplacement完了だけ',
    )
    expect(panel.root.textContent).toContain(
      'learnerは非voterでTiKV quorumには参加しません',
    )
    expect(panel.root.querySelector('[role="status"]')?.textContent)
      .toContain('フェーズ: 完了')
  })

  it('never renders event payloads, requires the exact discriminator, caches, hides, and disposes', () => {
    installTestDom()
    const complete = detailedEvents(trace()).at(-1)!
    const poisoned: TraceEvent = {
      ...complete,
      label: 'TOP-SECRET-SQL-LABEL',
      detail: 'TOP-SECRET-ROW-VALUE',
      metadata: {
        privateLiteral: 'TOP-SECRET-LITERAL',
      },
    }
    const activePoison = {
      ...poisoned,
      id: 'active-poison',
      label: 'TOP-SECRET-ACTIVE-EVENT',
    }
    const panel = createTiFlashMppLabPanel('en')
    document.body.append(panel.root)

    panel.update(poisoned, [activePoison])
    expect(panel.root.textContent).not.toContain('TOP-SECRET')
    expect(panel.root.textContent).toContain(
      'SQL text, literals, real or encoded keys, values, rows, and result rows are neither retained nor projected.',
    )
    const firstChild = panel.root.firstChild
    panel.update(poisoned, [activePoison])
    expect(panel.root.firstChild).toBe(firstChild)

    panel.update({
      ...complete,
      id: 'legacy-tiflash-event',
      snapshot: {
        modelVersion: 'tidb-v8.5-model-7',
        tsoLastAllocated: 1,
        transaction: null,
        regions: [],
      },
    })
    expect(panel.root.hidden).toBe(true)
    expect(panel.root.childNodes).toHaveLength(0)

    panel.dispose()
    expect(panel.root.parentNode).toBeNull()
    expect(() => panel.dispose()).not.toThrow()
  })
})
