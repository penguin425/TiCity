// SPDX-License-Identifier: Apache-2.0

import { CATALOG, type Locale } from './ui/catalog'
import { isCityAppearance, type CityAppearance } from './appearance'

export type { CityAppearance } from './appearance'

export type SurfaceId = 'city' | 'machine' | 'diagnose'
export type Theme = 'day' | 'night'

const THEME_STORAGE_KEY = 'ticity:theme'
const APPEARANCE_STORAGE_KEY = 'ticity:appearance'

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function resolveTheme(search = window.location.search): Theme {
  const requested = new URLSearchParams(search).get('theme')
  if (requested === 'day' || requested === 'night') return requested
  let saved: string | null | undefined
  try {
    saved = safeStorage()?.getItem(THEME_STORAGE_KEY)
  } catch {
    // Browsers can expose localStorage while rejecting reads.
  }
  return saved === 'night' ? 'night' : 'day'
}

export function resolveAppearance(search = window.location.search): CityAppearance {
  const requested = new URLSearchParams(search).get('appearance')
  if (isCityAppearance(requested)) return requested
  try {
    const saved = safeStorage()?.getItem(APPEARANCE_STORAGE_KEY)
    if (isCityAppearance(saved)) return saved
  } catch {
    // URL selection and the default remain available with restricted storage.
  }
  return 'tidb'
}

function syncThemeColor(): void {
  const day = document.documentElement.dataset.theme !== 'night'
  const fresh = document.documentElement.dataset.appearance === 'tidb'
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    fresh ? (day ? '#eaf5fa' : '#102331') : (day ? '#d7e9f1' : '#07121f'),
  )
}

function syncExistingUrlChoice(key: 'appearance' | 'theme', value: string): void {
  const search = new URLSearchParams(window.location.search)
  // Keep clean entry URLs clean, while making explicit shared settings match
  // the user's subsequent choice on reload or scenario navigation.
  if (!search.has(key)) return
  search.set(key, value)
  try {
    window.history?.replaceState?.(
      null,
      '',
      `${window.location.pathname}?${search.toString()}${window.location.hash}`,
    )
  } catch {
    // Display controls continue to work if history updates are restricted.
  }
}

export function applyAppearance(appearance: CityAppearance): void {
  document.documentElement.dataset.appearance = appearance
  syncThemeColor()
  syncExistingUrlChoice('appearance', appearance)
  try {
    safeStorage()?.setItem(APPEARANCE_STORAGE_KEY, appearance)
  } catch {
    // The selected palette still applies when storage is disabled.
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'day' ? 'light' : 'dark'
  syncThemeColor()
  syncExistingUrlChoice('theme', theme)
  try {
    safeStorage()?.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The selected theme still applies when storage is disabled.
  }
}

export function logoMark(doc: Document = document): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = doc.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 128 128')
  svg.setAttribute('aria-hidden', 'true')
  const hex = doc.createElementNS(ns, 'path')
  hex.setAttribute('d', 'M64 4 116 34v60l-52 30-52-30V34z')
  hex.setAttribute('fill', 'var(--logo-bg, #07121f)')
  hex.setAttribute('stroke', 'var(--logo-line, #34d5ff)')
  hex.setAttribute('stroke-width', '5')
  const towers = doc.createElementNS(ns, 'path')
  towers.setAttribute('d', 'M31 89V59l16-9 16 9v30l-16 9zm38 0V39l16-9 16 9v50l-16 9z')
  towers.setAttribute('fill', 'none')
  towers.setAttribute('stroke', 'var(--logo-towers, #ffcc42)')
  towers.setAttribute('stroke-width', '6')
  towers.setAttribute('stroke-linejoin', 'round')
  const ground = doc.createElementNS(ns, 'path')
  ground.setAttribute('d', 'M25 104h78')
  ground.setAttribute('stroke', 'var(--logo-line, #34d5ff)')
  ground.setAttribute('stroke-width', '5')
  ground.setAttribute('stroke-linecap', 'round')
  svg.append(hex, towers, ground)
  return svg
}

export function createWordmark(locale: Locale): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'tidb-wordmark'
  const copy = document.createElement('span')
  const name = document.createElement('strong')
  name.textContent = 'TiCity'
  const model = document.createElement('small')
  model.textContent = CATALOG[locale].navigation.model
  copy.append(name, model)
  root.append(logoMark(), copy)
  return root
}

function navLink(
  id: SurfaceId | 'github',
  label: string,
  href: string,
  current: boolean,
  external = false,
): HTMLAnchorElement {
  const link = document.createElement('a')
  link.className = 'tidb-nav-link'
  link.dataset.nav = id
  link.textContent = label
  link.href = href
  if (current) link.setAttribute('aria-current', 'page')
  if (external) {
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
  }
  return link
}

export interface NavigationHandle {
  root: HTMLElement
  themeButton: HTMLButtonElement
  appearanceSelect: HTMLSelectElement
  setLocale(locale: Locale): void
  syncTheme(): void
  syncAppearance(): void
  setTraceContext(scenario: string | null, eventId: string | null): void
}

export function createNavigation(
  surface: SurfaceId,
  initialLocale: Locale,
): NavigationHandle {
  let locale = initialLocale
  const copy = () => CATALOG[locale].navigation
  const initialSearch = new URLSearchParams(window.location.search)
  let scenario = initialSearch.get('scenario')
  let eventId = initialSearch.get('event')
  const root = document.createElement('nav')
  root.className = 'tidb-top-actions'
  root.setAttribute('aria-label', copy().ariaLabel)

  const links = document.createElement('div')
  links.className = 'tidb-nav-destinations'
  const appearanceLabel = document.createElement('label')
  appearanceLabel.className = 'tidb-nav-appearance'
  const appearanceText = document.createElement('span')
  const appearanceSelect = document.createElement('select')
  appearanceSelect.dataset.nav = 'appearance'
  const tidbOption = document.createElement('option')
  tidbOption.value = 'tidb'
  const classicOption = document.createElement('option')
  classicOption.value = 'classic'
  appearanceSelect.append(tidbOption, classicOption)
  appearanceLabel.append(appearanceText, appearanceSelect)
  appearanceSelect.addEventListener('change', () => {
    if (!isCityAppearance(appearanceSelect.value)) return
    applyAppearance(appearanceSelect.value)
    syncAppearance()
  })

  const themeButton = document.createElement('button')
  themeButton.className = 'tidb-icon-button'
  themeButton.dataset.nav = 'theme'
  themeButton.type = 'button'
  themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'day' ? 'night' : 'day'
    applyTheme(next)
    syncTheme()
  })

  const traceHref = (path: string): string => {
    const search = new URLSearchParams()
    if (scenario) search.set('scenario', scenario)
    if (eventId) search.set('event', eventId)
    search.set('lang', locale)
    search.set('theme', document.documentElement.dataset.theme === 'night' ? 'night' : 'day')
    search.set('appearance', document.documentElement.dataset.appearance === 'classic' ? 'classic' : 'tidb')
    return `${path}?${search.toString()}`
  }

  const syncTheme = () => {
    const labels = copy()
    const theme = document.documentElement.dataset.theme === 'night' ? 'night' : 'day'
    const nextTheme = theme === 'day' ? 'night' : 'day'
    themeButton.textContent = nextTheme === 'day' ? `☀ ${labels.day}` : `☾ ${labels.night}`
    themeButton.setAttribute('aria-label', nextTheme === 'day'
      ? labels.switchToDay
      : labels.switchToNight)
    themeButton.setAttribute('aria-pressed', String(theme === 'night'))
    syncLinks()
  }

  const syncAppearance = () => {
    const labels = copy()
    appearanceText.textContent = labels.appearance
    appearanceSelect.setAttribute('aria-label', labels.appearance)
    tidbOption.textContent = labels.appearanceTiDB
    classicOption.textContent = labels.appearanceClassic
    appearanceSelect.value = document.documentElement.dataset.appearance === 'classic' ? 'classic' : 'tidb'
    syncLinks()
  }

  const syncLinks = () => {
    const paths: Readonly<Record<SurfaceId, string>> = {
      city: surface === 'city' ? './' : '../',
      machine: surface === 'city' ? 'machine/' : surface === 'machine' ? './' : '../machine/',
      diagnose: surface === 'city' ? 'diagnose/' : surface === 'diagnose' ? './' : '../diagnose/',
    }
    for (const id of ['city', 'machine', 'diagnose'] as const) {
      const link = links.querySelector<HTMLAnchorElement>(`[data-nav="${id}"]`)
      if (link) link.href = traceHref(paths[id])
    }
  }

  const sync = () => {
    const labels = copy()
    root.setAttribute('aria-label', labels.ariaLabel)
    for (const id of ['city', 'machine', 'diagnose', 'github'] as const) {
      const link = links.querySelector<HTMLAnchorElement>(`[data-nav="${id}"]`)
      if (link) link.textContent = id === 'github' ? labels.source : labels[id]
    }
    syncTheme()
    syncAppearance()
  }

  links.append(
    navLink('city', '', './', surface === 'city'),
    navLink('machine', '', './', surface === 'machine'),
    navLink('diagnose', '', './', surface === 'diagnose'),
    navLink('github', '', 'https://github.com/penguin425/TiCity', false, true),
  )
  root.append(links, appearanceLabel, themeButton)
  sync()
  return {
    root,
    themeButton,
    appearanceSelect,
    syncTheme,
    syncAppearance,
    setLocale(next) {
      locale = next
      sync()
    },
    setTraceContext(nextScenario, nextEventId) {
      scenario = nextScenario
      eventId = nextEventId
      syncLinks()
    },
  }
}

export function prepareDocument(locale: Locale): void {
  document.documentElement.lang = locale
  const skip = document.querySelector<HTMLElement>('.skip-link')
  if (skip) {
    skip.textContent = CATALOG[locale].city.skip
  }
  applyAppearance(resolveAppearance())
  applyTheme(resolveTheme())
}
