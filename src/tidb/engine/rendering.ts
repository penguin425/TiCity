/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { CityAppearance } from '../appearance'
import { TICITY_LAYOUT } from '../world/layout'
import type { CityTheme } from '../world/palette'
import { CityAmbientOcclusionPass } from './ambient-occlusion'
import { CITY_SUN_POSITION, createCityReflections } from './reflections'

/** Owns lighting, offscreen targets and output conversion as one lifecycle. */
export interface CityRendering {
  /** Completed City renders, independent of Three.js postprocessing passes. */
  readonly renderedFrames: number
  setTheme(theme: CityTheme, appearance?: CityAppearance): void
  resize(width: number, height: number, pixelRatio: number): void
  invalidateShadows(): void
  render(): void
  dispose(): void
}

export function createCityRendering(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): CityRendering {
  const hemisphere = new THREE.HemisphereLight()
  const ambient = new THREE.AmbientLight()
  const sun = new THREE.DirectionalLight()
  sun.position.set(...CITY_SUN_POSITION)
  sun.target.position.set(0, 0, 20)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  // Cover the diagonal campus, including the perimeter's instanced trees and
  // skyline. The 4K map retains ~0.24m texels across this full-width frustum.
  sun.shadow.camera.left = -500
  sun.shadow.camera.right = 500
  sun.shadow.camera.top = 420
  sun.shadow.camera.bottom = -420
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 950
  sun.shadow.bias = -0.00015
  sun.shadow.normalBias = 0.12
  sun.shadow.radius = 2
  const rim = new THREE.DirectionalLight()
  rim.position.set(220, 160, -240)
  scene.add(hemisphere, ambient, sun, sun.target, rim, rim.target)

  // Outdoor sky, horizon and soft sun reflections suit the campus architecture.
  // Both themes are baked once, without fetching an HDR or drawing extra scenery.
  const reflections = createCityReflections(renderer)
  scene.environment = reflections.day

  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  // Buildings are static; update their shadow only when the projection changes.
  renderer.shadowMap.autoUpdate = false
  renderer.info.autoReset = false

  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: Math.min(4, renderer.capabilities.maxSamples),
    stencilBuffer: false,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  })
  target.texture.name = 'TiCity HDR color'
  const composer = new EffectComposer(renderer, target)
  const renderPass = new RenderPass(scene, camera)
  const occlusion = new CityAmbientOcclusionPass(scene, camera, 1, 1)
  occlusion.updateGtaoMaterial({ radius: 5, thickness: 2, distanceFallOff: 0.8, samples: 8 })
  occlusion.updatePdMaterial({ radius: 4, samples: 8, depthPhi: 1.5 })
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.35, 1.15)
  const output = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(occlusion)
  composer.addPass(bloom)
  composer.addPass(output)

  let theme: CityTheme = 'day'
  let wideViewport = true
  let disposed = false
  let renderedFrames = 0

  function setTheme(next: CityTheme, appearance: CityAppearance = 'classic'): void {
    theme = next
    const night = next === 'night'
    const fresh = appearance === 'tidb'
    const background = fresh
      ? (night ? 0x0b2238 : 0xd8eff1)
      : (night ? 0x071425 : 0xc2dce8)
    if (scene.background instanceof THREE.Color) scene.background.setHex(background)
    else scene.background = new THREE.Color(background)
    const fog = TICITY_LAYOUT.fog[next]
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.setHex(background)
      scene.fog.near = fog.near
      scene.fog.far = fog.far
    } else scene.fog = new THREE.Fog(background, fog.near, fog.far)
    hemisphere.color.setHex(night ? 0x9bbfe5 : 0xc4ddff)
    hemisphere.groundColor.setHex(night ? 0x162337 : 0x746d60)
    hemisphere.intensity = night ? 0.7 : 0.6
    ambient.color.setHex(night ? 0x7397bd : 0xfff5e7)
    ambient.intensity = night ? 0.16 : 0.06
    sun.color.setHex(night ? 0xb1d0fa : 0xffe2bb)
    sun.intensity = night ? 1.7 : 3.6
    rim.color.setHex(night ? 0x5b83ca : 0xb8d9ff)
    rim.intensity = night ? 0.7 : 0.65
    scene.environment = reflections[next]
    scene.environmentIntensity = night ? 1.1 : 0.85
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = night ? 1.1 : 0.94
    occlusion.blendIntensity = night ? 0.6 : 0.85
    bloom.enabled = night

    if (fresh) {
      // Neutral daylight keeps white architecture and pale blue glass clear;
      // the same baked outdoor reflections serve both appearance palettes.
      hemisphere.color.setHex(night ? 0xa5cee9 : 0xd6efff)
      hemisphere.groundColor.setHex(night ? 0x183c46 : 0x9eaaa0)
      ambient.color.setHex(night ? 0x86b1cb : 0xf4ffff)
      sun.color.setHex(night ? 0xc3ddff : 0xf1fbff)
      sun.intensity = night ? 1.7 : 3.1
      rim.color.setHex(night ? 0x679dcb : 0xc2e5ff)
    }
    renderer.shadowMap.needsUpdate = true
  }

  setTheme(theme)

  return {
    get renderedFrames(): number { return renderedFrames },
    setTheme,
    resize(width, height, pixelRatio): void {
      wideViewport = width > 900
      const shadowSize = wideViewport ? 4096 : 2048
      if (sun.shadow.mapSize.x !== shadowSize) {
        sun.shadow.mapSize.set(shadowSize, shadowSize)
        sun.shadow.map?.dispose()
        sun.shadow.map = null
        renderer.shadowMap.needsUpdate = true
      }
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      composer.setPixelRatio(pixelRatio)
      composer.setSize(width, height)
    },
    invalidateShadows(): void {
      renderer.shadowMap.needsUpdate = true
    },
    render(): void {
      if (disposed) return
      // Counters describe the entire frame, including postprocessing passes.
      renderer.info.reset()
      if (wideViewport) composer.render()
      else renderer.render(scene, camera)
      // WebGLRenderer.info.render.frame increases for each render pass (Three
      // r185 WebGLRenderer.js), not once for an EffectComposer frame. Count
      // only after the whole City render completes successfully.
      renderedFrames += 1
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      bloom.dispose()
      // Three r185 does not include the bright-area extraction shader in
      // UnrealBloomPass.dispose(); it is still owned by this pipeline.
      bloom.materialHighPassFilter.dispose()
      occlusion.dispose()
      output.dispose()
      renderPass.dispose()
      composer.dispose()
      reflections.dispose()
      sun.shadow.dispose()
      scene.environment = null
      scene.remove(hemisphere, ambient, sun, sun.target, rim, rim.target)
    },
  }
}
