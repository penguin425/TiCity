/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { TiCityState, TraceReceipt } from '../model/types'
import { FOCUS_COMPONENT_TARGETS, TICITY_LAYOUT } from '../world/layout'
import { createTiDBSceneGraph } from '../world/city'
import type { CityComponent, TiDBSceneGraph } from '../world/city'
import type { CityTheme } from '../world/palette'
import { createCityAudio } from './audio'
import type { CityAudio } from './audio'
import { createCityCameraController } from './camera'
import type { CityCameraController, CityViewMode } from './camera'
import { createCollisionMap } from './collision'
import { createCityLabels } from './labels'
import { createCityPicker } from './picker'
import type { CityPicker } from './picker'
import { createTraceFlows } from './trace-flows'
import type { TraceFlowController } from './trace-flows'

export interface CityShellOptions {
  readonly theme?: CityTheme
  readonly mode?: CityViewMode
  readonly hudExpanded?: boolean
  readonly autoStart?: boolean
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

export function cityPixelRatio(width: number, devicePixelRatio: number): number {
  const cap = width <= 900 ? 1.25 : 1.5
  return Math.max(1, Math.min(cap, devicePixelRatio || 1))
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
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
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
  scene.fog = new THREE.Fog(0x050b12, TICITY_LAYOUT.fog.near, TICITY_LAYOUT.fog.far)

  const camera = new THREE.PerspectiveCamera(52, width / height, 0.3, 2200)
  camera.position.set(0, 305, 555)
  camera.lookAt(0, 12, 25)
  let hudExpanded = options.hudExpanded ?? true
  const initialOcclusion = cityViewOcclusion(width, hudExpanded)
  if (initialOcclusion > 0) {
    camera.setViewOffset(
      width + initialOcclusion,
      height,
      initialOcclusion,
      0,
      width,
      height,
    )
  }

  const hemisphere = new THREE.HemisphereLight(0x91b8db, 0x0a1018, 1.05)
  const ambient = new THREE.AmbientLight(0x6b9fc2, 0.62)
  const key = new THREE.DirectionalLight(0xc8e4ff, 2.1)
  key.position.set(180, 300, -160)
  key.target.position.set(0, 0, 30)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.left = -330
  key.shadow.camera.right = 330
  key.shadow.camera.top = 330
  key.shadow.camera.bottom = -330
  key.shadow.camera.near = 20
  key.shadow.camera.far = 760
  key.shadow.bias = -0.00045
  key.shadow.normalBias = 0.42
  const fill = new THREE.DirectionalLight(0x6f9fd0, 0.42)
  fill.position.set(-280, 170, 260)
  fill.target.position.set(0, 16, 10)
  scene.add(hemisphere, ambient, key, key.target, fill, fill.target)

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
  const audio = createCityAudio()
  const composer = new EffectComposer(renderer)
  composer.setPixelRatio(cityPixelRatio(width, window.devicePixelRatio))
  composer.setSize(width, height)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.34, 0.38, 0.9)
  const outputPass = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(outputPass)

  let theme: CityTheme = options.theme ?? 'night'
  let viewportWidth = width
  let postProcessing = false
  let raf = 0
  let running = false
  let disposed = false
  let lastTime = 0
  let lastStateTick = -1
  let lastTrace: TraceReceipt | null = null
  let networkEmphasis = false
  const focusAnchor = new THREE.Vector3()

  function syncNetworkEmphasis(): void {
    const phase = flows.playback.phase
    const next = phase === 'playing' || phase === 'paused'
    if (next === networkEmphasis) return
    networkEmphasis = next
    city.setNetworkEmphasis(next)
  }

  function setTheme(next: CityTheme): void {
    theme = next
    city.setTheme(next)
    flows.setTheme(next)
    picker.setTheme(next)
    const night = next === 'night'
    if (scene.background instanceof THREE.Color) {
      scene.background.setHex(night ? 0x050b12 : 0xc7d6e2)
    }
    if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(night ? 0x050b12 : 0xc7d6e2)
    hemisphere.color.setHex(night ? 0x91b8db : 0xd9efff)
    hemisphere.groundColor.setHex(night ? 0x0a1018 : 0x71806e)
    hemisphere.intensity = night ? 1.05 : 1.32
    ambient.color.setHex(night ? 0x6b9fc2 : 0xffffff)
    ambient.intensity = night ? 0.54 : 0.3
    key.color.setHex(night ? 0xc8e4ff : 0xfff0cf)
    key.intensity = night ? 2.35 : 3.25
    key.castShadow = !night
    fill.color.setHex(night ? 0x557fb8 : 0x97bce2)
    fill.intensity = night ? 0.62 : 0.46
    renderer.shadowMap.enabled = !night
    renderer.toneMapping = night ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping
    renderer.toneMappingExposure = night ? 1.18 : 0.98
    bloomPass.enabled = night
    postProcessing =
      night &&
      viewportWidth > 900 &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function resize(): void {
    const [nextWidth, nextHeight] = measure(container)
    viewportWidth = nextWidth
    camera.aspect = nextWidth / nextHeight
    const occlusion = cityViewOcclusion(nextWidth, hudExpanded)
    if (occlusion > 0) {
      camera.setViewOffset(
        nextWidth + occlusion,
        nextHeight,
        occlusion,
        0,
        nextWidth,
        nextHeight,
      )
    } else {
      camera.clearViewOffset()
    }
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(cityPixelRatio(nextWidth, window.devicePixelRatio))
    renderer.setSize(nextWidth, nextHeight, false)
    composer.setPixelRatio(cityPixelRatio(nextWidth, window.devicePixelRatio))
    composer.setSize(nextWidth, nextHeight)
    postProcessing =
      theme === 'night' &&
      nextWidth > 900 &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    picker?.resize()
    labels.update(true)
  }

  function frame(time: number): void {
    if (!running || disposed) return
    const delta = lastTime === 0 ? 1 / 60 : Math.min(0.05, Math.max(0, (time - lastTime) / 1000))
    lastTime = time
    controls.update(delta)
    city.updateVisuals(delta)
    flows.update(delta)
    syncNetworkEmphasis()
    audio.update(flows.activity)
    picker.update()
    labels.update()
    if (postProcessing) composer.render()
    else renderer.render(scene, camera)
    raf = window.requestAnimationFrame(frame)
  }

  function update(state: TiCityState, trace?: TraceReceipt | null): void {
    const receipt = trace === undefined ? state.lastTrace : trace
    const traceChanged = hasTraceChanged(lastTrace, receipt)
    if (state.tick !== lastStateTick || traceChanged) {
      lastStateTick = state.tick
      city.updateState(state)
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
    setMode(mode: CityViewMode): void {
      controls.setMode(mode)
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
      composer.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      scene.clear()
    },
  }
}
