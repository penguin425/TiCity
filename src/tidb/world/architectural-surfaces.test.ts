/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  ARCHITECTURAL_SURFACE_SHADER_VERSION,
  applyArchitecturalSurface,
  createArchitecturalSurfaces,
} from './architectural-surfaces'
import { createCityMaterials } from './palette'

function checksum(texture: THREE.DataTexture): number {
  const data = texture.image.data as Uint8Array
  let value = 2_026
  for (const channel of data) value = Math.imul(value ^ channel, 16_777_619) >>> 0
  return value
}

describe('architectural surfaces', () => {
  it('generates stable local maps with distinct concrete, metal and glass responses', () => {
    const first = createArchitecturalSurfaces()
    const second = createArchitecturalSurfaces()

    expect(first.textures).toHaveLength(12)
    expect(new Set(first.textures).size).toBe(12)
    for (const [left, right] of [
      [first.concrete, second.concrete],
      [first.metal, second.metal],
      [first.glass, second.glass],
      [first.window, second.window],
    ] as const) {
      expect(checksum(left.color)).toBe(checksum(right.color))
      expect(checksum(left.roughness)).toBe(checksum(right.roughness))
      expect(checksum(left.bump)).toBe(checksum(right.bump))
    }
    expect(checksum(first.concrete.roughness)).not.toBe(checksum(first.metal.roughness))
    expect(first.concrete.color.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(first.concrete.roughness.colorSpace).toBe(THREE.NoColorSpace)
    expect(first.concrete.color.wrapS).toBe(THREE.RepeatWrapping)
    expect(first.concrete.color.wrapT).toBe(THREE.RepeatWrapping)

    first.dispose()
    first.dispose()
    second.dispose()
  })

  it('uses the Three MeshStandard uv_vertex contract for instanced world-space maps', () => {
    const surfaces = createArchitecturalSurfaces()
    const material = new THREE.MeshStandardMaterial()
    applyArchitecturalSurface(material, surfaces.glass, 9, 0.018)

    expect(material.map).toBe(surfaces.glass.color)
    expect(material.roughnessMap).toBe(surfaces.glass.roughness)
    expect(material.bumpMap).toBe(surfaces.glass.bump)
    expect(material.bumpScale).toBeCloseTo(0.018)
    expect(material.customProgramCacheKey()).toBe(ARCHITECTURAL_SURFACE_SHADER_VERSION)

    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      uniforms: {} as Record<string, { value: unknown }>,
    }
    const patchShader = material.onBeforeCompile as unknown as (
      parameters: { vertexShader: string; uniforms: Record<string, { value: unknown }> },
      renderer: unknown,
    ) => void
    patchShader(shader, undefined)
    expect(shader.vertexShader).toContain('#include <uv_vertex>')
    expect(shader.vertexShader).toContain('#include <defaultnormal_vertex>')
    expect(shader.vertexShader).toContain('#include <begin_vertex>')
    expect(shader.vertexShader).toContain('architecturalPosition')
    expect(shader.vertexShader).toContain('transpose(mat3(viewMatrix)) * transformedNormal')
    expect(shader.vertexShader).toContain('uArchitecturalTileSize')
    expect(shader.vertexShader).toContain('vBumpMapUv = architecturalUv')
    expect(shader.vertexShader).toContain('vRoughnessMapUv = architecturalUv')
    expect(shader.uniforms.uArchitecturalTileSize.value).toBe(9)

    const secondMaterial = new THREE.MeshStandardMaterial()
    applyArchitecturalSurface(secondMaterial, surfaces.concrete, 8, 0.11)
    expect(secondMaterial.customProgramCacheKey()).toBe(material.customProgramCacheKey())

    material.dispose()
    secondMaterial.dispose()
    surfaces.dispose()
  })

  it('switches daytime route lines to normal blending and restores additive night blending', () => {
    const materials = createCityMaterials()
    const routes = [materials.dataLine, materials.controlLine, materials.htapLine]

    expect(routes.every((material) => material.blending === THREE.AdditiveBlending)).toBe(true)
    materials.apply('day')
    expect(routes.every((material) => material.blending === THREE.NormalBlending)).toBe(true)
    materials.apply('night')
    expect(routes.every((material) => material.blending === THREE.AdditiveBlending)).toBe(true)
    materials.dispose()
  })

  it('releases generated textures exactly once through the existing materials lifecycle', () => {
    const materials = createCityMaterials()
    const textures = new Set<THREE.Texture>()
    for (const material of materials.all) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
    }
    expect(textures.size).toBe(12)
    const disposed = new Map<THREE.Texture, number>()
    for (const texture of textures) {
      disposed.set(texture, 0)
      texture.addEventListener('dispose', () => {
        disposed.set(texture, (disposed.get(texture) ?? 0) + 1)
      })
    }

    materials.dispose()
    materials.dispose()
    expect([...disposed.values()].every((count) => count === 1)).toBe(true)
  })
})
