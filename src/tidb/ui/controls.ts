// SPDX-License-Identifier: Apache-2.0

import type {
  PlaybackMode,
  ScenarioId,
  TiDBControls,
} from '../model/types'
import type { Locale } from './catalog'
import { element } from './dom'
import { createModelBadge } from './legal'

export const SCENARIOS: readonly ScenarioId[] = [
  'point-read',
  'cross-region-transaction',
  'optimistic-conflict',
  'lock-deadlock',
  'commit-protocols',
  'hotspot-split',
  'tikv-failover',
  'gc-safe-point',
  'tiflash-mpp',
] as const

interface ControlCopy {
  title: string
  scenarios: string
  controls: string
  qps: string
  writeRatio: string
  keyDistribution: string
  transactionMode: string
  commitProtocol: string
  readPolicy: string
  regionSplitThresholdMiB: string
  gcLifetimeSeconds: string
  networkLatencyMs: string
  tiflashLagSeconds: string
  playbackSpeed: string
  paused: string
  playback: string
  running: string
  pointRead: string
  crossRegionTransaction: string
  optimisticConflict: string
  lockDeadlock: string
  commitProtocols: string
  hotspotSplit: string
  tikvFailover: string
  gcSafePoint: string
  tiflashMpp: string
}

export const CONTROL_COPY: Record<Locale, ControlCopy> = {
  ja: {
    title: 'シミュレーション操作',
    scenarios: 'ガイドシナリオ',
    controls: '負荷と分散設定',
    qps: 'QPS',
    writeRatio: 'write比率',
    keyDistribution: 'key分布',
    transactionMode: 'transaction mode',
    commitProtocol: 'commit protocol',
    readPolicy: 'read policy',
    regionSplitThresholdMiB: 'Region split閾値',
    gcLifetimeSeconds: 'GC lifetime',
    networkLatencyMs: 'network latency',
    tiflashLagSeconds: 'TiFlash lag',
    playbackSpeed: '再生速度',
    paused: '一時停止',
    playback: '再生モード',
    running: '選択中',
    pointRead: 'Point read',
    crossRegionTransaction: 'Cross-Region transaction',
    optimisticConflict: 'Optimistic conflict',
    lockDeadlock: 'Lock wait / deadlock',
    commitProtocols: '1PC / Async / 2PC',
    hotspotSplit: 'Hotspot → split',
    tikvFailover: 'TiKV failover',
    gcSafePoint: 'GC safe point',
    tiflashMpp: 'TiFlash MPP',
  },
  en: {
    title: 'Simulation controls',
    scenarios: 'Guided scenarios',
    controls: 'Workload and distribution',
    qps: 'QPS',
    writeRatio: 'Write ratio',
    keyDistribution: 'Key distribution',
    transactionMode: 'Transaction mode',
    commitProtocol: 'Commit protocol',
    readPolicy: 'Read policy',
    regionSplitThresholdMiB: 'Region split threshold',
    gcLifetimeSeconds: 'GC lifetime',
    networkLatencyMs: 'Network latency',
    tiflashLagSeconds: 'TiFlash lag',
    playbackSpeed: 'Playback speed',
    paused: 'Paused',
    playback: 'Playback mode',
    running: 'Selected',
    pointRead: 'Point read',
    crossRegionTransaction: 'Cross-Region transaction',
    optimisticConflict: 'Optimistic conflict',
    lockDeadlock: 'Lock wait / deadlock',
    commitProtocols: '1PC / Async / 2PC',
    hotspotSplit: 'Hotspot → split',
    tikvFailover: 'TiKV failover',
    gcSafePoint: 'GC safe point',
    tiflashMpp: 'TiFlash MPP',
  },
}

const SCENARIO_COPY_KEYS: Record<ScenarioId, keyof ControlCopy> = {
  'point-read': 'pointRead',
  'cross-region-transaction': 'crossRegionTransaction',
  'optimistic-conflict': 'optimisticConflict',
  'lock-deadlock': 'lockDeadlock',
  'commit-protocols': 'commitProtocols',
  'hotspot-split': 'hotspotSplit',
  'tikv-failover': 'tikvFailover',
  'gc-safe-point': 'gcSafePoint',
  'tiflash-mpp': 'tiflashMpp',
}

export const DEFAULT_CITY_CONTROLS: TiDBControls = {
  qps: 500,
  writeRatio: 0.25,
  keyDistribution: 'uniform',
  transactionMode: 'pessimistic',
  commitProtocol: 'auto',
  readPolicy: 'leader',
  regionSplitThresholdMiB: 96,
  gcLifetimeSeconds: 600,
  networkLatencyMs: 10,
  tiflashLagSeconds: 2,
  playbackSpeed: 1,
  paused: false,
}

export interface CityControlBridge {
  controls?: Partial<TiDBControls>
  playback?: PlaybackMode
  runScenario?: (id: ScenarioId) => unknown
  setControl?: (key: keyof TiDBControls, value: TiDBControls[keyof TiDBControls]) => void
  setPlayback?: (mode: PlaybackMode) => void
  onReceipt?: (receipt: unknown) => void
}

interface NumberSpec {
  key:
    | 'qps'
    | 'writeRatio'
    | 'regionSplitThresholdMiB'
    | 'gcLifetimeSeconds'
    | 'networkLatencyMs'
    | 'tiflashLagSeconds'
    | 'playbackSpeed'
  min: number
  max: number
  step: number
  format(value: number): string
}

const NUMBER_SPECS: readonly NumberSpec[] = [
  { key: 'qps', min: 0, max: 2000, step: 50, format: (v) => `${v}` },
  { key: 'writeRatio', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'regionSplitThresholdMiB', min: 32, max: 256, step: 8, format: (v) => `${v} MiB` },
  { key: 'gcLifetimeSeconds', min: 600, max: 86_400, step: 600, format: (v) => `${v} s` },
  { key: 'networkLatencyMs', min: 0, max: 500, step: 5, format: (v) => `${v} ms` },
  { key: 'tiflashLagSeconds', min: 0, max: 30, step: 0.5, format: (v) => `${v} s` },
  { key: 'playbackSpeed', min: 0.25, max: 4, step: 0.25, format: (v) => `${v}×` },
]

type ChoiceKey = 'keyDistribution' | 'transactionMode' | 'commitProtocol' | 'readPolicy'

const CHOICE_SPECS: readonly {
  key: ChoiceKey
  choices: readonly string[]
}[] = [
  { key: 'keyDistribution', choices: ['uniform', 'sequential'] },
  { key: 'transactionMode', choices: ['pessimistic', 'optimistic'] },
  { key: 'commitProtocol', choices: ['auto', '1pc', 'async_commit', '2pc'] },
  { key: 'readPolicy', choices: ['leader', 'follower'] },
]

export function createControlPanel(
  locale: Locale,
  bridge: CityControlBridge = {},
): HTMLElement {
  const copy = CONTROL_COPY[locale]
  const values: TiDBControls = { ...DEFAULT_CITY_CONTROLS, ...bridge.controls }
  let activeScenario: ScenarioId | null = null
  const scenarioStatus = element('p', { className: 'tidb-control-status', attrs: { 'aria-live': 'polite' } })
  const scenarioGrid = element('div', { className: 'tidb-scenario-grid' })

  for (const id of SCENARIOS) {
    const button = element('button', {
      className: 'tidb-scenario',
      text: copy[SCENARIO_COPY_KEYS[id]],
      attrs: {
        type: 'button',
        'data-scenario': id,
        'aria-pressed': 'false',
      },
    })
    button.addEventListener('click', () => {
      activeScenario = id
      for (const candidate of scenarioGrid.querySelectorAll<HTMLElement>('[data-scenario]')) {
        candidate.setAttribute('aria-pressed', String(candidate.dataset.scenario === id))
      }
      scenarioStatus.textContent = `${copy.running}: ${copy[SCENARIO_COPY_KEYS[id]]}`
      const receipt = bridge.runScenario?.(id)
      if (receipt !== undefined) bridge.onReceipt?.(receipt)
    })
    scenarioGrid.append(button)
  }

  const controls = element('div', { className: 'tidb-control-grid' })
  for (const spec of NUMBER_SPECS) {
    const output = element('output', { text: spec.format(values[spec.key]) })
    const input = element('input', {
      className: 'tidb-control-input',
      attrs: {
        type: 'range',
        min: String(spec.min),
        max: String(spec.max),
        step: String(spec.step),
        value: String(values[spec.key]),
        'data-control': spec.key,
        'aria-label': copy[spec.key],
      },
    })
    input.value = String(values[spec.key])
    input.addEventListener('input', () => {
      const next = Number(input.value)
      values[spec.key] = next
      output.textContent = spec.format(next)
      bridge.setControl?.(spec.key, next)
    })
    controls.append(
      element('label', { className: 'tidb-control' },
        element('span', { text: copy[spec.key] }),
        input,
        output,
      ),
    )
  }

  for (const spec of CHOICE_SPECS) {
    const select = element('select', {
      className: 'tidb-control-select',
      attrs: { 'data-control': spec.key, 'aria-label': copy[spec.key] },
    })
    for (const choice of spec.choices) {
      select.append(element('option', { text: choice, attrs: { value: choice } }))
    }
    select.value = String(values[spec.key])
    select.addEventListener('change', () => {
      const next = select.value as TiDBControls[typeof spec.key]
      ;(values as unknown as Record<ChoiceKey, string>)[spec.key] = next
      bridge.setControl?.(spec.key, next)
    })
    controls.append(
      element('label', { className: 'tidb-control' },
        element('span', { text: copy[spec.key] }),
        select,
      ),
    )
  }

  const paused = element('button', {
    className: 'tidb-button tidb-control-toggle',
    text: copy.paused,
    attrs: {
      type: 'button',
      'data-control': 'paused',
      'aria-pressed': String(values.paused),
    },
  })
  paused.addEventListener('click', () => {
    values.paused = !values.paused
    paused.setAttribute('aria-pressed', String(values.paused))
    bridge.setControl?.('paused', values.paused)
  })
  controls.append(element('div', { className: 'tidb-control' }, paused))

  const playback = element('select', {
    className: 'tidb-control-select',
    attrs: { 'data-control': 'playback', 'aria-label': copy.playback },
  })
  for (const mode of ['step', 'slow', 'live'] as const) {
    playback.append(element('option', { text: mode, attrs: { value: mode } }))
  }
  playback.value = bridge.playback ?? 'slow'
  playback.addEventListener('change', () => {
    bridge.setPlayback?.(playback.value as PlaybackMode)
  })
  controls.append(
    element('label', { className: 'tidb-control' },
      element('span', { text: copy.playback }),
      playback,
    ),
  )

  const panel = element(
    'section',
    { className: 'tidb-card tidb-controls', attrs: { 'aria-labelledby': 'tidb-controls-title' } },
    element('div', { className: 'tidb-section-heading' },
      element('h2', { text: copy.title, attrs: { id: 'tidb-controls-title' } }),
      createModelBadge(locale),
    ),
    element('h3', { text: copy.scenarios }),
    scenarioGrid,
    scenarioStatus,
    element('h3', { text: copy.controls }),
    controls,
  )
  panel.dataset.activeScenario = activeScenario ?? ''
  return panel
}
