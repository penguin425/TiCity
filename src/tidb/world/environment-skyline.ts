/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Distant architectural dressing, independent of the simulated topology.
 */

import * as THREE from 'three'

const BUILDING_COUNT = 52
const ROOFTOP_LIGHT_COUNT = 8
const MAX_FACADE_ROWS = 5

/** Flat normals preserve a narrow, sunlit facet along each chamfered corner. */
function createTowerGeometry(): THREE.BufferGeometry {
  const outline = [
    [-0.38, -0.5], [0.38, -0.5], [0.5, -0.38], [0.5, 0.38],
    [0.38, 0.5], [-0.38, 0.5], [-0.5, 0.38], [-0.5, -0.38],
  ] as const
  const vertices: number[] = []
  for (let index = 0; index < outline.length; index++) {
    const [x, z] = outline[index]
    const [nextX, nextZ] = outline[(index + 1) % outline.length]
    vertices.push(
      x, -0.5, z, x, 0.5, z, nextX, 0.5, nextZ,
      x, -0.5, z, nextX, 0.5, nextZ, nextX, -0.5, nextZ,
    )
  }
  for (let index = 1; index < outline.length - 1; index++) {
    const [x, z] = outline[index]
    const [nextX, nextZ] = outline[index + 1]
    vertices.push(
      outline[0][0], 0.5, outline[0][1],
      nextX, 0.5, nextZ,
      x, 0.5, z,
    )
  }
  // Undersides sit against the ground or the solid terrace slab. Omitting
  // these hidden faces leaves a 22-triangle shell for each architectural mass.
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Quiet perimeter architecture: chamfered glass towers, metal roof terraces,
 * mechanical caps and recessed floor bands. Three instance batches use at
 * most 6,928 triangles, including the sparse architectural roof lights.
 * Materials belong to the environment; this group never mutates or owns them.
 */
export function createSkyline(
  material: THREE.MeshStandardMaterial,
  beaconMaterial: THREE.MeshStandardMaterial,
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'city:distant-skyline'

  let seed = 4_250
  const random = (): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    return seed / 0x1_0000_0000
  }

  const towers = new THREE.InstancedMesh(createTowerGeometry(), material, BUILDING_COUNT * 2)
  const details = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    BUILDING_COUNT * 4,
  )
  const lights = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    beaconMaterial,
    BUILDING_COUNT * MAX_FACADE_ROWS * 4 + ROOFTOP_LIGHT_COUNT * 4,
  )
  towers.name = 'city:skyline-towers'
  details.name = 'city:skyline-architectural-metalwork'
  lights.name = 'city:skyline-window-bands'

  const matrix = new THREE.Matrix4()
  const scale = new THREE.Vector3()
  const tint = new THREE.Color()
  const place = (
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
  ): void => {
    matrix.makeScale(width, height, depth)
    matrix.setPosition(x, y, z)
    mesh.setMatrixAt(index, matrix)
  }

  let windowIndex = 0
  const window = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    rotation: number,
  ): void => {
    matrix.makeRotationY(rotation)
    scale.set(width, height, 1)
    matrix.scale(scale)
    matrix.setPosition(x, y, z)
    lights.setMatrixAt(windowIndex, matrix)
    lights.setColorAt(windowIndex, tint)
    windowIndex++
  }
  const facadeRows = (
    x: number,
    bottom: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    rows: number,
  ): void => {
    const pitch = height / (rows + 1)
    const paneHeight = Math.min(2.15, pitch * 0.4)
    for (let row = 1; row <= rows; row++) {
      const y = bottom + pitch * row
      window(x, y, z + depth / 2 + 0.025, width * 0.73, paneHeight, 0)
      window(x, y, z - depth / 2 - 0.025, width * 0.73, paneHeight, Math.PI)
      window(x + width / 2 + 0.025, y, z, depth * 0.73, paneHeight, Math.PI / 2)
      window(x - width / 2 - 0.025, y, z, depth * 0.73, paneHeight, -Math.PI / 2)
    }
  }

  for (let index = 0; index < BUILDING_COUNT; index++) {
    // The rear row leaves a generous central opening for the client approach.
    // Side rows stay beyond the service roads, within the ground's perimeter.
    const rear = index < 18
    const sideIndex = index - 18
    const x = rear
      ? (index < 9 ? -1 : 1) * (40 + (index % 9) * 34 + random() * 4)
      : (sideIndex < 17 ? -1 : 1) * (341 + random() * 4)
    const z = rear
      ? -344 + random() * 3
      : -297 + (sideIndex % 17) * 37.5 + random() * 4
    const width = 9 + random() * 9
    const depth = 9 + random() * 9
    const landmark = index % 7 === 0
    const height = landmark ? 43 + random() * 17 : 13 + random() * 28
    const style = index % 4
    const baseHeight = height * [0.64, 0.84, 0.55, 0.74][style]
    const crownHeight = height - baseHeight
    const crownWidth = width * [0.68, 0.55, 0.84, 0.7][style]
    const crownDepth = depth * [0.74, 0.62, 0.64, 0.86][style]
    const crownX = x + (style === 3 ? (width - crownWidth) * 0.28 : 0)
    const crownZ = z + (style === 2 ? (depth - crownDepth) * 0.28 : 0)
    const value = 0.68 + random() * 0.25

    place(towers, index * 2, x, baseHeight / 2, z, width, baseHeight, depth)
    tint.setRGB(value * 0.72, value * 0.87, value)
    towers.setColorAt(index * 2, tint)
    place(
      towers,
      index * 2 + 1,
      crownX,
      baseHeight + crownHeight / 2,
      crownZ,
      crownWidth,
      crownHeight,
      crownDepth,
    )
    tint.multiplyScalar(style === 1 ? 0.68 : 0.85)
    towers.setColorAt(index * 2 + 1, tint)

    // Broad ledges reveal the setbacks in silhouette; the compact plant room
    // and roof cap catch a separate highlight without texture or extra draws.
    place(
      details,
      index * 4,
      x,
      baseHeight + 0.08,
      z,
      width + 0.55,
      0.32,
      depth + 0.55,
    )
    tint.setRGB(0.88, 0.95, 1)
    details.setColorAt(index * 4, tint)
    place(
      details,
      index * 4 + 1,
      crownX,
      height + 0.16,
      crownZ,
      crownWidth + 0.38,
      0.4,
      crownDepth + 0.38,
    )
    details.setColorAt(index * 4 + 1, tint)
    const plantHeight = 0.9 + (index % 3) * 0.5
    place(
      details,
      index * 4 + 2,
      crownX,
      height + 0.36 + plantHeight / 2,
      crownZ,
      Math.min(3.4, crownWidth * 0.38),
      plantHeight,
      Math.min(3.8, crownDepth * 0.44),
    )
    tint.setRGB(0.39, 0.49, 0.57)
    details.setColorAt(index * 4 + 2, tint)

    // One projecting steel mullion divides the inward-facing glazed frontage.
    // The other facades retain wider horizontal panes for architectural variety.
    const inward = sideIndex < 17 ? 1 : -1
    place(
      details,
      index * 4 + 3,
      rear ? x : x + inward * (width / 2 + 0.08),
      baseHeight / 2,
      rear ? z + depth / 2 + 0.08 : z,
      rear ? 0.3 : 0.22,
      baseHeight - 0.18,
      rear ? 0.22 : 0.3,
    )
    tint.setRGB(0.78, 0.89, 0.96)
    details.setColorAt(index * 4 + 3, tint)

    // Glazed floors are static architecture, with no relationship to modeled
    // cluster activity. Keep several darker floors between the broad ribbons.
    const lowerRows = Math.max(2, Math.min(4, Math.floor(baseHeight / 7)))
    const upperRows = Math.max(1, Math.min(MAX_FACADE_ROWS - lowerRows, Math.floor(crownHeight / 7)))
    tint.setRGB(0.57 + random() * 0.13, 0.74 + random() * 0.12, 0.86)
    facadeRows(x, 0, z, width, baseHeight, depth, lowerRows)
    tint.multiplyScalar(0.78)
    facadeRows(crownX, baseHeight, crownZ, crownWidth, crownHeight, crownDepth, upperRows)

    if (landmark) {
      tint.setRGB(0.87, 0.82, 0.7)
      const lightY = height + 0.36 + plantHeight * 0.65
      const plantWidth = Math.min(3.4, crownWidth * 0.38)
      const plantDepth = Math.min(3.8, crownDepth * 0.44)
      window(crownX, lightY, crownZ + plantDepth / 2 + 0.025, 0.6, 0.24, 0)
      window(crownX, lightY, crownZ - plantDepth / 2 - 0.025, 0.6, 0.24, Math.PI)
      window(crownX + plantWidth / 2 + 0.025, lightY, crownZ, 0.6, 0.24, Math.PI / 2)
      window(crownX - plantWidth / 2 - 0.025, lightY, crownZ, 0.6, 0.24, -Math.PI / 2)
    }
  }

  lights.count = windowIndex
  for (const mesh of [towers, details, lights]) {
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.receiveShadow = true
  }
  towers.castShadow = details.castShadow = true
  root.add(towers, details, lights)
  return root
}
