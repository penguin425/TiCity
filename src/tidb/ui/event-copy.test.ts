/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from '../model'
import { TIDB_SCENARIOS } from '../model/scenarios'
import {
  TRACE_EVENT_KINDS,
  traceDomainLabel,
  traceEndpointLabel,
  traceEventCopy,
} from './event-copy'

describe('trace event presentation catalog', () => {
  it('covers every event kind emitted by the default request and all scenarios', () => {
    const emitted = new Set<string>()
    for (const scenario of TIDB_SCENARIOS) {
      const receipt = createTiDBSimulation({ seed: 425 }).runScenario(scenario.id)
      for (const event of receipt.events) {
        emitted.add(event.kind)
        expect(TRACE_EVENT_KINDS).toContain(event.kind)

        const japanese = traceEventCopy(event, 'ja')
        const english = traceEventCopy(event, 'en')
        expect(japanese.label.length).toBeGreaterThan(0)
        expect(japanese.detail.length).toBeGreaterThan(0)
        expect(english.label.length).toBeGreaterThan(0)
        expect(english.detail.length).toBeGreaterThan(0)
        /* Model receipt prose remains untouched and is never the Japanese UI
           detail, even when the receipt itself is deterministic English. */
        expect(japanese.detail).not.toBe(event.detail)
      }
    }
    expect(emitted.size).toBeGreaterThan(100)
  })

  it('keeps technical domain terms while clarifying client, transaction, and return domains', () => {
    expect(traceDomainLabel('ja', 'client')).toBe('クライアント')
    expect(traceDomainLabel('ja', 'return')).toBe('応答')
    expect(traceDomainLabel('ja', 'txn2pc')).toBe('トランザクション 2PC')
    expect(traceDomainLabel('ja', 'raft')).toBe('Region Raft')
    expect(traceDomainLabel('ja', 'kv')).toBe('TiKV / MVCC')
    expect(traceDomainLabel('ja', 'tiflash')).toBe('TiFlash / MPP')
    expect(traceEndpointLabel('ja', 'tiflash-1')).toBe('TiFlash Store 1')
    expect(traceEndpointLabel('en', 'tiflash-2')).toBe('TiFlash Store 2')
  })

  it('does not expose a free-form label or detail for an unknown kind', () => {
    const source = {
      kind: 'custom_event',
      label: 'SELECT secret_personal_value',
      detail: 'private literal should never be rendered',
      domain: 'sql',
    }
    const japanese = traceEventCopy(source, 'ja')
    expect(japanese.label).not.toContain('secret_personal_value')
    expect(japanese.detail).not.toContain('private literal')
    expect(japanese.label).toContain('Custom Event')

    for (const kind of ['constructor', 'toString', 'hasOwnProperty']) {
      const fallback = traceEventCopy({ kind }, 'ja')
      expect(fallback.label).toContain('イベント')
      expect(fallback.detail).not.toContain('undefined')
    }
  })

  it('keeps the three commit-protocol branches distinct from canonical metadata', () => {
    const protocols = [
      ['1pc', '1PC'],
      ['async_commit', 'Async Commit'],
      ['2pc', 'regular 2PC'],
    ] as const

    for (const [selected, label] of protocols) {
      const japanese = traceEventCopy({
        kind: 'protocol_selection',
        metadata: { selected },
      }, 'ja')
      const english = traceEventCopy({
        kind: 'protocol_selection',
        metadata: { selected },
      }, 'en')
      expect(japanese.label).toContain(label)
      expect(japanese.detail).toContain(label)
      expect(english.label).toContain(label)
      expect(english.detail).toContain(label)
    }

    const receipt = createTiDBSimulation({ seed: 425 }).runScenario('commit-protocols')
    const responses = receipt.events.filter((event) =>
      event.kind === 'protocol_client_response')
    expect(responses).toHaveLength(3)
    expect(new Set(responses.map((event) => traceEventCopy(event, 'en').label)).size)
      .toBe(3)
    for (const event of responses) {
      const copy = traceEventCopy(event, 'en')
      expect(copy.label).toBe(event.label)
      expect(copy.detail).toBe(event.detail)
    }
  })

  it('retains operation, Region, and transaction identity in dynamic copies', () => {
    const onePc = traceEventCopy({
      kind: 'protocol_raft_propose',
      regionId: 24,
      metadata: { operation: 'one_pc_prewrite' },
    }, 'ja')
    const asyncCommit = traceEventCopy({
      kind: 'protocol_raft_propose',
      regionId: 25,
      metadata: { operation: 'commit_async' },
    }, 'ja')
    expect(onePc.label).toContain('1PC prewrite')
    expect(asyncCommit.label).toContain('Async commit')
    expect(onePc.detail).toContain('Region 24')
    expect(asyncCommit.detail).toContain('Region 25')
    expect(onePc.label).not.toBe(asyncCommit.label)

    const first = traceEventCopy({
      kind: 'lock_acquired',
      regionId: 6,
      transactionId: 'txn-1',
      metadata: { resourceId: 'resource-a' },
    }, 'ja')
    const second = traceEventCopy({
      kind: 'lock_acquired',
      regionId: 7,
      transactionId: 'txn-2',
      metadata: { resourceId: 'resource-b' },
    }, 'ja')
    expect(first.label).toContain('resource-a')
    expect(second.label).toContain('resource-b')
    expect(first.detail).toContain('Region 6')
    expect(first.detail).toContain('txn-1')
    expect(second.detail).toContain('Region 7')
    expect(second.detail).toContain('txn-2')
    expect(first.detail).not.toBe(second.detail)
  })

  it('preserves the first/second GC round distinction from round metadata', () => {
    const receipt = createTiDBSimulation({ seed: 425 }).runScenario('gc-safe-point')
    const starts = receipt.events.filter((event) => event.kind === 'gc_round_start')
    const candidates = receipt.events.filter((event) => event.kind === 'gc_safe_point_candidate')
    expect(starts).toHaveLength(2)
    expect(candidates).toHaveLength(2)

    const startCopies = starts.map((event) => traceEventCopy(event, 'ja'))
    const candidateCopies = candidates.map((event) => traceEventCopy(event, 'ja'))
    expect(startCopies[0].label).toContain('第1ラウンド')
    expect(startCopies[1].label).toContain('第2ラウンド')
    expect(new Set(startCopies.map((copy) => copy.label)).size).toBe(2)
    expect(new Set(candidateCopies.map((copy) => copy.detail)).size).toBe(2)

    const englishStarts = starts.map((event) => traceEventCopy(event, 'en'))
    const englishCandidates = candidates.map((event) => traceEventCopy(event, 'en'))
    expect(englishStarts.map((copy) => copy.label)).toEqual(starts.map((event) => event.label))
    expect(englishStarts.map((copy) => copy.detail)).toEqual(starts.map((event) => event.detail))
    expect(englishCandidates.map((copy) => copy.label)).toEqual(candidates.map((event) => event.label))
    expect(englishCandidates.map((copy) => copy.detail)).toEqual(candidates.map((event) => event.detail))

    const compactions = receipt.events.filter((event) => event.kind === 'gc_compaction_filter_apply')
    expect(compactions).toHaveLength(2)
    expect(new Set(compactions.map((event) => traceEventCopy(event, 'ja').detail)).size).toBe(2)

    const servicePoints = receipt.events.filter((event) => event.kind === 'gc_service_safe_point')
    expect(servicePoints).toHaveLength(2)
    expect(traceEventCopy(servicePoints[0]!, 'ja').label).toContain('制限値')
    expect(traceEventCopy(servicePoints[0]!, 'ja').detail).toContain('active transaction')
    expect(traceEventCopy(servicePoints[1]!, 'ja').label).toContain('候補')
    expect(traceEventCopy(servicePoints[1]!, 'ja').detail).toContain('候補がこのround')
  })
})
