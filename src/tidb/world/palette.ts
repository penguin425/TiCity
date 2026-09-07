/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import {
  applyArchitecturalSurface,
  createArchitecturalSurfaces,
} from './architectural-surfaces'

export type CityTheme = 'day' | 'night'
export type SemanticDomain =
  | 'structure'
  | 'client'
  | 'sql'
  | 'tso'
  | 'txn2pc'
  | 'raft'
  | 'kv'
  | 'gc'
  | 'tiflash'
  | 'return'
  | 'fault'

export const SEMANTIC_COLORS: Record<CityTheme, Record<SemanticDomain, number>> = {
  night: {
    structure: 0x18283a,
    client: 0x5ee7ff,
    sql: 0x20d9c2,
    tso: 0xffd166,
    txn2pc: 0xe28cff,
    raft: 0xff7a59,
    kv: 0x64e572,
    gc: 0xb6c2cf,
    tiflash: 0x49a7ff,
    return: 0xf7fbff,
    fault: 0xff365f,
  },
  day: {
    structure: 0xd7e0e8,
    client: 0x087b96,
    sql: 0x007f70,
    tso: 0x9b6400,
    txn2pc: 0x8b2dab,
    raft: 0xc03616,
    kv: 0x168431,
    gc: 0x526271,
    tiflash: 0x176cbb,
    return: 0x263746,
    fault: 0xb81434,
  },
}

export interface CityMaterials {
  readonly structure: THREE.MeshStandardMaterial
  readonly darkStructure: THREE.MeshStandardMaterial
  readonly pavement: THREE.MeshStandardMaterial
  readonly glass: THREE.MeshStandardMaterial
  readonly window: THREE.MeshStandardMaterial
  readonly trim: THREE.MeshStandardMaterial
  readonly edge: THREE.LineBasicMaterial
  readonly client: THREE.MeshStandardMaterial
  readonly sql: THREE.MeshStandardMaterial
  readonly tso: THREE.MeshStandardMaterial
  readonly txn2pc: THREE.MeshStandardMaterial
  readonly raft: THREE.LineBasicMaterial
  readonly kv: THREE.MeshStandardMaterial
  readonly gc: THREE.MeshStandardMaterial
  readonly tiflash: THREE.MeshStandardMaterial
  readonly dataLine: THREE.LineBasicMaterial
  readonly controlLine: THREE.LineDashedMaterial
  readonly htapLine: THREE.LineDashedMaterial
  readonly ground: THREE.MeshStandardMaterial
  readonly all: readonly THREE.Material[]
  apply(theme: CityTheme): void
  setNetworkEmphasis(active: boolean): void
  dispose(): void
}

const NETWORK_OPACITY: Readonly<
  Record<
    CityTheme,
    Readonly<Record<'raft' | 'data' | 'control' | 'htap', number>>
  >
> = {
  night: {
    raft: 0.34,
    data: 0.74,
    control: 0.68,
    htap: 0.7,
  },
  day: {
    raft: 0.48,
    data: 0.74,
    control: 0.68,
    htap: 0.7,
  },
}

/** Leave the topology readable without competing with a foreground trace. */
const EMPHASIZED_NETWORK_OPACITY_FACTOR = 0.14

function semanticMaterial(domain: SemanticDomain): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night[domain],
    emissive: SEMANTIC_COLORS.night[domain],
    emissiveIntensity: 0.28,
    roughness: 0.55,
    metalness: 0.24,
  })
}

export function createCityMaterials(): CityMaterials {
  const structure = new THREE.MeshStandardMaterial({
    color: 0x405966,
    roughness: 0.75,
    metalness: 0.08,
  })
  const darkStructure = new THREE.MeshStandardMaterial({
    color: 0x263e4c,
    roughness: 0.38,
    metalness: 0.58,
  })
  const pavement = new THREE.MeshStandardMaterial({
    color: 0x293e50,
    roughness: 0.96,
    metalness: 0,
  })
  const glass = new THREE.MeshStandardMaterial({
    color: 0x8fd8ff,
    emissive: 0x1e6d96,
    emissiveIntensity: 0.25,
    roughness: 0.12,
    metalness: 0.65,
  })
  const window = new THREE.MeshStandardMaterial({
    color: 0xa7d3db,
    emissive: 0x79c2d4,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.4,
  })
  const trim = new THREE.MeshStandardMaterial({
    color: 0x6f879c,
    roughness: 0.3,
    metalness: 0.75,
  })
  const edge = new THREE.LineBasicMaterial({
    depthWrite: false,
    color: 0x5ccff0,
    transparent: true,
    opacity: 0.28,
    toneMapped: false,
  })
  const client = semanticMaterial('client')
  const sql = semanticMaterial('sql')
  const tso = semanticMaterial('tso')
  const txn2pc = semanticMaterial('txn2pc')
  const kv = semanticMaterial('kv')
  const gc = semanticMaterial('gc')
  const tiflash = semanticMaterial('tiflash')
  const raft = new THREE.LineBasicMaterial({
    depthWrite: false,
    color: SEMANTIC_COLORS.night.raft,
    transparent: true,
    opacity: 0.34,
    toneMapped: false,
  })
  const dataLine = new THREE.LineBasicMaterial({
    depthWrite: false,
    color: SEMANTIC_COLORS.night.sql,
    transparent: true,
    opacity: 0.74,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const controlLine = new THREE.LineDashedMaterial({
    depthWrite: false,
    color: SEMANTIC_COLORS.night.tso,
    transparent: true,
    opacity: 0.68,
    dashSize: 3,
    gapSize: 2,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const htapLine = new THREE.LineDashedMaterial({
    depthWrite: false,
    color: SEMANTIC_COLORS.night.tiflash,
    transparent: true,
    opacity: 0.7,
    dashSize: 4,
    gapSize: 2,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const ground = new THREE.MeshStandardMaterial({
    color: 0x07101a,
    roughness: 1,
    metalness: 0,
  })

  // Keep the public palette small: architectural variation is carried by
  // shared local maps on these existing five materials rather than by adding
  // per-building materials.  World-space projection keeps panel seams and
  // grain aligned across both regular meshes and detail InstancedMesh batches.
  const architecturalSurfaces = createArchitecturalSurfaces()
  applyArchitecturalSurface(structure, architecturalSurfaces.concrete, 8, 0.11)
  applyArchitecturalSurface(darkStructure, architecturalSurfaces.metal, 5, 0.075)
  applyArchitecturalSurface(glass, architecturalSurfaces.glass, 9, 0.018)
  applyArchitecturalSurface(window, architecturalSurfaces.window, 7, 0.016)
  applyArchitecturalSurface(trim, architecturalSurfaces.metal, 2.8, 0.055)

  const all: readonly THREE.Material[] = [
    structure,
    darkStructure,
    pavement,
    glass,
    window,
    trim,
    edge,
    client,
    sql,
    tso,
    txn2pc,
    kv,
    gc,
    tiflash,
    raft,
    dataLine,
    controlLine,
    htapLine,
    ground,
  ]

  let currentTheme: CityTheme = 'night'
  let networkEmphasis = false
  let disposed = false

  function applyNetworkOpacity(): void {
    const opacity = NETWORK_OPACITY[currentTheme]
    const factor = networkEmphasis ? EMPHASIZED_NETWORK_OPACITY_FACTOR : 1
    raft.opacity = opacity.raft * factor
    dataLine.opacity = opacity.data * factor
    controlLine.opacity = opacity.control * factor
    htapLine.opacity = opacity.htap * factor
  }

  function apply(theme: CityTheme): void {
    currentTheme = theme
    const palette = SEMANTIC_COLORS[theme]
    const night = theme === 'night'
    structure.color.setHex(night ? 0x69818c : 0xd2d1c7)
    darkStructure.color.setHex(night ? 0x203647 : 0x253e4b)
    pavement.color.setHex(night ? 0x293e50 : 0x8b9595)
    // The old daytime 0x16485e glass read as an almost opaque navy box.  Keep
    // the semantic cool palette, but lift the base so local reflections and
    // the generated panel variation can be seen in a bright campus scene.
    glass.color.setHex(night ? 0x42647a : 0x4c7f8e)
    glass.emissive.setHex(night ? 0x1e6d96 : 0x000000)
    glass.emissiveIntensity = night ? 0.25 : 0
    window.color.setHex(night ? 0xb4cfd5 : 0x7ca9af)
    window.emissive.setHex(night ? 0xb0d6de : 0x000000)
    window.emissiveIntensity = night ? 0.7 : 0
    trim.color.setHex(night ? 0x91a7b6 : 0xb9c0bb)
    edge.color.setHex(night ? 0x5ccff0 : 0x324b5a)
    edge.opacity = night ? 0.18 : 0.15
    ground.color.setHex(night ? 0x07101a : 0x919fa7)

    const semantic: readonly [THREE.MeshStandardMaterial, SemanticDomain][] = [
      [client, 'client'],
      [sql, 'sql'],
      [tso, 'tso'],
      [txn2pc, 'txn2pc'],
      [kv, 'kv'],
      [gc, 'gc'],
      [tiflash, 'tiflash'],
    ]
    for (const [material, domain] of semantic) {
      material.color.setHex(palette[domain])
      material.emissive.setHex(night ? palette[domain] : 0x000000)
      material.emissiveIntensity = night ? 0.28 : 0
    }
    // Columnar halls read as architecture; blue accents identify their role
    // without turning every wall into a light source.
    tiflash.color.setHex(night ? 0x385a74 : 0x325b73)
    tiflash.emissive.setHex(night ? 0x143046 : 0x000000)
    tiflash.emissiveIntensity = night ? 0.14 : 0
    raft.color.setHex(palette.raft)
    dataLine.color.setHex(palette.sql)
    controlLine.color.setHex(palette.tso)
    htapLine.color.setHex(palette.tiflash)
    // Additive lines are legible against the dark night ground, but they
    // saturate on the bright daytime campus.  Switch the three data/control
    // route materials as a group whenever the theme changes.
    const networkBlending = night ? THREE.AdditiveBlending : THREE.NormalBlending
    dataLine.blending = networkBlending
    controlLine.blending = networkBlending
    htapLine.blending = networkBlending
    dataLine.needsUpdate = true
    controlLine.needsUpdate = true
    htapLine.needsUpdate = true
    applyNetworkOpacity()
  }

  apply('night')

  return {
    structure,
    darkStructure,
    pavement,
    glass,
    window,
    trim,
    edge,
    client,
    sql,
    tso,
    txn2pc,
    raft,
    kv,
    gc,
    tiflash,
    dataLine,
    controlLine,
    htapLine,
    ground,
    all,
    apply,
    setNetworkEmphasis(active: boolean): void {
      networkEmphasis = active
      applyNetworkOpacity()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const material of all) material.dispose()
      architecturalSurfaces.dispose()
    },
  }
}
