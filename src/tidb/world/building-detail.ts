/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { COMPONENT_ANCHORS } from './layout'
import type { Point3 } from './layout'
import type { CityMaterials } from './palette'
import { SQL_TERRACE_HEIGHT, SQL_TOWERS } from './sql-architecture'
import type { SqlTowerTier } from './sql-architecture'

export { SQL_TOWER_HEIGHTS } from './sql-architecture'

type DetailMaterial = 'structure' | 'darkStructure' | 'trim' | 'glass' | 'window' | 'tiflash'
type PanelMaterial = 'glass' | 'window'

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
 * The caller owns the shared box and front-panel geometries through its root
 * traversal. Materials remain owned by CityMaterials. There is no update loop,
 * picking target, or additional disposal lifecycle. Structural and mechanical
 * batches cast one shared shadow silhouette each; glass panes stay receive-only
 * so the detail remains inexpensive at overview scale.
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
  const panels: Record<PanelMaterial, BoxDetail[]> = { glass: [], window: [] }
  const at = (anchor: Point3, x: number, y: number, z: number): Point3 =>
    [anchor[0] + x, y, anchor[2] + z]
  const box = (material: DetailMaterial, position: Point3, size: Point3, angle = 0): void => {
    batches[material].push({
      position, size,
      rotation: angle === 0 ? undefined : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    })
  }
  // A glazed bay's back is buried in its opaque core, and its tiny thickness
  // sits behind the surrounding mullions. Preserve the exact outward surface
  // of the box, including UVs and normals, without drawing ten hidden triangles.
  // Galleries, entrance panes and exposed lights retain their full box edges.
  const panel = (material: PanelMaterial, position: Point3, size: Point3, angle = 0): void => {
    panels[material].push({
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

  // Rectangular curtain walls follow the same offset blocks as the main
  // masses. Floor joints, projecting ribs and deep reveals create real shadow
  // lines; the minority of lit bays is fixed architectural ambience.
  const curtainWall = (anchor: Point3, tier: SqlTowerTier, seed: number): void => {
    const [width, height, depth] = tier.size
    const [offsetX, centerY, offsetZ] = tier.position
    const bottom = centerY - height / 2 + 0.45
    const top = centerY + height / 2 - 0.45
    const floorHeight = (top - bottom) / tier.floors
    for (let face = 0; face < 4; face++) {
      const span = face % 2 === 0 ? width : depth
      const faceDepth = face % 2 === 0 ? depth : width
      const columns = tier.columns[face % 2]
      const bayWidth = (span - 1.2) / columns
      const angle = face * Math.PI / 2
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      const point = (horizontal: number, y: number, inset = 0): Point3 =>
        at(anchor, offsetX + cos * horizontal + sin * (faceDepth / 2 + inset), y,
          offsetZ - sin * horizontal + cos * (faceDepth / 2 + inset))
      for (let column = 0; column < columns; column++) {
        const x = -span / 2 + 0.6 + (column + 0.5) * bayWidth
        for (let floor = 0; floor < tier.floors; floor++) {
          const lit = (floor * 7 + column * 11 + face * 3 + seed * 17) % 13 < 3
          panel(lit ? 'window' : 'glass', point(x, bottom + (floor + 0.5) * floorHeight, 0.12),
            [bayWidth - 0.28, floorHeight - 0.58, 0.22], angle)
        }
      }
      for (let column = 1; column < columns; column++) {
        const x = -span / 2 + 0.6 + column * bayWidth
        box('trim', point(x, (bottom + top) / 2, 0.29), [0.2, top - bottom + 0.2, 0.35], angle)
      }
      for (let floor = 1; floor < tier.floors; floor++) {
        const y = bottom + floor * floorHeight
        box('darkStructure', point(0, y + 0.03, 0.08), [span - 0.8, 0.2, 0.2], angle)
        box('trim', point(0, y, 0.25), [span - 0.8, 0.13, 0.3], angle)
      }
      for (const corner of [-1, 1]) {
        box('structure', point(corner * (span / 2 - 0.35), (bottom + top) / 2, 0.15),
          [0.65, top - bottom + 0.3, 0.52], angle)
      }
      // Full-height paired fins on the long faces read as a working building's
      // external frame at city scale, instead of relying on tiny window marks.
      if (face % 2 === 0) {
        for (const rib of [-1, 1]) {
          box('structure', point(rib * span * 0.29, (bottom + top) / 2, 0.88),
            [1, top - bottom + 0.5, 1.75], angle)
        }
      }
    }
  }

  for (let server = 0; server < SQL_TOWERS.length; server++) {
    const anchor = COMPONENT_ANCHORS[`tidb.${server}` as 'tidb.0' | 'tidb.1' | 'tidb.2']
    const spec = SQL_TOWERS[server]
    const { podium, entrance } = spec
    const [podiumWidth, podiumHeight, podiumDepth] = podium.size
    const podiumTop = podium.position[1] + podiumHeight / 2
    const canopyZ = Math.min(entrance.z + 0.8, 18)

    // Offset entrances and deep canopies give the broad ground-floor wings a
    // clear address. Their entire footprint stays inside the 44 x 40 envelope.
    box('darkStructure', at(anchor, entrance.x, 4.1, entrance.z - 0.1), [entrance.width, 5.8, 0.6])
    box('glass', at(anchor, entrance.x, 4.1, entrance.z + 0.23), [entrance.width - 1.7, 5.3, 0.22])
    box('trim', at(anchor, entrance.x, 4.1, entrance.z + 0.39), [0.3, 5.6, 0.3])
    box('structure', at(anchor, entrance.x, podiumTop + 0.15, canopyZ), [entrance.width + 3.5, 0.85, 4])
    box('window', at(anchor, entrance.x, podiumTop - 0.31, canopyZ + 1.75), [entrance.width + 0.8, 0.2, 0.35])
    for (const side of [-1, 1]) {
      box('trim', at(anchor, entrance.x + side * (entrance.width / 2 + 1), 4.2, canopyZ + 1.45),
        [0.8, 6.8, 0.8])
    }
    for (let step = 0; step < 3; step++) {
      box('structure', at(anchor, entrance.x, 0.9 + step * 0.2, canopyZ + 1.4 - step * 0.9),
        [entrance.width + 2, 0.4 + step * 0.4, 1.1])
    }

    // Glazed podium side galleries and wide piers make the lower wing visibly
    // separate from the offset office floors above it.
    for (const side of [-1, 1]) {
      box('glass', at(anchor, side * (podiumWidth / 2 + 0.12), 4.1, -1), [0.22, 4.7, podiumDepth - 7])
      box('structure', at(anchor, side * (podiumWidth / 2 + 0.02), 6.9, 0), [0.4, 0.7, podiumDepth])
      for (let pier = 0; pier < 4; pier++) {
        const z = -podiumDepth / 2 + 4 + pier * (podiumDepth - 8) / 3
        box('structure', at(anchor, side * (podiumWidth / 2 + 0.02), 4.05, z), [0.4, 5.6, 0.9])
      }
    }

    for (let index = 0; index < spec.tiers.length; index++) {
      const tier = spec.tiers[index]
      curtainWall(anchor, tier, server * 3 + index)
      const [width, height, depth] = tier.size
      const [x, y, z] = tier.position
      const roof = y + height / 2
      // A low rectangular parapet makes each exposed roof a usable ledge.
      for (const side of [-1, 1]) {
        const railY = roof + SQL_TERRACE_HEIGHT + 0.35
        box('trim', at(anchor, x + side * (width / 2 - 0.25), railY, z), [0.28, 0.7, depth - 0.5])
        box('trim', at(anchor, x, railY, z + side * (depth / 2 - 0.25)), [width - 0.5, 0.7, 0.28])
      }
      // The broadest working floor gets projecting horizontal sun shelves.
      // Their spacing differs across the three buildings while remaining fixed.
      if (index === 0) {
        const shelves = server === 1 ? 3 : 2
        for (let shelf = 1; shelf <= shelves; shelf++) {
          const shelfY = y - height / 2 + shelf * height / (shelves + 1)
          box('structure', at(anchor, x, shelfY, z + depth / 2 + 0.8), [width + 0.8, 0.7, 2.2])
        }
      }
    }

    // A continuous rear service spine and large roof housings suggest air and
    // power infrastructure, without giving a stateless SQL node storage racks.
    const main = spec.tiers[0]
    const spineSide = server === 0 ? 1 : -1
    const spineX = main.position[0] + spineSide * (main.size[0] / 2 + 0.7)
    const spineZ = main.position[2] - main.size[2] / 2 + 3.2
    box('darkStructure', at(anchor, spineX, main.position[1], spineZ), [1.8, main.size[1], 5.5])
    for (const side of [-1, 1]) {
      box('trim', at(anchor, spineX + side * 0.72, main.position[1], spineZ), [0.25, main.size[1] + 0.4, 5.8])
    }
    for (const plant of spec.roofPlant) {
      const [width, height, depth] = plant.size
      const [x, y, z] = plant.position
      const roof = y + height / 2
      // Feet bear directly on the shared roof datum. The broad curb seals the
      // machinery to that slab rather than leaving an unsupported dark box.
      box('structure', at(anchor, x, y - height / 2 + 0.14, z), [width + 0.7, 0.28, depth + 0.7])
      box('trim', at(anchor, x, roof - 0.08, z), [width + 0.3, 0.16, depth + 0.3])
      for (let grille = 0; grille < 4; grille++) {
        const grilleZ = z - depth / 2 + 0.65 + grille * (depth - 1.3) / 3
        box('darkStructure', at(anchor, x, roof - 0.06, grilleZ), [width - 0.75, 0.08, 0.55])
      }
      for (const side of [-1, 1]) {
        for (let louver = 0; louver < 3; louver++) {
          const louverY = y - height * 0.24 + louver * height * 0.24
          box('trim', at(anchor, x, louverY, z + side * (depth / 2 + 0.1)),
            [width - 0.6, 0.18, 0.3])
          box('trim', at(anchor, x + side * (width / 2 + 0.1), louverY, z),
            [0.3, 0.18, depth - 0.6])
        }
      }
    }
  }

  const pd = COMPONENT_ANCHORS['pd.control']
  // Tangent glass bays follow the circular drum. Opaque cores keep the tower
  // substantial while the close-set ribs catch the architectural lighting.
  for (let bay = 0; bay < 24; bay++) {
    const angle = bay * Math.PI / 12
    const radial = (radius: number, y: number): Point3 =>
      at(pd, Math.sin(angle) * radius, y, Math.cos(angle) * radius)
    for (let floor = 0; floor < 4; floor++) {
      panel((bay + floor * 5) % 11 === 0 ? 'window' : 'glass', radial(19.16, 5.75 + floor * 4.15),
        [4.6, 3.35, 0.24], angle)
    }
    box('trim', radial(19.35, 13.1), [0.22, 17.6, 0.45], angle)
    if (bay % 2 === 0) {
      for (let floor = 0; floor < 4; floor++) {
        panel((bay + floor) % 7 === 0 ? 'window' : 'glass', radial(12.16, 25.1 + floor * 4),
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
  // Four compact rooftop units around the clock plinth provide a tangible
  // mechanical crown while leaving the PD tower's circular silhouette intact.
  for (let unit = 0; unit < 4; unit++) {
    const angle = unit * Math.PI / 2 + Math.PI / 4
    const x = Math.cos(angle) * 7.6
    const z = Math.sin(angle) * 7.6
    box('darkStructure', at(pd, x, 42.65, z), [1.8, 1.15, 2.4], -angle)
    box('trim', at(pd, x, 43.26, z), [2.05, 0.12, 2.65], -angle)
  }

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
        panel((floor + column * 3) % 8 === 0 ? 'window' : 'glass',
          at(flash, x, y, side * 19.13), [6.5, floorHeight - 0.4, 0.22], side > 0 ? 0 : Math.PI)
        box('trim', at(flash, x, y - floorHeight / 2, side * 19.3), [7, 0.17, 0.4])
      }
      box('structure', at(flash, x + side * 3.65, baseY + height / 2, 19.3), [0.65, height, 0.6])
      box('structure', at(flash, x + side * 3.65, baseY + height / 2, -19.3), [0.65, height, 0.6])
      // Visible steel crossheads carry the tall glazing between the end piers.
      // They share the working-floor datum across the alternating-height halls.
      for (const y of [baseY + 0.55, baseY + 10.2, baseY + 20.4]) {
        box('structure', at(flash, x, y, side * 19.4), [7.5, 0.65, 0.75])
      }
      // An inset blue service rail is an identity accent, not a status meter.
      box('tiflash', at(flash, x + side * 4.35, baseY + height / 2, 19.7), [0.8, height + 0.3, 0.9])
    }
    box('darkStructure', at(flash, x, roofY + 2.1, 0), [5.5, 2, 29])
    box('trim', at(flash, x, roofY + 3.16, 0), [5.9, 0.24, 29.5])
    for (let grille = 0; grille < 8; grille++) {
      box('darkStructure', at(flash, x, roofY + 3.4, -12.5 + grille * 3.6), [4.7, 0.22, 2.1])
      for (const side of [-1, 1]) {
        box('trim', at(flash, x + side * 2.05, roofY + 3.4, -12.5 + grille * 3.6), [0.16, 0.2, 2.25])
      }
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
    box('trim', at(flash, side * 40, 10.2, 0), [1.2, 1.4, 56])
    for (const z of [-24, 0, 24]) {
      box('structure', at(flash, side * 40, 8.95, z), [1.8, 1.1, 1.8])
    }
  }
  box('darkStructure', at(flash, 0, 10.3, 25), [82, 1.8, 5.8])
  for (const x of [-34, -20, -6, 8, 22, 36]) {
    box('structure', at(flash, x, 8.95, 25), [2.2, 1.1, 2.2])
    box('darkStructure', at(flash, x, 9.8, 21), [2.1, 0.8, 6])
  }
  box('trim', at(flash, 0, 12.4, 27.6), [80, 0.2, 0.2])
  box('trim', at(flash, 0, 11.8, 27.6), [80, 0.15, 0.15])
  for (let post = 0; post <= 12; post++) {
    box('trim', at(flash, -40 + post * 80 / 12, 11.8, 27.6), [0.16, 1.2, 0.16])
  }
  box('structure', at(flash, 0, 7, -30), [16, 12, 8])
  box('glass', at(flash, 0, 6.5, -34.15), [12, 8.5, 0.25])
  box('trim', at(flash, 0, 6.5, -34.4), [0.4, 9, 0.3])
  box('structure', at(flash, 0, 13.5, -32), [20, 1, 10])
  box('window', at(flash, 0, 12.95, -36.6), [15, 0.28, 0.4])
  for (let step = 0; step < 4; step++) {
    box('structure', at(flash, 0, 0.85 + step * 0.19, -39.4 + step * 0.72),
      [16, 0.3 + step * 0.38, 0.82])
  }
  box('structure', at(flash, 0, 1.42, -35.5), [16, 1.44, 2.8])
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
  const panelGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.5)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const identity = new THREE.Quaternion()
  const addBatch = (
    material: DetailMaterial,
    instances: readonly BoxDetail[],
    sharedGeometry: THREE.BufferGeometry,
    name: string,
  ): void => {
    if (instances.length === 0) return
    const mesh = new THREE.InstancedMesh(sharedGeometry, materials[material], instances.length)
    mesh.name = name
    mesh.castShadow = material === 'structure'
      || material === 'darkStructure'
      || material === 'trim'
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
  for (const material of Object.keys(batches) as DetailMaterial[]) {
    addBatch(material, batches[material], geometry, `architecture:${material}`)
  }
  for (const material of Object.keys(panels) as PanelMaterial[]) {
    addBatch(material, panels[material], panelGeometry, `architecture:${material}-panels`)
  }
}
