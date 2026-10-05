/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { TIKV_ARCHITECTURE } from './layout'
import type { Point3 } from './layout'
import type { CityMaterials } from './palette'
import type { BoxInstance, createCityGeometry } from './geometry'

interface StorageDetail extends BoxInstance {
  readonly rotation?: THREE.Quaternion
}

/**
 * An open service story beneath each TiKV rack deck. Columns, exposed steel
 * trusses and cooling equipment make the store read as a constructed machine;
 * none of these fittings represents shared memory or simulated storage state.
 * All geometry and materials are borrowed from the city's existing owners.
 */
export function addStorageArchitecture(
  parent: THREE.Object3D,
  materials: CityMaterials,
  anchor: Point3,
  geometry: ReturnType<typeof createCityGeometry>,
): void {
  const pillars: StorageDetail[] = []
  const machinery: StorageDetail[] = []
  const fittings: StorageDetail[] = []
  const point = (x: number, y: number, z: number): Point3 =>
    [anchor[0] + x, y, anchor[2] + z]
  const box = (
    batch: StorageDetail[], x: number, y: number, z: number,
    width: number, height: number, depth: number,
  ): void => {
    batch.push({ position: point(x, y, z), size: [width, height, depth] })
  }
  const brace = (from: Point3, to: Point3): void => {
    const direction = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2])
    const length = direction.length()
    fittings.push({
      position: point((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2),
      size: [0.85, length, 1.15],
      rotation: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), direction.multiplyScalar(1 / length),
      ),
    })
  }

  const deckBottom = TIKV_ARCHITECTURE.deckCenterY - TIKV_ARCHITECTURE.deckHeight / 2
  const deckTop = TIKV_ARCHITECTURE.deckTop
  const footingTop = 2
  const columnHeight = deckBottom - footingTop
  const equipmentScale = Math.min(2, (deckBottom - 3) / 8)
  const equipmentY = (y: number): number => footingTop + (y - footingTop) * equipmentScale
  const equipmentBox = (
    batch: StorageDetail[], x: number, y: number, z: number,
    width: number, height: number, depth: number,
  ): void => box(batch, x, equipmentY(y), z, width, height * equipmentScale, depth)
  // Eight broad piers leave the middle of the service floor entirely open.
  // Separate feet and capitals show how the slab transfers its weight to them.
  for (const [x, z] of [
    [-42, -42], [0, -42], [42, -42], [-42, 0], [42, 0],
    [-42, 42], [0, 42], [42, 42],
  ]) {
    box(pillars, x, footingTop + columnHeight / 2, z, 6.2, columnHeight, 6.2)
    box(machinery, x, 1.1, z, 11.5, 1.8, 11.5)
    box(fittings, x, deckBottom - 0.5, z, 8.5, 1, 8.5)
  }

  for (const side of [-1, 1]) {
    // Deep perimeter girders and diagonal struts remain below the slab. Their
    // open bays are visible from every side rather than becoming solid walls.
    box(machinery, 0, deckBottom - 0.7, side * 42, 90, 1.4, 2.2)
    box(machinery, side * 42, deckBottom - 0.7, 0, 2.2, 1.4, 90)
    for (const end of [-1, 1]) {
      brace([side * 42, 2.7, end * 38.5], [side * 42, deckBottom - 1.2, end * 22])
      brace([end * 38.5, 2.7, side * 42], [end * 22, deckBottom - 1.2, side * 42])
    }

    // The upper edge has a shallow cantilever fascia and a narrow service
    // walk. Its low rail stays outside the Region racks' entire footprint.
    box(machinery, 0, deckTop - 1, side * 49.1, 98.2, 1.8, 0.8)
    box(machinery, side * 49.1, deckTop - 1, 0, 0.8, 1.8, 98.2)
    box(fittings, 0, deckTop + 0.09, side * 45.4, 96, 0.18, 5.6)
    box(fittings, side * 45.4, deckTop + 0.09, 0, 5.6, 0.18, 84)
    box(fittings, 0, deckTop + 1.05, side * 49, 98, 0.28, 0.4)
    box(fittings, side * 49, deckTop + 1.05, 0, 0.4, 0.28, 98)
    for (let post = 0; post < 9; post++) {
      const along = -48 + post * 12
      box(fittings, along, deckTop + 0.55, side * 49, 0.35, 1.1, 0.35)
      box(fittings, side * 49, deckTop + 0.55, along, 0.35, 1.1, 0.35)
    }

    // Repeated heat exchanger housings have plinths, inset fan discs, upper
    // exhaust hoods and separated louvers, giving the lower story a purposeful
    // mechanical scale. These are static fittings, never diagnostic readings.
    for (const x of [-30, -15, 15, 30]) {
      equipmentBox(machinery, x, 2.3, side * 42, 10.2, 0.6, 7.2)
      equipmentBox(machinery, x, 5.1, side * 42, 8.5, 5, 5.8)
      equipmentBox(fittings, x, 7.75, side * 42, 9.2, 0.3, 6.3)
      equipmentBox(machinery, x, 8.6, side * 41.1, 5.8, 1.4, 3.7)
      equipmentBox(fittings, x, 9.4, side * 41.1, 6.5, 0.2, 4.3)
      for (const edge of [-1, 1]) {
        equipmentBox(fittings, x + edge * 3.6, 5.1, side * 45.08, 0.3, 4.4, 0.25)
      }
      for (let louver = 0; louver < 4; louver++) {
        equipmentBox(fittings, x, 3.5 + louver * 1.05, side * 45.1, 6.7, 0.15, 0.3)
      }
      const fan = geometry.addCylinder(
        parent, 1.65 * equipmentScale, 0.2, point(x, equipmentY(5.3), side * 45.38), materials.darkStructure,
        'tikv:service-fan', 12,
      )
      fan.rotation.x = Math.PI / 2
      fan.raycast = () => {}
    }

    // A compact power cabinet interrupts the equipment rhythm at the centre.
    // Its small green fittings are the only semantic accent on the machinery.
    equipmentBox(machinery, 0, 5.15, side * 42, 7.2, 6.1, 5.8)
    equipmentBox(fittings, 0, 8.3, side * 42, 7.8, 0.2, 6.3)
    equipmentBox(fittings, 0, 5.15, side * 45.05, 0.2, 5.3, 0.3)
    for (const x of [-1.7, 1.7]) {
      const marker = geometry.addCylinder(
        parent, 0.32, 0.22, point(x, equipmentY(7.15), side * 45.34), materials.kv,
        'tikv:service-identity', 8,
      )
      marker.rotation.x = Math.PI / 2
      marker.raycast = () => {}
    }
  }

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const batches = [
    [pillars, materials.structure, 'tikv:service-pillars', true],
    [machinery, materials.darkStructure, 'tikv:service-machinery', false],
    [fittings, materials.trim, 'tikv:service-fittings', false],
  ] as const
  for (const [instances, material, name, castShadow] of batches) {
    const mesh = geometry.addInstancedBoxes(parent, instances, material, name, castShadow)
    // The shared builder handles the ordinary boxes. Only the diagonal steel
    // struts require a full rotation, applied to this same three-batch layout.
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index]
      if (!instance.rotation) continue
      position.set(...instance.position)
      scale.set(...instance.size)
      matrix.compose(position, instance.rotation, scale)
      mesh.setMatrixAt(index, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
  }
}
