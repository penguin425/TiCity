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

  it('preserves overlapping model intervals and exposes every active branch', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    const events = [
      event({
        id: 'region-0-prewrite',
        atMs: 0,
        durationMs: 100,
        domain: 'txn2pc',
        regionId: 0,
      }),
      event({
        id: 'region-18-prewrite',
        atMs: 20,
        durationMs: 100,
        domain: 'txn2pc',
        regionId: 18,
      }),
    ]
    const schedule = buildTracePresentationSchedule(events, [100, 100])
    const firstEnd = schedule.starts[0] + schedule.lives[0]
    const secondEnd = schedule.starts[1] + schedule.lives[1]

    expect(schedule.starts[1]).toBeGreaterThan(schedule.starts[0])
    expect(schedule.starts[1]).toBeLessThan(firstEnd)
    expect(firstEnd).toBeGreaterThan(schedule.starts[1])
    expect(secondEnd).toBeGreaterThan(firstEnd)
    expect([...schedule.order]).toEqual([0, 1])

    const parallel = receipt([
      event({
        id: 'branch-a',
        atMs: 0,
        durationMs: 100,
        domain: 'raft',
        regionId: 0,
      }),
      event({
        id: 'branch-b',
        atMs: 0,
        durationMs: 100,
        domain: 'raft',
        regionId: 18,
      }),
    ])
    const activeIds = flows.playback.activeEventIds
    const completedIds = flows.playback.completedEventIds
    flows.play(parallel)

    expect(flows.playback.activeEventIds).toBe(activeIds)
    expect(flows.playback.completedEventIds).toBe(completedIds)
    expect(flows.activeEventIds).toBe(activeIds)
    expect(flows.completedEventIds).toBe(completedIds)
    expect(flows.playback.activeEventIds).toEqual(['branch-a', 'branch-b'])
    expect(flows.playback.currentIndex).toBe(1)
    expect(flows.playback.cursorMs).toBe(0)
    flows.update(0.01)
    expect(flows.active).toBe(2)
    expect(flows.playback.activeEventIds).toEqual(['branch-a', 'branch-b'])

    flows.update(flows.playback.durationMs / 1_000 + 1)
    expect(flows.playback.activeEventIds).toEqual([])
    expect(flows.playback.completedEventIds).toEqual(['branch-a', 'branch-b'])
    expect(flows.playback.cursorMs).toBe(flows.playback.durationMs)
    expect(flows.cursorMs).toBe(flows.playback.durationMs)
    flows.dispose()
    city.dispose()
  })

  it('seeks an exact parallel sibling by stable event id and pauses there', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    flows.play(receipt([
      event({
        id: 'branch-a',
        atMs: 0,
        durationMs: 100,
        domain: 'raft',
        regionId: 0,
      }),
      event({
        id: 'branch-b',
        atMs: 0,
        durationMs: 100,
        domain: 'raft',
        regionId: 18,
      }),
    ]))

    expect(flows.playback.event?.id).toBe('branch-b')
    expect(flows.seek('branch-a')).toBe(true)
    expect(flows.playback).toMatchObject({
      phase: 'paused',
      currentIndex: 0,
    })
    expect(flows.playback.event?.id).toBe('branch-a')
    expect(flows.playback.activeEventIds).toEqual(['branch-a', 'branch-b'])
    expect(flows.seek('missing-event')).toBe(false)
    expect(flows.playback.event?.id).toBe('branch-a')

    flows.setPaused(false)
    expect(flows.playback.event?.id).toBe('branch-b')
    flows.dispose()
    city.dispose()
  })

  it('starts a causal join after every declared parent while leaving siblings parallel', () => {
    const parentA = event({
      id: 'apply-region-0',
      atMs: 0,
      durationMs: 100,
      domain: 'kv',
      regionId: 0,
    })
    const parentB = event({
      id: 'apply-region-18',
      atMs: 0,
      durationMs: 100,
      domain: 'kv',
      regionId: 18,
    })
    const join = {
      ...event({
        id: 'prewrite-join',
        atMs: 20,
        durationMs: 20,
        domain: 'txn2pc',
      }),
      dependsOn: ['apply-region-0', 'apply-region-18'],
    } as TraceEvent
    const schedule = buildTracePresentationSchedule(
      [parentA, parentB, join],
      [80, 180, 40],
    )
    const parentEnd = Math.max(
      schedule.starts[0] + schedule.lives[0],
      schedule.starts[1] + schedule.lives[1],
    )

    expect(schedule.starts[0]).toBe(schedule.starts[1])
    expect(schedule.starts[2]).toBeGreaterThan(parentEnd)
    expect([...schedule.order]).toEqual([0, 1, 2])
  })

  it('keeps dependencies optional for legacy receipts and ignores unknown parents', () => {
    const root = event({
      id: 'legacy-root',
      atMs: 0,
      durationMs: 100,
      domain: 'sql',
    })
    const legacyChild = event({
      id: 'legacy-child',
      atMs: 20,
      durationMs: 80,
      domain: 'kv',
    })
    const unknownParentChild = {
      ...legacyChild,
      dependsOn: ['not-in-this-receipt'],
    } as TraceEvent

    const legacy = buildTracePresentationSchedule([root, legacyChild], [60, 60])
    const unknown = buildTracePresentationSchedule(
      [root, unknownParentChild],
      [60, 60],
    )

    expect([...unknown.starts]).toEqual([...legacy.starts])
    expect([...unknown.lives]).toEqual([...legacy.lives])
    expect([...unknown.order]).toEqual([...legacy.order])
    expect(unknown.durationMs).toBe(legacy.durationMs)
  })

  it('steps by parallel start group in both directions', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    const rootEvent = event({
      id: 'root',
      atMs: 0,
      durationMs: 10,
      domain: 'tso',
    })
    const branchA = {
      ...event({
        id: 'branch-a',
        atMs: 10,
        durationMs: 20,
        domain: 'raft',
        regionId: 0,
      }),
      dependsOn: ['root'],
    } as TraceEvent
    const branchB = {
      ...event({
        id: 'branch-b',
        atMs: 10,
        durationMs: 20,
        domain: 'raft',
        regionId: 18,
      }),
      dependsOn: ['root'],
    } as TraceEvent
    const join = {
      ...event({
        id: 'join',
        atMs: 30,
        durationMs: 10,
        domain: 'txn2pc',
      }),
      dependsOn: ['branch-a', 'branch-b'],
    } as TraceEvent

    flows.play(receipt([rootEvent, branchA, branchB, join]))
    expect(flows.activeEventIds).toEqual(['root'])

    flows.step(1)
    expect(flows.playback.phase).toBe('paused')
    expect(flows.playback.currentIndex).toBe(2)
    expect(flows.activeEventIds).toEqual(['branch-a', 'branch-b'])

    flows.step(1)
    expect(flows.playback.currentIndex).toBe(3)
    expect(flows.activeEventIds).toEqual(['join'])

    flows.step(-1)
    expect(flows.playback.currentIndex).toBe(2)
    expect(flows.activeEventIds).toEqual(['branch-a', 'branch-b'])
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

  it('reuses the same bounded render pool through 50 parallel trace loops', () => {
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    const trace = receipt(Object.freeze([
      Object.freeze(event({
        id: 'parallel-a',
        atMs: 0,
        durationMs: 30,
        domain: 'raft',
        regionId: 0,
      })),
      Object.freeze(event({
        id: 'parallel-b',
        atMs: 0,
        durationMs: 30,
        domain: 'raft',
        regionId: 18,
      })),
    ]))
    const children = flows.object.children.length
    const geometry = flows.mesh.geometry
    const material = flows.mesh.material
    const modelTimes = trace.events.map(({ atMs, durationMs }) => ({ atMs, durationMs }))

    flows.play(trace)
    for (let loop = 0; loop < 50; loop++) {
      flows.update(flows.playback.durationMs / 1_000 + 0.01)
      expect(flows.playback.phase).toBe('holding')
      expect(flows.playback.completedEventIds).toEqual(['parallel-a', 'parallel-b'])

      flows.update(TRACE_LOOP_HOLD_MS / 1_000)
      expect(flows.playback.iteration).toBe(loop + 2)
      expect(flows.playback.phase).toBe('playing')
      expect(flows.active).toBe(2)
      expect(flows.mesh.count).toBe(2)
      expect(flows.dropped).toBe(0)
      expect(flows.object.children).toHaveLength(children)
      expect(flows.mesh.geometry).toBe(geometry)
      expect(flows.mesh.material).toBe(material)
    }

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

  it('keeps parallel state deterministic under reduced motion and disables loops by default', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        matchMedia: () => ({ matches: true }),
      },
    })

    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)
    try {
      flows.play(receipt([
        event({ id: 'reduced-a', atMs: 0, durationMs: 20, domain: 'raft' }),
        event({ id: 'reduced-b', atMs: 0, durationMs: 20, domain: 'raft' }),
      ]))
      expect(flows.playback).toMatchObject({
        motion: 'reduced',
        looping: false,
      })
      flows.update(0.01)
      expect(flows.active).toBe(2)
      expect(flows.playback.activeEventIds).toEqual(['reduced-a', 'reduced-b'])

      const cursor = flows.playback.cursorMs
      flows.setPaused(true)
      flows.update(10)
      expect(flows.playback.cursorMs).toBe(cursor)
      expect(flows.playback.phase).toBe('paused')

      flows.setLooping(true)
      expect(flows.playback.looping).toBe(true)
    } finally {
      flows.dispose()
      city.dispose()
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })

  it('stretches a real cross-Region receipt without mutating model time', () => {
    const simulation = createTiDBSimulation()
    const trace = simulation.runScenario('cross-region-transaction')
    const modelDuration = trace.durationMs
    const modelTimes = trace.events.map(({ atMs, durationMs }) => ({ atMs, durationMs }))
    const parallelBranches = trace.events.filter((event) =>
      event.branchId !== undefined &&
      trace.events.some((candidate) =>
        candidate.id !== event.id &&
        candidate.atMs === event.atMs &&
        candidate.dependsOn?.some((dependency) =>
          event.dependsOn?.includes(dependency),
        ),
      ),
    )
    const city = createTiDBSceneGraph()
    const flows = createTraceFlows(city)

    flows.play(trace)

    expect(parallelBranches.length).toBeGreaterThanOrEqual(2)
    expect(flows.playback.durationMs).toBeGreaterThan(modelDuration)
    expect(trace.durationMs).toBe(modelDuration)
    expect(trace.events.map(({ atMs, durationMs }) => ({ atMs, durationMs }))).toEqual(
      modelTimes,
    )
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

  it('resolves every Lock Lab endpoint without the world-origin fallback', () => {
    const simulation = createTiDBSimulation()
    const trace = simulation.runScenario('lock-deadlock')
    const city = createTiDBSceneGraph()
    const point = new THREE.Vector3()
    const fallback = new THREE.Vector3(0, 5, 0)

    for (const traceEvent of trace.events) {
      for (const side of ['source', 'target'] as const) {
        expect(
          resolveTraceEndpoint(traceEvent, side, city, point),
          `${traceEvent.kind}:${side}:${traceEvent[side] ?? '(default)'}`,
        ).toBe(true)
        expect(
          point.equals(fallback),
          `${traceEvent.kind}:${side} used the renderer fallback`,
        ).toBe(false)
      }
    }

    const error = trace.events.find(
      (traceEvent) => traceEvent.kind === 'deadlock_error_1213',
    )!
    expect(resolveTraceEndpoint(error, 'target', city, point)).toBe(true)
    expect(point.equals(city.registry.get('client.terminal')!.anchor)).toBe(true)

    const clientAliases = event({
      source: 'client-a',
      target: 'client-b',
      snapshot: error.snapshot,
    })
    expect(resolveTraceEndpoint(clientAliases, 'source', city, point)).toBe(true)
    expect(point.equals(city.registry.get('client.terminal')!.anchor)).toBe(true)
    expect(resolveTraceEndpoint(clientAliases, 'target', city, point)).toBe(true)
    expect(point.equals(city.registry.get('client.terminal')!.anchor)).toBe(true)

    const detectorEndpoints: Array<{
      readonly traceEvent: TraceEvent
      readonly side: 'source' | 'target'
    }> = []
    for (const traceEvent of trace.events) {
      switch (traceEvent.kind) {
        case 'lock_wait_enqueued':
        case 'deadlock_detected':
          detectorEndpoints.push({ traceEvent, side: 'target' })
          break
        case 'deadlock_victim_selected':
        case 'deadlock_resolved':
          detectorEndpoints.push({ traceEvent, side: 'source' })
          break
      }
    }
    expect(detectorEndpoints.length).toBeGreaterThanOrEqual(5)
    for (const { traceEvent, side } of detectorEndpoints) {
      expect(traceEvent[side]).toBe('tikv-3')
      expect(resolveTraceEndpoint(traceEvent, side, city, point)).toBe(true)
      expect(point.equals(city.registry.get('tikv.2')!.anchor)).toBe(true)
      if (traceEvent.regionId !== undefined) {
        expect(
          point.equals(
            city.registry.get(`region.${traceEvent.regionId}.peer.2`)!.anchor,
          ),
        ).toBe(false)
      }
    }
    city.dispose()
  })
})
