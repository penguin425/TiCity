// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createCityRadiance, createCityReflections } from './reflections'

afterEach(() => vi.restoreAllMocks())

function sample(texture: THREE.DataTexture, u: number, v: number): number[] {
  const { width, height, data } = texture.image
  if (!data) throw new Error('Missing radiance pixels')
  const offset = (Math.min(height - 1, Math.floor(v * height)) * width +
    Math.min(width - 1, Math.floor(u * width))) * 4
  return [0, 1, 2].map((channel) => THREE.DataUtils.fromHalfFloat(data[offset + channel]))
}

describe('outdoor architectural reflections', () => {
  it('authors deterministic linear HDR lighting with a sky above the ground', () => {
    const day = createCityRadiance('day')
    const repeated = createCityRadiance('day')
    const night = createCityRadiance('night')
    const pixels = day.image.data
    const repeatedPixels = repeated.image.data
    if (!pixels || !repeatedPixels) throw new Error('Missing radiance pixels')
    expect(day.image.width).toBe(1024)
    expect(day.image.height).toBe(512)
    expect(day.image.data).toBeInstanceOf(Uint16Array)
    expect(day.type).toBe(THREE.HalfFloatType)
    expect(day.mapping).toBe(THREE.EquirectangularReflectionMapping)
    expect(day.colorSpace).toBe(THREE.LinearSRGBColorSpace)
    expect(Buffer.from(pixels.buffer).equals(Buffer.from(repeatedPixels.buffer))).toBe(true)
    const sky = sample(day, 0.2, 0.9)
    const ground = sample(day, 0.2, 0.1)
    const darkSky = sample(night, 0.2, 0.9)
    expect(sky[2]).toBeGreaterThan(ground[2] * 2)
    expect(sky[2]).toBeGreaterThan(sky[0])
    expect(sky[2]).toBeGreaterThan(darkSky[2] * 2)
    expect(darkSky[2]).toBeGreaterThan(0.3)
    let maximum = 0
    for (let index = 0; index < pixels.length; index += 4) {
      maximum = Math.max(maximum, THREE.DataUtils.fromHalfFloat(pixels[index]))
    }
    expect(maximum).toBeGreaterThan(10)
    expect(maximum).toBeLessThan(32)
    day.dispose()
    repeated.dispose()
    night.dispose()
  })

  it('bakes each theme once and releases source textures and outputs exactly once', () => {
    const sources: { name: string; disposals: number }[] = []
    const targets: THREE.WebGLRenderTarget[] = []
    const disposalCounts: number[] = []
    const bake = vi.spyOn(THREE.PMREMGenerator.prototype, 'fromEquirectangular')
      .mockImplementation((source) => {
        const entry = { name: source.name, disposals: 0 }
        source.addEventListener('dispose', () => { entry.disposals++ })
        sources.push(entry)
        const target = new THREE.WebGLRenderTarget(1, 1)
        const index = targets.length
        disposalCounts.push(0)
        target.addEventListener('dispose', () => { disposalCounts[index]++ })
        targets.push(target)
        return target
      })
    const releaseGenerator = vi.spyOn(THREE.PMREMGenerator.prototype, 'dispose')
      .mockImplementation(() => {})
    const reflections = createCityReflections({} as THREE.WebGLRenderer)
    expect(bake).toHaveBeenCalledTimes(2)
    expect(sources).toEqual([
      { name: 'TiCity outdoor radiance: day', disposals: 1 },
      { name: 'TiCity outdoor radiance: night', disposals: 1 },
    ])
    expect(reflections.day).toBe(targets[0].texture)
    expect(reflections.night).toBe(targets[1].texture)
    expect(reflections.day).not.toBe(reflections.night)
    expect(disposalCounts).toEqual([0, 0])
    expect(releaseGenerator).toHaveBeenCalledTimes(1)
    reflections.dispose()
    reflections.dispose()
    expect(disposalCounts).toEqual([1, 1])
    expect(bake).toHaveBeenCalledTimes(2)
  })

  it('releases the first output and every source when the second bake fails', () => {
    const target = new THREE.WebGLRenderTarget(1, 1)
    const releaseTarget = vi.spyOn(target, 'dispose')
    const sourceDisposals: number[] = []
    vi.spyOn(THREE.PMREMGenerator.prototype, 'fromEquirectangular')
      .mockImplementation((source) => {
        const index = sourceDisposals.length
        sourceDisposals.push(0)
        source.addEventListener('dispose', () => { sourceDisposals[index]++ })
        if (index === 1) throw new Error('PMREM bake failed')
        return target
      })
    const releaseGenerator = vi.spyOn(THREE.PMREMGenerator.prototype, 'dispose')
      .mockImplementation(() => {})
    expect(() => createCityReflections({} as THREE.WebGLRenderer)).toThrow('PMREM bake failed')
    expect(sourceDisposals).toEqual([1, 1])
    expect(releaseTarget).toHaveBeenCalledTimes(1)
    expect(releaseGenerator).toHaveBeenCalledTimes(1)
  })
})
