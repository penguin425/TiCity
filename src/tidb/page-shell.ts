// SPDX-License-Identifier: Apache-2.0

import type { Locale } from './ui/catalog'

export type SurfaceId = 'city' | 'machine' | 'diagnose'
export type Theme = 'day' | 'night'

const THEME_STORAGE_KEY = 'tidb-city:theme'

const text = {
  ja: {
    city: '3D City',
    machine: '2D Machine',
    diagnose: '診断',
    source: 'GitHub',
    day: '昼',
    night: '夜',
    model: 'TiDB v8.5 LTS 教育モデル',
  },
  en: {
    city: '3D City',
    machine: '2D Machine',
    diagnose: 'Diagnose',
    source: 'GitHub',
    day: 'Day',
    night: 'Night',
    model: 'TiDB v8.5 LTS teaching model',
  },
} as const

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
  const saved = safeStorage()?.getItem(THEME_STORAGE_KEY)
  return saved === 'day' ? 'day' : 'night'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'day' ? 'light' : 'dark'
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'day' ? '#d7e9f1' : '#07121f',
  )
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
  hex.setAttribute('fill', '#07121f')
  hex.setAttribute('stroke', '#34d5ff')
  hex.setAttribute('stroke-width', '5')
  const towers = doc.createElementNS(ns, 'path')
  towers.setAttribute('d', 'M31 89V59l16-9 16 9v30l-16 9zm38 0V39l16-9 16 9v50l-16 9z')
  towers.setAttribute('fill', 'none')
  towers.setAttribute('stroke', '#ffcc42')
  towers.setAttribute('stroke-width', '6')
  towers.setAttribute('stroke-linejoin', 'round')
  const ground = doc.createElementNS(ns, 'path')
  ground.setAttribute('d', 'M25 104h78')
  ground.setAttribute('stroke', '#34d5ff')
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
  name.textContent = 'TiDB City'
  const model = document.createElement('small')
  model.textContent = text[locale].model
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
  setLocale(locale: Locale): void
}

export function createNavigation(
  surface: SurfaceId,
  initialLocale: Locale,
): NavigationHandle {
  let locale = initialLocale
  const root = document.createElement('nav')
  root.className = 'tidb-top-actions'
  root.setAttribute('aria-label', locale === 'ja' ? '主要ナビゲーション' : 'Primary navigation')

  const themeButton = document.createElement('button')
  themeButton.className = 'tidb-icon-button'
  themeButton.dataset.nav = 'theme'
  themeButton.type = 'button'
  themeButton.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'day' ? 'night' : 'day'
    applyTheme(next)
    sync()
  })

  const sync = () => {
    root.setAttribute('aria-label', locale === 'ja' ? '主要ナビゲーション' : 'Primary navigation')
    root.replaceChildren(
      navLink('city', text[locale].city, surface === 'city' ? './' : '../', surface === 'city'),
      navLink('machine', text[locale].machine, surface === 'city' ? 'machine/' : surface === 'machine' ? './' : '../machine/', surface === 'machine'),
      navLink('diagnose', text[locale].diagnose, surface === 'city' ? 'diagnose/' : surface === 'diagnose' ? './' : '../diagnose/', surface === 'diagnose'),
      navLink('github', text[locale].source, 'https://github.com/penguin425/TiDB-City', false, true),
      themeButton,
    )
    const theme = document.documentElement.dataset.theme === 'day' ? 'day' : 'night'
    const nextTheme = theme === 'day' ? 'night' : 'day'
    themeButton.textContent = nextTheme === 'day' ? `☀ ${text[locale].day}` : `☾ ${text[locale].night}`
    themeButton.setAttribute('aria-label', nextTheme === 'day'
      ? (locale === 'ja' ? '昼テーマに切り替える' : 'Switch to day theme')
      : (locale === 'ja' ? '夜テーマに切り替える' : 'Switch to night theme'))
    themeButton.setAttribute('aria-pressed', String(theme === 'night'))
  }

  sync()
  return {
    root,
    themeButton,
    setLocale(next) {
      locale = next
      sync()
    },
  }
}

export function prepareDocument(locale: Locale): void {
  document.documentElement.lang = locale
  applyTheme(resolveTheme())
}
