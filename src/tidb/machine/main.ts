// SPDX-License-Identifier: Apache-2.0

import '../app.css'

import { createTiDBSimulation } from '../model'
import type { ScenarioId } from '../model/types'
import { createNavigation, createWordmark, prepareDocument } from '../page-shell'
import { resolveLocale } from '../ui/catalog'
import { mountMachine } from './index'

const SCENARIOS: readonly ScenarioId[] = [
  'point-read',
  'cross-region-transaction',
  'optimistic-conflict',
  'commit-protocols',
  'hotspot-split',
  'tikv-failover',
  'gc-safe-point',
  'tiflash-mpp',
]

const labels = {
  ja: {
    scenario: '再生するシナリオ',
    names: [
      'Point Readとルーティング',
      '複数Regionの悲観トランザクション',
      '楽観トランザクションの競合',
      '1PC／Async Commit／2PC',
      'hotspot、split、rebalance',
      'TiKV障害とleader election',
      '長時間transactionとGC safe point',
      'TiFlash catch-upとMPP',
    ],
  },
  en: {
    scenario: 'Scenario to replay',
    names: [
      'Point read and routing',
      'Cross-Region pessimistic transaction',
      'Optimistic transaction conflict',
      '1PC / Async Commit / 2PC',
      'Hotspot, split, and rebalance',
      'TiKV failure and leader election',
      'Long transaction and GC safe point',
      'TiFlash catch-up and MPP',
    ],
  },
} as const

function selectedScenario(): ScenarioId {
  const value = new URLSearchParams(location.search).get('scenario')
  return SCENARIOS.includes(value as ScenarioId)
    ? value as ScenarioId
    : 'cross-region-transaction'
}

function boot(): void {
  const root = document.querySelector<HTMLElement>('#machine-app')
  if (!root) throw new Error('Missing #machine-app')

  const locale = resolveLocale()
  prepareDocument(locale)
  const simulation = createTiDBSimulation({ seed: 425 })
  const scenario = selectedScenario()
  const receipt = simulation.runScenario(scenario)

  root.className = 'tidb-page'
  const top = document.createElement('div')
  top.className = 'tidb-page-nav'
  const navigation = createNavigation('machine', locale)
  top.append(createWordmark(locale), navigation.root)

  const controls = document.createElement('div')
  controls.className = 'tidb-page-controls'
  const label = document.createElement('label')
  label.textContent = labels[locale].scenario
  const select = document.createElement('select')
  select.setAttribute('aria-label', labels[locale].scenario)
  for (const [index, id] of SCENARIOS.entries()) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = labels[locale].names[index]
    option.selected = id === scenario
    select.append(option)
  }
  select.addEventListener('change', () => {
    const url = new URL(location.href)
    url.searchParams.set('scenario', select.value)
    url.searchParams.set('lang', locale)
    location.assign(url)
  })
  label.append(select)
  controls.append(label)

  const content = document.createElement('section')
  content.className = 'tidb-page-content'
  mountMachine(content, {
    locale,
    receipt,
    initialIndex: 0,
    stepIntervalMs: 650,
  })

  root.replaceChildren(top, controls, content)
  document.body.dataset.ready = 'true'
}

try {
  boot()
} catch (error) {
  console.error(error)
  document.body.dataset.ready = 'error'
  const root = document.querySelector<HTMLElement>('#machine-app')
  if (root) {
    root.textContent = 'TiDB Machine could not start. See the browser console for details.'
  }
}
