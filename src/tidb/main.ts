// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

import './app.css'

import { createTiDBSimulation } from './model'
import type {
  ScenarioId,
  SqlSubmission,
  TiCityState,
  TiDBControls,
  TiDBSimulationApi,
  TraceReceipt,
  TraceRequest,
} from './model/types'
import {
  applyTheme,
  createNavigation,
  createWordmark,
  prepareDocument,
  type Theme,
} from './page-shell'
import {
  mountCityUi,
  resolveLocale,
  type Locale,
} from './ui'
import { createTracePlaybackDock } from './ui/trace-playback'
import { createTiDBWorld, type WorldHandle } from './world'
import type { CityComponent } from './world/city'
import type { CityMovementInput, CityViewMode } from './engine/camera'

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

const copy = {
  ja: {
    skip: 'メインコンテンツへ移動',
    qps: 'QPS',
    txn: '取引',
    regions: 'Regions',
    trace: 'Trace',
    none: 'なし',
    succeeded: 'success',
    committed: 'commit',
    rolledBack: 'rollback',
    failed: 'failed',
    orbit: '俯瞰',
    fly: '飛行',
    walk: '歩行',
    sound: '音',
    panel: '操作',
    showPanel: '操作パネルを開く',
    hidePanel: '操作パネルを閉じる',
    canvas: 'TiCityの対話型3Dアーキテクチャ。画面上の表示切替またはキーボードで探索できます。',
    hint: {
      orbit: 'ドラッグ: 回転 · wheel: zoom · 建物をclick: 詳細',
      fly: 'ドラッグ: 視点 · WASD: 移動 · Space/E: 上昇 · Q: 下降 · wheel: 速度',
      walk: 'ドラッグ: 視点 · WASD: 歩行 · Shift: 早歩き',
    },
    selected: '選択したコンポーネント',
    noWebgl: 'WebGL2を開始できませんでした。モデルと解説UIは引き続き利用できます。',
    movement: {
      flyControls: '飛行移動',
      walkControls: '歩行移動',
      forward: '前へ移動',
      backward: '後ろへ移動',
      left: '左へ移動',
      right: '右へ移動',
      ascend: '上昇',
      descend: '下降',
      sprint: '高速移動',
    },
    legend: {
      sql: 'SQL / data route',
      tso: 'TSO / control',
      txn2pc: 'Transaction 2PC',
      raft: 'Region Raft',
      kv: 'KV / MVCC',
      tiflash: 'TiFlash / MPP',
    },
  },
  en: {
    skip: 'Skip to main content',
    qps: 'QPS',
    txn: 'Txn',
    regions: 'Regions',
    trace: 'Trace',
    none: 'none',
    succeeded: 'success',
    committed: 'commit',
    rolledBack: 'rollback',
    failed: 'failed',
    orbit: 'Orbit',
    fly: 'Fly',
    walk: 'Walk',
    sound: 'Sound',
    panel: 'Panel',
    showPanel: 'Open control panel',
    hidePanel: 'Close control panel',
    canvas: 'TiCity interactive 3D architecture. Use the view controls or keyboard to explore.',
    hint: {
      orbit: 'Drag: orbit · wheel: zoom · click a building: inspect',
      fly: 'Drag: look · WASD: move · Space/E: ascend · Q: descend · wheel: speed',
      walk: 'Drag: look · WASD: walk · Shift: move faster',
    },
    selected: 'Selected component',
    noWebgl: 'WebGL2 could not start. The model and explanatory interface remain available.',
    movement: {
      flyControls: 'Fly movement',
      walkControls: 'Walk movement',
      forward: 'Move forward',
      backward: 'Move backward',
      left: 'Move left',
      right: 'Move right',
      ascend: 'Ascend',
      descend: 'Descend',
      sprint: 'Move faster',
    },
    legend: {
      sql: 'SQL / data route',
      tso: 'TSO / control',
      txn2pc: 'Transaction 2PC',
      raft: 'Region Raft',
      kv: 'KV / MVCC',
      tiflash: 'TiFlash / MPP',
    },
  },
} as const

interface TiCityPublicApi {
  readonly model: TiDBSimulationApi
  readonly world: WorldHandle | null
  readonly trace: TraceReceipt | null
  runScenario(id: ScenarioId): TraceReceipt
  submitSql(sql: string): SqlSubmission
  setControl<K extends keyof TiDBControls>(key: K, value: TiDBControls[K]): void
  setView(mode: CityViewMode): void
  setTheme(theme: Theme): void
  reset(): void
}

declare global {
  interface Window {
    TICITY: TiCityPublicApi
  }
}

function initialScenario(): ScenarioId {
  const value = new URLSearchParams(location.search).get('scenario')
  return SCENARIOS.includes(value as ScenarioId)
    ? value as ScenarioId
    : 'point-read'
}

function deepFreezeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreezeSnapshot(nested)
  }
  return Object.freeze(value)
}

function button(
  label: string,
  action: () => void,
  pressed = false,
): HTMLButtonElement {
  const result = document.createElement('button')
  result.type = 'button'
  result.className = 'tidb-icon-button'
  result.textContent = label
  result.setAttribute('aria-pressed', String(pressed))
  result.addEventListener('click', action)
  return result
}

function metric(term: string): { root: HTMLDivElement; value: HTMLElement } {
  const root = document.createElement('div')
  root.className = 'tidb-status'
  const name = document.createElement('dt')
  name.textContent = term
  const value = document.createElement('dd')
  root.append(name, value)
  return { root, value }
}

function createLegend(locale: Locale): HTMLElement {
  const root = document.createElement('aside')
  root.className = 'tidb-scene-legend'
  root.setAttribute('aria-label', locale === 'ja' ? '意味を表す色' : 'Semantic colours')
  for (const domain of ['sql', 'tso', 'txn2pc', 'raft', 'kv', 'tiflash'] as const) {
    const chip = document.createElement('span')
    chip.className = 'tidb-domain-chip'
    chip.dataset.domain = domain
    chip.textContent = copy[locale].legend[domain]
    root.append(chip)
  }
  return root
}

interface MovementPad {
  readonly root: HTMLDivElement
  setMode(mode: CityViewMode): void
  setLocale(locale: Locale): void
  release(): void
  dispose(): void
}

interface MovementBinding {
  readonly input: CityMovementInput
  readonly button: HTMLButtonElement
  release(): void
  dispose(): void
}

const MOVEMENT_GLYPHS: Readonly<Record<CityMovementInput, string>> = {
  forward: '↑',
  backward: '↓',
  left: '←',
  right: '→',
  ascend: '+',
  descend: '−',
  sprint: '⇧',
}

function createMovementPad(
  initialLocale: Locale,
  onMovement: (input: CityMovementInput, active: boolean) => void,
): MovementPad {
  const root = document.createElement('div')
  root.className = 'tidb-movement-pad'
  root.dataset.mode = 'orbit'
  root.hidden = true
  root.setAttribute('role', 'group')

  let locale = initialLocale
  let mode: CityViewMode = 'orbit'
  const bindings: MovementBinding[] = []

  const movementLabel = (input: CityMovementInput): string => copy[locale].movement[input]

  for (const input of [
    'forward',
    'backward',
    'left',
    'right',
    'ascend',
    'descend',
    'sprint',
  ] as const) {
    const control = document.createElement('button')
    control.type = 'button'
    control.className = 'tidb-movement-pad__button'
    control.dataset.cameraMove = input
    control.textContent = MOVEMENT_GLYPHS[input]
    control.setAttribute('aria-pressed', 'false')

    const pointers = new Set<number>()
    let keyboardActive = false
    let active = false

    const sync = () => {
      const next = pointers.size > 0 || keyboardActive
      if (next === active) return
      active = next
      control.setAttribute('aria-pressed', String(active))
      onMovement(input, active)
    }

    const release = () => {
      for (const pointerId of pointers) {
        if (control.hasPointerCapture?.(pointerId)) {
          try {
            control.releasePointerCapture(pointerId)
          } catch {
            // The pointer may already have been released by the browser.
          }
        }
      }
      pointers.clear()
      keyboardActive = false
      sync()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      event.preventDefault()
      pointers.add(event.pointerId)
      try {
        control.setPointerCapture(event.pointerId)
      } catch {
        // Capture is an enhancement; window blur still releases the input.
      }
      sync()
    }
    const endPointer = (event: PointerEvent) => {
      if (!pointers.delete(event.pointerId)) return
      if (control.hasPointerCapture?.(event.pointerId)) {
        try {
          control.releasePointerCapture(event.pointerId)
        } catch {
          // Pointer capture can disappear between pointerup and this check.
        }
      }
      sync()
    }
    const onLostPointerCapture = (event: PointerEvent) => {
      if (pointers.delete(event.pointerId)) sync()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      event.stopPropagation()
      keyboardActive = true
      sync()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      event.stopPropagation()
      keyboardActive = false
      sync()
    }
    const onBlur = () => {
      keyboardActive = false
      sync()
    }
    const onClick = (event: MouseEvent) => event.preventDefault()

    control.addEventListener('pointerdown', onPointerDown)
    control.addEventListener('pointerup', endPointer)
    control.addEventListener('pointercancel', endPointer)
    control.addEventListener('lostpointercapture', onLostPointerCapture)
    control.addEventListener('keydown', onKeyDown)
    control.addEventListener('keyup', onKeyUp)
    control.addEventListener('blur', onBlur)
    control.addEventListener('click', onClick)
    root.append(control)

    bindings.push({
      input,
      button: control,
      release,
      dispose(): void {
        release()
        control.removeEventListener('pointerdown', onPointerDown)
        control.removeEventListener('pointerup', endPointer)
        control.removeEventListener('pointercancel', endPointer)
        control.removeEventListener('lostpointercapture', onLostPointerCapture)
        control.removeEventListener('keydown', onKeyDown)
        control.removeEventListener('keyup', onKeyUp)
        control.removeEventListener('blur', onBlur)
        control.removeEventListener('click', onClick)
      },
    })
  }

  const release = () => {
    for (const binding of bindings) binding.release()
  }
  const onWindowBlur = () => release()
  const onVisibilityChange = () => {
    if (document.hidden) release()
  }
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)

  const setLocale = (next: Locale) => {
    locale = next
    root.setAttribute(
      'aria-label',
      mode === 'walk'
        ? copy[locale].movement.walkControls
        : copy[locale].movement.flyControls,
    )
    for (const binding of bindings) {
      const label = movementLabel(binding.input)
      binding.button.setAttribute('aria-label', label)
      binding.button.title = label
    }
  }

  const setMode = (next: CityViewMode) => {
    release()
    mode = next
    root.dataset.mode = next
    root.hidden = next === 'orbit'
    const fly = next === 'fly'
    for (const binding of bindings) {
      if (binding.input === 'ascend' || binding.input === 'descend') {
        binding.button.hidden = !fly
      }
    }
    setLocale(locale)
  }

  setLocale(locale)
  setMode(mode)

  return {
    root,
    setMode,
    setLocale,
    release,
    dispose(): void {
      release()
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      for (const binding of bindings) binding.dispose()
    },
  }
}

function boot(): void {
  const app = document.querySelector<HTMLElement>('#city-app')
  if (!app) throw new Error('Missing #city-app')

  let locale = resolveLocale()
  prepareDocument(locale)
  const simulation = createTiDBSimulation({ seed: 425 })
  let currentTrace: TraceReceipt | null = simulation.runScenario(initialScenario())
  let world: WorldHandle | null = null
  let disposed = false

  const layout = document.createElement('div')
  layout.className = 'tidb-layout'
  let currentView: CityViewMode = 'orbit'
  let panelExpanded =
    window.innerWidth <= 900 ||
    new URLSearchParams(location.search).get('panel') === 'open'
  layout.dataset.panel = panelExpanded ? 'open' : 'closed'
  layout.dataset.cameraView = 'orbit'

  const pageTitle = document.createElement('h1')
  pageTitle.className = 'visually-hidden'
  pageTitle.textContent = 'TiCity'

  const worldHost = document.createElement('div')
  worldHost.className = 'tidb-world'
  worldHost.id = 'tidb-world'

  const selected = document.createElement('aside')
  selected.className = 'tidb-inspector'
  selected.hidden = true
  const selectedTitle = document.createElement('strong')
  const selectedRole = document.createElement('p')
  const selectedDomain = document.createElement('small')
  selected.append(selectedTitle, selectedRole, selectedDomain)

  const hint = document.createElement('p')
  hint.className = 'tidb-scene-hint'
  hint.textContent = copy[locale].hint[currentView]

  const onSelect = (component: CityComponent | null) => {
    selected.hidden = component === null
    if (!component) return
    selected.setAttribute('aria-label', copy[locale].selected)
    selectedTitle.textContent = component.name
    selectedRole.textContent = component.role
    selectedDomain.textContent = `MODEL / SIMULATED · ${component.domain}`
  }

  try {
    world = createTiDBWorld(worldHost, {
      theme: document.documentElement.dataset.theme === 'day' ? 'day' : 'night',
      mode: 'orbit',
      hudExpanded: panelExpanded,
      onSelect,
    })
    world.shell.renderer.domElement.setAttribute('aria-label', copy[locale].canvas)
  } catch (error) {
    console.warn('3D world unavailable:', error)
    const fallback = document.createElement('p')
    fallback.className = 'tidb-webgl-fallback'
    fallback.textContent = copy[locale].noWebgl
    worldHost.append(fallback)
  }

  const traceDock = createTracePlaybackDock(locale, {
    onPrevious: () => {
      world?.shell.flows.step(-1)
    },
    onTogglePause: () => {
      const flows = world?.shell.flows
      if (!flows) return
      const pause =
        flows.playback.phase === 'playing' ||
        flows.playback.phase === 'holding'
      flows.setPaused(pause)
    },
    onNext: () => {
      world?.shell.flows.step(1)
    },
    onReplay: () => {
      world?.shell.flows.replay()
    },
    onToggleLoop: () => {
      const flows = world?.shell.flows
      if (!flows) return
      flows.setLooping(!flows.playback.looping)
    },
  })
  traceDock.root.dataset.traceDock = ''
  if (world) worldHost.append(traceDock.root)

  const movementPad = createMovementPad(locale, (input, active) => {
    world?.shell.controls.setMovement(input, active)
  })
  if (world) worldHost.append(movementPad.root)

  const setPlayback = (mode: TiCityState['playback']): void => {
    simulation.setPlayback(mode)
    world?.shell.flows.setPaused(mode === 'step')
  }

  const setControl = <K extends keyof TiDBControls>(
    key: K,
    value: TiDBControls[K],
  ): void => {
    simulation.setControl(key, value)
    if (key === 'paused') world?.shell.flows.setPaused(Boolean(value))
  }

  const topbar = document.createElement('header')
  topbar.className = 'tidb-topbar'
  const wordmarkHost = document.createElement('div')
  wordmarkHost.append(createWordmark(locale))
  const navigation = createNavigation('city', locale)
  const topCluster = document.createElement('div')
  topCluster.className = 'tidb-top-cluster'
  const viewActions = document.createElement('div')
  viewActions.className = 'tidb-view-actions'
  const viewButtons = new Map<CityViewMode, HTMLButtonElement>()

  const panelButton = button(copy[locale].panel, () => {
    panelExpanded = !panelExpanded
    layout.dataset.panel = panelExpanded ? 'open' : 'closed'
    panelButton.setAttribute('aria-expanded', String(panelExpanded))
    panelButton.setAttribute('aria-pressed', String(panelExpanded))
    panelButton.setAttribute(
      'aria-label',
      panelExpanded ? copy[locale].hidePanel : copy[locale].showPanel,
    )
    world?.setHudExpanded(panelExpanded)
  }, panelExpanded)
  panelButton.dataset.action = 'panel'
  panelButton.setAttribute('aria-controls', 'tidb-control-panel')
  panelButton.setAttribute('aria-expanded', String(panelExpanded))
  panelButton.setAttribute(
    'aria-label',
    panelExpanded ? copy[locale].hidePanel : copy[locale].showPanel,
  )

  const setView = (mode: CityViewMode) => {
    movementPad.setMode(mode)
    world?.setMode(mode)
    currentView = mode
    layout.dataset.cameraView = mode
    hint.textContent = copy[locale].hint[mode]
    for (const [candidate, control] of viewButtons) {
      control.setAttribute('aria-pressed', String(candidate === mode))
    }
    world?.shell.renderer.domElement.focus({ preventScroll: true })
  }

  for (const mode of ['orbit', 'fly', 'walk'] as const) {
    const control = button(copy[locale][mode], () => setView(mode), mode === 'orbit')
    control.dataset.view = mode
    viewButtons.set(mode, control)
    viewActions.append(control)
  }

  const audioButton = button(copy[locale].sound, async () => {
    if (!world) return
    const enabled = await world.enableAudio()
    audioButton.setAttribute('aria-pressed', String(enabled))
  })
  audioButton.dataset.action = 'audio'
  viewActions.append(panelButton, audioButton)
  topCluster.append(navigation.root, viewActions)
  topbar.append(wordmarkHost, topCluster)

  const hud = document.createElement('aside')
  hud.className = 'tidb-hud'
  const status = document.createElement('dl')
  status.className = 'tidb-status-strip'
  const qps = metric(copy[locale].qps)
  const txn = metric(copy[locale].txn)
  const regions = metric(copy[locale].regions)
  const trace = metric(copy[locale].trace)
  status.append(qps.root, txn.root, regions.root, trace.root)

  const uiHost = document.createElement('div')
  uiHost.className = 'tidb-ui-host'
  uiHost.id = 'tidb-control-panel'

  const applyReceipt = (candidate: unknown): void => {
    if (
      candidate &&
      typeof candidate === 'object' &&
      'events' in candidate &&
      'id' in candidate
    ) {
      currentTrace = candidate as TraceReceipt
      world?.update(simulation.state, currentTrace)
    }
  }

  const runScenario = (id: ScenarioId): TraceReceipt => {
    const receipt = simulation.runScenario(id)
    applyReceipt(receipt)
    return receipt
  }

  const submitSql = (sql: string): SqlSubmission => {
    const submission = simulation.submitSql(sql)
    applyReceipt(submission.receipt)
    return submission
  }

  let lastTourFocus = 'city.overview'
  mountCityUi(uiHost, {
    locale,
    simulation: {
      state: simulation.state,
      submitSql,
      runScenario,
      setControl,
      setPlayback,
    },
    analyzeSql: submitSql,
    onReceipt: applyReceipt,
    onRunScenario: runScenario,
    onSetControl: setControl,
    onSetPlayback: setPlayback,
    onTourFocus: (target) => {
      // Tour rendering reports its current chapter. Move only when the
      // chapter changes, not during the initial UI mount or locale rerender.
      if (target === lastTourFocus || !world) return
      lastTourFocus = target
      world.focus(target)
      if (target === 'city.overview') {
        world.shell.camera.position.set(0, 305, 555)
      }
    },
    onLocaleChange: (next) => {
      locale = next
      document.documentElement.lang = next
      navigation.setLocale(next)
      wordmarkHost.replaceChildren(createWordmark(next))
      for (const [mode, control] of viewButtons) {
        control.textContent = copy[next][mode]
      }
      audioButton.textContent = copy[next].sound
      panelButton.textContent = copy[next].panel
      panelButton.setAttribute(
        'aria-label',
        panelExpanded ? copy[next].hidePanel : copy[next].showPanel,
      )
      const skip = document.querySelector<HTMLElement>('.skip-link')
      if (skip) skip.textContent = copy[next].skip
      if (world) world.shell.renderer.domElement.setAttribute('aria-label', copy[next].canvas)
      traceDock.setLocale(next)
      movementPad.setLocale(next)
      hint.textContent = copy[next].hint[currentView]
    },
    machineHref: 'machine/',
    diagnoseHref: 'diagnose/',
    githubHref: 'https://github.com/penguin425/TiCity/',
  })

  hud.append(status, uiHost)
  const legend = createLegend(locale)
  layout.append(pageTitle, worldHost, topbar, hud, selected, hint, legend)
  app.replaceChildren(layout)

  let last = performance.now()
  let lastStatus = 0
  let animationFrame = 0
  const frame = (now: number) => {
    if (disposed) return
    const deltaSeconds = Math.min(0.25, Math.max(0, (now - last) / 1_000))
    last = now
    simulation.update(deltaSeconds)
    world?.update(simulation.state, currentTrace)
    const playback = world?.shell.flows.playback
    if (playback) {
      traceDock.update(playback, currentTrace)
      layout.dataset.traceState = playback.phase
    }

    if (now - lastStatus >= 250) {
      lastStatus = now
      qps.value.textContent = String(simulation.state.controls.qps)
      const latest = simulation.state.lastTrace
      txn.value.textContent =
        playback?.phase === 'playing'
          ? 'PLAY'
          : playback?.phase === 'paused'
            ? 'PAUSE'
            : latest
              ? latest.outcome === 'committed'
                ? copy[locale].committed
                : latest.outcome === 'rolled_back'
                  ? copy[locale].rolledBack
                  : latest.outcome === 'succeeded'
                    ? copy[locale].succeeded
                    : copy[locale].failed
              : copy[locale].none
      regions.value.textContent = String(simulation.state.regions.length)
      trace.value.textContent =
        playback &&
        (
          playback.phase === 'playing' ||
          playback.phase === 'holding' ||
          playback.phase === 'paused'
        )
          ? `${playback.currentIndex + 1}/${playback.total}`
          : latest?.scenarioId === 'commit-protocols'
            ? '1PC / Async / 2PC'
            : latest?.protocol ?? copy[locale].none
    }
    animationFrame = requestAnimationFrame(frame)
  }
  animationFrame = requestAnimationFrame(frame)

  const themeObserver = new MutationObserver(() => {
    world?.setTheme(document.documentElement.dataset.theme === 'day' ? 'day' : 'night')
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  const setTheme = (theme: Theme) => {
    applyTheme(theme)
  }

  const reset = () => {
    simulation.reset()
    currentTrace = null
    world?.update(simulation.state, null)
  }
  const publicModel: TiDBSimulationApi = {
    get state(): TiCityState {
      return deepFreezeSnapshot(structuredClone(simulation.state))
    },
    update: (deltaSeconds) => simulation.update(deltaSeconds),
    setControl,
    runScenario,
    submitSql,
    requestTrace(request: TraceRequest) {
      const receipt = simulation.requestTrace(request)
      applyReceipt(receipt)
      return receipt
    },
    setPlayback,
    reset,
  }

  window.TICITY = {
    model: publicModel,
    world,
    get trace() {
      return currentTrace
    },
    runScenario,
    submitSql,
    setControl(key, value) {
      setControl(key, value)
    },
    setView,
    setTheme,
    reset,
  }

  window.addEventListener('pagehide', () => {
    disposed = true
    cancelAnimationFrame(animationFrame)
    themeObserver.disconnect()
    traceDock.dispose()
    movementPad.dispose()
    world?.dispose()
  }, { once: true })

  const skip = document.querySelector<HTMLElement>('.skip-link')
  if (skip) skip.textContent = copy[locale].skip
  document.body.dataset.ready = 'true'
}

try {
  boot()
} catch (error) {
  console.error(error)
  document.body.dataset.ready = 'error'
  const app = document.querySelector<HTMLElement>('#city-app')
  if (app) {
    app.textContent = 'TiCity could not start. See the browser console for details.'
  }
}
