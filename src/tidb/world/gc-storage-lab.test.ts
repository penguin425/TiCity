/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import {
  createGcStorageLab,
  type GcStorageLabChainProjection,
  type GcStorageLabProjection,
} from './gc-storage-lab'

function chain(
  id: string,
  regionId: number,
  states: readonly [
    'present' | 'retained_anchor' | 'filtered',
    'present' | 'retained_anchor' | 'filtered',
    'present' | 'retained_anchor' | 'filtered',
    'present' | 'retained_anchor' | 'filtered',
  ],
): GcStorageLabChainProjection {
  return Object.freeze({
    visible: true,
    id,
    regionId,
    versions: Object.freeze(states.map((state, index) => Object.freeze({
      visible: true,
      id: `${id}-v${index + 1}`,
      commitTs: 100 + index * 10,
      writeType: 'put' as const,
      valueStorage: index === 0
        ? 'write_and_default_cf' as const
        : 'write_cf_inline' as const,
      state,
    })) as unknown as GcStorageLabChainProjection['versions']),
    overflowVersions: 0,
  })
}

const ACTIVE_PROJECTION: GcStorageLabProjection = Object.freeze({
  mode: 'inspect',
  phase: 'compacting',
  round: 2,
  reducedMotion: false,
  pulse: 1,
  flowStep: 'compact',
  safePoint: Object.freeze({
    previous: 120,
    candidate: 210,
    globalMinStartTs: null,
    activeTransactionBound: null,
    serviceSafePoint: 210,
    staged: 210,
    visibilitySaved: 210,
    published: 210,
    blocked: false,
    gateState: 'published',
  }),
  blocker: Object.freeze({
    visible: true,
    transactionId: 'txn-gc-blocker',
    startTs: 150,
    status: 'completed',
  }),
  resolveLocks: Object.freeze({
    implementation: 'REGION_SCAN_LOCK',
    scannedRegionIds: Object.freeze([8, 20]),
    locks: Object.freeze([
      Object.freeze({
        visible: true,
        id: 'lock-commit',
        regionId: 8,
        startTs: 130,
        primaryStatus: 'committed' as const,
        status: 'resolved_commit' as const,
      }),
      Object.freeze({
        visible: true,
        id: 'lock-rollback',
        regionId: 20,
        startTs: 140,
        primaryStatus: 'rolled_back' as const,
        status: 'resolved_rollback' as const,
      }),
      Object.freeze({
        visible: false,
        id: '',
        regionId: -1,
        startTs: 0,
        primaryStatus: 'committed' as const,
        status: 'pending' as const,
      }),
    ] as const),
  }),
  deleteRanges: Object.freeze([
    Object.freeze({
      visible: true,
      id: 'range-drop',
      dropTs: 125,
      status: 'deleted' as const,
    }),
    Object.freeze({
      visible: false,
      id: '',
      dropTs: 0,
      status: 'pending' as const,
    }),
  ] as const),
  stores: Object.freeze([
    Object.freeze({
      visible: true,
      storeId: 'tikv-1',
      detectedSafePoint: 210,
      detectorCurrent: true,
      compaction: 'complete' as const,
      filterActive: false,
    }),
    Object.freeze({
      visible: true,
      storeId: 'tikv-2',
      detectedSafePoint: 210,
      detectorCurrent: true,
      compaction: 'running' as const,
      filterActive: true,
    }),
    Object.freeze({
      visible: true,
      storeId: 'tikv-3',
      detectedSafePoint: 210,
      detectorCurrent: true,
      compaction: 'eligible' as const,
      filterActive: false,
    }),
  ] as const),
  chains: Object.freeze([
    chain('chain-a', 8, ['filtered', 'retained_anchor', 'present', 'present']),
    chain('chain-b', 8, ['filtered', 'filtered', 'present', 'present']),
    chain('chain-c', 20, ['retained_anchor', 'present', 'present', 'present']),
    chain('chain-d', 20, ['filtered', 'present', 'present', 'present']),
  ] as const),
  overflow: Object.freeze({
    stores: 0,
    locks: 0,
    deleteRanges: 0,
    chains: 0,
    versions: 0,
    total: 0,
  }),
})

function instanceScale(
  mesh: THREE.InstancedMesh,
  index: number,
): THREE.Vector3 {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix)
}

function instancePosition(
  mesh: THREE.InstancedMesh,
  index: number,
): THREE.Vector3 {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixPosition(matrix)
}

function sceneResources(root: THREE.Object3D): {
  objects: number
  geometries: Set<THREE.BufferGeometry>
  materials: Set<THREE.Material>
} {
  let objects = 0
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    objects++
    const drawable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    if (drawable.geometry) geometries.add(drawable.geometry)
    if (drawable.material) {
      const bound = Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]
      for (const material of bound) materials.add(material)
    }
  })
  return { objects, geometries, materials }
}

describe('GC/Storage Lab fixed-capacity world', () => {
  it('prebuilds the bounded gate, services, stores, filters, and MVCC board', () => {
    const lab = createGcStorageLab()
    const stores = lab.object.getObjectByName(
      'gc-storage-lab:store-detectors',
    ) as THREE.InstancedMesh
    const filters = lab.object.getObjectByName(
      'gc-storage-lab:compaction-filters',
    ) as THREE.InstancedMesh
    const chains = lab.object.getObjectByName(
      'gc-storage-lab:mvcc-chain-decks',
    ) as THREE.InstancedMesh
    const versions = lab.object.getObjectByName(
      'gc-storage-lab:mvcc-version-slots',
    ) as THREE.InstancedMesh

    expect(lab.object.userData.provenance).toBe('MODEL / SIMULATED')
    expect(lab.object.userData.boundary).toContain('Raft log GC')
    expect(stores.count).toBe(3)
    expect(filters.count).toBe(3)
    expect(chains.count).toBe(4)
    expect(versions.count).toBe(16)
    expect(versions.userData.stateShapes).toEqual({
      present: 'block',
      retained_anchor: 'tall-anchor',
      filtered: 'flat-filtered-marker',
    })
    expect(lab.debug.resources).toMatchObject({
      drawableCount: 9,
      geometryCount: 4,
      materialCount: 3,
      storeCapacity: 3,
      lockCapacity: 3,
      deleteRangeCapacity: 2,
      chainCapacity: 4,
      versionsPerChain: 4,
      versionCapacity: 16,
      flowCapacity: 8,
      shadowCount: 0,
    })

    lab.dispose()
  })

  it('projects exact safe-point, store, and version states with shape redundancy', () => {
    const lab = createGcStorageLab()
    lab.update(ACTIVE_PROJECTION)

    const versions = lab.object.getObjectByName(
      'gc-storage-lab:mvcc-version-slots',
    ) as THREE.InstancedMesh
    const retained = instanceScale(versions, 1)
    const filtered = instanceScale(versions, 0)
    const present = instanceScale(versions, 2)

    expect(lab.gateAnchor.userData).toMatchObject({
      gateState: 'published',
      previous: 120,
      staged: 210,
      visibilitySaved: 210,
      published: 210,
      blocked: false,
    })
    expect(lab.serviceAnchors[0].userData).toMatchObject({
      implementation: 'REGION_SCAN_LOCK',
      scannedRegionIds: [8, 20],
      resolvedLocks: 2,
    })
    expect(lab.storeAnchors[1].userData).toMatchObject({
      storeId: 'tikv-2',
      detectedSafePoint: 210,
      compaction: 'running',
      filterActive: true,
    })
    expect(retained.y).toBeGreaterThan(present.y)
    expect(filtered.y).toBeLessThan(present.y)
    expect(versions.userData.states.slice(0, 4)).toEqual([
      'filtered',
      'retained_anchor',
      'present',
      'present',
    ])

    lab.dispose()
  })

  it('loops flow particles, but holds their positions for reduced motion', () => {
    const lab = createGcStorageLab()
    const particles = lab.object.getObjectByName(
      'gc-storage-lab:flow-particles',
    ) as THREE.InstancedMesh

    lab.update({ ...ACTIVE_PROJECTION, pulse: 0, reducedMotion: false })
    const start = instancePosition(particles, 0)
    lab.update({ ...ACTIVE_PROJECTION, pulse: 0.7, reducedMotion: false })
    const moved = instancePosition(particles, 0)
    expect(moved.distanceTo(start)).toBeGreaterThan(1)

    lab.update({ ...ACTIVE_PROJECTION, pulse: 0, reducedMotion: true })
    const reducedStart = instancePosition(particles, 0)
    lab.update({ ...ACTIVE_PROJECTION, pulse: 0.7, reducedMotion: true })
    const reducedEnd = instancePosition(particles, 0)
    expect(reducedEnd.distanceTo(reducedStart)).toBeCloseTo(0)

    lab.dispose()
  })

  it('reuses scene resources, reapplies themes, and disposes once', () => {
    const lab = createGcStorageLab()
    const initial = sceneResources(lab.object)
    const resources = lab.debug.resources
    const stores = lab.object.getObjectByName(
      'gc-storage-lab:store-detectors',
    ) as THREE.InstancedMesh

    for (let index = 0; index < 30; index++) {
      lab.update({
        ...ACTIVE_PROJECTION,
        pulse: index / 29,
        reducedMotion: index % 3 === 0,
      })
    }
    const after = sceneResources(lab.object)
    expect(after.objects).toBe(initial.objects)
    expect(after.geometries).toEqual(initial.geometries)
    expect(after.materials).toEqual(initial.materials)
    expect(lab.debug.resources).toBe(resources)
    expect(lab.debug.updateCount).toBe(30)

    lab.setTheme('day')
    const color = new THREE.Color()
    stores.getColorAt(1, color)
    expect(color.getHex()).toBe(SEMANTIC_COLORS.day.gc)

    let geometryDisposals = 0
    let materialDisposals = 0
    for (const geometry of initial.geometries) {
      geometry.addEventListener('dispose', () => {
        geometryDisposals++
      })
    }
    for (const material of initial.materials) {
      material.addEventListener('dispose', () => {
        materialDisposals++
      })
    }
    lab.dispose()
    lab.dispose()
    expect(geometryDisposals).toBe(resources.geometryCount)
    expect(materialDisposals).toBe(resources.materialCount)
    expect(lab.debug.disposed).toBe(true)
  })
})
