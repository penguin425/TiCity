// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTraceInspector } from './trace-inspector'
import type { TraceInspectionEvent } from './trace-inspection'

describe('shared event inspector', () => {
  const events: readonly TraceInspectionEvent[] = [
    { id: 'request', kind: 'submit', path: 'critical' },
    { id: 'other', kind: 'route', dependsOn: ['request'] },
    { id: 'selected', kind: 'snapshot_ts', dependsOn: ['request'], presentationAfter: 'other', path: 'critical' },
    { id: 'child', kind: 'return', dependsOn: ['selected'], path: 'background' },
  ]

  it('renders localized parent/child/fence sections and performs only the selection callback', () => {
    const dom = installTestDom()
    const root = dom.mount('inspector')
    const selected: string[] = []
    const before = JSON.stringify(events)
    root.append(createTraceInspector({ events }, events[2], 'ja', (id) => selected.push(id)) as never)
    expect(root.querySelector('details')?.getAttribute('open')).toBe('')
    expect(root.textContent).toContain('直接の因果親 (1)')
    expect(root.textContent).toContain('直接の因果子 (1)')
    expect(root.textContent).toContain('因果親・因果子には含めません')
    expect(root.textContent).toContain('このモデルの参照実装')
    expect(root.textContent).toContain('行単位の対応ではありません')
    expect(root.querySelector('[data-inspector-relations="parent"]')?.textContent).toContain('request')
    expect(root.querySelector('[data-inspector-relations="parent"]')?.textContent).not.toContain('other')
    expect(root.querySelector('[data-inspector-fence]')?.textContent).toContain('other')
    const button = root.querySelector('[data-inspector-select="child"]')
    expect(button?.getAttribute('type')).toBe('button')
    expect(button?.getAttribute('aria-label')).toContain('イベント child を選択')
    button?.click()
    expect(selected).toEqual(['child'])
    expect(JSON.stringify(events)).toBe(before)
    expect(root.querySelectorAll('[data-inspector-source]')).toHaveLength(2)
    expect(root.querySelector('[data-inspector-source]')?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('allows City to start folded and limits a large direct-neighbor list', () => {
    const dom = installTestDom()
    const root = dom.mount('bounded-inspector')
    const children = Array.from({ length: 20 }, (_, index) => ({ id: `child-${index}`, dependsOn: ['request'] }))
    root.append(createTraceInspector({ events: [events[0], ...children] }, events[0], 'en', () => {}, { open: false }) as never)
    expect(root.querySelector('details')?.getAttribute('open')).toBeNull()
    expect(root.querySelectorAll('[data-inspector-relation="child"]')).toHaveLength(8)
    expect(root.textContent).toContain('Direct causal children (20)')
    expect(root.textContent).toContain('12 more')
    expect(root.textContent).toContain('MODEL / SIMULATED')
  })

  it('shows final-state selection guidance and honest unspecified paths', () => {
    const dom = installTestDom()
    const root = dom.mount('empty-inspector')
    root.append(createTraceInspector({ events }, null, 'en') as never)
    expect(root.textContent).toContain('Select an event')
    expect(root.querySelectorAll('a')).toHaveLength(0)
    root.replaceChildren(createTraceInspector({ events }, events[1], 'en') as never)
    expect(root.querySelector('[data-inspector-path="unspecified"]')?.textContent).toContain('No path is specified')
    expect(root.querySelectorAll('button')).toHaveLength(0)
  })
})
