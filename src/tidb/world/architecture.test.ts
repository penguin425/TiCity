/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createTiDBSceneGraph } from './city'
import { COMPONENT_ANCHORS, TIKV_ARCHITECTURE, TIKV_BOUNDS } from './layout'
import { SQL_TERRACE_HEIGHT, SQL_TOWERS } from './sql-architecture'
import { TIKV_SERVICE_STAIR } from './storage-architecture'

function instanceBounds(mesh: THREE.InstancedMesh): THREE.Box3[] {
  mesh.geometry.computeBoundingBox()
  const matrix = new THREE.Matrix4()
  const bounds: THREE.Box3[] = []
  for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, matrix)
    bounds.push(mesh.geometry.boundingBox!.clone().applyMatrix4(matrix))
  }
  return bounds
}

describe('constructed campus architecture', () => {
  it('keeps both TiFlash glazed ends outward-facing at their original surface positions', () => {
    const city = createTiDBSceneGraph()
    const anchor = COMPONENT_ANCHORS['tiflash.0']
    const matrix = new THREE.Matrix4()
    const normalMatrix = new THREE.Matrix3()
    const point = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const sides = new Set<number>()
    for (const name of ['architecture:glass-panels', 'architecture:window-panels']) {
      const mesh = city.root.getObjectByName(name) as THREE.InstancedMesh
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix)
        point.set(0, 0, 0.5).applyMatrix4(matrix)
        if (Math.abs(point.x - anchor[0]) > 41 || Math.abs(point.z - anchor[2]) > 21) continue
        const side = Math.sign(point.z - anchor[2])
        normal.set(0, 0, 1).applyMatrix3(normalMatrix.getNormalMatrix(matrix)).normalize()
        // Former 0.22m boxes centred at ±19.13m presented their visible glass
        // at ±19.24m. Removing buried faces must retain that exact surface.
        expect(Math.abs(point.z - anchor[2])).toBeCloseTo(19.24, 4)
        expect(normal.z * side).toBeCloseTo(1, 8)
        sides.add(side)
      }
    }
    expect([...sides].sort()).toEqual([-1, 1])
    city.dispose()
  })

  it('shares cooling guards inside one city without lending their disposal lifecycle to another city', () => {
    const first = createTiDBSceneGraph()
    const second = createTiDBSceneGraph()
    const guardGeometry = (city: ReturnType<typeof createTiDBSceneGraph>, store: number): THREE.BufferGeometry =>
      (city.registry.get(`tikv.${store}`)!.object.getObjectByName(
        'architecture:batch:tikv:service-fan-guard',
      ) as THREE.InstancedMesh).geometry
    const firstBuffer = guardGeometry(first, 0)
    const secondBuffer = guardGeometry(second, 0)
    expect(guardGeometry(first, 1)).toBe(firstBuffer)
    expect(guardGeometry(first, 2)).toBe(firstBuffer)
    expect(secondBuffer).not.toBe(firstBuffer)
    let secondDisposals = 0
    secondBuffer.addEventListener('dispose', () => { secondDisposals++ })
    first.dispose()
    expect(secondDisposals).toBe(0)
    second.dispose()
    expect(secondDisposals).toBe(1)
  })

  it('seats every SQL roof plant on an exposed working slab without changing the roof heights', () => {
    for (const tower of SQL_TOWERS) {
      for (const plant of tower.roofPlant) {
        const supportingTiers = tower.tiers.filter((tier) =>
          Math.abs(plant.position[0] - tier.position[0]) + plant.size[0] / 2 <= tier.size[0] / 2 &&
          Math.abs(plant.position[2] - tier.position[2]) + plant.size[2] / 2 <= tier.size[2] / 2,
        )
        expect(supportingTiers.length).toBeGreaterThan(0)
        const roof = Math.max(...supportingTiers.map((tier) =>
          tier.position[1] + tier.size[1] / 2 + SQL_TERRACE_HEIGHT,
        ))
        expect(plant.position[1] - plant.size[1] / 2).toBeCloseTo(roof, 8)
      }
      expect(Math.max(...tower.roofPlant.map((plant) =>
        plant.position[1] + plant.size[1] / 2,
      ))).toBeCloseTo(tower.height, 8)
    }
  })

  it('keeps round cooling guards within their cabinet faces on every store', () => {
    const city = createTiDBSceneGraph()
    for (let store = 0; store < 3; store++) {
      const id = `tikv.${store}` as 'tikv.0' | 'tikv.1' | 'tikv.2'
      const group = city.registry.get(id)!.object
      const anchor = COMPONENT_ANCHORS[id]
      const cabinets = instanceBounds(group.getObjectByName('tikv:service-machinery') as THREE.InstancedMesh)
      const guards = instanceBounds(group.getObjectByName('architecture:batch:tikv:service-fan-guard') as THREE.InstancedMesh)
      expect(guards.length).toBeGreaterThan(0)
      for (const guard of guards) {
        const guardSize = guard.getSize(new THREE.Vector3())
        expect(guardSize.x).toBeCloseTo(guardSize.y, 5)
        const side = guard.getCenter(new THREE.Vector3()).z > anchor[2] ? 1 : -1
        expect(cabinets.some((cabinet) => {
          const gap = side > 0 ? guard.min.z - cabinet.max.z : cabinet.min.z - guard.max.z
          return gap >= 0 && gap < 1.5 &&
            cabinet.min.x <= guard.min.x && cabinet.max.x >= guard.max.x &&
            cabinet.min.y <= guard.min.y && cabinet.max.y >= guard.max.y
        })).toBe(true)
      }
    }
    city.dispose()
  })

  it('brings the service stairs to deck height outside the rack slab and inside the district apron', () => {
    const city = createTiDBSceneGraph()
    for (let store = 0; store < 3; store++) {
      const id = `tikv.${store}` as 'tikv.0' | 'tikv.1' | 'tikv.2'
      const anchor = COMPONENT_ANCHORS[id]
      const fittings = city.registry.get(id)!.object.getObjectByName('tikv:service-fittings') as THREE.InstancedMesh
      const treads = instanceBounds(fittings).filter((bounds) => {
        const center = bounds.getCenter(new THREE.Vector3())
        const size = bounds.getSize(new THREE.Vector3())
        return Math.abs(center.x - anchor[0] - TIKV_SERVICE_STAIR.centerX) < 0.001 &&
          Math.abs(size.y - 0.18) < 0.001
      }).sort((a, b) => a.max.y - b.max.y)
      expect(treads.length).toBeGreaterThan(20)
      expect(treads.at(-1)!.max.y).toBeCloseTo(TIKV_ARCHITECTURE.deckTop, 5)
      for (let index = 0; index < treads.length; index++) {
        const tread = treads[index]
        expect(tread.min.x).toBeGreaterThan(anchor[0] + TIKV_ARCHITECTURE.deckWidth / 2)
        expect(tread.max.x).toBeLessThan(TIKV_BOUNDS[store].maxX)
        expect(tread.min.z).toBeGreaterThan(TIKV_BOUNDS[store].minZ)
        expect(tread.max.z).toBeLessThan(TIKV_BOUNDS[store].maxZ)
        if (index > 0) {
          expect(tread.max.y - treads[index - 1].max.y).toBeLessThanOrEqual(0.35)
          expect(tread.max.z).toBeGreaterThanOrEqual(treads[index - 1].min.z)
        }
      }
    }
    city.dispose()
  })
})
