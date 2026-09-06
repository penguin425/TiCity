/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { CityAmbientOcclusionPass } from './ambient-occlusion'

describe('city contact shading', () => {
  it('uses half-size effect buffers without changing the full-size scene buffer', () => {
    const pass = new CityAmbientOcclusionPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 1, 1)
    pass.setSize(1441, 1001)
    expect([pass.width, pass.height]).toEqual([721, 501])
    expect([pass.gtaoRenderTarget.width, pass.pdRenderTarget.height]).toEqual([721, 501])
    pass.setSize(1, 1)
    expect([pass.width, pass.height]).toEqual([1, 1])
    pass.dispose()
  })

  it('follows the composer depth swap and never owns the borrowed depth', () => {
    const pass = new CityAmbientOcclusionPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 1, 1)
    const a = new THREE.WebGLRenderTarget(16, 16, { depthTexture: new THREE.DepthTexture(16, 16) })
    const b = a.clone()
    const renderer = {} as THREE.WebGLRenderer
    const draw = vi.spyOn(GTAOPass.prototype, 'render').mockImplementation(() => {})
    const borrowed = vi.fn()
    a.depthTexture!.addEventListener('dispose', borrowed)
    b.depthTexture!.addEventListener('dispose', borrowed)
    try {
      pass.render(renderer, a, b)
      expect(pass.depthTexture).toBe(b.depthTexture)
      expect(pass.gtaoMaterial.defines.NORMAL_VECTOR_TYPE).toBe(0)
      pass.render(renderer, b, a)
      expect(pass.depthTexture).toBe(a.depthTexture)
      expect(draw).toHaveBeenCalledTimes(2)
      pass.dispose()
      expect(borrowed).not.toHaveBeenCalled()
    } finally {
      draw.mockRestore()
      pass.dispose()
      a.dispose()
      b.dispose()
    }
  })

  it('releases AO shaders, denoise targets and noise exactly once', () => {
    const pass = new CityAmbientOcclusionPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 1, 1)
    const resources = [pass.gtaoMaterial, pass.blendMaterial, pass.pdMaterial,
      pass.copyMaterial, pass.depthRenderMaterial, pass.normalMaterial,
      pass.gtaoRenderTarget, pass.pdRenderTarget, pass.gtaoNoiseTexture, pass.pdNoiseTexture]
    const counts = resources.map((resource) => {
      const listener = vi.fn()
      resource.addEventListener('dispose', listener)
      return listener
    })
    pass.dispose()
    pass.dispose()
    for (const listener of counts) expect(listener).toHaveBeenCalledTimes(1)
  })
})
