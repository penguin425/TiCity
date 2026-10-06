// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

import './dashboard.css'

import { CATALOG, type Locale } from './catalog'
import type { DashboardSample, DashboardSnapshot } from './dashboard-metrics'
import { element, svgElement } from './dom'

export type DashboardMetricId = 'statements' | 'commits' | 'raft' | 'regions' | 'gc' | 'tiflash'

const METRICS: readonly DashboardMetricId[] = ['statements', 'commits', 'raft', 'regions', 'gc', 'tiflash']

export interface CityDashboardOptions {
  readonly initialExpanded?: boolean
  readonly onExpandedChange?: (expanded: boolean) => void
  readonly onHelpChange?: (open: boolean) => void
}

export interface CityDashboard {
  readonly root: HTMLElement
  readonly expanded: boolean
  update(snapshot: DashboardSnapshot): void
  setLocale(locale: Locale): void
  setExpanded(expanded: boolean): void
  dispose(): void
}

interface MetricCard {
  readonly root: HTMLDivElement
  readonly name: HTMLElement
  readonly value: HTMLElement
  readonly note: HTMLElement
  readonly path: SVGPathElement
  readonly dot: SVGCircleElement
  readonly sparkline: SVGSVGElement
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text
}

function modelClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const minutes = Math.floor(safe / 60)
  const remainder = String(safe % 60).padStart(2, '0')
  if (minutes < 60) return `${minutes}:${remainder}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
}

function historyValue(sample: DashboardSample, metric: DashboardMetricId): number | null {
  switch (metric) {
    case 'statements': return sample.statementsPerSecond
    case 'commits': return sample.commitsPerSecond
    case 'raft': return sample.raftEntriesPerSecond
    case 'regions': return sample.healthyRegions
    case 'gc': return sample.gcBacklog
    case 'tiflash': return sample.tiflashLagSeconds
  }
}

/** Each point comes from an observed model snapshot. Missing data leaves a gap. */
function updateSparkline(card: MetricCard, history: readonly DashboardSample[], metric: DashboardMetricId): void {
  let maximum = 1
  for (const sample of history) {
    const value = historyValue(sample, metric)
    if (value !== null && Number.isFinite(value)) maximum = Math.max(maximum, value)
  }
  maximum *= 1.1
  const firstTime = history[0]?.modelTimeSeconds ?? 0
  const lastTime = history[history.length - 1]?.modelTimeSeconds ?? firstTime
  const interval = lastTime - firstTime
  let path = ''
  let connected = false
  let previousBucket: number | null = null
  let lastPoint: { x: number; y: number } | null = null
  for (const sample of history) {
    const bucket = Math.floor(sample.modelTimeSeconds + 1e-9)
    if (previousBucket !== null && bucket - previousBucket > 1) connected = false
    previousBucket = bucket
    const value = historyValue(sample, metric)
    if (value === null || !Number.isFinite(value)) {
      connected = false
      lastPoint = null
      continue
    }
    const x = interval > 0 ? 2 + 84 * (sample.modelTimeSeconds - firstTime) / interval : 44
    const y = 22 - 20 * Math.max(0, value) / maximum
    path += `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `
    connected = true
    lastPoint = { x, y }
  }
  const nextPath = path.trim()
  if (card.path.getAttribute('d') !== nextPath) card.path.setAttribute('d', nextPath)
  card.dot.setAttribute('visibility', lastPoint === null ? 'hidden' : 'visible')
  if (lastPoint !== null) {
    card.dot.setAttribute('cx', lastPoint.x.toFixed(2))
    card.dot.setAttribute('cy', lastPoint.y.toFixed(2))
  }
  card.sparkline.dataset.samples = String(history.length)
}

function createCard(metric: DashboardMetricId): MetricCard {
  const root = element('div', {
    className: 'tidb-dashboard__metric',
    attrs: { 'data-dashboard-metric': metric },
  })
  const name = element('dt', { className: 'tidb-dashboard__metric-name' })
  const value = element('span', { attrs: { 'data-dashboard-value': '' } })
  const sparkline = svgElement('svg', {
    viewBox: '0 0 88 24',
    width: '88',
    height: '24',
    'aria-hidden': 'true',
    focusable: 'false',
    'data-dashboard-sparkline': '',
    class: 'tidb-dashboard__sparkline',
  })
  const baseline = svgElement('line', { x1: '2', x2: '86', y1: '22', y2: '22', class: 'tidb-dashboard__baseline' })
  const path = svgElement('path', { fill: 'none', 'stroke-width': '1.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
  const dot = svgElement('circle', { r: '1.7', visibility: 'hidden' })
  sparkline.append(baseline, path, dot)
  const reading = element('div', { className: 'tidb-dashboard__reading' }, value, sparkline)
  const note = element('p', { className: 'tidb-dashboard__note', attrs: { 'data-dashboard-note': '' } })
  root.append(name, element('dd', { className: 'tidb-dashboard__metric-value' }, reading, note))
  return { root, name, value, note, path, dot, sparkline }
}

export function createCityDashboard(initialLocale: Locale, options: CityDashboardOptions = {}): CityDashboard {
  let locale = initialLocale
  let disposed = false
  let latest: DashboardSnapshot | null = null
  let number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  let integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const compact = typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 700px), (max-height: 700px)').matches
  let expanded = options.initialExpanded ?? !compact
  let helpOpen = false
  const root = element('section', {
    className: 'tidb-dashboard',
    attrs: { 'data-dashboard': '', 'data-expanded': String(expanded), 'data-help-open': 'false' },
  })
  const title = element('strong', { className: 'tidb-dashboard__title' })
  const model = element('span', { className: 'tidb-dashboard__badge' })
  const time = element('span', { className: 'tidb-dashboard__time', attrs: { 'data-dashboard-time': '' } })
  const status = element('span', { className: 'tidb-dashboard__status', attrs: { 'data-dashboard-status': '' } })
  const help = element('details', { className: 'tidb-dashboard__help', attrs: { 'data-dashboard-help': '' } })
  const summary = element('summary')
  const explanation = element('div', { className: 'tidb-dashboard__explanation', attrs: { tabindex: '0' } })
  const boundary = element('p', { className: 'tidb-dashboard__boundary' })
  const sampling = element('p')
  const definitions = element('dl', { className: 'tidb-dashboard__definitions' })
  const definitionsByMetric = new Map<DashboardMetricId, { name: HTMLElement; description: HTMLElement }>()
  for (const metric of METRICS) {
    const name = element('dt')
    const description = element('dd')
    definitions.append(element('div', {}, name, description))
    definitionsByMetric.set(metric, { name, description })
  }
  explanation.append(boundary, sampling, definitions)
  help.append(summary, explanation)
  const toggle = element('button', {
    className: 'tidb-dashboard__toggle',
    attrs: { type: 'button', 'data-action': 'dashboard-toggle', 'aria-controls': 'tidb-dashboard-metrics' },
  })
  const header = element('div', { className: 'tidb-dashboard__header' }, title, model, time, status, help, toggle)
  const metrics = element('dl', {
    className: 'tidb-dashboard__metrics',
    attrs: { id: 'tidb-dashboard-metrics', 'data-dashboard-metrics': '', tabindex: '0' },
  })
  const cards = new Map<DashboardMetricId, MetricCard>()
  for (const metric of METRICS) {
    const card = createCard(metric)
    cards.set(metric, card)
    metrics.append(card.root)
  }
  root.append(header, metrics)

  const render = (): void => {
    const copy = CATALOG[locale].dashboard
    root.setAttribute('aria-label', copy.ariaLabel)
    setText(title, copy.title)
    setText(model, CATALOG[locale].modelBadge)
    setText(time, `${copy.modelTime} ${modelClock(latest?.modelTimeSeconds ?? 0)}`)
    root.dataset.modelTime = String(latest?.modelTimeSeconds ?? 0)
    root.dataset.sampleCount = String(latest?.history.length ?? 0)
    root.dataset.status = latest?.status ?? 'warming'
    const state = latest?.status ?? 'warming'
    setText(status, state === 'paused' ? copy.paused : state === 'warming' ? copy.awaitingWindow : copy.running)
    setText(summary, copy.help)
    setText(boundary, copy.boundary)
    setText(sampling, copy.sampling)
    setText(toggle, expanded ? copy.hide : copy.show)
    toggle.setAttribute('aria-label', expanded ? copy.hideAria : copy.showAria)
    toggle.setAttribute('aria-expanded', String(expanded))
    metrics.hidden = !expanded
    metrics.setAttribute('aria-label', copy.history)
    for (const metric of METRICS) {
      const card = cards.get(metric)!
      const definition = definitionsByMetric.get(metric)!
      setText(card.name, copy.metric[metric])
      card.root.title = copy.metricHelp[metric]
      setText(definition.name, copy.metric[metric])
      setText(definition.description, copy.metricHelp[metric])
      let value: number | null = null
      let display = copy.unavailable
      let note = copy.awaitingWindow
      if (latest !== null) {
        value = historyValue(latest, metric)
        if (metric === 'regions') {
          display = `${integer.format(latest.healthyRegions)} / ${integer.format(latest.totalRegions)}`
          note = copy.regionsHealthy
          card.root.dataset.total = String(latest.totalRegions)
        } else if (metric === 'gc') {
          display = integer.format(latest.gcBacklog)
          note = copy.versions
        } else if (metric === 'tiflash') {
          display = value === null ? copy.unavailable : number.format(value)
          note = value === null ? copy.tiflashUnavailable : copy.history
        } else {
          display = value === null ? copy.unavailable : number.format(value)
          note = value === null ? copy.awaitingWindow : copy.rateWindow(number.format(latest.observedWindowSeconds))
        }
      }
      setText(card.value, display)
      setText(card.note, note)
      card.root.dataset.value = value === null ? '' : String(value)
      updateSparkline(card, latest?.history ?? [], metric)
    }
  }

  const setExpanded = (next: boolean): void => {
    if (disposed || next === expanded) return
    // Return focus to the control before hiding a keyboard-scrollable metric strip.
    if (!next && metrics.contains(document.activeElement)) toggle.focus({ preventScroll: true })
    expanded = next
    root.dataset.expanded = String(next)
    render()
    options.onExpandedChange?.(next)
  }
  const onToggle = (): void => setExpanded(!expanded)
  const syncHelp = (): void => {
    if (disposed || help.open === helpOpen) return
    helpOpen = help.open
    root.dataset.helpOpen = String(helpOpen)
    options.onHelpChange?.(helpOpen)
  }
  const closeHelp = (focus: boolean): void => {
    if (disposed || !help.open) return
    help.open = false
    syncHelp()
    if (focus) summary.focus({ preventScroll: true })
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !help.open) return
    event.preventDefault()
    event.stopPropagation()
    closeHelp(true)
  }
  const onOutsideClick = (event: Event): void => {
    if (help.open && event.target instanceof Node && !help.contains(event.target)) closeHelp(false)
  }
  toggle.addEventListener('click', onToggle)
  help.addEventListener('toggle', syncHelp)
  root.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', onOutsideClick)
  document.addEventListener('click', onOutsideClick)
  render()

  return {
    root,
    get expanded() { return expanded },
    update(snapshot) {
      if (disposed || snapshot === latest) return
      latest = snapshot
      render()
    },
    setLocale(next) {
      if (disposed || next === locale) return
      locale = next
      number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
      integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
      render()
    },
    setExpanded,
    dispose() {
      if (disposed) return
      disposed = true
      toggle.removeEventListener('click', onToggle)
      help.removeEventListener('toggle', syncHelp)
      root.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onOutsideClick)
      document.removeEventListener('click', onOutsideClick)
      help.open = false
      helpOpen = false
      root.dataset.helpOpen = 'false'
      latest = null
    },
  }
}
