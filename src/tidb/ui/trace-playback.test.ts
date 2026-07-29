/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import type { TraceFlowPlayback } from '../engine/trace-flows'
import type { TraceEvent, TraceReceipt } from '../model/types'
import { createTracePlaybackDock } from './trace-playback'

const ANALYSIS = {
  status: 'supported',
  kind: 'point_read',
  statementKind: 'point_read',
  table: 'accounts',
  accessPath: 'point_get',
  readOnly: true,
  plan: [],
  warnings: [],
  explanation: 'model',
} as const

function traceEvent(
  id: string,
  domain: TraceEvent['domain'],
  status: TraceEvent['status'],
  source: string,
  target: string,
): TraceEvent {
  return {
    id,
    atMs: 12,
    durationMs: 12,
    domain,
    kind: id,
    label: `${id} label`,
    detail: `${id} detail`,
    status,
    source,
    target,
    metadata: {},
  }
}

function receipt(): TraceReceipt {
  const events = [
    traceEvent('submit', 'client', 'success', 'client', 'tiproxy-1'),
    traceEvent('route', 'sql', 'success', 'tiproxy-1', 'tidb-1'),
    traceEvent('timestamp', 'tso', 'warning', 'tidb-1', 'pd-1'),
    traceEvent('return', 'return', 'failed', 'tidb-1', 'client'),
  ]
  return {
    id: 'trace-dock-test',
    scenarioId: 'point-read',
    analysis: ANALYSIS,
    startTs: 1,
    commitTs: null,
    succeeded: false,
    committed: false,
    outcome: 'failed',
    protocol: null,
    events,
    durationMs: 48,
    replay: {
      modelVersion: 'test',
      seed: 425,
      scenarioId: 'point-read',
      query: {
        kind: 'point_read',
        statementKind: 'point_read',
        table: 'accounts',
        accessPath: 'point_get',
      },
      transactionMode: 'pessimistic',
      commitProtocol: null,
    },
    warnings: [],
  }
}

function playback(
  trace: TraceReceipt,
  overrides: Partial<TraceFlowPlayback> = {},
): TraceFlowPlayback {
  const currentIndex = overrides.currentIndex ?? 0
  return {
    phase: overrides.phase ?? 'paused',
    currentIndex,
    total: overrides.total ?? trace.events.length,
    event: overrides.event ??
      (currentIndex >= 0 ? trace.events[currentIndex] ?? null : null),
    eventProgress: overrides.eventProgress ?? 0.4,
    overallProgress: overrides.overallProgress ?? 0.35,
    elapsedMs: overrides.elapsedMs ?? 1_200,
    durationMs: overrides.durationMs ?? 4_000,
    motion: overrides.motion ?? 'full',
  }
}

function noActions() {
  return {
    onPrevious: () => {},
    onTogglePause: () => {},
    onNext: () => {},
    onReplay: () => {},
  }
}

describe('trace playback dock', () => {
  it('shows the current event, direction, progress, and colour-independent rail state', () => {
    const dom = installTestDom()
    const trace = receipt()
    const dock = createTracePlaybackDock('ja', noActions())

    dock.update(playback(trace, {
      currentIndex: 2,
      event: trace.events[2],
      eventProgress: 0.62,
      overallProgress: 0.55,
    }), trace)

    expect(dock.root.dataset.phase).toBe('paused')
    expect(dock.root.dataset.currentDomain).toBe('tso')
    expect(dock.root.dataset.currentStatus).toBe('warning')
    expect(dock.root.querySelector('[data-trace-label]')?.textContent).toBe('timestamp label')
    expect(dock.root.querySelector('[data-trace-route]')?.textContent).toContain(
      'TiDB 1→PD / TSO',
    )
    expect(dock.root.querySelector('[data-trace-position]')?.textContent).toBe('3 / 4')
    expect(dock.root.querySelector('[data-trace-domain]')?.textContent).toBe('TSO / PD')
    expect(dock.root.querySelector('[data-trace-status]')?.textContent).toBe('注意')
    expect(
      dock.root.querySelector('[data-trace-event-progress]')?.getAttribute('aria-valuenow'),
    ).toBe('62')

    const ticks = dock.root.querySelectorAll<HTMLElement>('[data-event-index]')
    expect(ticks).toHaveLength(4)
    expect([...ticks].map((tick) => tick.dataset.state)).toEqual([
      'complete',
      'complete',
      'current',
      'future',
    ])
    expect(ticks[2].getAttribute('aria-current')).toBe('step')
    expect(ticks[2].getAttribute('aria-label')).toContain('現在')
    expect(ticks[3].querySelector('.tidb-trace-playback__tick-symbol')?.textContent).toBe('·')
  })

  it('wires all four controls and removes their listeners on dispose', () => {
    const dom = installTestDom()
    const trace = receipt()
    const calls: string[] = []
    const dock = createTracePlaybackDock('en', {
      onPrevious: () => calls.push('previous'),
      onTogglePause: () => calls.push('toggle'),
      onNext: () => calls.push('next'),
      onReplay: () => calls.push('replay'),
    })
    dock.update(playback(trace, { currentIndex: 1, event: trace.events[1] }), trace)

    const previous = dock.root.querySelector<HTMLButtonElement>('[data-action="trace-previous"]')!
    const toggle = dock.root.querySelector<HTMLButtonElement>('[data-action="trace-toggle"]')!
    const next = dock.root.querySelector<HTMLButtonElement>('[data-action="trace-next"]')!
    const replay = dock.root.querySelector<HTMLButtonElement>('[data-action="trace-replay"]')!
    previous.click()
    toggle.click()
    next.click()
    replay.click()
    expect(calls).toEqual(['previous', 'toggle', 'next', 'replay'])
    expect(toggle.textContent).toBe('Resume')

    dock.dispose()
    previous.click()
    toggle.click()
    next.click()
    replay.click()
    expect(calls).toEqual(['previous', 'toggle', 'next', 'replay'])
    expect(dock.root.childNodes).toHaveLength(0)
  })

  it('updates all chrome and rail descriptions when the locale changes', () => {
    const dom = installTestDom()
    const trace = receipt()
    const dock = createTracePlaybackDock('ja', noActions())
    dock.update(playback(trace, {
      phase: 'playing',
      currentIndex: 1,
      event: trace.events[1],
    }), trace)

    dock.setLocale('en')

    expect(dock.root.getAttribute('aria-label')).toBe('Trace playback')
    expect(dock.root.querySelector('[data-trace-phase]')?.textContent).toBe('Playing')
    expect(dock.root.querySelector('[data-action="trace-toggle"]')?.textContent).toBe('Pause')
    expect(dock.root.querySelector('[data-action="trace-replay"]')?.textContent).toBe('Replay')
    expect(
      dock.root.querySelector('[data-event-index="1"]')?.getAttribute('aria-label'),
    ).toContain('2 / 4: route label')
  })

  it('marks every event complete while retaining a replay action', () => {
    const dom = installTestDom()
    const trace = receipt()
    const dock = createTracePlaybackDock('en', noActions())
    dock.update(playback(trace, {
      phase: 'complete',
      currentIndex: 3,
      event: trace.events[3],
      eventProgress: 1,
      overallProgress: 1,
    }), trace)

    const ticks = dock.root.querySelectorAll<HTMLElement>('[data-event-index]')
    expect([...ticks].every((tick) => tick.dataset.state === 'complete')).toBe(true)
    expect([...ticks].every((tick) => tick.getAttribute('aria-current') === null)).toBe(true)
    expect(
      dock.root.querySelector<HTMLButtonElement>('[data-action="trace-toggle"]')!.disabled,
    ).toBe(true)
    expect(
      dock.root.querySelector<HTMLButtonElement>('[data-action="trace-replay"]')!.disabled,
    ).toBe(false)
    expect(ticks[3].querySelector('.tidb-trace-playback__tick-symbol')?.textContent).toBe('×')
  })

  it('renders an inert empty state without inventing a current event', () => {
    const dom = installTestDom()
    const dock = createTracePlaybackDock('ja', noActions())

    expect(dock.root.dataset.hasTrace).toBe('false')
    expect(dock.root.querySelector('[data-trace-position]')?.textContent).toBe('0 / 0')
    expect(dock.root.querySelector('[data-trace-label]')?.textContent).toContain('ありません')
    expect(dock.root.querySelectorAll('[data-event-index]')).toHaveLength(0)
    for (const control of dock.root.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      expect(control.disabled).toBe(true)
    }
  })
})
