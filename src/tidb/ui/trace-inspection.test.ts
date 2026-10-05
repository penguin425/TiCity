// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from '../model'
import {
  buildTraceInspectionIndex,
  projectTraceInspection,
  traceSourceGroup,
  type TraceInspectionEvent,
} from './trace-inspection'
import { TRACE_REFERENCE_GROUPS } from './trace-inspection-copy'

describe('shared trace inspection projection', () => {
  it('indexes only direct explicit dependencies, preserving parallel branches and separate fences', () => {
    const events: readonly TraceInspectionEvent[] = Object.freeze([
      Object.freeze({ id: 'root', path: 'critical' as const }),
      Object.freeze({ id: 'left', dependsOn: Object.freeze(['root']), path: 'critical' as const }),
      Object.freeze({ id: 'right', dependsOn: Object.freeze(['root']), presentationAfter: 'left', path: 'background' as const }),
      Object.freeze({ id: 'join', dependsOn: Object.freeze(['left', 'right', 'left']) }),
      Object.freeze({ id: 'adjacent' }),
    ])
    const before = JSON.stringify(events)
    const index = buildTraceInspectionIndex(events)
    const right = projectTraceInspection(index, events[2])
    expect(right.parents.map((event) => event.id)).toEqual(['root'])
    expect(right.children.map((event) => event.id)).toEqual(['join'])
    expect(right.presentationFence?.id).toBe('left')
    expect(right.path).toBe('background')
    expect(index.childrenById.get('root')?.map((event) => event.id)).toEqual(['left', 'right'])
    expect(index.childrenById.get('left')?.map((event) => event.id)).toEqual(['join'])
    expect(index.parentsById.get('join')?.map((event) => event.id)).toEqual(['left', 'right'])
    expect(index.parentsById.get('adjacent')).toEqual([])
    expect(projectTraceInspection(index, events[3]).path).toBe('unspecified')
    expect(JSON.stringify(events)).toBe(before)
  })

  it('inspects an actual parallel receipt without turning its presentation fence into causality', () => {
    const receipt = createTiDBSimulation({ seed: 425 }).runScenario('tiflash-mpp')
    const fencedEvent = receipt.events.find((event) => event.presentationAfter &&
      !event.dependsOn?.includes(event.presentationAfter))
    if (!fencedEvent) throw new Error('Expected an independent learner/task presentation fence')
    const before = JSON.stringify(receipt)
    const index = buildTraceInspectionIndex(receipt.events)
    const inspection = projectTraceInspection(index, fencedEvent)
    expect(inspection.presentationFence?.id).toBe(fencedEvent.presentationAfter)
    expect(inspection.parents.map((event) => event.id)).toEqual(fencedEvent.dependsOn ?? [])
    expect(inspection.parents.map((event) => event.id)).not.toContain(fencedEvent.presentationAfter)
    expect(inspection.sourceGroup).toBe('tiflash')
    expect(index.childrenById.get(fencedEvent.presentationAfter!)?.map((event) => event.id))
      .not.toContain(fencedEvent.id)
    expect(JSON.stringify(receipt)).toBe(before)
  })

  it('selects mechanism references from detailed snapshots and keeps snapshotless events an overview', () => {
    for (const [scenario, group, lab] of [
      ['cross-region-transaction', 'transaction', 'transaction'],
      ['lock-deadlock', 'lock', 'lockLab'],
      ['tikv-failover', 'raft', 'raftLab'],
      ['commit-protocols', 'protocol', 'protocolLab'],
      ['gc-safe-point', 'gc', 'gcLab'],
      ['tiflash-mpp', 'tiflash', 'tiflashMppLab'],
    ] as const) {
      const receipt = createTiDBSimulation({ seed: 425 }).runScenario(scenario)
      const event = receipt.events.find((entry) => entry.snapshot?.[lab])
      if (!event) throw new Error(`Missing ${scenario} snapshot`)
      expect(traceSourceGroup(event)).toBe(group)
    }
    expect(traceSourceGroup({ id: 'generic', domain: 'raft', kind: 'SQL secret' })).toBe('overview')
  })

  it('uses fixed primary source URLs independent from SQL, ids, or metadata', () => {
    const secret = "SELECT * FROM accounts WHERE token = 'private-literal'"
    const event: TraceInspectionEvent = {
      id: secret,
      kind: secret,
      metadata: { sql: secret },
    }
    const inspection = projectTraceInspection(buildTraceInspectionIndex([event]), event)
    const sources = TRACE_REFERENCE_GROUPS[inspection.sourceGroup].sources
    expect(sources).toHaveLength(2)
    for (const group of Object.values(TRACE_REFERENCE_GROUPS)) {
      expect(group.sources).toHaveLength(2)
      for (const source of group.sources) {
        expect(source.url).toMatch(/^https:\/\/github\.com\/(pingcap|tikv)\/[a-z-]+\/blob\/[a-f0-9]{40}\//)
        expect(new URL(source.url).search).toBe('')
        expect(source.url).not.toContain('private-literal')
        expect(source.url).not.toContain('SELECT')
      }
    }
  })
})
