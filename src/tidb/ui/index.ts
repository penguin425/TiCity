// SPDX-License-Identifier: Apache-2.0

import type {
  PlaybackMode,
  ScenarioId,
  TiDBControls,
} from '../model/types'
import {
  CATALOG,
  persistLocale,
  resolveLocale,
  type Locale,
  type LocaleStorage,
  type Messages,
} from './catalog'
import { element } from './dom'
import { CONTROL_COPY, createControlPanel } from './controls'
import { createLegalPanel, createModelBadge } from './legal'
import {
  mountSqlWorkbench,
  type SqlAnalyzer,
} from './sql'
import { installCityUiStyles } from './styles'
import { TOUR_CHAPTERS, tourChapter } from './tour'

export {
  CATALOG,
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  message,
  persistLocale,
  resolveLocale,
  type Locale,
  type LocaleStorage,
  type Messages,
} from './catalog'
export { createLegalPanel, createModelBadge } from './legal'
export {
  createTransactionLabPanel,
  type TransactionLabPanel,
} from './transaction-lab'
export {
  CONTROL_COPY,
  DEFAULT_CITY_CONTROLS,
  SCENARIOS,
  createControlPanel,
  type CityControlBridge,
} from './controls'
export {
  MAX_SQL_BYTES,
  mountSqlWorkbench,
  presentSql,
  simulationSqlAnalyzer,
  sqlByteLength,
  truncateSql,
  type SqlAnalyzer,
  type SqlPresentation,
  type SqlWorkbenchHandle,
  type SqlWorkbenchOptions,
} from './sql'
export { CITY_UI_CSS, installCityUiStyles } from './styles'
export { TOUR_CHAPTERS, tourChapter, type TourChapter } from './tour'

export interface CityUiSimulation {
  readonly state?: {
    readonly controls?: Partial<TiDBControls>
    readonly playback?: PlaybackMode
  }
  submitSql?: SqlAnalyzer
  runScenario?: (id: ScenarioId) => unknown
  setControl?: (key: keyof TiDBControls, value: TiDBControls[keyof TiDBControls]) => void
  setPlayback?: (mode: PlaybackMode) => void
}

export interface CityUiOptions {
  simulation?: CityUiSimulation
  analyzeSql?: SqlAnalyzer
  locale?: Locale
  search?: string
  storage?: LocaleStorage
  initialSql?: string
  initialChapter?: number
  onReceipt?: (receipt: unknown) => void
  onLocaleChange?: (locale: Locale) => void
  onTourFocus?: (focusId: string) => void
  onRunScenario?: (id: ScenarioId) => unknown
  onSetControl?: (key: keyof TiDBControls, value: TiDBControls[keyof TiDBControls]) => void
  onSetPlayback?: (mode: PlaybackMode) => void
  showControls?: boolean
  machineHref?: string
  diagnoseHref?: string
  githubHref?: string
}

export interface CityUiHandle {
  readonly root: HTMLElement
  locale(): Locale
  setLocale(locale: Locale): void
  chapter(): number
  setChapter(index: number): void
  dispose(): void
}

function unavailableAnalyzer(locale: Locale): SqlAnalyzer {
  return () => ({
    status: 'unsupported',
    statement: 'unknown',
    route: [],
    plan: [],
    warning: locale === 'ja'
      ? 'SQLモデルが接続されていません。'
      : 'The SQL model is not connected.',
  })
}

function createTour(
  locale: Locale,
  initialChapter: number,
  onChapter: (index: number) => void,
): { root: HTMLElement; setChapter(index: number): void; chapter(): number } {
  let current = Math.max(0, Math.min(TOUR_CHAPTERS.length - 1, initialChapter))
  const progress = element('p', { className: 'tidb-tour-progress' })
  const title = element('h3')
  const body = element('p', { className: 'tidb-tour-body' })
  const previous = element('button', {
    className: 'tidb-button',
    attrs: { type: 'button', 'data-action': 'tour-previous' },
  })
  const next = element('button', {
    className: 'tidb-button',
    attrs: { type: 'button', 'data-action': 'tour-next' },
  })

  const sync = () => {
    const chapter = TOUR_CHAPTERS[current]
    const copy = tourChapter(chapter, locale)
    progress.textContent = `${CATALOG[locale].chapter} ${current + 1} / ${TOUR_CHAPTERS.length}`
    title.textContent = copy.title
    body.textContent = copy.body
    previous.textContent = CATALOG[locale].previous
    next.textContent = CATALOG[locale].next
    previous.disabled = current === 0
    next.disabled = current === TOUR_CHAPTERS.length - 1
    onChapter(current)
  }
  previous.addEventListener('click', () => {
    if (current > 0) {
      current -= 1
      sync()
    }
  })
  next.addEventListener('click', () => {
    if (current < TOUR_CHAPTERS.length - 1) {
      current += 1
      sync()
    }
  })

  const root = element(
    'section',
    { className: 'tidb-card tidb-tour', attrs: { 'aria-labelledby': 'tidb-tour-title' } },
    element('div', { className: 'tidb-section-heading' },
      element('h2', { text: CATALOG[locale].tourTitle, attrs: { id: 'tidb-tour-title' } }),
      createModelBadge(locale),
    ),
    progress,
    title,
    body,
    element('div', { className: 'tidb-tour-nav' }, previous, next),
  )
  sync()
  return {
    root,
    setChapter(index) {
      current = Math.max(0, Math.min(TOUR_CHAPTERS.length - 1, Math.trunc(index)))
      sync()
    },
    chapter: () => current,
  }
}

export function mountCityUi(root: HTMLElement, options: CityUiOptions): CityUiHandle {
  installCityUiStyles(root.ownerDocument ?? document)
  let locale = options.locale ?? resolveLocale(options.search, options.storage)
  let chapter = Math.max(0, Math.min(TOUR_CHAPTERS.length - 1, options.initialChapter ?? 0))
  let currentSql = options.initialSql ?? ''
  let disposed = false

  const analyzer = options.analyzeSql
    ?? options.simulation?.submitSql
    ?? unavailableAnalyzer(locale)

  const render = () => {
    if (disposed) return
    const sqlHost = element('div')
    const sql = mountSqlWorkbench(sqlHost, {
      locale,
      analyzeSql: analyzer,
      initialSql: currentSql,
      onReceipt: options.onReceipt,
    })
    const tour = createTour(locale, chapter, (index) => {
      chapter = index
      options.onTourFocus?.(TOUR_CHAPTERS[index].focus)
    })
    const simulationState = options.simulation?.state
    const controls = options.showControls === false
      ? null
      : createControlPanel(locale, {
          controls: simulationState?.controls,
          playback: simulationState?.playback,
          runScenario: options.onRunScenario ?? options.simulation?.runScenario,
          setControl: options.onSetControl ?? options.simulation?.setControl,
          setPlayback: options.onSetPlayback ?? options.simulation?.setPlayback,
          onReceipt: options.onReceipt,
        })

    const language = element('fieldset', { className: 'tidb-language' },
      element('legend', { text: CATALOG[locale].language }),
    )
    for (const choice of ['ja', 'en'] as const) {
      const button = element('button', {
        className: 'tidb-button',
        text: choice === 'ja' ? CATALOG[locale].japanese : CATALOG[locale].english,
        attrs: {
          type: 'button',
          'aria-pressed': String(locale === choice),
          'data-locale': choice,
        },
      })
      button.addEventListener('click', () => {
        if (choice === locale) return
        currentSql = sql.value()
        chapter = tour.chapter()
        locale = choice
        persistLocale(locale, options.storage)
        options.onLocaleChange?.(locale)
        render()
      })
      language.append(button)
    }

    const navigation = element('nav', {
      className: 'tidb-navigation',
      attrs: { 'aria-label': locale === 'ja' ? '関連画面' : 'Related surfaces' },
    })
    const links = [
      ['machine', 'Machine', options.machineHref ?? 'machine/'],
      ['diagnose', 'Diagnose', options.diagnoseHref ?? 'diagnose/'],
      ['github', 'GitHub', options.githubHref ?? 'https://github.com/penguin425/TiCity/'],
    ] as const
    for (const [id, label, href] of links) {
      navigation.append(element('a', {
        className: 'tidb-nav-link',
        text: label,
        attrs: {
          href,
          'data-nav': id,
          ...(id === 'github' ? { rel: 'noopener noreferrer' } : {}),
        },
      }))
    }

    const sectionNavigation = element('nav', {
      className: 'tidb-hud-jumps',
      attrs: { 'aria-label': CATALOG[locale].appName },
    })
    const sectionLinks = [
      ...(controls
        ? [['controls', CONTROL_COPY[locale].title, '#tidb-controls-title']] as const
        : []),
      ['sql', CATALOG[locale].sqlTitle, '#tidb-sql-title'],
      ['tour', CATALOG[locale].tourTitle, '#tidb-tour-title'],
      ['legal', CATALOG[locale].legalTitle, '#tidb-legal-title'],
    ] as const
    for (const [id, label, href] of sectionLinks) {
      sectionNavigation.append(element('a', {
        className: 'tidb-hud-jump',
        text: label,
        attrs: {
          href,
          'data-ui-jump': id,
        },
      }))
    }

    root.classList.add('tidb-surface', 'ticity-ui')
    root.setAttribute('lang', locale)
    const children: Node[] = [
      element('header', { className: 'ticity-head' },
        element('div', { className: 'ticity-title' },
          element('h1', { text: CATALOG[locale].appName }),
          element('p', { text: CATALOG[locale].citySubtitle }),
        ),
        language,
      ),
      navigation,
      sectionNavigation,
      sqlHost,
      tour.root,
      element('div', { className: 'tidb-card tidb-legal-card' }, createLegalPanel(locale)),
    ]
    if (controls) children.splice(3, 0, controls)
    root.replaceChildren(...children)
  }

  render()
  return {
    root,
    locale: () => locale,
    setLocale(next) {
      if (disposed || next === locale) return
      currentSql = root.querySelector<HTMLTextAreaElement>('textarea')?.value ?? currentSql
      locale = next
      persistLocale(locale, options.storage)
      options.onLocaleChange?.(locale)
      render()
    },
    chapter: () => chapter,
    setChapter(index) {
      chapter = Math.max(0, Math.min(TOUR_CHAPTERS.length - 1, Math.trunc(index)))
      render()
    },
    dispose() {
      disposed = true
      root.replaceChildren()
      root.classList.remove('tidb-surface', 'ticity-ui')
    },
  }
}
