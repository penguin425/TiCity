/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import type { TiCityState } from '../model/types'

export const DASHBOARD_RATE_WINDOW_SECONDS = 5
export const DASHBOARD_HISTORY_SECONDS = 60

export type DashboardStatus = 'warming' | 'running' | 'paused'

/** Read-only values from the educational model, never cluster measurements. */
export interface DashboardSample {
  readonly modelTimeSeconds: number
  readonly statementsPerSecond: number | null
  readonly commitsPerSecond: number | null
  readonly raftEntriesPerSecond: number | null
  readonly healthyRegions: number
  readonly totalRegions: number
  readonly gcBacklog: number
  readonly tiflashLagSeconds: number | null
  readonly tiflashAvailable: boolean
}

export interface DashboardSnapshot extends DashboardSample {
  readonly status: DashboardStatus
  /** Maximum model-time span used for the rolling counters. */
  readonly rateWindowSeconds: number
  /** Actual observed span; shorter while warming up or after a sampling gap. */
  readonly observedWindowSeconds: number
  readonly history: readonly DashboardSample[]
}

export interface DashboardMetrics {
  sample(state: Readonly<TiCityState>): DashboardSnapshot
  /** Call when an isolated scenario or explicit model reset is selected. */
  reset(): void
}

interface Counters {
  statements: number
  commits: number
  raftEntries: number
}

interface Observation extends Counters {
  t: number
  tick: number
  seed: number
  modelVersion: string
}

interface RateAnchor extends Counters {
  t: number
}

const TIME_EPSILON = 1e-9

function modelSecond(time: number): number {
  // The fixed-step clock can land microscopically below an integer boundary.
  return Math.floor(time + TIME_EPSILON)
}

function readObservation(state: Readonly<TiCityState>): Observation {
  return {
    t: state.t,
    tick: state.tick,
    seed: state.seed,
    modelVersion: state.modelVersion,
    statements: state.metrics.statements,
    commits: state.metrics.commits,
    raftEntries: state.metrics.raftEntries,
  }
}

function hasRollback(previous: Observation, current: Observation): boolean {
  return current.t + TIME_EPSILON < previous.t ||
    current.tick < previous.tick ||
    current.seed !== previous.seed ||
    current.modelVersion !== previous.modelVersion ||
    current.statements < previous.statements ||
    current.commits < previous.commits ||
    current.raftEntries < previous.raftEntries
}

/**
 * Project only observed model work. A SQL/trace request mutates cumulative
 * counters synchronously without advancing state.t; sampling immediately
 * before and after that request rebases the raw counters without inventing
 * live throughput. Scenario replay and animation timing are not inputs.
 *
 * No missing seconds are interpolated. Rates use actual observations within
 * the last five model seconds, and chart points record at most one observed
 * value per integer model-second bucket. The history and rate anchors are
 * bounded independently of wall-clock frame frequency.
 */
export function createDashboardMetrics(): DashboardMetrics {
  let previous: Observation | null = null
  let observed: Counters = { statements: 0, commits: 0, raftEntries: 0 }
  let anchors: RateAnchor[] = []
  let history: DashboardSample[] = []

  function reset(): void {
    previous = null
    observed = { statements: 0, commits: 0, raftEntries: 0 }
    anchors = []
    history = []
  }

  function sample(state: Readonly<TiCityState>): DashboardSnapshot {
    const current = readObservation(state)
    if (previous && hasRollback(previous, current)) reset()

    const timeAdvanced = previous !== null &&
      current.t > previous.t + TIME_EPSILON
    if (timeAdvanced && previous) {
      observed.statements += current.statements - previous.statements
      observed.commits += current.commits - previous.commits
      observed.raftEntries += current.raftEntries - previous.raftEntries
    }

    // At identical model time, only the raw baseline changes. The observed
    // workload totals and their earlier history remain untouched.
    previous = current

    anchors = anchors.filter((anchor) =>
      anchor.t + TIME_EPSILON >= current.t - DASHBOARD_RATE_WINDOW_SECONDS)
    const bucket = modelSecond(current.t)
    if (anchors.length === 0 ||
        modelSecond(anchors[anchors.length - 1].t) !== bucket) {
      anchors.push({ t: current.t, ...observed })
    }
    const anchor = anchors[0]
    const elapsed = Math.max(0, current.t - anchor.t)
    const hasWindow = elapsed > TIME_EPSILON
    const point: DashboardSample = Object.freeze({
      modelTimeSeconds: current.t,
      statementsPerSecond: hasWindow
        ? (observed.statements - anchor.statements) / elapsed
        : null,
      commitsPerSecond: hasWindow
        ? (observed.commits - anchor.commits) / elapsed
        : null,
      raftEntriesPerSecond: hasWindow
        ? (observed.raftEntries - anchor.raftEntries) / elapsed
        : null,
      healthyRegions: state.regions.filter((region) => region.health === 'healthy').length,
      totalRegions: state.regions.length,
      gcBacklog: state.gc.backlog,
      tiflashLagSeconds: state.tiflash.available ? state.tiflash.lagSeconds : null,
      tiflashAvailable: state.tiflash.available,
    })

    history = history.filter((entry) =>
      modelSecond(entry.modelTimeSeconds) > bucket - DASHBOARD_HISTORY_SECONDS)
    if (history.length === 0 ||
        modelSecond(history[history.length - 1].modelTimeSeconds) !== bucket) {
      history.push(point)
    }

    return Object.freeze({
      ...point,
      status: state.controls.paused ? 'paused' : hasWindow ? 'running' : 'warming',
      rateWindowSeconds: DASHBOARD_RATE_WINDOW_SECONDS,
      observedWindowSeconds: elapsed,
      history: Object.freeze([...history]),
    })
  }

  return { sample, reset }
}
