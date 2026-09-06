/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import type { TiCityState, TraceReceipt } from '../model/types'
import { FOCUS_COMPONENT_TARGETS, TICITY_LAYOUT } from '../world/layout'
import { createTiDBSceneGraph } from '../world/city'
import type { CityComponent, TiDBSceneGraph } from '../world/city'
import type { CityTheme } from '../world/palette'
import { createCityAudio } from './audio'
import type { CityAudio } from './audio'
import { CITY_ORBIT, createCityCameraController } from './camera'
import type { CityCameraController, CityViewMode } from './camera'
import { createCollisionMap } from './collision'
import { createCityLabels } from './labels'
import { createCityRendering } from './rendering'
import { createCityPicker } from './picker'
import type { CityPicker } from './picker'
import { createTraceFlows } from './trace-flows'
import type { TraceFlowController } from './trace-flows'
import { projectCityLabs } from './lab-projections'
export { projectCityLabs } from './lab-projections'
export type { CityLabProjections } from './lab-projections'

export interface CityShellOptions {
  readonly theme?: CityTheme
  readonly mode?: CityViewMode
  readonly hudExpanded?: boolean
  readonly autoStart?: boolean
  readonly inspectLab?: boolean
  /** @deprecated Use `inspectLab`. */
  readonly inspectTransactionLab?: boolean
  readonly onSelect?: (component: CityComponent | null) => void
}

export interface CityShell {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly city: TiDBSceneGraph
  readonly controls: CityCameraController
  readonly picker: CityPicker
  readonly flows: TraceFlowController
  readonly audio: CityAudio
  update(state: TiCityState, trace?: TraceReceipt | null): void
  focus(targetId: string): boolean
  setTheme(theme: CityTheme): void
  setMode(mode: CityViewMode): void
  setLabInspect(enabled: boolean): void
  /** @deprecated Use `setLabInspect`. */
  setTransactionLabInspect(enabled: boolean): void
  setHudExpanded(expanded: boolean): void
  resize(): void
  start(): void
  stop(): void
  dispose(): void
}

export function hasTraceChanged(
  previous: TraceReceipt | null,
  next: TraceReceipt | null,
): boolean {
  return previous !== next
}

export function cityViewOcclusion(width: number, expanded = true): number {
  return expanded && width > 900 ? Math.min(420, width * 0.32) : 0
}

export function cityProjectionAspect(
  width: number,
  height: number,
  expanded = true,
): number {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  return (safeWidth + cityViewOcclusion(safeWidth, expanded)) / safeHeight
}

export function cityPixelRatio(width: number, devicePixelRatio: number): number {
  const cap = width <= 900 ? 1.25 : 2
  return Math.max(1, Math.min(cap, devicePixelRatio || 1))
}

/** Keep the campus in view in portrait without changing the navigated pose. */
export function cityViewZoom(width: number, height: number): number {
  return width <= 900 ? Math.min(1, Math.max(0.35, width / Math.max(1, height) * 0.9)) : 1
}

function verticalFraming(width: number, height: number): number {
  return width > 900 ? height * 0.075 : 0
}

function measure(container: HTMLElement): readonly [number, number] {
  const width = Math.max(1, container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1))
  const height = Math.max(1, container.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 1))
  return [width, height]
}

export function createCityShell(container: HTMLElement, options: CityShellOptions = {}): CityShell {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('TiCity requires a browser DOM and WebGL2')
  }
  const [width, height] = measure(container)
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  })
  renderer.setPixelRatio(cityPixelRatio(width, window.devicePixelRatio))
  renderer.setSize(width, height, false)
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.touchAction = 'none'
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute(
    'aria-label',
    'TiCity interactive architecture. Use the view controls or keyboard to explore.',
  )
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x050b12)
  let hudExpanded = options.hudExpanded ?? true
  const initialOcclusion = cityViewOcclusion(width, hudExpanded)
  const initialFog = TICITY_LAYOUT.fog.night
  scene.fog = new THREE.Fog(0x050b12, initialFog.near, initialFog.far)

  const camera = new THREE.PerspectiveCamera(
    38,
    cityProjectionAspect(width, height, hudExpanded),
    0.3,
    4_000,
  )
  camera.position.set(...CITY_ORBIT.homePosition)
  camera.lookAt(...CITY_ORBIT.target)
  camera.zoom = cityViewZoom(width, height)
  if (initialOcclusion > 0 || width > 900) {
    camera.setViewOffset(
      width + initialOcclusion,
      height,
      initialOcclusion,
      verticalFraming(width, height),
      width,
      height,
    )
  }
  camera.updateProjectionMatrix()

  const rendering = createCityRendering(renderer, scene, camera)
  rendering.resize(width, height, cityPixelRatio(width, window.devicePixelRatio))

  const city = createTiDBSceneGraph()
  const flows = createTraceFlows(city)
  scene.add(city.root, flows.object)
  const collision = createCollisionMap(city.colliders)
  const controls = createCityCameraController({
    camera,
    dom: renderer.domElement,
    collision,
    initialMode: options.mode,
  })
  const picker = createCityPicker({
    dom: renderer.domElement,
    container,
    camera,
    city,
    onSelect: options.onSelect,
  })
  scene.add(picker.object)
  const labels = createCityLabels(container, camera, city)
  labels.setMode(options.mode ?? 'orbit')
  const audio = createCityAudio()
  let theme: CityTheme = options.theme ?? 'night'
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')

  let raf = 0
  let running = false
  let disposed = false
  let lastTime = 0
  let lastStateTick = -1
  let lastTrace: TraceReceipt | null = null
  let networkEmphasis = false
  let labInspect = options.inspectLab ?? options.inspectTransactionLab ?? false
  let labProjectionKey = ''
  const focusAnchor = new THREE.Vector3()

  function syncNetworkEmphasis(): void {
    const phase = flows.playback.phase
    const next = phase === 'playing' || phase === 'holding' || phase === 'paused'
    if (next === networkEmphasis) return
    networkEmphasis = next
    city.setNetworkEmphasis(next)
  }

  function syncDetailedLabs(): void {
    const playback = flows.playback
    const event = playback.event
    const labPulse = playback.motion === 'reduced'
      ? 0.5
      : Math.round(playback.eventProgress * 60) / 60
    const key = [
      labInspect ? 'inspect' : 'hidden',
      playback.motion,
      event?.id ?? '',
      String(labPulse),
    ].join('|')
    if (key === labProjectionKey) return
    labProjectionKey = key
    const projection = projectCityLabs(
      event,
      labInspect,
      playback.motion === 'reduced',
      labPulse,
    )
    city.transactionLab.update(projection.transaction)
    city.lockLab.update(projection.lock)
    city.raftLab.update(projection.raft)
    city.protocolLab.update(projection.protocol)
    city.gcStorageLab.update(projection.gcStorage)
    city.tiflashMppLab.update(projection.tiflashMpp)
  }

  function setTheme(next: CityTheme): void {
    theme = next
    city.setTheme(next)
    flows.setTheme(next)
    picker.setTheme(next)
    rendering.setTheme(next)
  }

  function resize(): void {
    const [nextWidth, nextHeight] = measure(container)
    const occlusion = cityViewOcclusion(nextWidth, hudExpanded)
    camera.aspect = cityProjectionAspect(nextWidth, nextHeight, hudExpanded)
    camera.zoom = cityViewZoom(nextWidth, nextHeight)
    if (occlusion > 0 || nextWidth > 900) {
      camera.setViewOffset(
        nextWidth + occlusion,
        nextHeight,
        occlusion,
        verticalFraming(nextWidth, nextHeight),
        nextWidth,
        nextHeight,
      )
    } else {
      camera.clearViewOffset()
    }
    camera.updateProjectionMatrix()
    rendering.resize(nextWidth, nextHeight, cityPixelRatio(nextWidth, window.devicePixelRatio))
    picker?.resize()
    labels.update(true)
  }

  function setMode(mode: CityViewMode): void {
    controls.setMode(mode)
    labels.setMode(mode)
    if (mode === 'walk') picker.select(null)
    resize()
  }

  function frame(time: number): void {
    if (!running || disposed) return
    const delta = lastTime === 0 ? 1 / 60 : Math.min(0.05, Math.max(0, (time - lastTime) / 1000))
    lastTime = time
    controls.update(delta)
    // Picking and cached HTML labels must project the current camera pose.
    // WebGLRenderer normally updates this later, after those consumers run.
    camera.updateMatrixWorld()
    city.updateVisuals(motionPreference.matches ? 0 : delta)
    flows.update(delta)
    syncDetailedLabs()
    syncNetworkEmphasis()
    audio.update(flows.activity)
    picker.update()
    labels.update()
    rendering.render()
    raf = window.requestAnimationFrame(frame)
  }

  function update(state: TiCityState, trace?: TraceReceipt | null): void {
    const receipt = trace === undefined ? state.lastTrace : trace
    const traceChanged = hasTraceChanged(lastTrace, receipt)
    if (state.tick !== lastStateTick || traceChanged) {
      lastStateTick = state.tick
      city.updateState(state)
      rendering.invalidateShadows()
    }
    /*
     * Model pause and trace presentation pause are intentionally separate.
     * A completed receipt remains replayable while the deterministic workload
     * is held in step mode; explicit UI actions synchronize them when wanted.
     */
    flows.setPlaybackRate(state.controls.playbackSpeed)
    if (receipt && traceChanged) {
      lastTrace = receipt
      flows.play(receipt)
    } else if (!receipt && traceChanged) {
      lastTrace = null
      flows.stop()
    }
    syncDetailedLabs()
    syncNetworkEmphasis()
  }

  function focus(targetId: string): boolean {
    if (!city.getAnchor(targetId, focusAnchor)) return false
    picker.select(city.registry.get(targetId) ? targetId : FOCUS_COMPONENT_TARGETS[targetId] ?? null)
    controls.focus(focusAnchor)
    return true
  }

  function start(): void {
    if (running || disposed) return
    running = true
    lastTime = 0
    raf = window.requestAnimationFrame(frame)
  }

  function stop(): void {
    if (!running) return
    running = false
    window.cancelAnimationFrame(raf)
    raf = 0
  }

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
  resizeObserver?.observe(container)
  window.addEventListener('resize', resize)
  resize()
  setTheme(theme)
  if (options.autoStart !== false) start()

  return {
    renderer,
    scene,
    camera,
    city,
    controls,
    picker,
    flows,
    audio,
    update,
    focus,
    setTheme,
    setMode,
    setLabInspect(enabled: boolean): void {
      if (labInspect === enabled) return
      labInspect = enabled
      labProjectionKey = ''
      syncDetailedLabs()
    },
    setTransactionLabInspect(enabled: boolean): void {
      if (labInspect === enabled) return
      labInspect = enabled
      labProjectionKey = ''
      syncDetailedLabs()
    },
    setHudExpanded(expanded: boolean): void {
      if (hudExpanded === expanded) return
      hudExpanded = expanded
      resize()
    },
    resize,
    start,
    stop,
    dispose(): void {
      if (disposed) return
      stop()
      disposed = true
      resizeObserver?.disconnect()
      window.removeEventListener('resize', resize)
      audio.dispose()
      labels.dispose()
      picker.dispose()
      controls.dispose()
      flows.dispose()
      city.dispose()
      rendering.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      scene.clear()
    },
  }
}
