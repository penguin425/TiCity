// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from '../model'
import type { TraceEvent } from '../model/types'
import type { DiagnoseCursor } from './cursor'
import {
  DIAGNOSE_PAGE_COPY,
  diagnoseCursorNote,
  diagnoseEventName,
  diagnoseEventOptionLabel,
} from './page-copy'

const event: TraceEvent = Object.freeze({
  id: 'event-9',
  atMs: 90,
  durationMs: 10,
  domain: 'kv',
  kind: 'deadlock_detected',
  label: 'Cluster-wide detector found a cycle',
  detail: 'Synthetic detail.',
  status: 'failed',
  metadata: Object.freeze({}),
})

describe('Diagnose page copy', () => {
  it('localizes Lock Lab event labels in Japanese and preserves English', () => {
    expect(diagnoseEventName('ja', event)).toBe('クラスタ全体のdetectorがcycleを検出')
    expect(diagnoseEventName('en', event)).toBe(event.label)
  })

  it('covers every visible Lock Lab event option in both locales', () => {
    const events = createTiDBSimulation({ seed: 425 })
      .runScenario('lock-deadlock')
      .events
    for (const [index, candidate] of events.entries()) {
      const cursor: DiagnoseCursor = {
        event: candidate,
        snapshot: candidate.snapshot ?? null,
        snapshotEvent: candidate.snapshot ? candidate : null,
        resolution: candidate.snapshot ? 'exact' : 'scenario-start',
      }
      expect(diagnoseEventName('ja', candidate)).not.toBe(candidate.label)
      expect(diagnoseEventOptionLabel('ja', candidate, index, cursor))
        .toContain(diagnoseEventName('ja', candidate))
      expect(diagnoseEventOptionLabel('en', candidate, index, cursor))
        .toContain(candidate.label)
    }
  })

  it('covers every visible Protocol Lab event option in both locales', () => {
    const events = createTiDBSimulation({ seed: 425 })
      .runScenario('commit-protocols')
      .events
    expect(events).toHaveLength(75)
    for (const [index, candidate] of events.entries()) {
      const cursor: DiagnoseCursor = {
        event: candidate,
        snapshot: candidate.snapshot ?? null,
        snapshotEvent: candidate.snapshot ? candidate : null,
        resolution: candidate.snapshot ? 'exact' : 'scenario-start',
      }
      expect(diagnoseEventName('ja', candidate)).not.toBe(candidate.label)
      expect(diagnoseEventOptionLabel('ja', candidate, index, cursor))
        .toContain(diagnoseEventName('ja', candidate))
      expect(diagnoseEventOptionLabel('en', candidate, index, cursor))
        .toContain(candidate.label)
    }
  })

  it('keeps all 45 GC deep-link options exact, numbered, and localized', () => {
    const events = createTiDBSimulation({ seed: 425 })
      .runScenario('gc-safe-point')
      .events
    expect(events).toHaveLength(45)
    for (const [index, candidate] of events.entries()) {
      const cursor: DiagnoseCursor = {
        event: candidate,
        snapshot: candidate.snapshot ?? null,
        snapshotEvent: candidate.snapshot ? candidate : null,
        resolution: candidate.snapshot ? 'exact' : 'scenario-start',
      }
      expect(cursor.resolution).toBe('exact')
      expect(diagnoseEventName('ja', candidate)).not.toBe(candidate.label)
      expect(diagnoseEventOptionLabel('ja', candidate, index, cursor))
        .toMatch(new RegExp(`^${index + 1}\\. `))
      expect(diagnoseEventOptionLabel('en', candidate, index, cursor))
        .toBe(`${index + 1}. ${candidate.label}`)
    }
    const scheduled = events.find((candidate) => candidate.kind === 'gc_delete_marker_cleanup_scheduled')
    const completed = events.find((candidate) => candidate.kind === 'gc_delete_marker_cleanup_complete')
    if (!scheduled || !completed) throw new Error('Expected separate Delete-marker cleanup events')
    expect(diagnoseEventName('ja', scheduled)).toContain('後続compaction')
    expect(diagnoseEventName('ja', scheduled)).toContain('別GC-key taskを登録')
    expect(diagnoseEventName('ja', completed)).toContain('GC-key taskがDelete markerを削除')
  })

  it('localizes every model-7 TiFlash/MPP event without changing English', () => {
    const events = createTiDBSimulation({ seed: 425 })
      .runScenario('tiflash-mpp')
      .events
    expect(events).toHaveLength(56)
    for (const candidate of events) {
      expect(diagnoseEventName('en', candidate)).toBe(candidate.label)
      expect(diagnoseEventName('ja', candidate)).not.toBe(candidate.label)
    }
    const applied = events.find((candidate) =>
      candidate.id === 'trace-1-event-37')
    expect(applied?.kind).toBe('tiflash_learner_applied_advance')
    expect(applied && diagnoseEventName('ja', applied))
      .toBe('Region 26 learnerのapplied indexが前進')
  })

  it('marks snapshotless event options and explains the cursor rule visibly', () => {
    const cursor: DiagnoseCursor = {
      event,
      snapshot: null,
      snapshotEvent: null,
      resolution: 'scenario-start',
    }
    expect(diagnoseEventOptionLabel('ja', event, 8, cursor))
      .toContain('シナリオ開始時点を使用')
    expect(diagnoseCursorNote('en', cursor)).toContain('nearest earlier detailed snapshot')
    expect(diagnoseCursorNote('en', cursor)).toContain('scenario start')
    expect(DIAGNOSE_PAGE_COPY.ja.cursorRule).toContain('直前の詳細スナップショット')
  })
})
