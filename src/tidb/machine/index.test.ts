// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { MACHINE_CSS, MACHINE_LANES, mountMachine } from './index'

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
})
