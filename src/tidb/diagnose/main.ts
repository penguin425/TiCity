// SPDX-License-Identifier: Apache-2.0

import '../app.css'

import { createTiDBSimulation, TIDB_SCENARIOS } from '../model'
import type {
  ScenarioId,
  TiCityState,
  TraceStateSnapshot,
} from '../model/types'
import { createNavigation, createWordmark, prepareDocument } from '../page-shell'
import { resolveLocale } from '../ui/catalog'
import { resolveDiagnoseCursor } from './cursor'
import { mountDiagnose } from './index'
import {
  DIAGNOSE_PAGE_COPY,
  diagnoseCursorNote,
  diagnoseEventOptionLabel,
} from './page-copy'

const SCENARIOS: readonly ScenarioId[] = TIDB_SCENARIOS.map(({ id }) => id)

function selectedScenario(): ScenarioId {
  const value = new URLSearchParams(location.search).get('scenario')
  return SCENARIOS.includes(value as ScenarioId)
    ? value as ScenarioId
    : 'hotspot-split'
}

function projectionAtEvent(
  finalState: TiCityState,
  snapshot: TraceStateSnapshot | null,
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
    ...(snapshot.lockLab === undefined ? {} : { lockLab: snapshot.lockLab }),
    ...(snapshot.raftLab === undefined ? {} : { raftLab: snapshot.raftLab }),
    ...(snapshot.protocolLab === undefined
      ? {}
      : { protocolLab: snapshot.protocolLab }),
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
  const copy = DIAGNOSE_PAGE_COPY[locale]
  prepareDocument(locale)
  const simulation = createTiDBSimulation({ seed: 425 })
  const scenarioStartState = simulation.state
  const scenario = selectedScenario()
  const receipt = simulation.runScenario(scenario)
  const requestedEventId = new URLSearchParams(location.search).get('event')
  const cursor = resolveDiagnoseCursor(receipt.events, requestedEventId)

  root.className = 'tidb-page'
  const top = document.createElement('div')
  top.className = 'tidb-page-nav'
  const navigation = createNavigation('diagnose', locale)
  top.append(createWordmark(locale), navigation.root)

  const controls = document.createElement('div')
  controls.className = 'tidb-page-controls tidb-diagnose-controls'
  const label = document.createElement('label')
  label.textContent = copy.scenario
  const select = document.createElement('select')
  select.setAttribute('aria-label', copy.scenario)
  for (const id of SCENARIOS) {
    const option = document.createElement('option')
    option.value = id
    option.textContent = copy.names[id]
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
  eventLabel.textContent = copy.event
  const eventSelect = document.createElement('select')
  eventSelect.setAttribute('aria-label', copy.event)
  const finalOption = document.createElement('option')
  finalOption.value = ''
  finalOption.textContent = copy.finalState
  finalOption.selected = cursor.event === null
  eventSelect.append(finalOption)
  for (const [index, event] of receipt.events.entries()) {
    const option = document.createElement('option')
    const optionCursor = resolveDiagnoseCursor(receipt.events, event.id)
    option.value = event.id
    option.textContent = diagnoseEventOptionLabel(locale, event, index, optionCursor)
    option.selected = event.id === cursor.event?.id
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
  const cursorNote = document.createElement('p')
  cursorNote.className = 'tidb-diagnose-cursor-note'
  cursorNote.dataset.cursorResolution = cursor.resolution
  cursorNote.textContent = diagnoseCursorNote(locale, cursor)
  controls.append(cursorNote)

  const content = document.createElement('section')
  content.className = 'tidb-page-content'
  mountDiagnose(content, {
    locale,
    snapshot: projectionAtEvent(
      cursor.resolution === 'scenario-start'
        ? scenarioStartState
        : simulation.state,
      cursor.snapshot,
    ),
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
