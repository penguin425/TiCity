/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Deterministic, local architectural surface maps.  The maps are deliberately
 * small and shared by the existing CityMaterials so close views gain joints,
 * grain and a restrained relief without adding a material or draw call.
 */

import * as THREE from 'three'

export type ArchitecturalSurface = 'concrete' | 'metal' | 'glass' | 'window'

export interface ArchitecturalSurfaceMaps {
  readonly color: THREE.DataTexture
  readonly roughness: THREE.DataTexture
  readonly bump: THREE.DataTexture
  readonly textures: readonly [THREE.DataTexture, THREE.DataTexture, THREE.DataTexture]
}

export interface ArchitecturalSurfaces {
  readonly concrete: ArchitecturalSurfaceMaps
  readonly metal: ArchitecturalSurfaceMaps
  readonly glass: ArchitecturalSurfaceMaps
  readonly window: ArchitecturalSurfaceMaps
  readonly textures: readonly THREE.DataTexture[]
  dispose(): void
}

export const ARCHITECTURAL_SURFACE_SIZE = 256
/** Keep every architectural material on one shared shader program variant. */
export const ARCHITECTURAL_SURFACE_SHADER_VERSION = 'architectural-surface-v2'

type SurfaceMapKind = 'color' | 'roughness' | 'bump'

function hash(x: number, y: number, salt: number): number {
  let value = Math.imul(x + salt, 374_761_393) ^ Math.imul(y + salt * 3, 668_265_263)
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffff_ffff
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function setPixel(pixels: Uint8Array, offset: number, value: number): void {
  const channel = clampByte(value)
  pixels[offset] = channel
  pixels[offset + 1] = channel
  pixels[offset + 2] = channel
  pixels[offset + 3] = 255
}

function setColorPixel(
  pixels: Uint8Array,
  offset: number,
  red: number,
  green: number,
  blue: number,
): void {
  pixels[offset] = clampByte(red)
  pixels[offset + 1] = clampByte(green)
  pixels[offset + 2] = clampByte(blue)
  pixels[offset + 3] = 255
}

function createTexture(
  pixels: Uint8Array,
  surface: ArchitecturalSurface,
  kind: SurfaceMapKind,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    pixels,
    ARCHITECTURAL_SURFACE_SIZE,
    ARCHITECTURAL_SURFACE_SIZE,
    THREE.RGBAFormat,
  )
  texture.name = `architectural:${surface}:${kind}`
  // Only the albedo map is colour data.  Roughness and height are sampled as
  // linear values by MeshStandardMaterial's roughness/bump chunks.
  if (kind === 'color') texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

function createSurfaceMaps(surface: ArchitecturalSurface): ArchitecturalSurfaceMaps {
  const colorPixels = new Uint8Array(ARCHITECTURAL_SURFACE_SIZE ** 2 * 4)
  const roughnessPixels = new Uint8Array(ARCHITECTURAL_SURFACE_SIZE ** 2 * 4)
  const bumpPixels = new Uint8Array(ARCHITECTURAL_SURFACE_SIZE ** 2 * 4)

  for (let y = 0; y < ARCHITECTURAL_SURFACE_SIZE; y++) {
    for (let x = 0; x < ARCHITECTURAL_SURFACE_SIZE; x++) {
      const fine = hash(x, y, 17)
      const grain = hash(Math.floor(x / 4), Math.floor(y / 4), 31)
      const broad = hash(Math.floor(x / 24), Math.floor(y / 24), 47)
      const offset = (y * ARCHITECTURAL_SURFACE_SIZE + x) * 4
      const panelX = x % 64
      const panelY = y % 64
      const horizontalJoint = panelY < 2
      const verticalJoint = panelX < 2
      const joint = horizontalJoint || verticalJoint
      let colorRed = 240
      let colorGreen = 240
      let colorBlue = 240
      let roughness = 160
      let bump = 128

      if (surface === 'concrete') {
        // Formwork-sized slabs and quiet mineral variation read as concrete at
        // overview scale; the narrow joints remain visible in a close-up.
        const mottling = (broad - 0.5) * 22 + (grain - 0.5) * 10
        const slab = joint ? 142 + fine * 18 : 238 + mottling + fine * 6
        colorRed = slab + 3
        colorGreen = slab + 4
        colorBlue = slab + 2
        roughness = joint ? 218 + fine * 12 : 178 + broad * 42 + grain * 16
        bump = joint ? 76 + fine * 18 : 119 + broad * 18 + grain * 12
      } else if (surface === 'metal') {
        // Brushed metal has elongated deterministic grain and darker seams at
        // panel boundaries, making louvers and roof plant less like flat bars.
        const brush = 0.5 + 0.5 * Math.sin(y * 0.48 + broad * 5.2)
        const mottling = (grain - 0.5) * 18 + (broad - 0.5) * 14
        const panel = joint ? 116 + fine * 14 : 202 + brush * 28 + mottling
        colorRed = panel * 0.9
        colorGreen = panel * 0.96
        colorBlue = panel
        roughness = joint ? 125 + fine * 20 : 72 + (1 - brush) * 48 + grain * 20
        bump = joint ? 88 + fine * 16 : 118 + brush * 24 + grain * 12
      } else if (surface === 'glass') {
        // Keep albedo almost neutral: outdoor reflection should describe the
        // pane, while only a very broad, low-contrast streak keeps it from
        // reading as an untextured solid colour.
        const reflection = 0.5 + 0.5 * Math.sin(x * 0.045 + broad * 1.8)
        const streak = 0.5 + 0.5 * Math.sin(y * 0.025 + grain * 1.4)
        const panel = 238 + reflection * 4 + streak * 2 + (fine - 0.5) * 1.5
        colorRed = panel * 0.96
        colorGreen = panel * 0.99
        colorBlue = panel
        roughness = 34 + (1 - reflection) * 14 + grain * 5
        bump = 127 + (reflection - 0.5) * 2 + (fine - 0.5) * 2
      } else {
        // Window panes are brighter than the general curtain wall, but retain
        // a small amount of rolled-glass variation for lit and unlit bays.
        const reflection = 0.5 + 0.5 * Math.sin(x * 0.11 + broad * 3.7)
        const panel = 231 + reflection * 15 + (fine - 0.5) * 7
        colorRed = panel * 0.92
        colorGreen = panel * 0.99
        colorBlue = panel
        roughness = 42 + (1 - reflection) * 36 + grain * 18
        bump = 124 + (reflection - 0.5) * 8 + (fine - 0.5) * 7
      }

      setColorPixel(colorPixels, offset, colorRed, colorGreen, colorBlue)
      setPixel(roughnessPixels, offset, roughness)
      setPixel(bumpPixels, offset, bump)
    }
  }

  const color = createTexture(colorPixels, surface, 'color')
  const roughness = createTexture(roughnessPixels, surface, 'roughness')
  const bump = createTexture(bumpPixels, surface, 'bump')
  return { color, roughness, bump, textures: [color, roughness, bump] }
}

/**
 * Build all architectural maps locally from fixed integer hashes.  No image
 * fetches or runtime random state are involved, so every scene gets identical
 * surfaces for the same source revision.
 */
export function createArchitecturalSurfaces(): ArchitecturalSurfaces {
  const concrete = createSurfaceMaps('concrete')
  const metal = createSurfaceMaps('metal')
  const glass = createSurfaceMaps('glass')
  const window = createSurfaceMaps('window')
  const textures: readonly THREE.DataTexture[] = [
    ...concrete.textures,
    ...metal.textures,
    ...glass.textures,
    ...window.textures,
  ]
  let disposed = false

  return {
    concrete,
    metal,
    glass,
    window,
    textures,
    dispose(): void {
      if (disposed) return
      disposed = true
      // The set is intentional: this remains exactly-once if a future
      // material assignment shares one of these maps between surface classes.
      const unique = new Set<THREE.Texture>(textures)
      for (const texture of unique) texture.dispose()
    },
  }
}

/**
 * Use a world-space, normal-aware projection so one texture scale is shared by
 * boxes and InstancedMesh details.  The shader patch follows Three 0.185's
 * `uv_vertex` and `defaultnormal_vertex` chunks.  Standard UV assignments,
 * map, roughnessMap and bumpMap fragment chunks remain renderer-owned.
 */
export function applyArchitecturalSurface(
  material: THREE.MeshStandardMaterial,
  surface: ArchitecturalSurfaceMaps,
  tileSize: number,
  bumpScale: number,
): void {
  if (!(tileSize > 0) || !Number.isFinite(tileSize)) {
    throw new Error(`architectural surface tileSize must be positive: ${tileSize}`)
  }
  if (!(bumpScale >= 0) || !Number.isFinite(bumpScale)) {
    throw new Error(`architectural surface bumpScale must be non-negative: ${bumpScale}`)
  }

  material.map = surface.color
  material.roughnessMap = surface.roughness
  material.bumpMap = surface.bump
  material.bumpScale = bumpScale
  material.onBeforeCompile = (shader) => {
    const uvChunk = '#include <uv_vertex>'
    const normalChunk = '#include <defaultnormal_vertex>'
    const positionChunk = '#include <begin_vertex>'
    const mainToken = 'void main() {'
    const projection = /* glsl */ `
      // defaultnormal_vertex has already applied Three's batching and
      // instance inverse-scale correction, then transformed the normal into
      // view space with normalMatrix.  The transpose of viewMatrix is the
      // inverse camera rotation, so this recovers the world-space orientation
      // without reimplementing a non-uniform model/instance normal matrix.
      vec3 architecturalNormal = normalize(transpose(mat3(viewMatrix)) * transformedNormal);
      // begin_vertex has initialized transformed; mirror the transforms
      // that Three applies later in project_vertex for this map projection.
      vec4 architecturalPosition = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        architecturalPosition = batchingMatrix * architecturalPosition;
      #endif
      #ifdef USE_INSTANCING
        architecturalPosition = instanceMatrix * architecturalPosition;
      #endif
      architecturalPosition = modelMatrix * architecturalPosition;
      vec3 architecturalAbsNormal = abs(architecturalNormal);
      vec2 architecturalUv;
      if (architecturalAbsNormal.y >= architecturalAbsNormal.x && architecturalAbsNormal.y >= architecturalAbsNormal.z) {
        architecturalUv = architecturalPosition.xz / uArchitecturalTileSize;
      } else if (architecturalAbsNormal.x >= architecturalAbsNormal.z) {
        architecturalUv = architecturalPosition.zy / uArchitecturalTileSize;
      } else {
        architecturalUv = architecturalPosition.xy / uArchitecturalTileSize;
      }
      #ifdef USE_MAP
        vMapUv = architecturalUv;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = architecturalUv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = architecturalUv;
      #endif
    `
    if (!shader.vertexShader.includes(uvChunk)
      || !shader.vertexShader.includes(normalChunk)
      || !shader.vertexShader.includes(positionChunk)) {
      throw new Error('Three MeshStandard vertex shader no longer exposes required UV/normal chunks')
    }
    if (!shader.vertexShader.includes(mainToken)) {
      throw new Error('Three MeshStandard vertex shader no longer exposes main()')
    }
    shader.uniforms.uArchitecturalTileSize = { value: tileSize }
    // Keep the stock UV chunk intact so vUv and any future mapped channels are
    // initialized before the architectural projection overrides only the maps
    // owned here.  The projection is inserted after transformedNormal and
    // transformed both exist.
    shader.vertexShader = shader.vertexShader.replace(
      mainToken,
      `uniform float uArchitecturalTileSize;\n\n${mainToken}`,
    )
    shader.vertexShader = shader.vertexShader.replace(positionChunk, `${positionChunk}\n${projection}`)
  }
  material.customProgramCacheKey = () => ARCHITECTURAL_SURFACE_SHADER_VERSION
  // Assigning a map after construction changes USE_* defines in Three's
  // material program.  Marking it dirty is construction-time only and never a
  // per-frame allocation or update.
  material.needsUpdate = true
}
