// SPDX-License-Identifier: Apache-2.0

import '../app.css'

import { createTiDBSimulation } from '../model'
import type {
  ScenarioId,
  TiCityState,
  TraceEvent,
  TraceStateSnapshot,
} from '../model/types'
import { createNavigation, createWordmark, prepareDocument } from '../page-shell'
import { resolveLocale } from '../ui/catalog'
import { mountDiagnose } from './index'

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
    scenario: '投影するシナリオ後の状態',
    event: '投影するイベント時点',
    finalState: '最終状態',
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
    scenario: 'State after scenario',
    event: 'State at event',
    finalState: 'Final state',
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
    : 'hotspot-split'
}

function selectedTraceEvent(events: readonly TraceEvent[]): TraceEvent | null {
  const requested = new URLSearchParams(location.search).get('event')
  if (requested === null) return null
  return events.find((event) => event.id === requested) ?? null
}

function projectionAtEvent(
  finalState: TiCityState,
  snapshot: TraceStateSnapshot | undefined,
): unknown {
  if (!snapshot) return finalState
  const detailedRegions = new Map(
    snapshot.regions.map((region) => [region.regionId, region]),
  )
  return {
    ...finalState,
    tso: {
      ...finalState.tso,
      lastAllocated: snapshot.tsoLastAllocated,
    },
    transactions: snapshot.transaction === null
      ? []
      : [{
          ...snapshot.transaction,
          phase: snapshot.transaction.stage,
          conflict: false,
        }],
    regions: finalState.regions.map((region) => {
      const detail = detailedRegions.get(region.id)
      if (!detail) return region
      return {
        ...region,
        ...detail,
        peers: detail.peers,
      }
    }),
  }
}

function boot(): void {
  const root = document.querySelector<HTMLElement>('#diagnose-app')
  if (!root) throw new Error('Missing #diagnose-app')

  const locale = resolveLocale()
  prepareDocument(locale)
  const simulation = createTiDBSimulation({ seed: 425 })
  const scenario = selectedScenario()
  const receipt = simulation.runScenario(scenario)
  const selectedEvent = selectedTraceEvent(receipt.events)

  root.className = 'tidb-page'
  const top = document.createElement('div')
  top.className = 'tidb-page-nav'
  const navigation = createNavigation('diagnose', locale)
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
    url.searchParams.delete('event')
    location.assign(url)
  })
  label.append(select)
  controls.append(label)

  const eventLabel = document.createElement('label')
  eventLabel.textContent = labels[locale].event
  const eventSelect = document.createElement('select')
  eventSelect.setAttribute('aria-label', labels[locale].event)
  const finalOption = document.createElement('option')
  finalOption.value = ''
  finalOption.textContent = labels[locale].finalState
  finalOption.selected = selectedEvent === null
  eventSelect.append(finalOption)
  for (const [index, event] of receipt.events.entries()) {
    if (!event.snapshot) continue
    const option = document.createElement('option')
    option.value = event.id
    option.textContent = `${index + 1}. ${event.label}`
    option.selected = event.id === selectedEvent?.id
    eventSelect.append(option)
  }
  eventSelect.addEventListener('change', () => {
    const url = new URL(location.href)
    if (eventSelect.value) url.searchParams.set('event', eventSelect.value)
    else url.searchParams.delete('event')
    url.searchParams.set('scenario', scenario)
    url.searchParams.set('lang', locale)
    location.assign(url)
  })
  eventLabel.append(eventSelect)
  controls.append(eventLabel)

  const content = document.createElement('section')
  content.className = 'tidb-page-content'
  mountDiagnose(content, {
    locale,
    snapshot: projectionAtEvent(simulation.state, selectedEvent?.snapshot),
  })

  root.replaceChildren(top, controls, content)
  document.body.dataset.ready = 'true'
}

try {
  boot()
} catch (error) {
  console.error(error)
  document.body.dataset.ready = 'error'
  const root = document.querySelector<HTMLElement>('#diagnose-app')
  if (root) {
    root.textContent = 'TiCity Diagnose could not start. See the browser console for details.'
  }
}
