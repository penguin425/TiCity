/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import type { CityTheme } from '../world/palette'

const WIDTH = 1024
const HEIGHT = 512
export const CITY_SUN_POSITION = [-240, 280, 160] as const
const SUN = new THREE.Vector3(...CITY_SUN_POSITION).normalize()
const SUN_TINT = [1, 0.91, 0.74] as const
const WINDOW_RADIANCE = [2.8, 2.2, 1.45] as const

function hash(index: number, salt: number): number {
  let value = Math.imul(index + salt, 374_761_393)
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffff_ffff
}

/**
 * Linear HDR radiance for outdoor glass and metal, authored locally rather
 * than reflecting an unrelated indoor studio. The horizon is lighting scenery,
 * not a second city, a live model projection, or an additional visible world.
 * Equirectangular V runs from the ground (-Y) to the zenith (+Y).
 */
export function createCityRadiance(theme: CityTheme): THREE.DataTexture {
  const night = theme === 'night'
  const pixels = new Uint16Array(WIDTH * HEIGHT * 4)
  // The night sky is an exposed architectural night, not an unlit physical
  // black sky: a useful amount of blue fill must still reveal the voter racks.
  const horizon = night ? [0.3, 0.47, 0.7] : [1.1, 1.2, 1.24]
  const zenith = night ? [0.08, 0.18, 0.35] : [0.34, 0.58, 0.86]
  const ground = night ? [0.075, 0.12, 0.2] : [0.21, 0.25, 0.26]
  const facade = night ? [0.065, 0.12, 0.18] : [0.3, 0.36, 0.4]

  // Reuse the angular skyline and directions across all image rows. These
  // arrays and the source image live only while the two PMREMs are baked.
  const directionX = new Float32Array(WIDTH)
  const directionZ = new Float32Array(WIDTH)
  const roof = new Float32Array(WIDTH)
  const faceShade = new Float32Array(WIDTH)
  const sectorIds = new Uint8Array(WIDTH)
  const bays = new Uint8Array(WIDTH)
  for (let x = 0; x < WIDTH; x++) {
    const u = (x + 0.5) / WIDTH
    const angle = (u - 0.5) * Math.PI * 2
    directionX[x] = Math.cos(angle)
    directionZ[x] = Math.sin(angle)
    const sector = Math.floor(u * 32)
    const local = u * 32 - sector
    const inset = Math.abs(local - 0.5)
    sectorIds[x] = sector
    bays[x] = Math.floor(local * 9)
    const height = 0.11 + hash(sector, 73) * 0.25
    roof[x] = inset > 0.38 ? 0 : height * (inset > 0.27 ? 0.78 : 1)
    faceShade[x] = 0.7 + hash(sector, 29) * 0.4 + (local < 0.45 ? 0.1 : -0.12)
  }

  for (let y = 0; y < HEIGHT; y++) {
    const elevation = ((y + 0.5) / HEIGHT - 0.5) * Math.PI
    const directionY = Math.sin(elevation)
    const horizontal = Math.cos(elevation)
    const skyMix = Math.sqrt(Math.max(0, directionY))
    const groundMix = 0.72 + 0.28 * (1 + directionY)
    const floor = Math.floor(elevation / 0.022)
    const floorFraction = elevation / 0.022 - floor
    for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 4
      const isFacade = elevation > -0.045 && elevation < roof[x] && roof[x] > 0
      const occupied = hash(sectorIds[x] * 197 + floor * 13 + bays[x], 37) > 0.72
      const lit = isFacade && night && occupied && floorFraction > 0.27 && floorFraction < 0.75
      const floorBand = floorFraction < 0.14 ? 0.76 : 1
      const sunDot = Math.max(0, horizontal * directionX[x] * SUN.x +
        directionY * SUN.y + horizontal * directionZ[x] * SUN.z)
      const glow = isFacade || directionY < 0 ? 0 : Math.pow(sunDot, 180) * (night ? 0.08 : 1.6)
      const disc = sunDot > 0.9998 && !isFacade ? (night ? 0.9 : 24) : 0
      for (let channel = 0; channel < 3; channel++) {
        let value = directionY < 0 ? ground[channel] * groundMix :
          horizon[channel] + (zenith[channel] - horizon[channel]) * skyMix
        if (isFacade) value = facade[channel] * faceShade[x] * floorBand
        if (lit) value = WINDOW_RADIANCE[channel]
        pixels[offset + channel] = THREE.DataUtils.toHalfFloat(
          value + (glow + disc) * SUN_TINT[channel],
        )
      }
      pixels[offset + 3] = 0x3c00 // Half-float 1.0.
    }
  }

  const source = new THREE.DataTexture(pixels, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType)
  source.name = `TiCity outdoor radiance: ${theme}`
  source.mapping = THREE.EquirectangularReflectionMapping
  source.colorSpace = THREE.LinearSRGBColorSpace
  source.magFilter = THREE.LinearFilter
  source.minFilter = THREE.LinearFilter
  source.needsUpdate = true
  return source
}

export interface CityReflections {
  readonly day: THREE.Texture
  readonly night: THREE.Texture
  dispose(): void
}

/** Bake once; theme switches only select an existing environment texture. */
export function createCityReflections(renderer: THREE.WebGLRenderer): CityReflections {
  const generator = new THREE.PMREMGenerator(renderer)
  const targets: THREE.WebGLRenderTarget[] = []
  try {
    for (const theme of ['day', 'night'] as const) {
      const source = createCityRadiance(theme)
      try {
        const target = generator.fromEquirectangular(source)
        target.texture.name = `TiCity outdoor reflections: ${theme}`
        targets.push(target)
      } finally {
        source.dispose()
      }
    }
  } catch (error) {
    for (const target of targets) target.dispose()
    throw error
  } finally {
    generator.dispose()
  }
  let disposed = false
  return {
    day: targets[0].texture,
    night: targets[1].texture,
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const target of targets) target.dispose()
    },
  }
}
