/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import type { TraceEvent, TraceReceipt } from '../model/types'
import { createTiDBSimulation } from '../model/simulation'
import { createTiDBSceneGraph } from '../world/city'
import { createTraceFlows, resolveTraceEndpoint } from './trace-flows'
import * as THREE from 'three'

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

function receipt(events: readonly TraceEvent[]): TraceReceipt {
  return {
    id: 'trace-test',
    scenarioId: 'point-read',
    analysis: ANALYSIS,
    startTs: 1,
    commitTs: null,
    succeeded: true,
    committed: false,
    outcome: 'succeeded',
    protocol: null,
    events,
    durationMs: 1200,
    replay: {
      modelVersion: 'test',
      seed: 1,
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

function event(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: 'event',
    atMs: 0,
    durationMs: 500,
    domain: 'sql',
    kind: 'dispatch',
    label: 'dispatch',
    detail: 'model event',
    status: 'success',
    metadata: {},
    ...overrides,
  }
}

describe('TraceReceipt-driven city flows', () => {
  it('schedules particles only from receipt events', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    flows.play(
      receipt([
        event({ id: 'client', atMs: 0, domain: 'client' }),
        event({ id: 'raft', atMs: 100, domain: 'raft', regionId: 4 }),
      ]),
    )

    expect(flows.active).toBe(0)
    flows.update(0.01)
    expect(flows.active).toBe(1)
    flows.update(0.1)
    expect(flows.active).toBe(2)
    flows.update(1)
    expect(flows.active).toBe(0)
    flows.dispose()
    city.dispose()
  })

  it('maps model node ids and keeps TSO at the PD control plane', () => {
    const city = createTiDBSceneGraph()
    const out = new THREE.Vector3()
    const tso = event({ domain: 'tso', source: 'tidb-2', target: 'pd' })
    expect(resolveTraceEndpoint(tso, 'source', city, out)).toBe(true)
    expect(out.equals(city.registry.get('tidb.1')!.anchor)).toBe(true)
    expect(resolveTraceEndpoint(tso, 'target', city, out)).toBe(true)
    expect(out.equals(city.registry.get('pd.control')!.anchor)).toBe(true)

    const overflow = event({
      domain: 'kv',
      regionId: 36,
      target: 'tikv-2',
    })
    expect(resolveTraceEndpoint(overflow, 'target', city, out)).toBe(true)
    expect(out.equals(city.registry.get('tikv.1')!.anchor)).toBe(true)
    city.dispose()
  })

  it('uses explicit live peers for failover and Raft quorum routes', () => {
    const simulation = createTiDBSimulation()
    const failover = simulation.runScenario('tikv-failover')
    const analysis = simulation.submitSql(
      'UPDATE accounts SET balance = 1 WHERE id = 7',
    ).analysis
    const write = simulation.requestTrace({
      analysis,
      regionIds: [0],
      forceProtocol: '1pc',
    })!
    const city = createTiDBSceneGraph()
    city.updateState(simulation.state)
    const from = new THREE.Vector3()
    const to = new THREE.Vector3()

    for (const [kind, receipt] of [
      ['leader_election', failover],
      ['quorum_commit', write],
    ] as const) {
      const traceEvent = receipt.events.find((candidate) => candidate.kind === kind)
      expect(traceEvent, kind).toBeDefined()
      expect(resolveTraceEndpoint(traceEvent!, 'source', city, from)).toBe(true)
      expect(resolveTraceEndpoint(traceEvent!, 'target', city, to)).toBe(true)
      expect(from.equals(to), kind).toBe(false)
    }
    expect([...failover.events, ...write.events].some((traceEvent) =>
      traceEvent.source?.startsWith('txn-') ||
      traceEvent.target?.startsWith('txn-'),
    )).toBe(false)
    city.dispose()
  })
})
