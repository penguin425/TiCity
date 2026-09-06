/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Small deterministic material maps, generated locally at construction time.
 * World-space projection keeps the grain and paving joints the same size on
 * every instance, regardless of the width of an avenue or garden terrace.
 */

import * as THREE from 'three'

export type CampusSurface = 'stone' | 'asphalt' | 'turf' | 'timber'

function grain(x: number, y: number, salt: number): number {
  let value = Math.imul(x + salt, 374_761_393) + Math.imul(y + salt, 668_265_263)
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffff_ffff
}

export function createCampusSurface(surface: CampusSurface): THREE.DataTexture {
  const size = 256
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fine = grain(x, y, 83)
      const broad = grain(Math.floor(x / 16), Math.floor(y / 16), 29)
      let value: number
      if (surface === 'stone') {
        const row = Math.floor(y / 64)
        const column = Math.floor(((x + row % 2 * 32) % size) / 64)
        const jointX = (x + row % 2 * 32) % 64
        const jointY = y % 64
        const slab = grain(column, row, 71) * 10
        value = jointX < 2 || jointY < 2 ? 125 + fine * 12 : 224 + slab + fine * 12
      } else if (surface === 'asphalt') {
        const aggregate = fine > 0.94 ? -32 : 0
        value = 217 + fine * 26 + broad * 6 + aggregate
      } else if (surface === 'turf') {
        const mowing = Math.floor(x / 64) % 2 * 9
        value = 205 + fine * 24 + broad * 12 + mowing
      } else {
        const wave = Math.sin(x * 0.11 + Math.sin(y * 0.025) * 2.2)
        value = 205 + wave * 15 + fine * 14
      }
      const offset = (y * size + x) * 4
      const channel = Math.max(0, Math.min(255, Math.round(value)))
      pixels[offset] = channel
      pixels[offset + 1] = channel
      pixels[offset + 2] = channel
      pixels[offset + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size)
  texture.name = `campus:${surface}`
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

export function applyCampusSurface(
  material: THREE.MeshStandardMaterial,
  texture: THREE.Texture,
  tileSize: number,
  relief: number,
): void {
  material.map = texture
  material.bumpMap = texture
  material.bumpScale = relief
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
      #include <uv_vertex>
      vec4 campusPosition = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        campusPosition = instanceMatrix * campusPosition;
      #endif
      campusPosition = modelMatrix * campusPosition;
      vec2 campusUv = campusPosition.xz / ${tileSize.toFixed(4)};
      #ifdef USE_MAP
        vMapUv = campusUv;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = campusUv;
      #endif
    `)
  }
  material.customProgramCacheKey = () => `campus-surface:${tileSize}`
}
