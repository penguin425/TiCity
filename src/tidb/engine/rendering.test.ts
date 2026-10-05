// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'

import { createCityRendering } from './rendering'

afterEach(() => vi.restoreAllMocks())

function pipeline() {
  // Real Three.js targets/materials exercise the pipeline's ownership without
  // requiring a GPU. Only the actual draw and reflection bake are replaced.
  vi.spyOn(THREE.PMREMGenerator.prototype, 'fromEquirectangular')
    .mockImplementation(() => new THREE.WebGLRenderTarget(1, 1))
  vi.spyOn(THREE.PMREMGenerator.prototype, 'dispose').mockImplementation(() => {})
  const info = { autoReset: true, render: { frame: 0 }, reset: vi.fn() }
  const renderer = {
    info,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap, autoUpdate: true, needsUpdate: false },
    capabilities: { maxSamples: 4 },
    getPixelRatio: () => 1,
    getSize: (target: THREE.Vector2) => target.set(1440, 900),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(() => { info.render.frame += 1 }),
  }
  const composerDraw = vi.spyOn(EffectComposer.prototype, 'render')
    .mockImplementation(() => { info.render.frame += 17 })
  const rendering = createCityRendering(
    renderer as unknown as THREE.WebGLRenderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
  )
  return { rendering, renderer, composerDraw }
}

describe('completed logical City render frames', () => {
  it('counts a completed composer frame once even when it submits many WebGL passes', () => {
    const { rendering, renderer, composerDraw } = pipeline()
    try {
      expect(rendering.renderedFrames).toBe(0)
      composerDraw.mockImplementation(() => {
        expect(rendering.renderedFrames).toBe(0)
        renderer.info.render.frame += 17
      })
      rendering.render()
      expect(renderer.info.render.frame).toBe(17)
      expect(rendering.renderedFrames).toBe(1)
      composerDraw.mockImplementation(() => { renderer.info.render.frame += 17 })
      rendering.render()
      expect(renderer.info.render.frame).toBe(34)
      expect(rendering.renderedFrames).toBe(2)
      expect(Reflect.set(rendering, 'renderedFrames', 999)).toBe(false)
      expect(rendering.renderedFrames).toBe(2)
    } finally {
      rendering.dispose()
    }
  })

  it('uses the same counter for compact direct renders and desktop postprocessing', () => {
    const { rendering, renderer, composerDraw } = pipeline()
    try {
      rendering.resize(390, 844, 1.25)
      rendering.setTheme('night')
      rendering.invalidateShadows()
      expect(rendering.renderedFrames).toBe(0)
      rendering.render()
      expect(renderer.render).toHaveBeenCalledTimes(1)
      expect(composerDraw).not.toHaveBeenCalled()
      expect(rendering.renderedFrames).toBe(1)
      rendering.resize(1440, 900, 2)
      expect(rendering.renderedFrames).toBe(1)
      rendering.render()
      expect(composerDraw).toHaveBeenCalledTimes(1)
      expect(renderer.info.render.frame).toBe(18)
      expect(rendering.renderedFrames).toBe(2)
    } finally {
      rendering.dispose()
    }
  })

  it('does not count partial failed renders or calls after disposal', () => {
    const { rendering, renderer, composerDraw } = pipeline()
    composerDraw.mockImplementationOnce(() => {
      renderer.info.render.frame += 3
      throw new Error('draw interrupted')
    })
    expect(() => rendering.render()).toThrow('draw interrupted')
    expect(renderer.info.render.frame).toBe(3)
    expect(rendering.renderedFrames).toBe(0)
    rendering.render()
    expect(rendering.renderedFrames).toBe(1)
    rendering.dispose()
    rendering.dispose()
    rendering.render()
    expect(rendering.renderedFrames).toBe(1)
    expect(composerDraw).toHaveBeenCalledTimes(2)
  })
})
