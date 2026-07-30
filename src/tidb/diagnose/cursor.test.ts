// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import type { TraceEvent, TraceStateSnapshot } from '../model/types'
import { resolveDiagnoseCursor } from './cursor'

const snapshot: TraceStateSnapshot = Object.freeze({
  modelVersion: 'tidb-v8.5-model-3',
  tsoLastAllocated: 101,
  transaction: null,
  regions: Object.freeze([]),
})

function event(id: string, detail?: TraceStateSnapshot): TraceEvent {
  return Object.freeze({
    id,
    atMs: 0,
    durationMs: 1,
    domain: 'kv',
    kind: id,
    label: id,
    detail: id,
    status: 'success',
    ...(detail ? { snapshot: detail } : {}),
    metadata: Object.freeze({}),
  })
}

describe('Diagnose event cursor', () => {
  const events = [
    event('event-1'),
    event('event-2', snapshot),
    event('event-3'),
    event('event-4', { ...snapshot, tsoLastAllocated: 102 }),
  ] as const

  it('uses the exact immutable snapshot when the selected event has one', () => {
    const cursor = resolveDiagnoseCursor(events, 'event-4')
    expect(cursor).toMatchObject({
      event: events[3],
      snapshotEvent: events[3],
      resolution: 'exact',
    })
    expect(cursor.snapshot?.tsoLastAllocated).toBe(102)
  })

  it('uses the nearest previous detailed snapshot for a snapshotless event', () => {
    const cursor = resolveDiagnoseCursor(events, 'event-3')
    expect(cursor).toMatchObject({
      event: events[2],
      snapshot: snapshot,
      snapshotEvent: events[1],
      resolution: 'previous',
    })
  })

  it('falls back explicitly to scenario start when no earlier snapshot exists', () => {
    expect(resolveDiagnoseCursor(events, 'event-1')).toMatchObject({
      event: events[0],
      snapshot: null,
      snapshotEvent: null,
      resolution: 'scenario-start',
    })
  })

  it('uses the last detailed snapshot only for the final-state view', () => {
    const cursor = resolveDiagnoseCursor(events, null)
    expect(cursor).toMatchObject({
      event: null,
      snapshotEvent: events[3],
      resolution: 'final',
    })
    expect(cursor.snapshot?.tsoLastAllocated).toBe(102)
  })
})
