// SPDX-License-Identifier: Apache-2.0

import type { TraceDomain, TraceEvent, TraceReceipt } from '../model/types'
import { CATALOG, resolveLocale, type Locale } from '../ui/catalog'
import { element, svgElement } from '../ui/dom'
import { createModelBadge } from '../ui/legal'
import { installCityUiStyles } from '../ui/styles'
import { installMachineStyles } from './styles'

export { MACHINE_CSS, installMachineStyles } from './styles'

export const MACHINE_LANES = ['sql', 'tso', 'txn2pc', 'raft', 'kv', 'tiflash'] as const
export type MachineLane = (typeof MACHINE_LANES)[number]

export interface MachineEvent {
  id: string
  atMs: number
  durationMs: number
  domain: MachineLane
  label: string
  detail: string
  source?: string
  target?: string
  status?: string
}

export interface MachineReceipt {
  id: string
  events: readonly MachineEvent[]
}

export interface MachineOptions {
  receipt: TraceReceipt | MachineReceipt | unknown
  locale?: Locale
  search?: string
  initialIndex?: number
  stepIntervalMs?: number
  autoplay?: boolean
  adaptReceipt?: (receipt: unknown) => MachineReceipt
  onSeek?: (event: MachineEvent | null, index: number) => void
}

const LANE_LABELS: Record<Locale, Record<MachineLane, string>> = {
  ja: {
    sql: 'SQL / Client',
    tso: 'TSO',
    txn2pc: 'Transaction 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
  },
  en: {
    sql: 'SQL / Client',
    tso: 'TSO',
    txn2pc: 'Transaction 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
  },
}

const LANE_CODES: Record<MachineLane, string> = {
  sql: 'SQL',
  tso: 'TSO',
  txn2pc: '2PC',
  raft: 'RAFT',
  kv: 'KV',
  tiflash: 'MPP',
}

const MACHINE_COPY = {
  ja: {
    eyebrow: 'TRACE REPLAY / 6 LAYERS',
    summary: 'トレース再生の概要',
    step: '段階',
    modelTime: 'モデル時刻',
    activeLayer: '現在の層',
    timeWindow: '時間幅',
    progress: 'トレース再生位置',
    duration: '継続時間',
    route: '経路',
    current: '現在のイベント',
    empty: '—',
  },
  en: {
    eyebrow: 'TRACE REPLAY / 6 LAYERS',
    summary: 'Trace replay overview',
    step: 'Step',
    modelTime: 'Model time',
    activeLayer: 'Active layer',
    timeWindow: 'Time window',
    progress: 'Trace replay position',
    duration: 'Duration',
    route: 'Route',
    current: 'Current event',
    empty: '—',
  },
} as const

interface TimelineEventLayout {
  event: MachineEvent
  index: number
  x: number
  endX: number
  y: number
  state: 'complete' | 'current' | 'future'
  status: 'queued' | 'active' | 'success' | 'warning' | 'failed'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function machineDomain(value: unknown): MachineLane | null {
  if (value === 'client' || value === 'return' || value === 'sql') return 'sql'
  if (value === 'tso') return 'tso'
  if (value === 'txn' || value === 'transaction' || value === 'txn2pc') return 'txn2pc'
  if (value === 'raft') return 'raft'
  if (value === 'kv') return 'kv'
  if (value === 'tiflash') return 'tiflash'
  return null
}

function machineStatus(value: string | undefined): TimelineEventLayout['status'] {
  if (value === 'queued' || value === 'active' || value === 'warning' || value === 'failed') {
    return value
  }
  return 'success'
}

function receiptEndMs(receipt: MachineReceipt): number {
  return Math.max(
    1,
    ...receipt.events.map((event) => event.atMs + Math.max(0, event.durationMs)),
  )
}

function formatModelTime(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ms`
}

function shortLabel(label: string, maxLength = 32): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label
}

function appendSvgText(
  parent: SVGElement,
  className: string,
  text: string,
  x: number,
  y: number,
  attrs: Record<string, string> = {},
): SVGTextElement {
  const node = svgElement('text', {
    class: className,
    x: String(x),
    y: String(y),
    ...attrs,
  })
  node.textContent = text
  parent.append(node)
  return node
}

export function adaptTraceReceipt(source: unknown): MachineReceipt {
  const receipt = record(source)
  const rawEvents = Array.isArray(receipt.events) ? receipt.events : []
  const events: MachineEvent[] = []
  for (let index = 0; index < rawEvents.length; index += 1) {
    const raw = record(rawEvents[index])
    const domain = machineDomain(raw.domain)
    if (!domain) continue
    events.push({
      id: asString(raw.id, `event-${index + 1}`),
      atMs: asNumber(raw.atMs, asNumber(raw.at, index)),
      durationMs: asNumber(raw.durationMs, asNumber(raw.duration, 0)),
      domain,
      label: asString(raw.label, asString(raw.kind, domain)),
      detail: asString(raw.detail),
      source: asString(raw.source) || undefined,
      target: asString(raw.target) || undefined,
      status: asString(raw.status) || undefined,
    })
  }
  events.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id))
  return { id: asString(receipt.id, 'trace'), events }
}

function renderTimeline(
  receipt: MachineReceipt,
  locale: Locale,
  currentIndex: number,
): SVGSVGElement {
  const width = 1120
  const plotLeft = 210
  const plotRight = width - 28
  const top = 72
  const laneHeight = 68
  const height = top + MACHINE_LANES.length * laneHeight + 42
  const maxAt = receiptEndMs(receipt)
  const xOf = (atMs: number) => {
    const ratio = Math.max(0, Math.min(maxAt, atMs)) / maxAt
    return plotLeft + ratio * (plotRight - plotLeft)
  }
  const svg = svgElement('svg', {
    class: 'tidb-machine__svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'group',
    'aria-label': locale === 'ja' ? 'TiDB traceの層別タイムライン' : 'Layered TiDB trace timeline',
  })

  const defs = svgElement('defs')
  const arrow = svgElement('marker', {
    id: 'tidb-machine-arrow',
    viewBox: '0 0 10 10',
    refX: '8',
    refY: '5',
    markerWidth: '6',
    markerHeight: '6',
    orient: 'auto-start-reverse',
  })
  arrow.append(svgElement('path', {
    class: 'tidb-machine__arrow',
    d: 'M 0 0 L 10 5 L 0 10 z',
  }))
  defs.append(arrow)
  svg.append(
    defs,
    svgElement('rect', {
      class: 'tidb-machine__backdrop',
      x: '0',
      y: '0',
      width: String(width),
      height: String(height),
      rx: '14',
    }),
  )

  appendSvgText(svg, 'tidb-machine__plot-eyebrow', MACHINE_COPY[locale].eyebrow, 18, 28)
  appendSvgText(
    svg,
    'tidb-machine__time-title',
    `${MACHINE_COPY[locale].modelTime.toUpperCase()} / ms`,
    plotLeft,
    28,
  )

  const tickCount = 5
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const value = (maxAt * tick) / tickCount
    const x = xOf(value)
    svg.append(svgElement('line', {
      class: 'tidb-machine__gridline',
      x1: String(x),
      x2: String(x),
      y1: '48',
      y2: String(top + MACHINE_LANES.length * laneHeight),
      'data-time-tick': String(tick),
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__tick-label',
      tick === 0 ? '0' : String(Math.round(value * 10) / 10),
      x,
      53,
      { 'text-anchor': tick === 0 ? 'start' : tick === tickCount ? 'end' : 'middle' },
    )
  }

  MACHINE_LANES.forEach((lane, laneIndex) => {
    const y = top + laneIndex * laneHeight
    const eventCount = receipt.events.filter((event) => event.domain === lane).length
    const group = svgElement('g', {
      class: 'tidb-machine__lane',
      'data-lane': lane,
      role: 'group',
      'aria-label': LANE_LABELS[locale][lane],
    })
    const background = svgElement('rect', {
      class: 'tidb-machine__lane-bg',
      x: '8',
      y: String(y + 2),
      width: String(width - 16),
      height: String(laneHeight - 4),
      rx: '8',
    })
    const accent = svgElement('rect', {
      class: 'tidb-machine__lane-accent',
      x: '8',
      y: String(y + 12),
      width: '3',
      height: String(laneHeight - 24),
      rx: '1.5',
    })
    const axis = svgElement('line', {
      class: 'tidb-machine__axis',
      x1: String(plotLeft),
      x2: String(plotRight),
      y1: String(y + laneHeight / 2),
      y2: String(y + laneHeight / 2),
    })
    group.append(background, accent)
    appendSvgText(group, 'tidb-machine__lane-code', LANE_CODES[lane], 24, y + 28)
    appendSvgText(group, 'tidb-machine__lane-label', LANE_LABELS[locale][lane], 24, y + 47)
    appendSvgText(
      group,
      'tidb-machine__lane-count',
      String(eventCount).padStart(2, '0'),
      186,
      y + 38,
      { 'text-anchor': 'end', 'aria-label': `${eventCount} events` },
    )
    group.append(axis)
    svg.append(group)
  })

  const lastPlacement = new Map<MachineLane, { x: number; level: number }>()
  const layouts: TimelineEventLayout[] = receipt.events.map((event, index) => {
    const laneIndex = MACHINE_LANES.indexOf(event.domain)
    const x = xOf(event.atMs)
    const previousPlacement = lastPlacement.get(event.domain)
    const level = previousPlacement && x - previousPlacement.x < 30
      ? (previousPlacement.level + 1) % 3
      : 0
    lastPlacement.set(event.domain, { x, level })
    const yOffset = [0, -12, 12][level] ?? 0
    return {
      event,
      index,
      x,
      endX: xOf(event.atMs + Math.max(0, event.durationMs)),
      y: top + laneIndex * laneHeight + laneHeight / 2 + yOffset,
      state: index === currentIndex ? 'current' : index < currentIndex ? 'complete' : 'future',
      status: machineStatus(event.status),
    }
  })

  const durationLayer = svgElement('g', {
    class: 'tidb-machine__duration-layer',
    'aria-hidden': 'true',
  })
  for (const layout of layouts) {
    durationLayer.append(svgElement('rect', {
      class: `tidb-machine__duration is-${layout.state} is-${layout.status}`,
      x: String(layout.x),
      y: String(layout.y - 4),
      width: String(Math.max(10, layout.endX - layout.x)),
      height: '8',
      rx: '4',
      'data-event-duration': String(layout.event.durationMs),
      'data-duration-domain': layout.event.domain,
    }))
  }
  svg.append(durationLayer)

  const causalLayer = svgElement('g', {
    class: 'tidb-machine__causal-layer',
    'aria-hidden': 'true',
  })
  for (let index = 1; index < layouts.length; index += 1) {
    const previous = layouts[index - 1]
    const layout = layouts[index]
    if (!previous || !layout) continue
    const distance = Math.max(26, (layout.x - previous.x) * 0.42)
    causalLayer.append(svgElement('path', {
      class: `tidb-machine__causal is-${layout.state}`,
      d: [
        `M ${previous.x} ${previous.y}`,
        `C ${previous.x + distance} ${previous.y}`,
        `${layout.x - distance} ${layout.y}`,
        `${layout.x} ${layout.y}`,
      ].join(' '),
      'data-causal-from': previous.event.id,
      'data-causal-to': layout.event.id,
      'data-causal-domain': layout.event.domain,
      'marker-end': 'url(#tidb-machine-arrow)',
    }))
  }
  svg.append(causalLayer)

  const currentLayout = currentIndex >= 0 ? layouts[currentIndex] : undefined
  if (currentLayout) {
    svg.append(svgElement('line', {
      class: 'tidb-machine__cursor',
      x1: String(currentLayout.x),
      x2: String(currentLayout.x),
      y1: '48',
      y2: String(top + MACHINE_LANES.length * laneHeight + 14),
      'aria-hidden': 'true',
    }))
    const cursorLabelWidth = 74
    const cursorLabelX = Math.max(
      plotLeft,
      Math.min(plotRight - cursorLabelWidth, currentLayout.x - cursorLabelWidth / 2),
    )
    svg.append(svgElement('rect', {
      class: 'tidb-machine__cursor-badge',
      x: String(cursorLabelX),
      y: String(height - 28),
      width: String(cursorLabelWidth),
      height: '21',
      rx: '10.5',
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__cursor-label',
      formatModelTime(currentLayout.event.atMs),
      cursorLabelX + cursorLabelWidth / 2,
      height - 14,
      { 'text-anchor': 'middle' },
    )
  }

  for (const layout of layouts) {
    const { event, index, state, status, x, y } = layout
    const accessibleName = [
      `${CATALOG[locale].event} ${index + 1}`,
      LANE_LABELS[locale][event.domain],
      event.label,
      formatModelTime(event.atMs),
      `${MACHINE_COPY[locale].duration}: ${formatModelTime(Math.max(0, event.durationMs))}`,
      `status: ${status}`,
    ].join(', ')
    const eventNode = svgElement('g', {
      class: `tidb-machine__event is-${status} is-${state}`,
      tabindex: '0',
      role: 'button',
      'aria-label': accessibleName,
      'aria-current': state === 'current' ? 'step' : 'false',
      'data-event-index': String(index),
      'data-event-domain': event.domain,
      'data-event-status': status,
      'data-event-state': state,
    })
    const title = svgElement('title')
    title.textContent = accessibleName
    eventNode.append(
      title,
      svgElement('circle', {
        class: 'tidb-machine__event-hit',
        cx: String(x),
        cy: String(y),
        r: '19',
      }),
      svgElement('circle', {
        class: 'tidb-machine__event-halo',
        cx: String(x),
        cy: String(y),
        r: state === 'current' ? '14' : '12',
      }),
      svgElement('circle', {
        class: 'tidb-machine__event-core',
        cx: String(x),
        cy: String(y),
        r: state === 'current' ? '8.5' : '7',
      }),
    )
    appendSvgText(
      eventNode,
      'tidb-machine__event-glyph',
      status === 'failed' ? '×' : status === 'warning' ? '!' : String(index + 1),
      x,
      y + 3.25,
      { 'text-anchor': 'middle', 'aria-hidden': 'true' },
    )
    svg.append(eventNode)
  }

  if (currentLayout) {
    const calloutWidth = 238
    const calloutHeight = 28
    const calloutOnLeft = currentLayout.x > width - calloutWidth - 46
    const calloutX = calloutOnLeft
      ? currentLayout.x - calloutWidth - 20
      : currentLayout.x + 20
    const calloutY = currentLayout.y - calloutHeight / 2
    svg.append(svgElement('line', {
      class: 'tidb-machine__callout-leader',
      x1: String(currentLayout.x + (calloutOnLeft ? -10 : 10)),
      x2: String(calloutOnLeft ? calloutX + calloutWidth : calloutX),
      y1: String(currentLayout.y),
      y2: String(currentLayout.y),
      'aria-hidden': 'true',
    }))
    svg.append(svgElement('rect', {
      class: 'tidb-machine__callout',
      x: String(calloutX),
      y: String(calloutY),
      width: String(calloutWidth),
      height: String(calloutHeight),
      rx: '7',
      'aria-hidden': 'true',
    }))
    appendSvgText(
      svg,
      'tidb-machine__event-label',
      `${String(currentLayout.index + 1).padStart(2, '0')}  ${shortLabel(currentLayout.event.label)}`,
      calloutX + 11,
      currentLayout.y + 4,
      { 'aria-hidden': 'true' },
    )
  }
  return svg
}

export function mountMachine(root: HTMLElement, options: MachineOptions): void {
  const locale = options.locale ?? resolveLocale(options.search)
  const copy = MACHINE_COPY[locale]
  const receipt = options.adaptReceipt
    ? options.adaptReceipt(options.receipt)
    : adaptTraceReceipt(options.receipt)
  const total = receipt.events.length
  const maxAt = receiptEndMs(receipt)
  installCityUiStyles(root.ownerDocument ?? document)
  installMachineStyles(root.ownerDocument ?? document)

  let current = total === 0
    ? -1
    : Math.max(0, Math.min(total - 1, options.initialIndex ?? 0))
  let timer: ReturnType<typeof setInterval> | null = null
  const frame = element('div', { className: 'tidb-machine__frame' })
  const detail = element('section', {
    className: 'tidb-machine__detail',
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' },
  })
  const play = element('button', {
    className: 'tidb-button tidb-button--primary',
    text: CATALOG[locale].play,
    attrs: {
      type: 'button',
      'data-action': 'play',
      'aria-pressed': 'false',
    },
  })
  const step = element('button', {
    className: 'tidb-button',
    text: CATALOG[locale].step,
    attrs: { type: 'button', 'data-action': 'step' },
  })
  const reset = element('button', {
    className: 'tidb-button',
    text: CATALOG[locale].reset,
    attrs: { type: 'button', 'data-action': 'reset' },
  })
  if (total === 0) {
    play.setAttribute('disabled', '')
    step.setAttribute('disabled', '')
    reset.setAttribute('disabled', '')
  }

  const createMetric = (label: string) => {
    const value = element('strong', { className: 'tidb-machine__metric-value', text: copy.empty })
    return {
      value,
      node: element('div', { className: 'tidb-machine__metric' },
        element('span', { className: 'tidb-machine__metric-label', text: label }),
        value,
      ),
    }
  }
  const stepMetric = createMetric(copy.step)
  const timeMetric = createMetric(copy.modelTime)
  const layerMetric = createMetric(copy.activeLayer)
  const windowMetric = createMetric(copy.timeWindow)
  windowMetric.value.textContent = total > 0 ? formatModelTime(maxAt) : copy.empty
  const overview = element('section', {
    className: 'tidb-machine__overview',
    attrs: { 'aria-label': copy.summary },
  },
  stepMetric.node,
  timeMetric.node,
  layerMetric.node,
  windowMetric.node,
  )
  const progressText = element('span', {
    className: 'tidb-machine__progress-text',
    text: total > 0 ? `1 / ${total}` : `0 / 0`,
  })
  const progress = element('progress', {
    className: 'tidb-machine__progress',
    attrs: {
      max: String(Math.max(1, total)),
      value: total > 0 ? '1' : '0',
      'aria-label': copy.progress,
    },
  })
  const transport = element('div', { className: 'tidb-machine__transport' },
    element('div', { className: 'tidb-machine__controls' }, play, step, reset),
    element('div', { className: 'tidb-machine__progress-wrap' },
      element('div', { className: 'tidb-machine__progress-label' },
        element('span', { text: copy.progress }),
        progressText,
      ),
      progress,
    ),
  )

  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
    play.textContent = CATALOG[locale].play
    play.setAttribute('aria-pressed', 'false')
  }
  const sync = () => {
    frame.replaceChildren(renderTimeline(receipt, locale, current))
    const event = current >= 0 ? receipt.events[current] : null
    const position = event ? current + 1 : 0
    stepMetric.value.textContent = event ? `${position} / ${total}` : copy.empty
    timeMetric.value.textContent = event ? formatModelTime(event.atMs) : copy.empty
    layerMetric.value.textContent = event
      ? `${LANE_CODES[event.domain]} · ${LANE_LABELS[locale][event.domain]}`
      : copy.empty
    progress.setAttribute('value', String(position))
    progress.setAttribute('aria-valuetext', `${position} / ${total}`)
    progressText.textContent = `${position} / ${total}`

    if (event) {
      const route = [event.source, event.target].filter(Boolean).join(' → ')
      const status = machineStatus(event.status)
      detail.setAttribute('data-current-domain', event.domain)
      detail.setAttribute('data-current-status', status)
      const detailNodes: Node[] = [
        element('div', { className: 'tidb-machine__detail-head' },
          element('p', {
            className: 'tidb-machine__detail-eyebrow',
            text: `${copy.current} · ${CATALOG[locale].event} ${position} / ${total}`,
          }),
          element('p', {
            className: `tidb-machine__status is-${status}`,
            text: `status: ${status}`,
          }),
        ),
        element('h2', { text: event.label }),
        element('dl', { className: 'tidb-machine__detail-meta' },
          element('div', {},
            element('dt', { text: copy.modelTime }),
            element('dd', { text: formatModelTime(event.atMs) }),
          ),
          element('div', {},
            element('dt', { text: copy.activeLayer }),
            element('dd', { text: LANE_LABELS[locale][event.domain] }),
          ),
          element('div', {},
            element('dt', { text: copy.duration }),
            element('dd', { text: formatModelTime(Math.max(0, event.durationMs)) }),
          ),
        ),
      ]
      if (event.detail) {
        detailNodes.push(element('p', { className: 'tidb-machine__detail-copy', text: event.detail }))
      }
      if (route) {
        detailNodes.push(element('p', { className: 'tidb-machine__route' },
          element('strong', { text: `${copy.route}: ` }),
          element('span', { text: route }),
        ))
      }
      detail.replaceChildren(...detailNodes)
    } else {
      detail.removeAttribute('data-current-domain')
      detail.removeAttribute('data-current-status')
      detail.replaceChildren(element('p', { className: 'tidb-machine__empty', text: CATALOG[locale].emptyTrace }))
    }
    options.onSeek?.(event, current)

    for (const marker of frame.querySelectorAll<SVGElement>('[data-event-index]')) {
      marker.addEventListener('click', () => {
        current = Number(marker.dataset.eventIndex)
        stop()
        sync()
      })
      marker.addEventListener('keydown', (rawEvent) => {
        const keyboardEvent = rawEvent as KeyboardEvent
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return
        keyboardEvent.preventDefault()
        const selectedIndex = Number(marker.dataset.eventIndex)
        if (!Number.isInteger(selectedIndex)) return
        current = selectedIndex
        stop()
        sync()
        frame.querySelector<SVGElement>(`[data-event-index="${selectedIndex}"]`)?.focus()
      })
    }
  }

  play.addEventListener('click', () => {
    if (timer !== null) {
      stop()
      return
    }
    if (total === 0) return
    play.textContent = CATALOG[locale].pause
    play.setAttribute('aria-pressed', 'true')
    timer = setInterval(() => {
      if (current >= total - 1) {
        stop()
        return
      }
      current += 1
      sync()
    }, Math.max(100, options.stepIntervalMs ?? 750))
  })
  step.addEventListener('click', () => {
    stop()
    if (total > 0) current = Math.min(total - 1, current + 1)
    sync()
  })
  reset.addEventListener('click', () => {
    stop()
    current = total > 0 ? 0 : -1
    sync()
  })

  root.classList.add('tidb-surface', 'tidb-machine')
  root.setAttribute('lang', locale)
  root.replaceChildren(
    element('header', { className: 'tidb-machine__head' },
      element('div', {},
        element('h1', { text: CATALOG[locale].machineTitle }),
        element('p', { text: CATALOG[locale].machineSubtitle }),
      ),
      createModelBadge(locale),
    ),
    overview,
    transport,
    frame,
    detail,
    element('p', { className: 'tidb-machine__note', text: CATALOG[locale].simulatedTiming }),
  )
  sync()
  if (options.autoplay) play.click()
}

export type {
  TraceDomain,
  TraceEvent,
  TraceReceipt,
}
