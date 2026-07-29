/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import type { TraceEvent, TraceReceipt } from '../model/types'
import { createTiDBSimulation } from '../model/simulation'
import { createTiDBSceneGraph } from '../world/city'
import {
  buildTracePresentationSchedule,
  createTraceFlows,
  resolveTraceEndpoint,
  TRACE_LOOP_HOLD_MS,
} from './trace-flows'
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
  it('presents receipt events sequentially on a readable teaching clock', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    const events = [
      event({ id: 'client', atMs: 0, durationMs: 12, domain: 'client' }),
      event({ id: 'raft', atMs: 12, durationMs: 12, domain: 'raft', regionId: 4 }),
    ]
    const schedule = buildTracePresentationSchedule(events, [120, 80])
    expect(schedule.starts[1]).toBeGreaterThanOrEqual(
      schedule.starts[0] + schedule.lives[0] + 100,
    )
    expect(schedule.durationMs).toBeGreaterThan(1_000)

    flows.play(receipt(events))
    expect(flows.playback).toMatchObject({
      phase: 'playing',
      currentIndex: 0,
      total: 2,
    })
    expect(flows.active).toBe(0)
    flows.update(0.01)
    expect(flows.active).toBe(1)
    flows.update(0.1)
    expect(flows.active).toBe(1)
    expect(flows.playback.currentIndex).toBe(0)

    flows.step(1)
    expect(flows.active).toBe(1)
    expect(flows.playback).toMatchObject({
      phase: 'paused',
      currentIndex: 1,
    })
    flows.dispose()
    city.dispose()
  })

  it('pauses, steps, and replays without changing the receipt timeline', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    const trace = receipt([
      event({ id: 'one', atMs: 0, durationMs: 12, domain: 'client' }),
      event({ id: 'two', atMs: 12, durationMs: 12, domain: 'sql' }),
      event({ id: 'three', atMs: 24, durationMs: 12, domain: 'return' }),
    ])
    flows.play(trace)
    flows.update(0.2)
    const frozenProgress = flows.playback.eventProgress

    flows.setPaused(true)
    flows.update(5)
    expect(flows.playback.phase).toBe('paused')
    expect(flows.playback.eventProgress).toBe(frozenProgress)

    flows.step(1)
    expect(flows.playback.currentIndex).toBe(1)
    expect(flows.playback.eventProgress).toBeCloseTo(0.55)
    flows.step(-1)
    expect(flows.playback.currentIndex).toBe(0)

    flows.replay()
    expect(flows.playback).toMatchObject({
      phase: 'playing',
      currentIndex: 0,
      eventProgress: 0,
      overallProgress: 0,
    })
    expect(trace.events.map(({ atMs }) => atMs)).toEqual([0, 12, 24])
    flows.dispose()
    city.dispose()
  })

  it('holds the final event, pauses safely, then loops the same receipt', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    const trace = receipt([
      event({ id: 'one', atMs: 0, durationMs: 12, domain: 'client' }),
      event({ id: 'two', atMs: 12, durationMs: 12, domain: 'return' }),
    ])
    const modelDuration = trace.durationMs
    const modelTimes = trace.events.map(({ atMs, durationMs }) => ({ atMs, durationMs }))

    flows.play(trace)
    expect(flows.playback).toMatchObject({
      looping: true,
      iteration: 1,
      phase: 'playing',
    })
    flows.update(flows.playback.durationMs / 1_000 + 1)
    expect(flows.playback).toMatchObject({
      phase: 'holding',
      currentIndex: 1,
      eventProgress: 1,
      overallProgress: 1,
      atEnd: true,
      iteration: 1,
    })

    flows.update(TRACE_LOOP_HOLD_MS / 2_000)
    const holdProgress = flows.playback.holdProgress
    expect(holdProgress).toBeCloseTo(0.5)
    flows.setPaused(true)
    flows.update(10)
    expect(flows.playback.phase).toBe('paused')
    expect(flows.playback.holdProgress).toBe(holdProgress)

    flows.setPaused(false)
    expect(flows.playback.phase).toBe('holding')
    flows.update(TRACE_LOOP_HOLD_MS / 2_000)
    expect(flows.playback).toMatchObject({
      phase: 'playing',
      currentIndex: 0,
      eventProgress: 0,
      overallProgress: 0,
      atEnd: false,
      iteration: 2,
    })
    expect(trace.durationMs).toBe(modelDuration)
    expect(trace.events.map(({ atMs, durationMs }) => ({ atMs, durationMs }))).toEqual(
      modelTimes,
    )
    flows.dispose()
    city.dispose()
  })

  it('finishes without restarting when looping is disabled', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    flows.play(receipt([
      event({ id: 'one', domain: 'client' }),
      event({ id: 'two', domain: 'return' }),
    ]))
    flows.setLooping(false)
    flows.update(flows.playback.durationMs / 1_000 + 1)
    expect(flows.playback).toMatchObject({
      phase: 'complete',
      atEnd: true,
      looping: false,
      iteration: 1,
    })
    flows.update(10)
    expect(flows.playback).toMatchObject({
      phase: 'complete',
      iteration: 1,
    })
    flows.dispose()
    city.dispose()
  })

  it('stretches a real cross-Region receipt without mutating model time', () => {
    const simulation = createTiDBSimulation()
    const trace = simulation.runScenario('cross-region-transaction')
    const modelDuration = trace.durationMs
    const modelTimes = trace.events.map(({ atMs }) => atMs)
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)

    flows.play(trace)

    expect(trace.events).toHaveLength(31)
    expect(modelDuration).toBe(372)
    expect(flows.playback.durationMs).toBeGreaterThan(20_000)
    expect(trace.durationMs).toBe(modelDuration)
    expect(trace.events.map(({ atMs }) => atMs)).toEqual(modelTimes)
    flows.dispose()
    city.dispose()
  })

  it('uses a stationary endpoint pulse for local work', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    flows.play(receipt([
      event({
        id: 'local',
        domain: 'sql',
        kind: 'parse_optimize',
        source: 'tidb-1',
        target: 'tidb-1',
      }),
    ]))
    flows.update(0.1)

    const guide = flows.object.getObjectByName('trace-flow:route-guide') as THREE.InstancedMesh
    const endpoints = flows.object.getObjectByName('trace-flow:endpoints') as THREE.InstancedMesh
    expect(guide.count).toBe(0)
    expect(endpoints.count).toBe(1)
    expect(flows.active).toBe(1)
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
