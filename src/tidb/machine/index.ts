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
  const width = 960
  const labelWidth = 150
  const top = 24
  const laneHeight = 66
  const height = top + MACHINE_LANES.length * laneHeight + 24
  const svg = svgElement('svg', {
    class: 'tidb-machine__svg',
    viewBox: `0 0 ${width} ${height}`,
    role: 'group',
    'aria-label': locale === 'ja' ? 'TiDB traceの層別タイムライン' : 'Layered TiDB trace timeline',
  })

  const maxAt = Math.max(1, ...receipt.events.map((event) => event.atMs + event.durationMs))
  const usable = width - labelWidth - 40
  const xOf = (atMs: number) => labelWidth + 12 + (Math.max(0, atMs) / maxAt) * usable

  MACHINE_LANES.forEach((lane, laneIndex) => {
    const y = top + laneIndex * laneHeight
    const group = svgElement('g', {
      class: 'tidb-machine__lane',
      'data-lane': lane,
      role: 'group',
      'aria-label': LANE_LABELS[locale][lane],
    })
    const background = svgElement('rect', {
      class: 'tidb-machine__lane-bg',
      x: '0',
      y: String(y),
      width: String(width),
      height: String(laneHeight),
    })
    const label = svgElement('text', {
      class: 'tidb-machine__lane-label',
      x: '14',
      y: String(y + 36),
    })
    label.textContent = LANE_LABELS[locale][lane]
    const axis = svgElement('line', {
      class: 'tidb-machine__axis',
      x1: String(labelWidth),
      x2: String(width - 18),
      y1: String(y + laneHeight / 2),
      y2: String(y + laneHeight / 2),
    })
    group.append(background, label, axis)
    svg.append(group)
  })

  receipt.events.forEach((event, index) => {
    const laneIndex = MACHINE_LANES.indexOf(event.domain)
    const y = top + laneIndex * laneHeight + laneHeight / 2
    const x = xOf(event.atMs)
    const eventStatus = event.status ?? 'success'
    const eventNode = svgElement('circle', {
      class: `tidb-machine__event is-${eventStatus}${index > currentIndex ? ' is-future' : ''}${index === currentIndex ? ' is-current' : ''}`,
      cx: String(x),
      cy: String(y),
      r: index === currentIndex ? '8' : '6',
      tabindex: '0',
      role: 'button',
      'aria-label': `${LANE_LABELS[locale][event.domain]}: ${event.label} (${eventStatus})`,
      'data-event-index': String(index),
      'data-event-domain': event.domain,
      'data-event-status': eventStatus,
    })
    svg.append(eventNode)
    // Labels for every event become unreadable on busy 2PC/Raft traces. The
    // focused event is named in-place; every marker still has an accessible
    // name and selecting it updates the full detail panel below.
    if (index === currentIndex) {
      const label = svgElement('text', {
        class: 'tidb-machine__event-label',
        x: String(Math.min(width - 190, x + 11)),
        y: String(y - 11),
      })
      label.textContent = event.label
      svg.append(label)
    }
  })

  if (currentIndex >= 0 && receipt.events[currentIndex]) {
    const x = xOf(receipt.events[currentIndex].atMs)
    svg.append(svgElement('line', {
      class: 'tidb-machine__cursor',
      x1: String(x),
      x2: String(x),
      y1: String(top - 8),
      y2: String(height - 16),
    }))
  }
  return svg
}

export function mountMachine(root: HTMLElement, options: MachineOptions): void {
  const locale = options.locale ?? resolveLocale(options.search)
  const receipt = options.adaptReceipt
    ? options.adaptReceipt(options.receipt)
    : adaptTraceReceipt(options.receipt)
  installCityUiStyles(root.ownerDocument ?? document)
  installMachineStyles(root.ownerDocument ?? document)

  let current = receipt.events.length === 0
    ? -1
    : Math.max(0, Math.min(receipt.events.length - 1, options.initialIndex ?? 0))
  let timer: ReturnType<typeof setInterval> | null = null
  const frame = element('div', { className: 'tidb-machine__frame' })
  const detail = element('section', {
    className: 'tidb-machine__detail',
    attrs: { 'aria-live': 'polite' },
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

  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
    play.textContent = CATALOG[locale].play
    play.setAttribute('aria-pressed', 'false')
  }
  const sync = () => {
    frame.replaceChildren(renderTimeline(receipt, locale, current))
    const event = current >= 0 ? receipt.events[current] : null
    if (event) {
      const route = [event.source, event.target].filter(Boolean).join(' → ')
      const detailNodes: Node[] = [
        element('h2', { text: `${CATALOG[locale].event} ${current + 1} / ${receipt.events.length}` }),
        element('p', { text: `${event.atMs} ms · ${LANE_LABELS[locale][event.domain]} · ${event.label}` }),
      ]
      if (event.detail) detailNodes.push(element('p', { text: event.detail }))
      if (route) detailNodes.push(element('p', { text: route }))
      if (event.status && event.status !== 'success') {
        detailNodes.push(element('p', {
          className: `tidb-machine__status is-${event.status}`,
          text: `status: ${event.status}`,
        }))
      }
      detail.replaceChildren(...detailNodes)
    } else {
      detail.replaceChildren(element('p', { className: 'tidb-machine__empty', text: CATALOG[locale].emptyTrace }))
    }
    options.onSeek?.(event, current)

    for (const marker of frame.querySelectorAll<SVGElement>('[data-event-index]')) {
      marker.addEventListener('click', () => {
        current = Number(marker.dataset.eventIndex)
        stop()
        sync()
      })
    }
  }

  play.addEventListener('click', () => {
    if (timer !== null) {
      stop()
      return
    }
    if (receipt.events.length === 0) return
    play.textContent = CATALOG[locale].pause
    play.setAttribute('aria-pressed', 'true')
    timer = setInterval(() => {
      if (current >= receipt.events.length - 1) {
        stop()
        return
      }
      current += 1
      sync()
    }, Math.max(100, options.stepIntervalMs ?? 750))
  })
  step.addEventListener('click', () => {
    stop()
    if (receipt.events.length > 0) current = Math.min(receipt.events.length - 1, current + 1)
    sync()
  })
  reset.addEventListener('click', () => {
    stop()
    current = receipt.events.length > 0 ? 0 : -1
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
    element('div', { className: 'tidb-machine__controls' }, play, step, reset),
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
