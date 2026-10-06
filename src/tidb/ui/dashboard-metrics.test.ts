/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from '../model/simulation'
import {
  createDashboardMetrics,
  DASHBOARD_HISTORY_SECONDS,
  DASHBOARD_RATE_WINDOW_SECONDS,
} from './dashboard-metrics'

function writeWorkload(qps = 10) {
  const simulation = createTiDBSimulation({ seed: 425 })
  simulation.setControl('qps', qps)
  simulation.setControl('writeRatio', 1)
  return simulation
}

describe('read-only City dashboard model projection', () => {
  it('starts with unknown rates and the current model gauges, without a fabricated history', () => {
    const simulation = createTiDBSimulation()
    const dashboard = createDashboardMetrics()
    const initial = dashboard.sample(simulation.state)

    expect(initial).toMatchObject({
      modelTimeSeconds: 0,
      status: 'warming',
      statementsPerSecond: null,
      commitsPerSecond: null,
      raftEntriesPerSecond: null,
      healthyRegions: 36,
      totalRegions: 36,
      gcBacklog: 0,
      tiflashLagSeconds: 0,
      tiflashAvailable: true,
      rateWindowSeconds: DASHBOARD_RATE_WINDOW_SECONDS,
      observedWindowSeconds: 0,
    })
    expect(initial.history).toHaveLength(1)
    expect(initial.history[0].modelTimeSeconds).toBe(0)
  })

  it('derives three distinct background rates from actual counter deltas and model time', () => {
    const simulation = writeWorkload(120)
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    simulation.update(1)
    const result = dashboard.sample(simulation.state)

    expect(simulation.state.metrics).toMatchObject({
      statements: 120, commits: 120, raftEntries: 120,
    })
    expect(result).toMatchObject({
      status: 'running',
      statementsPerSecond: 120,
      commitsPerSecond: 120,
      raftEntriesPerSecond: 120,
      observedWindowSeconds: 1,
    })
  })

  it('does not equate read statements with committed writes or Raft entries', () => {
    const simulation = createTiDBSimulation()
    simulation.setControl('qps', 24)
    simulation.setControl('writeRatio', 0)
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    simulation.update(1)

    expect(dashboard.sample(simulation.state)).toMatchObject({
      statementsPerSecond: 24,
      commitsPerSecond: 0,
      raftEntriesPerSecond: 0,
    })
  })

  it('rolls the rates over five observed model seconds rather than the lifetime', () => {
    const simulation = writeWorkload(10)
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    for (let second = 0; second < 5; second++) {
      simulation.update(1)
      dashboard.sample(simulation.state)
    }
    simulation.setControl('qps', 100)
    for (let second = 0; second < 5; second++) {
      simulation.update(1)
      dashboard.sample(simulation.state)
    }

    expect(simulation.state.metrics.statements / simulation.state.t).toBe(55)
    expect(dashboard.sample(simulation.state)).toMatchObject({
      statementsPerSecond: 100,
      commitsPerSecond: 100,
      raftEntriesPerSecond: 100,
      observedWindowSeconds: 5,
    })
  })

  it('excludes synchronous SQL trace counter jumps while retaining observed background history', () => {
    const simulation = writeWorkload()
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    simulation.update(1)
    const before = dashboard.sample(simulation.state)
    const originalStatements = simulation.state.metrics.statements
    const submission = simulation.submitSql('UPDATE accounts SET balance = balance + 1 WHERE id = 7')
    expect(submission.receipt).not.toBeNull()
    expect(simulation.state.t).toBe(1)
    expect(simulation.state.metrics.statements).toBeGreaterThan(originalStatements)
    const afterTrace = dashboard.sample(simulation.state)

    expect(afterTrace.statementsPerSecond).toBe(before.statementsPerSecond)
    expect(afterTrace.commitsPerSecond).toBe(before.commitsPerSecond)
    expect(afterTrace.raftEntriesPerSecond).toBe(before.raftEntriesPerSecond)
    expect(afterTrace.history).toEqual(before.history)

    simulation.update(1)
    expect(dashboard.sample(simulation.state)).toMatchObject({
      statementsPerSecond: 10,
      commitsPerSecond: 10,
      raftEntriesPerSecond: 10,
      observedWindowSeconds: 2,
    })
  })

  it('freezes the model-time history while paused, while current gauges remain truthful', () => {
    const simulation = writeWorkload()
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    simulation.update(1)
    const running = dashboard.sample(simulation.state)
    simulation.setControl('paused', true)
    simulation.state.gc.backlog = 7
    simulation.state.tiflash.available = false
    simulation.state.regions[0].health = 'unavailable'
    simulation.update(100)
    const paused = dashboard.sample(simulation.state)

    expect(paused).toMatchObject({
      status: 'paused',
      modelTimeSeconds: 1,
      statementsPerSecond: 10,
      observedWindowSeconds: 1,
      healthyRegions: 35,
      gcBacklog: 7,
      tiflashLagSeconds: null,
      tiflashAvailable: false,
    })
    expect(paused.history).toEqual(running.history)
    expect(paused.history[1].gcBacklog).toBe(running.gcBacklog)
    expect(paused.history[1].gcBacklog).not.toBe(paused.gcBacklog)
  })

  it('uses the exact current TiFlash lag and only fully healthy Region statuses', () => {
    const simulation = createTiDBSimulation()
    simulation.state.tiflash.lagSeconds = 2.75
    simulation.state.regions[0].health = 'degraded'
    simulation.state.regions[1].health = 'unavailable'

    expect(createDashboardMetrics().sample(simulation.state)).toMatchObject({
      healthyRegions: 34,
      totalRegions: 36,
      tiflashLagSeconds: 2.75,
      tiflashAvailable: true,
    })
  })

  it('stores only the first actual observation in each model-second bucket and leaves gaps', () => {
    const simulation = writeWorkload()
    const dashboard = createDashboardMetrics()
    const initial = dashboard.sample(simulation.state)
    simulation.update(0.25)
    const fraction = dashboard.sample(simulation.state)
    expect(fraction.statementsPerSecond)
      .toBe(simulation.state.metrics.statements / simulation.state.t)
    expect(fraction.history).toEqual(initial.history)
    simulation.update(0.8)
    const next = dashboard.sample(simulation.state)
    const nextTime = simulation.state.t
    expect(next.history.map((point) => point.modelTimeSeconds)).toEqual([0, nextTime])
    simulation.update(6)
    const gap = dashboard.sample(simulation.state)

    expect(gap.history.map((point) => point.modelTimeSeconds))
      .toEqual([0, nextTime, simulation.state.t])
    expect(gap).toMatchObject({
      status: 'warming',
      statementsPerSecond: null,
      observedWindowSeconds: 0,
    })
    simulation.update(1)
    expect(dashboard.sample(simulation.state).statementsPerSecond).toBe(10)
  })

  it('bounds retained observations by sixty model seconds and never backfills old samples', () => {
    const simulation = writeWorkload()
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    for (let second = 0; second < 80; second++) {
      simulation.update(1)
      dashboard.sample(simulation.state)
    }
    const full = dashboard.sample(simulation.state)
    expect(full.history).toHaveLength(DASHBOARD_HISTORY_SECONDS)
    expect(full.history[0].modelTimeSeconds).toBe(21)
    expect(full.history.at(-1)?.modelTimeSeconds).toBe(80)
    simulation.update(100)
    const afterGap = dashboard.sample(simulation.state)
    expect(afterGap.history).toHaveLength(1)
    expect(afterGap.history[0].modelTimeSeconds).toBe(180)
  })

  it('explicitly resets same-value isolated scenarios and excludes their complete fixture counters', () => {
    const simulation = createTiDBSimulation()
    simulation.runScenario('cross-region-transaction')
    const dashboard = createDashboardMetrics()
    const first = dashboard.sample(simulation.state)
    expect(first.statementsPerSecond).toBeNull()
    expect(simulation.state.metrics.statements).toBeGreaterThan(0)
    simulation.setControl('qps', 10)
    simulation.setControl('writeRatio', 1)
    simulation.update(1)
    expect(dashboard.sample(simulation.state).statementsPerSecond).toBe(10)

    dashboard.reset()
    simulation.runScenario('cross-region-transaction')
    expect(dashboard.sample(simulation.state)).toEqual(first)
  })

  it('detects clock, tick, and cumulative counter rollback without relying on state identity', () => {
    const simulation = writeWorkload()
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    simulation.update(2)
    dashboard.sample(simulation.state)
    const stateIdentity = simulation.state
    simulation.reset()
    expect(simulation.state).toBe(stateIdentity)
    expect(dashboard.sample(simulation.state)).toMatchObject({
      status: 'warming',
      statementsPerSecond: null,
      history: [{ modelTimeSeconds: 0 }],
    })

    simulation.update(1)
    dashboard.sample(simulation.state)
    simulation.state.metrics.commits = 0
    const counters = dashboard.sample(simulation.state)
    expect(counters.statementsPerSecond).toBeNull()
    expect(counters.history).toHaveLength(1)
    simulation.update(1)
    dashboard.sample(simulation.state)
    simulation.state.tick = 0
    expect(dashboard.sample(simulation.state).statementsPerSecond).toBeNull()
  })

  it('resets when the model version or seed changes', () => {
    const simulation = writeWorkload()
    const dashboard = createDashboardMetrics()
    dashboard.sample(simulation.state)
    simulation.update(1)
    dashboard.sample(simulation.state)
    simulation.state.seed++
    expect(dashboard.sample(simulation.state).status).toBe('warming')
    simulation.update(1)
    dashboard.sample(simulation.state)
    simulation.state.modelVersion = 'other-educational-model'
    expect(dashboard.sample(simulation.state).status).toBe('warming')
  })

  it('projects identical deterministic model work from fixed and chunked updates', () => {
    const chunked = writeWorkload(73)
    const fixed = writeWorkload(73)
    const chunkedDashboard = createDashboardMetrics()
    const fixedDashboard = createDashboardMetrics()
    chunkedDashboard.sample(chunked.state)
    fixedDashboard.sample(fixed.state)
    for (let second = 0; second < 8; second++) {
      chunked.update(1)
      for (let tick = 0; tick < 60; tick++) fixed.update(1 / 60)
      expect(chunkedDashboard.sample(chunked.state)).toEqual(fixedDashboard.sample(fixed.state))
    }
  })

  it('never mutates the model and returns immutable snapshots independent of future samples', () => {
    const simulation = writeWorkload()
    const dashboard = createDashboardMetrics()
    const before = JSON.stringify(simulation.state)
    const initial = dashboard.sample(simulation.state)
    expect(JSON.stringify(simulation.state)).toBe(before)
    expect(Object.isFrozen(initial)).toBe(true)
    expect(Object.isFrozen(initial.history)).toBe(true)
    expect(Object.isFrozen(initial.history[0])).toBe(true)
    expect(() => Object.assign(initial.history[0], { gcBacklog: 999 })).toThrow(TypeError)
    simulation.update(1)
    const afterUpdate = JSON.stringify(simulation.state)
    dashboard.sample(simulation.state)
    expect(JSON.stringify(simulation.state)).toBe(afterUpdate)
    expect(initial.modelTimeSeconds).toBe(0)
    expect(initial.history).toHaveLength(1)
    expect(initial.history[0].statementsPerSecond).toBeNull()
  })
})
