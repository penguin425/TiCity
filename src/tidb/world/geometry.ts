/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Point3 } from './layout'

export interface BoxInstance {
  readonly position: Point3
  readonly size: Point3
  readonly rotationY?: number
}

/**
 * One primitive library per city. Object transforms carry dimensions so the
 * same vertex buffers serve every plinth, window, support, and tower.
 * The scene owns these geometries and disposes each unique buffer once.
 */
export function createCityGeometry() {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const edges = new THREE.EdgesGeometry(box, 24)
  const bevels = new Map<string, THREE.BufferGeometry>()
  const cylinders = new Map<number, THREE.CylinderGeometry>()
  const rings = new Map<number, THREE.TorusGeometry>()
  const staticMeshes = new WeakSet<THREE.Mesh>()
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const axis = new THREE.Vector3(0, 1, 0)

  function addBox(
    parent: THREE.Object3D, size: Point3, point: Point3,
    material: THREE.Material, name: string, castShadow = false,
  ): THREE.Mesh {
    let geometry: THREE.BufferGeometry = box
    // Large architectural masses get a consistent world-space bevel. Baking
    // the inverse dimensions into the buffer retains the public object scale,
    // while avoiding stretched corner radii on tall towers or wide foundations.
    if (Math.min(...size) >= 2 && size[0] >= 6 && size[2] >= 6) {
      const key = size.join(':')
      let bevel = bevels.get(key)
      if (!bevel) {
        bevel = new RoundedBoxGeometry(...size, 1, Math.min(0.32, Math.min(...size) * 0.08))
        bevel.scale(1 / size[0], 1 / size[1], 1 / size[2])
        bevels.set(key, bevel)
      }
      geometry = bevel
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...point)
    mesh.scale.set(...size)
    mesh.name = name
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    staticMeshes.add(mesh)
    parent.add(mesh)
    return mesh
  }

  function addCylinder(
    parent: THREE.Object3D, radius: number, height: number, point: Point3,
    material: THREE.Material, name: string, sides = 12, castShadow = false,
  ): THREE.Mesh {
    let geometry = cylinders.get(sides)
    if (!geometry) {
      geometry = new THREE.CylinderGeometry(1, 1, 1, sides)
      cylinders.set(sides, geometry)
    }
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...point)
    mesh.scale.set(radius, height, radius)
    mesh.name = name
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    staticMeshes.add(mesh)
    parent.add(mesh)
    return mesh
  }

  function addInstancedBoxes(
    parent: THREE.Object3D, instances: readonly BoxInstance[],
    material: THREE.Material, name: string, castShadow = false,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(box, material, instances.length)
    mesh.name = name
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index]
      position.set(...instance.position)
      scale.set(...instance.size)
      rotation.setFromAxisAngle(axis, instance.rotationY ?? 0)
      matrix.compose(position, rotation, scale)
      mesh.setMatrixAt(index, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    parent.add(mesh)
    return mesh
  }

  function addFacadeWindows(
    parent: THREE.Object3D, center: Point3, width: number, height: number,
    depth: number, columns: number, rows: number, material: THREE.Material, name: string,
  ): THREE.InstancedMesh {
    const instances: BoxInstance[] = []
    const panelWidth = Math.max(1.2, (width - 5) / columns * 0.6)
    const panelHeight = Math.max(0.7, (height - 5) / rows * 0.38)
    const yBottom = center[1] - height / 2 + 3.2
    const yStep = (height - 5.2) / Math.max(1, rows - 1)
    const xStep = (width - 7) / Math.max(1, columns - 1)
    const sideColumns = Math.max(2, Math.round(columns * depth / width))
    const zStep = Math.max(0, depth - 7) / Math.max(1, sideColumns - 1)
    for (let row = 0; row < rows; row++) {
      const y = yBottom + row * yStep
      for (let column = 0; column < columns; column++) {
        const x = center[0] - (width - 7) / 2 + column * xStep
        instances.push(
          { position: [x, y, center[2] + depth / 2 + 0.12], size: [panelWidth, panelHeight, 0.32] },
          { position: [x, y, center[2] - depth / 2 - 0.12], size: [panelWidth, panelHeight, 0.32] },
        )
      }
      for (let column = 0; column < sideColumns; column++) {
        const z = center[2] - Math.max(0, depth - 7) / 2 + column * zStep
        instances.push(
          { position: [center[0] + width / 2 + 0.12, y, z], size: [0.32, panelHeight, panelWidth] },
          { position: [center[0] - width / 2 - 0.12, y, z], size: [0.32, panelHeight, panelWidth] },
        )
      }
    }
    return addInstancedBoxes(parent, instances, material, name)
  }

  function addHorizontalBands(
    parent: THREE.Object3D, center: Point3, width: number, height: number,
    depth: number, count: number, material: THREE.Material, name: string,
  ): THREE.InstancedMesh {
    const instances: BoxInstance[] = []
    for (let index = 0; index < count; index++) {
      const y = center[1] - height / 2 + ((index + 1) / (count + 1)) * height
      instances.push({ position: [center[0], y, center[2]], size: [width + 0.7, 0.45, depth + 0.7] })
    }
    return addInstancedBoxes(parent, instances, material, name)
  }

  function addBoxOutline(
    parent: THREE.Object3D, size: Point3, point: Point3,
    material: THREE.LineBasicMaterial, name: string,
  ): THREE.LineSegments {
    const lines = new THREE.LineSegments(edges, material)
    lines.position.set(...point)
    lines.scale.set(...size)
    lines.name = name
    lines.renderOrder = 5
    parent.add(lines)
    return lines
  }

  function addHorizontalRing(
    parent: THREE.Object3D, radius: number, tube: number, point: Point3,
    material: THREE.Material, name: string,
  ): THREE.Mesh {
    const ratio = tube / radius
    let geometry = rings.get(ratio)
    if (!geometry) {
      geometry = new THREE.TorusGeometry(1, ratio, 8, 36)
      rings.set(ratio, geometry)
    }
    const ring = new THREE.Mesh(geometry, material)
    ring.position.set(...point)
    ring.scale.setScalar(radius)
    ring.rotation.x = Math.PI / 2
    ring.name = name
    staticMeshes.add(ring)
    parent.add(ring)
    return ring
  }

  /** Batch only siblings made by this builder, preserving selectable parents. */
  function batchStaticMeshes(root: THREE.Object3D): void {
    const parents: THREE.Object3D[] = []
    root.traverse((object) => { if (object.children.length) parents.push(object) })
    for (const parent of parents) {
      const batches = new Map<string, THREE.Mesh[]>()
      for (const child of parent.children) {
        if (!(child instanceof THREE.Mesh) || !staticMeshes.has(child) || Array.isArray(child.material)) continue
        const key = `${child.geometry.id}:${child.material.id}:${child.castShadow}:${child.receiveShadow}`
        const batch = batches.get(key)
        if (batch) batch.push(child)
        else batches.set(key, [child])
      }
      for (const sources of batches.values()) {
        if (sources.length < 2) continue
        const first = sources[0]
        const mesh = new THREE.InstancedMesh(first.geometry, first.material, sources.length)
        mesh.name = `architecture:batch:${first.name}`
        mesh.castShadow = first.castShadow
        mesh.receiveShadow = first.receiveShadow
        for (let index = 0; index < sources.length; index++) {
          sources[index].updateMatrix()
          mesh.setMatrixAt(index, sources[index].matrix)
          parent.remove(sources[index])
        }
        mesh.instanceMatrix.needsUpdate = true
        parent.add(mesh)
      }
    }
  }

  return { addBox, addCylinder, addInstancedBoxes, addFacadeWindows, addHorizontalBands, addBoxOutline, addHorizontalRing, batchStaticMeshes }
}
