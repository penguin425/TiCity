/*
 * Copyright 2026 TiDB City contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'

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
  dispose(): void
}

function semanticMaterial(domain: SemanticDomain): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: SEMANTIC_COLORS.night[domain],
    emissive: SEMANTIC_COLORS.night[domain],
    emissiveIntensity: 0.26,
    roughness: 0.58,
    metalness: 0.28,
  })
}

export function createCityMaterials(): CityMaterials {
  const structure = new THREE.MeshStandardMaterial({
    color: 0x2a425a,
    roughness: 0.9,
    metalness: 0.08,
  })
  const darkStructure = new THREE.MeshStandardMaterial({
    color: 0x17283a,
    roughness: 0.82,
    metalness: 0.18,
  })
  const pavement = new THREE.MeshStandardMaterial({
    color: 0x203345,
    roughness: 0.96,
    metalness: 0,
  })
  const glass = new THREE.MeshStandardMaterial({
    color: 0x8fd8ff,
    emissive: 0x1e6d96,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.7,
    roughness: 0.16,
    metalness: 0.12,
  })
  const client = semanticMaterial('client')
  const sql = semanticMaterial('sql')
  const tso = semanticMaterial('tso')
  const txn2pc = semanticMaterial('txn2pc')
  const kv = semanticMaterial('kv')
  const gc = semanticMaterial('gc')
  const tiflash = semanticMaterial('tiflash')
  const raft = new THREE.LineBasicMaterial({
    color: SEMANTIC_COLORS.night.raft,
    transparent: true,
    opacity: 0.36,
  })
  const dataLine = new THREE.LineBasicMaterial({
    color: SEMANTIC_COLORS.night.sql,
    transparent: true,
    opacity: 0.52,
  })
  const controlLine = new THREE.LineDashedMaterial({
    color: SEMANTIC_COLORS.night.tso,
    transparent: true,
    opacity: 0.45,
    dashSize: 3,
    gapSize: 2,
  })
  const htapLine = new THREE.LineDashedMaterial({
    color: SEMANTIC_COLORS.night.tiflash,
    transparent: true,
    opacity: 0.5,
    dashSize: 4,
    gapSize: 2,
  })
  const ground = new THREE.MeshStandardMaterial({
    color: 0x07101a,
    roughness: 1,
    metalness: 0,
  })

  const all: readonly THREE.Material[] = [
    structure,
    darkStructure,
    pavement,
    glass,
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

  function apply(theme: CityTheme): void {
    const palette = SEMANTIC_COLORS[theme]
    const night = theme === 'night'
    structure.color.setHex(night ? 0x2a425a : 0xd7e0e8)
    darkStructure.color.setHex(night ? 0x17283a : 0x8e9dab)
    pavement.color.setHex(night ? 0x203345 : 0xb9c4cd)
    glass.color.setHex(night ? 0x8fd8ff : 0x348db4)
    glass.emissive.setHex(night ? 0x1e6d96 : 0x000000)
    glass.emissiveIntensity = night ? 0.25 : 0
    ground.color.setHex(night ? 0x07101a : 0xaebbc6)

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
      material.emissiveIntensity = night ? 0.26 : 0
    }
    raft.color.setHex(palette.raft)
    dataLine.color.setHex(palette.sql)
    controlLine.color.setHex(palette.tso)
    htapLine.color.setHex(palette.tiflash)
  }

  return {
    structure,
    darkStructure,
    pavement,
    glass,
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
    dispose(): void {
      for (const material of all) material.dispose()
    },
  }
}
