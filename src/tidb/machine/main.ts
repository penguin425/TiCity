// SPDX-License-Identifier: Apache-2.0

import '../app.css'

import { createTiDBSimulation } from '../model'
import { createNavigation, createWordmark, prepareDocument } from '../page-shell'
import { resolveLocale } from '../ui/catalog'
import {
  MACHINE_PAGE_COPY,
  MACHINE_SCENARIOS,
  resolveMachineScenario,
} from './catalog'
import { mountMachine } from './index'

function boot(): void {
  const root = document.querySelector<HTMLElement>('#machine-app')
  if (!root) throw new Error('Missing #machine-app')

  const locale = resolveLocale()
  prepareDocument(locale)
  const simulation = createTiDBSimulation({ seed: 425 })
  const scenario = resolveMachineScenario(location.search)
  const receipt = simulation.runScenario(scenario)
  const requestedEvent = new URLSearchParams(location.search).get('event')
  const copy = MACHINE_PAGE_COPY[locale]

  root.className = 'tidb-page'
  const top = document.createElement('div')
  top.className = 'tidb-page-nav'
  const navigation = createNavigation('machine', locale)
  top.append(createWordmark(locale), navigation.root)

  const controls = document.createElement('div')
  controls.className = 'tidb-page-controls'
  const label = document.createElement('label')
  label.textContent = copy.scenario
  const select = document.createElement('select')
  select.setAttribute('aria-label', copy.scenario)
  for (const id of MACHINE_SCENARIOS) {
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

  const content = document.createElement('section')
  content.className = 'tidb-page-content'
  mountMachine(content, {
    locale,
    receipt,
    initialEventId: requestedEvent ?? undefined,
    stepIntervalMs: 650,
    onSeek(event) {
      const url = new URL(location.href)
      if (event) url.searchParams.set('event', event.id)
      else url.searchParams.delete('event')
      history.replaceState(null, '', url)
    },
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
    root.textContent = 'TiCity Machine could not start. See the browser console for details.'
  }
}
