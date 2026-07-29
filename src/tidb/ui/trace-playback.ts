/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type { TraceFlowPlayback, TracePlaybackPhase } from '../engine/trace-flows'
import type {
  TraceDomain,
  TraceEvent,
  TraceEventStatus,
  TraceReceipt,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'

interface TracePlaybackCopy {
  readonly region: string
  readonly eyebrow: string
  readonly progress: string
  readonly eventProgress: string
  readonly route: string
  readonly empty: string
  readonly ready: string
  readonly previous: string
  readonly play: string
  readonly pause: string
  readonly resume: string
  readonly next: string
  readonly replay: string
  readonly phase: Readonly<Record<TracePlaybackPhase, string>>
  readonly status: Readonly<Record<TraceEventStatus, string>>
  readonly railState: Readonly<Record<RailState, string>>
}

type RailState = 'complete' | 'current' | 'future'

const COPY: Readonly<Record<Locale, TracePlaybackCopy>> = {
  ja: {
    region: 'トレース再生',
    eyebrow: 'TRACE REPLAY',
    progress: 'トレース再生位置',
    eventProgress: '現在イベントの進捗',
    route: '経路',
    empty: '再生できるイベントはありません。',
    ready: 'トレースを再生できます。',
    previous: '前のイベント',
    play: '再生',
    pause: '一時停止',
    resume: '再開',
    next: '次のイベント',
    replay: 'もう一度再生',
    phase: {
      idle: '待機',
      playing: '再生中',
      paused: '一時停止',
      complete: '完了',
    },
    status: {
      queued: '待機',
      active: '処理中',
      success: '成功',
      warning: '注意',
      failed: '失敗',
    },
    railState: {
      complete: '完了',
      current: '現在',
      future: '未到達',
    },
  },
  en: {
    region: 'Trace playback',
    eyebrow: 'TRACE REPLAY',
    progress: 'Trace replay position',
    eventProgress: 'Current event progress',
    route: 'Route',
    empty: 'There are no events to replay.',
    ready: 'The trace is ready to replay.',
    previous: 'Previous event',
    play: 'Play',
    pause: 'Pause',
    resume: 'Resume',
    next: 'Next event',
    replay: 'Replay',
    phase: {
      idle: 'Ready',
      playing: 'Playing',
      paused: 'Paused',
      complete: 'Complete',
    },
    status: {
      queued: 'Queued',
      active: 'Active',
      success: 'Success',
      warning: 'Warning',
      failed: 'Failed',
    },
    railState: {
      complete: 'Complete',
      current: 'Current',
      future: 'Upcoming',
    },
  },
}

const DOMAIN_LABELS: Readonly<Record<Locale, Readonly<Record<TraceDomain, string>>>> = {
  ja: {
    client: 'CLIENT',
    sql: 'SQL',
    tso: 'TSO / PD',
    txn2pc: 'Transaction 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
    return: 'RETURN',
  },
  en: {
    client: 'CLIENT',
    sql: 'SQL',
    tso: 'TSO / PD',
    txn2pc: 'Transaction 2PC',
    raft: 'Region Raft',
    kv: 'TiKV / MVCC',
    tiflash: 'TiFlash / MPP',
    return: 'RETURN',
  },
}

const DOMAIN_COLORS: Readonly<Record<TraceDomain, string>> = {
  client: 'var(--city-cyan)',
  sql: 'var(--domain-sql)',
  tso: 'var(--domain-tso)',
  txn2pc: 'var(--domain-txn2pc)',
  raft: 'var(--domain-raft)',
  kv: 'var(--domain-kv)',
  tiflash: 'var(--domain-tiflash)',
  return: 'var(--city-text)',
}

export interface TracePlaybackDockActions {
  readonly onPrevious: () => void
  readonly onTogglePause: () => void
  readonly onNext: () => void
  readonly onReplay: () => void
}

export interface TracePlaybackDock {
  readonly root: HTMLElement
  update(playback: TraceFlowPlayback, receipt: TraceReceipt | null): void
  setLocale(locale: Locale): void
  dispose(): void
}

interface RailEntry {
  readonly root: HTMLLIElement
  readonly symbol: HTMLSpanElement
  readonly event: TraceEvent
  readonly index: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function integer(value: number, fallback = -1): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback
}

function railState(
  index: number,
  currentIndex: number,
  phase: TracePlaybackPhase,
): RailState {
  if (phase === 'complete') return 'complete'
  if (index < currentIndex) return 'complete'
  if (index === currentIndex) return 'current'
  return 'future'
}

function railSymbol(state: RailState, status: TraceEventStatus): string {
  if (state === 'current') return '▶'
  if (state === 'future') return '·'
  if (status === 'failed') return '×'
  if (status === 'warning') return '!'
  return '✓'
}

function endpointLabel(rawValue: string | undefined, event: TraceEvent): string {
  if (!rawValue) return '—'
  const raw = rawValue.trim().toLowerCase()
  if (raw === 'client' || raw === 'application' || raw === 'client-terminal') {
    return 'CLIENTS'
  }
  if (raw === 'pd' || raw === 'tso' || /^pd[-._]?\d*$/.test(raw)) {
    return 'PD / TSO'
  }
  if (raw === 'gc' || raw === 'gc-worker' || raw === 'safe-point') return 'MVCC GC'
  if (raw === 'tiflash' || raw === 'mpp' || /^tiflash[-._]?\d*$/.test(raw)) {
    return 'TiFlash / MPP'
  }

  const numbered = (
    pattern: RegExp,
    label: string,
    includeRegion = false,
  ): string | null => {
    const match = raw.match(pattern)
    if (!match) return null
    const number = match[1] || '1'
    const region = includeRegion && event.regionId !== undefined
      ? ` · Region ${event.regionId}`
      : ''
    return `${label} ${number}${region}`
  }
  return (
    numbered(/^tiproxy[-._]?(\d+)?$/, 'TiProxy') ??
    numbered(/^tidb[-._]?(\d+)?$/, 'TiDB') ??
    numbered(/^tikv[-._]?(\d+)?$/, 'TiKV', true) ??
    (raw.startsWith('region') && event.regionId !== undefined
      ? `Region ${event.regionId}`
      : rawValue)
  )
}

function setDisabled(button: HTMLButtonElement, disabled: boolean): void {
  button.disabled = disabled
  if (disabled) button.setAttribute('disabled', '')
  else button.removeAttribute('disabled')
}

function setData(
  node: HTMLElement,
  name: string,
  value: string | null,
): void {
  if (value === null) {
    delete node.dataset[name]
    return
  }
  node.dataset[name] = value
}

export function createTracePlaybackDock(
  initialLocale: Locale,
  actions: TracePlaybackDockActions,
): TracePlaybackDock {
  let locale = initialLocale
  let disposed = false
  let latestPlayback: TraceFlowPlayback | null = null
  let latestReceipt: TraceReceipt | null = null
  let railReceipt: TraceReceipt | null = null
  let railLocale: Locale | null = null
  let railIndex = Number.NaN
  let railPhase: TracePlaybackPhase | null = null
  let announcementKey = ''
  let entries: RailEntry[] = []

  const eyebrow = element('span', {
    className: 'tidb-trace-playback__eyebrow',
  })
  const phase = element('span', {
    className: 'tidb-trace-playback__phase',
    attrs: { 'data-trace-phase': '' },
  })
  const position = element('span', {
    className: 'tidb-trace-playback__position',
    text: '0 / 0',
    attrs: { 'data-trace-position': '' },
  })
  const domain = element('span', {
    className: 'tidb-trace-playback__domain',
    attrs: { 'data-trace-domain': '' },
  })
  const status = element('span', {
    className: 'tidb-trace-playback__status',
    attrs: { 'data-trace-status': '' },
  })
  const label = element('h2', {
    className: 'tidb-trace-playback__label',
    attrs: { 'data-trace-label': '' },
  })
  const source = element('span', {
    className: 'tidb-trace-playback__endpoint is-source',
    attrs: { 'data-trace-source': '' },
  })
  const arrow = element('span', {
    className: 'tidb-trace-playback__route-arrow',
    text: '→',
    attrs: { 'aria-hidden': 'true' },
  })
  const target = element('span', {
    className: 'tidb-trace-playback__endpoint is-target',
    attrs: { 'data-trace-target': '' },
  })
  const route = element(
    'p',
    {
      className: 'tidb-trace-playback__route',
      attrs: { 'data-trace-route': '' },
    },
    source,
    arrow,
    target,
  )
  const current = element(
    'div',
    {
      className: 'tidb-trace-playback__current',
      attrs: {
        'aria-live': 'polite',
        'aria-atomic': 'true',
      },
    },
    label,
    route,
  )
  const rail = element('ol', {
    className: 'tidb-trace-playback__rail',
    attrs: { 'data-trace-rail': '' },
  })
  const progress = element('progress', {
    className: 'tidb-trace-playback__progress',
    attrs: {
      max: '1',
      value: '0',
      'data-trace-overall-progress': '',
    },
  })
  const eventProgressFill = element('span', {
    className: 'tidb-trace-playback__event-progress-fill',
    attrs: { 'aria-hidden': 'true' },
  })
  const eventProgress = element(
    'span',
    {
      className: 'tidb-trace-playback__event-progress',
      attrs: {
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
        'data-trace-event-progress': '',
      },
    },
    eventProgressFill,
  )

  const previous = element('button', {
    className: 'tidb-trace-playback__control is-previous',
    attrs: { type: 'button', 'data-action': 'trace-previous' },
  })
  const toggle = element('button', {
    className: 'tidb-trace-playback__control is-toggle',
    attrs: {
      type: 'button',
      'data-action': 'trace-toggle',
      'aria-pressed': 'false',
    },
  })
  const next = element('button', {
    className: 'tidb-trace-playback__control is-next',
    attrs: { type: 'button', 'data-action': 'trace-next' },
  })
  const replay = element('button', {
    className: 'tidb-trace-playback__control is-replay',
    attrs: { type: 'button', 'data-action': 'trace-replay' },
  })

  const onPrevious = (): void => {
    if (!disposed) actions.onPrevious()
  }
  const onToggle = (): void => {
    if (!disposed) actions.onTogglePause()
  }
  const onNext = (): void => {
    if (!disposed) actions.onNext()
  }
  const onReplay = (): void => {
    if (!disposed) actions.onReplay()
  }
  previous.addEventListener('click', onPrevious)
  toggle.addEventListener('click', onToggle)
  next.addEventListener('click', onNext)
  replay.addEventListener('click', onReplay)

  const controls = element(
    'div',
    {
      className: 'tidb-trace-playback__controls',
      attrs: { role: 'group' },
    },
    previous,
    toggle,
    next,
    replay,
  )
  const root = element(
    'section',
    {
      className: 'tidb-trace-playback',
      attrs: {
        role: 'region',
        'data-phase': 'idle',
        'data-has-trace': 'false',
      },
    },
    element(
      'div',
      { className: 'tidb-trace-playback__heading' },
      eyebrow,
      element(
        'div',
        { className: 'tidb-trace-playback__meta' },
        phase,
        domain,
        status,
        position,
      ),
    ),
    current,
    rail,
    element(
      'div',
      { className: 'tidb-trace-playback__progress-stack' },
      progress,
      eventProgress,
    ),
    controls,
  )

  function rebuildRail(receipt: TraceReceipt | null): void {
    railReceipt = receipt
    railLocale = locale
    railIndex = Number.NaN
    railPhase = null
    entries = []
    if (!receipt || receipt.events.length === 0) {
      rail.replaceChildren()
      rail.hidden = true
      return
    }

    const copy = COPY[locale]
    rail.hidden = false
    rail.setAttribute('aria-label', copy.progress)
    entries = receipt.events.map((event, index) => {
      const symbol = element('span', {
        className: 'tidb-trace-playback__tick-symbol',
        attrs: { 'aria-hidden': 'true' },
      })
      const tick = element(
        'li',
        {
          className: 'tidb-trace-playback__tick',
          attrs: {
            'data-event-index': String(index),
            'data-domain': event.domain,
            'data-status': event.status,
            title: event.label,
          },
        },
        symbol,
      )
      tick.style.setProperty('--trace-color', DOMAIN_COLORS[event.domain])
      return { root: tick, symbol, event, index }
    })
    rail.replaceChildren(...entries.map((entry) => entry.root))
  }

  function updateRail(currentIndex: number, playbackPhase: TracePlaybackPhase): void {
    if (railIndex === currentIndex && railPhase === playbackPhase) return
    railIndex = currentIndex
    railPhase = playbackPhase
    const copy = COPY[locale]
    const total = entries.length
    for (const entry of entries) {
      const state = railState(entry.index, currentIndex, playbackPhase)
      entry.root.className = `tidb-trace-playback__tick is-${state}`
      entry.root.dataset.state = state
      entry.symbol.textContent = railSymbol(state, entry.event.status)
      entry.root.setAttribute(
        'aria-label',
        `${entry.index + 1} / ${total}: ${entry.event.label}. ` +
        `${DOMAIN_LABELS[locale][entry.event.domain]}. ` +
        `${copy.status[entry.event.status]}. ${copy.railState[state]}.`,
      )
      if (state === 'current') entry.root.setAttribute('aria-current', 'step')
      else entry.root.removeAttribute('aria-current')
    }
  }

  function render(playback: TraceFlowPlayback, receipt: TraceReceipt | null): void {
    const copy = COPY[locale]
    const receiptTotal = receipt?.events.length ?? 0
    const total = Math.max(0, integer(playback.total, receiptTotal) || receiptTotal)
    const rawIndex = integer(playback.currentIndex)
    const currentIndex = total > 0 ? clamp(rawIndex, -1, total - 1) : -1
    const event = playback.event ??
      (currentIndex >= 0 ? receipt?.events[currentIndex] ?? null : null)
    const item = event && currentIndex >= 0 ? currentIndex + 1 : 0
    const overall = clamp(playback.overallProgress, 0, 1)
    const eventValue = clamp(playback.eventProgress, 0, 1)
    const overallPercent = Math.round(overall * 100)
    const eventPercent = Math.round(eventValue * 100)
    const hasTrace = receiptTotal > 0

    root.setAttribute('aria-label', copy.region)
    root.dataset.phase = playback.phase
    root.dataset.hasTrace = String(hasTrace)
    root.dataset.currentIndex = String(currentIndex)
    root.dataset.eventIndex = String(currentIndex)
    root.dataset.eventCount = String(total)
    root.dataset.motion = playback.motion
    root.dataset.elapsedMs = String(Math.max(0, playback.elapsedMs))
    root.dataset.durationMs = String(Math.max(0, playback.durationMs))
    root.dataset.presentationDurationMs = String(Math.max(0, playback.durationMs))
    setData(root, 'currentDomain', event?.domain ?? null)
    setData(root, 'currentStatus', event?.status ?? null)
    root.style.setProperty('--trace-overall-progress', `${overallPercent}%`)
    root.style.setProperty('--trace-event-progress', `${eventPercent}%`)
    root.style.setProperty(
      '--trace-color',
      event ? DOMAIN_COLORS[event.domain] : 'var(--city-cyan)',
    )

    eyebrow.textContent = copy.eyebrow
    phase.textContent = copy.phase[playback.phase]
    phase.dataset.tracePhase = playback.phase
    position.textContent = `${item} / ${total}`
    domain.textContent = event ? DOMAIN_LABELS[locale][event.domain] : '—'
    domain.dataset.traceDomain = event?.domain ?? ''
    status.textContent = event ? copy.status[event.status] : copy.phase[playback.phase]
    status.dataset.traceStatus = event?.status ?? playback.phase

    progress.max = 1
    progress.value = overall
    progress.setAttribute('max', '1')
    progress.setAttribute('value', String(overall))
    progress.setAttribute('aria-label', copy.progress)
    progress.setAttribute(
      'aria-valuetext',
      `${item} / ${total} · ${overallPercent}%`,
    )
    eventProgress.setAttribute('aria-label', copy.eventProgress)
    eventProgress.setAttribute('aria-valuenow', String(eventPercent))

    const nextAnnouncementKey =
      `${locale}:${playback.phase}:${currentIndex}:${event?.id ?? 'none'}`
    if (announcementKey !== nextAnnouncementKey) {
      announcementKey = nextAnnouncementKey
      label.textContent = event
        ? event.label
        : hasTrace
          ? copy.ready
          : copy.empty
      route.hidden = event === null
      if (event) {
        const rawFrom = event.source || '—'
        const rawTo = event.target || '—'
        const from = endpointLabel(event.source, event)
        const to = endpointLabel(event.target, event)
        source.textContent = from
        target.textContent = to
        route.dataset.local = String(rawFrom === rawTo && rawFrom !== '—')
        route.setAttribute('aria-label', `${copy.route}: ${from} → ${to}`)
      } else {
        source.textContent = ''
        target.textContent = ''
        route.dataset.local = 'false'
        route.removeAttribute('aria-label')
      }
    }

    if (railReceipt !== receipt || railLocale !== locale) rebuildRail(receipt)
    updateRail(currentIndex, playback.phase)

    const canNavigate = hasTrace && currentIndex >= 0
    setDisabled(previous, !canNavigate || currentIndex <= 0)
    setDisabled(next, !canNavigate || currentIndex >= total - 1)
    setDisabled(
      toggle,
      !hasTrace || playback.phase === 'idle' || playback.phase === 'complete',
    )
    setDisabled(replay, !hasTrace)

    previous.textContent = copy.previous
    previous.setAttribute('aria-label', copy.previous)
    const toggleCopy = playback.phase === 'playing'
      ? copy.pause
      : playback.phase === 'paused'
        ? copy.resume
        : copy.play
    toggle.textContent = toggleCopy
    toggle.setAttribute('aria-label', toggleCopy)
    toggle.setAttribute('aria-pressed', String(playback.phase === 'playing'))
    next.textContent = copy.next
    next.setAttribute('aria-label', copy.next)
    replay.textContent = copy.replay
    replay.setAttribute('aria-label', copy.replay)
    controls.setAttribute('aria-label', copy.region)
  }

  const idlePlayback: TraceFlowPlayback = {
    phase: 'idle',
    currentIndex: -1,
    total: 0,
    event: null,
    eventProgress: 0,
    overallProgress: 0,
    elapsedMs: 0,
    durationMs: 0,
    motion: 'full',
  }
  render(idlePlayback, null)

  return {
    root,
    update(playback, receipt): void {
      if (disposed) return
      latestPlayback = playback
      latestReceipt = receipt
      render(playback, receipt)
    },
    setLocale(next): void {
      if (disposed || next === locale) return
      locale = next
      announcementKey = ''
      railLocale = null
      render(latestPlayback ?? idlePlayback, latestReceipt)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      previous.removeEventListener('click', onPrevious)
      toggle.removeEventListener('click', onToggle)
      next.removeEventListener('click', onNext)
      replay.removeEventListener('click', onReplay)
      entries = []
      latestPlayback = null
      latestReceipt = null
      root.replaceChildren()
      root.remove()
    },
  }
}
