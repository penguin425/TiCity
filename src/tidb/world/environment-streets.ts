/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Instanced campus landscaping. Decorations deliberately stay outside the
 * authored districts and never encode model state or network traffic.
 */

import * as THREE from 'three'
import {
  GARDEN_BEDS,
  LAMP_POSITIONS,
  ROAD_SEGMENTS,
  TREE_POSITIONS,
} from './layout'
import type { Point3 } from './layout'

// Keep the historical import path stable for environment.ts and integrations.
export { ROAD_SEGMENTS } from './layout'

interface CampusMaterials {
  readonly road: THREE.MeshStandardMaterial
  readonly paving: THREE.MeshStandardMaterial
  readonly pole: THREE.MeshStandardMaterial
  readonly lamp: THREE.MeshStandardMaterial
  readonly foliage: THREE.MeshStandardMaterial
  readonly lawn: THREE.MeshStandardMaterial
  readonly timber: THREE.MeshStandardMaterial
  readonly water: THREE.MeshStandardMaterial
  readonly lightPool: THREE.MeshBasicMaterial
}

interface BoxInstance {
  readonly position: Point3
  readonly size: Point3
  readonly color?: number
  readonly rotation?: Point3
}

/** Initialization-only buffers: no matrices or colours are allocated per frame. */
function boxes(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: readonly BoxInstance[],
  shadows = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const euler = new THREE.Euler()
  const color = new THREE.Color()
  mesh.name = name
  for (let index = 0; index < instances.length; index++) {
    const item = instances[index]
    position.fromArray(item.position)
    scale.fromArray(item.size)
    euler.set(item.rotation?.[0] ?? 0, item.rotation?.[1] ?? 0, item.rotation?.[2] ?? 0)
    rotation.setFromEuler(euler)
    mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))
    if (item.color !== undefined) mesh.setColorAt(index, color.setHex(item.color))
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = shadows
  mesh.receiveShadow = true
  return mesh
}

function chamferedPlanterGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const corner = 0.1
  shape.moveTo(-0.5 + corner, -0.5)
  shape.lineTo(0.5 - corner, -0.5)
  shape.lineTo(0.5, -0.5 + corner)
  shape.lineTo(0.5, 0.5 - corner)
  shape.lineTo(0.5 - corner, 0.5)
  shape.lineTo(-0.5 + corner, 0.5)
  shape.lineTo(-0.5, 0.5 - corner)
  shape.lineTo(-0.5, -0.5 + corner)
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 })
    .rotateX(-Math.PI / 2).translate(0, -0.5, 0)
}

function createCanopyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1)
  const vertices = geometry.getAttribute('position')
  for (let index = 0; index < vertices.count; index++) {
    const x = vertices.getX(index)
    const y = vertices.getY(index)
    const z = vertices.getZ(index)
    // Broad, rounded leaf clusters with an irregular outline; the detail is
    // fixed so scenery never needs frame-driven deformations or random state.
    const radius = 1 + Math.sin(x * 9 + z * 6) * Math.sin(y * 7 - x * 4) * 0.075
    vertices.setXYZ(index, x * radius, y * radius, z * radius)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Soft elliptical street-lamp spill, baked locally without point lights. */
export function createLightPoolTexture(): THREE.DataTexture {
  const size = 64
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / (size - 1) - 0.5) * 2
      const dy = (y / (size - 1) - 0.5) * 2
      const radius = Math.sqrt(dx * dx + dy * dy)
      const alpha = Math.pow(Math.max(0, 1 - radius), 2.4)
      const index = (y * size + x) * 4
      pixels[index] = 255
      pixels[index + 1] = 255
      pixels[index + 2] = 255
      pixels[index + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

export function createCampusStreets(materials: CampusMaterials): THREE.Group {
  const root = new THREE.Group()
  root.name = 'city:campus-streets'
  const box = new THREE.BoxGeometry(1, 1, 1)
  const planter = chamferedPlanterGeometry()
  const canopy = createCanopyGeometry()

  const asphalt: BoxInstance[] = ROAD_SEGMENTS.map((road) => ({
    position: [road.x, 0.02, road.z], size: [road.width, 0.34, road.depth],
  }))

  const pavement: BoxInstance[] = []
  const markings: BoxInstance[] = []
  for (const road of ROAD_SEGMENTS) {
    const horizontal = road.width > road.depth
    if (horizontal) {
      for (const side of [-1, 1]) {
        pavement.push({
          position: [0, 0.16, road.z + side * (road.depth / 2 + 2.1)],
          size: [616, 0.6, 4.2],
        })
        markings.push({
          position: [0, 0.215, road.z + side * (road.depth / 2 - 1.2)],
          size: [576, 0.025, 0.25],
        })
        asphalt.push({
          position: [0, 0.21, road.z + side * (road.depth / 2 - 0.4)],
          size: [614, 0.04, 0.8], color: 0x79898d,
        })
      }
    } else {
      const large = road.depth > 100
      // Side avenues stop at the three boulevard intersections.
      const stretches = large ? [[-319, -39], [-11, 142], [168, 274], [298, 302]] :
        [[road.z - road.depth / 2, road.z + road.depth / 2]]
      for (const [start, end] of stretches) {
        for (const side of [-1, 1]) pavement.push({
          position: [road.x + side * (road.width / 2 + 2.1), 0.16, (start + end) / 2],
          size: [4.2, 0.6, end - start],
        })
        if (large) {
          for (const side of [-1, 1]) markings.push({
            position: [road.x + side * (road.width / 2 - 1.2), 0.215, (start + end) / 2],
            size: [0.25, 0.025, end - start],
          })
        }
      }
    }
  }

  // Zebra crossings sit before each junction; the intersection stays open.
  for (const road of ROAD_SEGMENTS.filter((road) => road.width > road.depth)) {
    for (const side of [-1, 1]) {
      for (let stripe = -3; stripe <= 3; stripe++) markings.push({
        position: [side * 295 + stripe * 2.7, 0.205, road.z],
        size: [1.2, 0.025, road.depth - 4],
      })
      for (const approach of [-1, 1]) {
        for (let stripe = -2; stripe <= 2; stripe++) markings.push({
          position: [side * 318, 0.205, road.z + approach * (road.depth / 2 + 10) + stripe * 2.3],
          size: [14, 0.025, 1.1],
        })
      }
    }
  }

  // Low garden beds occupy the empty campus blocks and preserve all districts.
  const beds = GARDEN_BEDS
  const grass: BoxInstance[] = []
  const planterRims: BoxInstance[] = []
  const woodwork: BoxInstance[] = []
  const metalwork: BoxInstance[] = []
  const water: BoxInstance[] = []
  const hedges: BoxInstance[] = []
  const lowPlants: BoxInstance[] = []
  for (let index = 0; index < beds.length; index++) {
    const [x, z, width, depth] = beds[index]
    pavement.push({ position: [x, 0.15, z], size: [width + 2.5, 0.65, depth + 2.5] })
    if (width > 80 && depth > 50) {
      // Four separate, clipped-corner planting islands leave generous stone
      // promenades. Selected islands are quiet reflecting gardens, not data.
      for (const sideX of [-1, 1]) {
        for (const sideZ of [-1, 1]) {
          const islandX = x + sideX * width * 0.258
          const islandZ = z + sideZ * depth * 0.258
          const islandWidth = width * 0.44
          const islandDepth = depth * 0.425
          const reflecting = index % 2 === 0 && sideX === 1 && sideZ === -1
          planterRims.push({
            position: [islandX, 0.9, islandZ], size: [islandWidth, 1, islandDepth],
            color: reflecting ? 0xa4b3b3 : 0xb9bdb0,
          })
          if (reflecting) {
            asphalt.push({
              position: [islandX, 1.25, islandZ], size: [islandWidth - 3, 0.12, islandDepth - 3],
              color: 0x809696,
            })
            water.push({
              position: [islandX, 1.35, islandZ], size: [islandWidth - 3.3, 0.08, islandDepth - 3.3],
            })
            // A few broad stepping stones give the water surface a physical
            // scale and reflect their edges in the surrounding dark glazing.
            for (let step = -1; step <= 1; step++) pavement.push({
              position: [islandX + step * 7, 1.6, islandZ], size: [4.8, 0.48, 5.5],
            })
          } else {
            grass.push({
              position: [islandX, 1.38, islandZ], size: [islandWidth - 1.4, 0.16, islandDepth - 1.4],
              color: (sideX + sideZ + index) % 2 === 0 ? 0xb8c7a9 : 0xa2b69b,
            })
            hedges.push({
              position: [islandX - islandWidth * 0.3, 2.4, islandZ - islandDepth * 0.34],
              size: [islandWidth * 0.25, 2.3, 3.2], color: 0x889f7d,
            })
            for (let shrub = 0; shrub < 3; shrub++) lowPlants.push({
              position: [islandX + islandWidth * 0.32 - shrub * 2.8, 2.1, islandZ + islandDepth * 0.31],
              size: [2.2, 1.5 + shrub * 0.2, 2],
              color: shrub === 1 ? 0xc0b990 : 0x93a881,
            })
          }
        }
      }

      // Two open pergolas create detailed slatted shadows across the garden
      // walk; their low roof stays outside the component districts/sightlines.
      if (index < 3 && index !== 1) {
        for (const sideX of [-1, 1]) {
          for (const sideZ of [-1, 1]) metalwork.push({
            position: [x + sideX * 9, 3.8, z + sideZ * 5], size: [0.55, 6.8, 0.55],
          })
          woodwork.push({ position: [x + sideX * 9, 7.2, z], size: [0.5, 0.75, 13] })
        }
        for (let slat = -5; slat <= 5; slat++) woodwork.push({
          position: [x, 7.75, z + slat * 1.12], size: [20, 0.7, 0.5],
        })
      }
      for (const side of [-1, 1]) {
        const benchX = x + side * width * 0.23
        const benchZ = z + 1.4
        for (let slat = -1; slat <= 1; slat++) woodwork.push(
          { position: [benchX, 1.75, benchZ + slat * 0.62], size: [7.2, 0.25, 0.5] },
          { position: [benchX, 2.5 + slat * 0.45, benchZ + 0.96], size: [7.2, 0.34, 0.25] },
        )
        metalwork.push(
          { position: [benchX - 2.4, 1, benchZ], size: [0.5, 1.6, 1.7] },
          { position: [benchX + 2.4, 1, benchZ], size: [0.5, 1.6, 1.7] },
        )
      }
    } else {
      planterRims.push({ position: [x, 0.8, z], size: [width, 0.75, depth] })
      grass.push({
        position: [x, 1.18, z], size: [width - 1, 0.12, depth - 1], color: 0xa2b69b,
      })
      if (width < 50 && depth > 50) {
        for (let hedge = -1; hedge <= 1; hedge++) hedges.push({
          position: [x - width * 0.22, 2.6, z + hedge * 26],
          size: [3.2, 2.7, 13], color: 0x8a9f79,
        })
      }
    }
  }

  const trees = TREE_POSITIONS

  const trunks: BoxInstance[] = []
  const crowns: BoxInstance[] = [...lowPlants]
  for (let index = 0; index < trees.length; index++) {
    const [x, , z] = trees[index]
    if (water.some((pool) =>
      Math.abs(x - pool.position[0]) < pool.size[0] / 2 + 3 &&
      Math.abs(z - pool.position[2]) < pool.size[2] / 2 + 3,
    )) continue
    const size = 0.98 + (index % 5) * 0.075
    const slender = index % 4 === 0
    const crownColor = [0xc5c6a2, 0xa9be91, 0x98b49c, 0xb1c69d][index % 4]
    trunks.push({ position: [x, 3.2 * size, z], size: [size, size, size] })
    for (const side of [-1, 1]) trunks.push({
      position: [x + side * 1.05 * size, 5.9 * size, z], size: [0.48 * size, 0.68 * size, 0.48 * size],
      rotation: [0, 0, -side * 0.62],
    })
    crowns.push(
      {
        position: [x, (slender ? 11.8 : 10.6) * size, z],
        size: [(slender ? 3.6 : 4.8) * size, (slender ? 7 : 5.6) * size, 4.4 * size],
        color: crownColor, rotation: [0, index * 0.71, 0],
      },
      {
        position: [x + 2.5 * size, 8.2 * size, z + 0.8], size: [3.8 * size, 4.4 * size, 3.9 * size],
        color: crownColor, rotation: [0, index * 0.43, 0],
      },
      {
        position: [x - 2.3 * size, 8.1 * size, z - 0.9], size: [3.6 * size, 4 * size, 3.5 * size],
        color: 0x92ad86, rotation: [0, index * 0.57, 0],
      },
    )
  }
  const lampPositions = LAMP_POSITIONS
  for (const [x, , z] of lampPositions) trunks.push({
    position: [x, 4.3, z], size: [0.48, 8.3 / 6.4, 0.48],
  })
  root.add(
    boxes('city:roads', box, materials.road, asphalt),
    boxes('city:campus-curbs-and-crossings', box, materials.paving, [...pavement, ...markings]),
    boxes('city:raised-planter-rims', planter, materials.paving, planterRims, true),
    boxes('city:landscaped-beds', planter, materials.lawn, grass),
    boxes('city:garden-hedges', planter, materials.foliage, hedges, true),
    boxes('city:reflecting-gardens', planter, materials.water, water),
    boxes('city:timber-garden-details', box, materials.timber, woodwork, true),
    boxes('city:tree-trunks-and-lamp-posts', new THREE.CylinderGeometry(0.5, 0.72, 6.4, 5), materials.pole, trunks),
    boxes('city:data-grove-crowns', canopy, materials.foliage, crowns, true),
  )

  root.add(
    boxes('city:lamp-heads', box, materials.lamp,
      lampPositions.map(([x, , z]) => ({ position: [x, 8.7, z], size: [1.6, 0.46, 1.6] }))),
    boxes('city:street-metal-details', box, materials.pole, [
      ...metalwork,
      ...lampPositions.map(([x, , z]): BoxInstance => ({ position: [x, 9.05, z], size: [2, 0.25, 2] })),
    ]),
  )

  const poolGeometry = new THREE.PlaneGeometry(23, 23).rotateX(-Math.PI / 2)
  const pools = boxes('city:lamp-ground-pools', poolGeometry, materials.lightPool,
    lampPositions.map(([x, , z]) => ({ position: [x, 0.58, z], size: [1, 1, 1] })))
  pools.renderOrder = 2
  root.add(pools)
  return root
}
