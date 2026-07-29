// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { MACHINE_LANES, mountMachine } from './index'

describe('TiDB machine replay', () => {
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
})
