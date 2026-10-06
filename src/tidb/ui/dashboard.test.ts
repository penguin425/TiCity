// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import type { DashboardSample, DashboardSnapshot } from './dashboard-metrics'
import { createCityDashboard } from './dashboard'

function point(overrides: Partial<DashboardSample> = {}): DashboardSample {
  return Object.freeze({
    modelTimeSeconds: 5,
    statementsPerSecond: 12,
    commitsPerSecond: 3,
    raftEntriesPerSecond: 9,
    healthyRegions: 3,
    totalRegions: 4,
    gcBacklog: 8,
    tiflashLagSeconds: 0.4,
    tiflashAvailable: true,
    ...overrides,
  })
}

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return Object.freeze({
    ...point(),
    status: 'running',
    rateWindowSeconds: 5,
    observedWindowSeconds: 5,
    history: Object.freeze([point({ modelTimeSeconds: 4, statementsPerSecond: 10 }), point()]),
    ...overrides,
  })
}

describe('City dashboard', () => {
  it('projects all six current values and labels their educational model boundary', () => {
    installTestDom()
    const dashboard = createCityDashboard('en')
    const view = snapshot()
    const before = JSON.stringify(view)
    dashboard.update(view)

    expect(dashboard.root.querySelectorAll('[data-dashboard-metric]')).toHaveLength(6)
    for (const [metric, value] of Object.entries({ statements: '12', commits: '3', raft: '9', regions: '3 / 4', gc: '8', tiflash: '0.4' })) {
      expect(dashboard.root.querySelector(`[data-dashboard-metric="${metric}"] [data-dashboard-value]`)?.textContent).toBe(value)
    }
    expect(dashboard.root.textContent).toContain('MODEL / SIMULATED')
    expect(dashboard.root.textContent).toContain('not live-cluster monitoring')
    expect(dashboard.root.textContent).toContain('Background load · 5 / 5 model s')
    expect(dashboard.root.querySelector('[data-dashboard-time]')?.textContent).toBe('Model time 0:05')
    expect(dashboard.root.querySelector('[aria-live="polite"]')).toBeNull()
    expect(dashboard.root.querySelector('[aria-live="assertive"]')).toBeNull()
    for (const svg of dashboard.root.querySelectorAll('[data-dashboard-sparkline]')) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('focusable')).toBe('false')
    }
    expect(JSON.stringify(view)).toBe(before)
    dashboard.dispose()
  })

  it('distinguishes unobserved rates and unavailable TiFlash from an actual zero', () => {
    installTestDom()
    const dashboard = createCityDashboard('ja')
    dashboard.update(snapshot({
      statementsPerSecond: null,
      commitsPerSecond: 0,
      raftEntriesPerSecond: null,
      tiflashLagSeconds: null,
      tiflashAvailable: false,
      gcBacklog: 0,
      status: 'warming',
      observedWindowSeconds: 0,
      history: [],
    }))
    expect(dashboard.root.querySelector('[data-dashboard-metric="statements"] [data-dashboard-value]')?.textContent).toBe('—')
    expect(dashboard.root.querySelector('[data-dashboard-metric="commits"] [data-dashboard-value]')?.textContent).toBe('0')
    expect(dashboard.root.querySelector('[data-dashboard-metric="gc"] [data-dashboard-value]')?.textContent).toBe('0')
    expect(dashboard.root.querySelector('[data-dashboard-metric="tiflash"] [data-dashboard-note]')?.textContent).toBe('TiFlash 未利用')
    expect(dashboard.root.querySelector('[data-dashboard-status]')?.textContent).toBe('集計中')
    expect(dashboard.root.querySelector('[data-dashboard-sparkline] path')?.getAttribute('d')).toBe('')
    dashboard.dispose()
  })

  it('keeps controls and help stable across sampling and language changes, and disposes actions', () => {
    const dom = installTestDom()
    const expansions: boolean[] = []
    const dashboard = createCityDashboard('en', { initialExpanded: false, onExpandedChange: (value) => expansions.push(value) })
    dom.mount('dashboard-test').append(dashboard.root as never)
    const toggle = dashboard.root.querySelector<HTMLButtonElement>('[data-action="dashboard-toggle"]')!
    const metrics = dashboard.root.querySelector<HTMLElement>('[data-dashboard-metrics]')!
    const help = dashboard.root.querySelector('[data-dashboard-help]')!
    expect(metrics.hidden).toBe(true)
    toggle.focus()
    toggle.click()
    expect(dashboard.expanded).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(metrics.hidden).toBe(false)
    dashboard.update(snapshot())
    dashboard.setLocale('ja')
    expect(dashboard.root.querySelector('[data-action="dashboard-toggle"]')).toBe(toggle)
    expect(dashboard.root.querySelector('[data-dashboard-help]')).toBe(help)
    expect(dom.document.activeElement).toBe(toggle)
    expect(toggle.textContent).toBe('指標を隠す')
    expect(dashboard.root.querySelector('summary')?.textContent).toBe('指標の読み方')
    metrics.focus()
    dashboard.setExpanded(false)
    expect(dom.document.activeElement).toBe(toggle)
    expect(expansions).toEqual([true, false])
    dashboard.dispose()
    toggle.click()
    dashboard.setExpanded(true)
    dashboard.setLocale('en')
    expect(expansions).toEqual([true, false])
    expect(toggle.textContent).toBe('指標を表示')
  })

  it('plots observed timestamps with genuine missing-value gaps rather than generated samples', () => {
    installTestDom()
    const dashboard = createCityDashboard('en')
    dashboard.update(snapshot({ history: [
      point({ modelTimeSeconds: 1, tiflashLagSeconds: 0.2 }),
      point({ modelTimeSeconds: 2, tiflashLagSeconds: null }),
      point({ modelTimeSeconds: 5, tiflashLagSeconds: 0.4 }),
    ] }))
    const chart = dashboard.root.querySelector('[data-dashboard-metric="tiflash"] [data-dashboard-sparkline]')!
    const path = chart.querySelector('path')?.getAttribute('d') ?? ''
    expect(chart.getAttribute('aria-hidden')).toBe('true')
    expect(path.match(/M/g)).toHaveLength(2)
    expect(path).not.toContain('L')
    expect(path).toContain('M2.00,')
    expect(path).toContain('M86.00,')
    const statements = dashboard.root.querySelector('[data-dashboard-metric="statements"] [data-dashboard-sparkline] path')?.getAttribute('d') ?? ''
    expect(statements.match(/M/g)).toHaveLength(2)
    expect(statements.match(/L/g)).toHaveLength(1)
    const next = snapshot({ status: 'paused', history: [] })
    dashboard.update(next)
    expect(chart.querySelector('path')?.getAttribute('d')).toBe('')
    expect(chart.querySelector('circle')?.getAttribute('visibility')).toBe('hidden')
    expect(dashboard.root.querySelector('[data-dashboard-status]')?.textContent).toBe('Paused')
    dashboard.dispose()
  })

  it('closes help with Escape or an outside click, restores focus, and removes listeners', () => {
    const dom = installTestDom()
    const changes: boolean[] = []
    const dashboard = createCityDashboard('en', { onHelpChange: (open) => changes.push(open) })
    const help = dashboard.root.querySelector<HTMLDetailsElement>('[data-dashboard-help]')!
    const summary = help.querySelector<HTMLElement>('summary')!
    const openHelp = (): void => {
      help.open = true
      help.dispatchEvent(new Event('toggle'))
    }
    openHelp()
    expect(dashboard.root.dataset.helpOpen).toBe('true')
    const escape = new Event('keydown', { cancelable: true })
    Object.defineProperty(escape, 'key', { value: 'Escape' })
    dashboard.root.dispatchEvent(escape)
    expect(help.open).toBe(false)
    expect(escape.defaultPrevented).toBe(true)
    expect(dom.document.activeElement).toBe(summary)
    expect(dashboard.expanded).toBe(true)
    openHelp()
    dom.document.dispatchEvent(new Event('click'))
    expect(help.open).toBe(false)
    expect(changes).toEqual([true, false, true, false])
    dashboard.dispose()
    openHelp()
    dom.document.dispatchEvent(new Event('pointerdown'))
    expect(help.open).toBe(true)
    expect(changes).toEqual([true, false, true, false])
  })

  it('defaults to collapsed at short heights while respecting an explicit initial choice', () => {
    const dom = installTestDom()
    Reflect.set(dom.window, 'matchMedia', (query: string) => ({ matches: query.includes('max-height: 700px') }))
    const compact = createCityDashboard('ja')
    expect(compact.expanded).toBe(false)
    const selected = createCityDashboard('ja', { initialExpanded: true })
    expect(selected.expanded).toBe(true)
    compact.dispose()
    selected.dispose()
  })
})
