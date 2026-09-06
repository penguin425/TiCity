/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { COMPONENT_ANCHORS } from './layout'
import type { Point3 } from './layout'
import type { CityMaterials } from './palette'

/** Shared massing dimensions for the SQL towers and their attached details. */
export const SQL_TOWER_HEIGHTS = [36, 48, 40] as const

type DetailMaterial = 'structure' | 'darkStructure' | 'trim' | 'glass' | 'window' | 'tiflash'

interface BoxDetail {
  readonly position: Point3
  readonly size: Point3
  readonly rotation?: THREE.Quaternion
}

/**
 * Permanent architectural fittings, grouped across the city by six borrowed
 * materials. These are supports, entrances and equipment, never model state.
 * The site coordinates come from layout; offsets below are building dimensions.
 * Anchor Y denotes a semantic focus point, so fittings use the common floor.
 *
 * The caller owns the shared unit-box geometry through its normal root
 * traversal. Materials remain owned by CityMaterials. There is no update loop,
 * shadow pass, picking target, or additional disposal lifecycle.
 */
export function addBuildingDetails(parent: THREE.Object3D, materials: CityMaterials): void {
  const batches: Record<DetailMaterial, BoxDetail[]> = {
    structure: [],
    darkStructure: [],
    trim: [],
    glass: [],
    window: [],
    tiflash: [],
  }
  const at = (anchor: Point3, x: number, y: number, z: number): Point3 =>
    [anchor[0] + x, y, anchor[2] + z]
  const box = (material: DetailMaterial, position: Point3, size: Point3, angle = 0): void => {
    batches[material].push({
      position, size,
      rotation: angle === 0 ? undefined : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    })
  }
  const beam = (material: DetailMaterial, from: Point3, to: Point3, width: number, depth = width): void => {
    const direction = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const length = direction.length()
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.multiplyScalar(1 / length),
    )
    batches[material].push({
      position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      size: [width, length, depth],
      rotation,
    })
  }

  // Deep glazing, a dark spandrel gap, and thin aluminium mullions create a
  // continuous curtain wall. A deterministic minority of occupied bays is lit;
  // this is architectural ambience and never encodes model measurements.
  const curtainWall = (anchor: Point3, span: number, bottom: number, top: number,
    columns: number, floors: number, seed: number): void => {
    const bayWidth = (span - 1.2) / columns
    const floorHeight = (top - bottom) / floors
    for (let face = 0; face < 4; face++) {
      const angle = face * Math.PI / 2
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      const point = (horizontal: number, y: number, inset = 0): Point3 =>
        at(anchor, cos * horizontal + sin * (span / 2 + inset), y,
          -sin * horizontal + cos * (span / 2 + inset))
      for (let column = 0; column < columns; column++) {
        const x = -span / 2 + 0.6 + (column + 0.5) * bayWidth
        for (let floor = 0; floor < floors; floor++) {
          const lit = (floor * 7 + column * 11 + face * 3 + seed * 17) % 13 < 3
          box(lit ? 'window' : 'glass', point(x, bottom + (floor + 0.5) * floorHeight, 0.12),
            [bayWidth - 0.28, floorHeight - 0.58, 0.22], angle)
        }
      }
      for (let column = 1; column < columns; column++) {
        const x = -span / 2 + 0.6 + column * bayWidth
        box('trim', point(x, (bottom + top) / 2, 0.29), [0.2, top - bottom + 0.2, 0.35], angle)
      }
      for (let floor = 1; floor < floors; floor++) {
        box('trim', point(0, bottom + floor * floorHeight, 0.25), [span - 0.8, 0.13, 0.3], angle)
      }
      for (const corner of [-1, 1]) {
        box('structure', point(corner * (span / 2 - 0.35), (bottom + top) / 2, 0.15),
          [0.65, top - bottom + 0.3, 0.52], angle)
      }
    }
  }

  for (let server = 0; server < SQL_TOWER_HEIGHTS.length; server++) {
    const anchor = COMPONENT_ANCHORS[`tidb.${server}` as 'tidb.0' | 'tidb.1' | 'tidb.2']
    const height = SQL_TOWER_HEIGHTS[server]

    // A shallow entrance porch gives the tall shafts a human-scale ground floor.
    box('darkStructure', at(anchor, 0, 4.6, 15.4), [9.5, 7.4, 1.4])
    box('glass', at(anchor, 0, 4.6, 16.15), [7.2, 6, 0.22])
    box('trim', at(anchor, 0, 4.6, 16.32), [0.28, 6.4, 0.24])
    box('structure', at(anchor, 0, 8.5, 17.3), [14, 0.9, 6.4])
    box('window', at(anchor, 0, 8.03, 19.9), [10.5, 0.22, 0.35])
    for (const x of [-6, 6]) box('trim', at(anchor, x, 4.8, 19.8), [0.7, 6.5, 0.7])
    for (let step = 0; step < 3; step++) {
      box('structure', at(anchor, 0, 0.9 + step * 0.2, 20.8 - step * 1.2), [13, 0.4 + step * 0.4, 1.25])
    }

    curtainWall(anchor, 30, 6.4, height + 0.35, 6, Math.round((height - 6) / 3.8), server)
    curtainWall(anchor, 24, height + 1.2, height + 9.4, 5, 2, server + 3)
    curtainWall(anchor, 18, height + 10.3, height + 16.55, 4, 2, server + 6)

    // A recessed ground-floor arcade gives the curtain wall a defined base.
    for (const side of [-1, 1]) {
      box('glass', at(anchor, side * 15.12, 3.65, 0), [0.22, 4.8, 26])
      box('structure', at(anchor, side * 15.2, 6.1, 0), [0.8, 0.6, 30.8])
      for (const z of [-12, -4, 4, 12]) {
        box('trim', at(anchor, side * 15.32, 3.5, z), [0.5, 5.4, 0.45])
      }
    }
    // Mechanical services sit on the exposed ledge around the upper tier.
    for (const side of [-1, 1]) {
      box('darkStructure', at(anchor, side * 13.7, height + 1.3, -2), [2.1, 1.7, 14])
      box('trim', at(anchor, side * 13.7, height + 2.2, -2), [2.3, 0.35, 14.6])
      for (let vent = 0; vent < 4; vent++) {
        box('trim', at(anchor, side * 13.7, height + 2.55, -7 + vent * 3.3), [1.7, 0.5, 1.2])
      }
    }
    // Setback terraces have slender parapets and small mechanical housings;
    // the central crown now reads as roof plant instead of a glowing antenna.
    for (const side of [-1, 1]) {
      box('trim', at(anchor, side * 11.7, height + 10.35, 0), [0.28, 1, 23.4])
      box('trim', at(anchor, 0, height + 10.35, side * 11.7), [23.4, 1, 0.28])
      box('darkStructure', at(anchor, side * 6.4, height + 18.5, -1), [3.2, 2.4, 10.5])
      box('trim', at(anchor, side * 6.4, height + 19.82, -1), [3.5, 0.26, 10.9])
      for (let slat = 0; slat < 5; slat++) {
        box('darkStructure', at(anchor, side * 6.4, height + 20.04, -5 + slat * 2), [2.7, 0.19, 1.15])
      }
    }
    box('structure', at(anchor, 0, height + 18.1, 6.8), [4.4, 1.7, 3])
    box('trim', at(anchor, 0, height + 19.12, 6.8), [4.8, 0.35, 3.4])
  }

  const pd = COMPONENT_ANCHORS['pd.control']
  // Tangent glass bays follow the circular drum. Opaque cores keep the tower
  // substantial while the close-set ribs catch the architectural lighting.
  for (let bay = 0; bay < 24; bay++) {
    const angle = bay * Math.PI / 12
    const radial = (radius: number, y: number): Point3 =>
      at(pd, Math.sin(angle) * radius, y, Math.cos(angle) * radius)
    for (let floor = 0; floor < 4; floor++) {
      box((bay + floor * 5) % 11 === 0 ? 'window' : 'glass', radial(19.16, 5.75 + floor * 4.15),
        [4.6, 3.35, 0.24], angle)
    }
    box('trim', radial(19.35, 13.1), [0.22, 17.6, 0.45], angle)
    if (bay % 2 === 0) {
      for (let floor = 0; floor < 4; floor++) {
        box((bay + floor) % 7 === 0 ? 'window' : 'glass', radial(12.16, 25.1 + floor * 4),
          [5.65, 3.2, 0.22], angle)
      }
      box('structure', radial(12.45, 31.2), [0.42, 17.1, 0.55], angle)
    }
  }
  // Eight radial feet brace the circular deck. The upper ends touch the tower;
  // the lower ends remain within its existing thirty-metre foundation radius.
  for (let spoke = 0; spoke < 8; spoke++) {
    const angle = (spoke / 8) * Math.PI * 2
    const x = Math.cos(angle)
    const z = Math.sin(angle)
    beam('trim', at(pd, x * 28, 4.3, z * 28), at(pd, x * 17.5, 17.5, z * 17.5), 1.2, 1.8)
    box('structure', at(pd, x * 27, 3.4, z * 27), [3.5, 2.2, 3.5])
    box('darkStructure', at(pd, x * 16.8, 24.1, z * 16.8), [2.8, 2.2, 2.8])
    box('trim', at(pd, x * 16.8, 25.3, z * 16.8), [3.1, 0.25, 3.1])
  }
  box('darkStructure', at(pd, 0, 7.1, 19), [7, 8, 1.4])
  box('glass', at(pd, 0, 7, 19.76), [5, 6.4, 0.2])
  box('structure', at(pd, 0, 11.5, 21), [10, 0.8, 5.5])
  box('window', at(pd, 0, 11.08, 23.4), [7, 0.2, 0.35])

  const flash = COMPONENT_ANCHORS['tiflash.0']
  // Six repeated analytical halls read as a columnar machine at overview
  // scale. Close-up, glazed end walls, folded fins and roof heat exchangers
  // give those masses a believable manufactured construction.
  for (let column = 0; column < 6; column++) {
    const x = -34 + column * 14
    const height = 28 + (column % 2) * 8
    const baseY = 8.6
    const roofY = baseY + height
    for (const side of [-1, 1]) {
      box('glass', at(flash, x + side * 4.12, baseY + height / 2, 0), [0.22, height - 2, 36])
      for (let fin = 0; fin < 9; fin++) {
        box('trim', at(flash, x + side * 4.3, baseY + height / 2, -16 + fin * 4),
          [1.15, height - 1.4, 0.28], side * 0.24)
      }
      for (let floor = 0; floor < 7; floor++) {
        const floorHeight = (height - 2) / 7
        const y = baseY + 1 + floorHeight * (floor + 0.5)
        box((floor + column * 3) % 8 === 0 ? 'window' : 'glass',
          at(flash, x, y, side * 19.13), [6.5, floorHeight - 0.4, 0.22])
        box('trim', at(flash, x, y - floorHeight / 2, side * 19.3), [7, 0.17, 0.4])
      }
      box('structure', at(flash, x + side * 3.65, baseY + height / 2, 19.3), [0.65, height, 0.6])
      box('structure', at(flash, x + side * 3.65, baseY + height / 2, -19.3), [0.65, height, 0.6])
      // An inset blue service rail is an identity accent, not a status meter.
      box('tiflash', at(flash, x + side * 4.35, baseY + height / 2, 19.7), [0.8, height + 0.3, 0.9])
    }
    box('darkStructure', at(flash, x, roofY + 2.1, 0), [5.5, 2, 29])
    box('trim', at(flash, x, roofY + 3.16, 0), [5.9, 0.24, 29.5])
    for (let grille = 0; grille < 8; grille++) {
      box('darkStructure', at(flash, x, roofY + 3.4, -12.5 + grille * 3.6), [4.7, 0.22, 2.1])
    }
  }
  // The columnar hall gets an external steel frame and rear service gallery.
  // Alternating crown heights remain clear: these braces stop below the roofs.
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < 5; bay++) {
      const x = -34 + bay * 14
      beam('trim', at(flash, x, 10, side * 19.9), at(flash, x + 14, 28, side * 19.9), 0.8)
      box('darkStructure', at(flash, x + 7, 9, side * 20), [14, 1.4, 1.2])
    }
    box('trim', at(flash, side * 40, 10.2, 0), [1.2, 1.4, 43])
  }
  box('darkStructure', at(flash, 0, 10.3, 25), [73, 1.8, 5.8])
  box('trim', at(flash, 0, 13.6, 27.6), [73, 0.5, 0.5])
  for (let post = 0; post < 11; post++) {
    box('trim', at(flash, -35 + post * 7, 12, 27.6), [0.4, 3.2, 0.4])
  }
  box('structure', at(flash, 0, 7, -30), [16, 12, 8])
  box('glass', at(flash, 0, 6.5, -34.15), [12, 8.5, 0.25])
  box('trim', at(flash, 0, 6.5, -34.4), [0.4, 9, 0.3])
  box('structure', at(flash, 0, 13.5, -32), [20, 1, 10])
  box('window', at(flash, 0, 12.95, -36.6), [15, 0.28, 0.4])
  for (const side of [-1, 1]) {
    beam('trim', at(flash, side * 13, 10, 25), at(flash, side * 3.6, 34, 32), 1.2)
    box('darkStructure', at(flash, side * 4.35, 25, 32), [1, 18, 3.2])
    for (let bracket = 0; bracket < 3; bracket++) {
      box('trim', at(flash, side * 4.35, 19 + bracket * 6, 32), [2.2, 0.7, 5.2])
    }
  }

  const gc = COMPONENT_ANCHORS['gc.yard']
  // Runways connect the existing gantry frames into one working structure.
  for (const side of [-1, 1]) {
    box('darkStructure', at(gc, side * 34, 29.2, 0), [2.8, 1.2, 52])
    box('trim', at(gc, side * 34, 30.05, 0), [0.8, 0.55, 52])
    for (const end of [-1, 1]) {
      beam('trim', at(gc, side * 34, 18, end * 25), at(gc, side * 22, 27, end * 25), 1.2)
      box('structure', at(gc, side * 34, 30.5, end * 25), [4, 2.6, 2])
    }
  }
  box('structure', at(gc, 0, 31.2, -10), [70, 2, 3.4])
  box('darkStructure', at(gc, 0, 33, -10), [8, 1.8, 5])
  box('trim', at(gc, 0, 24.4, -10), [0.65, 11.6, 0.65])
  box('structure', at(gc, 0, 18.7, -10), [13, 1.2, 3])
  box('darkStructure', at(gc, -5, 26.6, 29), [9, 3.2, 8])
  box('trim', at(gc, -5, 28.4, 29), [10, 0.5, 9])
  for (let grille = 0; grille < 5; grille++) {
    box('trim', at(gc, -8.2 + grille * 1.6, 28.8, 29), [0.45, 0.35, 6.8])
  }
  box('structure', at(gc, 9, 26.6, 31), [5, 3.2, 5])
  box('darkStructure', at(gc, 9, 29, 31), [3, 1.6, 3])
  box('window', at(gc, 0, 23.7, 38.2), [23, 0.4, 0.4])

  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const identity = new THREE.Quaternion()
  for (const material of Object.keys(batches) as DetailMaterial[]) {
    const instances = batches[material]
    if (instances.length === 0) continue
    const mesh = new THREE.InstancedMesh(geometry, materials[material], instances.length)
    mesh.name = `architecture:${material}`
    mesh.castShadow = false
    mesh.receiveShadow = true
    mesh.raycast = () => {}
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index]
      position.set(...instance.position)
      scale.set(...instance.size)
      matrix.compose(position, instance.rotation ?? identity, scale)
      mesh.setMatrixAt(index, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    parent.add(mesh)
  }
}
