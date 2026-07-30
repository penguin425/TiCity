/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import {
  createLockLab,
  type LockLabProjection,
} from './lock-lab'

const ACTIVE_PROJECTION: LockLabProjection = Object.freeze({
  mode: 'inspect',
  phase: 'victim',
  reducedMotion: false,
  transactions: Object.freeze([
    Object.freeze({
      visible: true,
      id: 'txn-a',
      clientId: 'client-a',
      attempt: 1,
      retryOfTransactionId: null,
      startTs: 101,
      commitTs: null,
      status: 'waiting' as const,
      shape: 'cylinder' as const,
    }),
    Object.freeze({
      visible: true,
      id: 'txn-b-1',
      clientId: 'client-b',
      attempt: 1,
      retryOfTransactionId: null,
      startTs: 102,
      commitTs: null,
      status: 'victim' as const,
      shape: 'diamond' as const,
    }),
    Object.freeze({
      visible: true,
      id: 'txn-b-2',
      clientId: 'client-b',
      attempt: 2,
      retryOfTransactionId: 'txn-b-1',
      startTs: 103,
      commitTs: null,
      status: 'active' as const,
      shape: 'double-ring' as const,
    }),
  ] as const),
  resources: Object.freeze([
    Object.freeze({
      visible: true,
      id: 'resource-a',
      regionId: 6,
      leaderStoreId: 'tikv-1',
      holderSlot: 0 as const,
      waiterSlots: Object.freeze([1, -1] as const),
    }),
    Object.freeze({
      visible: true,
      id: 'resource-b',
      regionId: 7,
      leaderStoreId: 'tikv-2',
      holderSlot: 1 as const,
      waiterSlots: Object.freeze([0, 2] as const),
    }),
  ] as const),
  edges: Object.freeze([
    Object.freeze({
      visible: true,
      id: 'a-to-b',
      waiterSlot: 0 as const,
      holderSlot: 1 as const,
      resourceSlot: 1 as const,
      cycle: true,
    }),
    Object.freeze({
      visible: true,
      id: 'b-to-a',
      waiterSlot: 1 as const,
      holderSlot: 0 as const,
      resourceSlot: 0 as const,
      cycle: true,
    }),
    ...Array.from({ length: 4 }, (_, index) => Object.freeze({
      visible: false,
      id: `empty-${index}`,
      waiterSlot: -1 as const,
      holderSlot: -1 as const,
      resourceSlot: -1 as const,
      cycle: false,
    })),
  ] as unknown as LockLabProjection['edges']),
  detector: Object.freeze({
    active: true,
    scope: 'cluster_wide',
    leaderStoreId: 'tikv-3',
    state: 'victim-selected' as const,
    pulse: 1,
  }),
  deadlock: Object.freeze({
    visible: true,
    id: 'deadlock-1',
    victimSlot: 1 as const,
    selectionPolicy: 'cycle_closing_waiter_model_policy',
    retryable: false,
    resolution: 'rolling_back' as const,
  }),
  applicationRetry: Object.freeze({
    visible: true,
    source: 'application',
    clientId: 'client-b',
    retryOfTransactionId: 'txn-b-1',
    fixedBackoffMs: 120,
    status: 'started' as const,
    newTransactionSlot: 2 as const,
  }),
  overflow: Object.freeze({
    transactions: 0,
    resources: 0,
    waiters: 0,
    edges: 0,
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

function instanceColor(
  mesh: THREE.InstancedMesh,
  index: number,
): number {
  const color = new THREE.Color()
  mesh.getColorAt(index, color)
  return color.getHex()
}

function sceneCounts(root: THREE.Object3D): {
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

describe('Lock Lab fixed-capacity world', () => {
  it('prebuilds the bounded MODEL / SIMULATED topology and distinct shapes', () => {
    const lab = createLockLab()
    const transactionA = lab.object.getObjectByName(
      'lock-lab:transaction-a',
    ) as THREE.InstancedMesh
    const transactionB = lab.object.getObjectByName(
      'lock-lab:transaction-b',
    ) as THREE.InstancedMesh
    const transactionRetry = lab.object.getObjectByName(
      'lock-lab:transaction-retry',
    ) as THREE.InstancedMesh
    const resources = lab.object.getObjectByName(
      'lock-lab:resource-decks',
    ) as THREE.InstancedMesh
    const holders = lab.object.getObjectByName(
      'lock-lab:holder-sockets',
    ) as THREE.InstancedMesh
    const waiters = lab.object.getObjectByName(
      'lock-lab:waiter-slots',
    ) as THREE.InstancedMesh
    const edges = lab.object.getObjectByName(
      'lock-lab:wait-for-edges',
    ) as THREE.InstancedMesh

    expect(lab.object.userData.provenance).toBe('MODEL / SIMULATED')
    expect(transactionA.geometry).toBeInstanceOf(THREE.CylinderGeometry)
    expect(transactionA.userData.shape).toBe('cylinder')
    expect(transactionB.geometry).toBeInstanceOf(THREE.OctahedronGeometry)
    expect(transactionB.userData.shape).toBe('diamond')
    expect(transactionRetry.geometry).toBeInstanceOf(THREE.TorusGeometry)
    expect(transactionRetry.userData.shape).toBe('double-ring')
    expect(resources.count).toBe(2)
    expect(holders.count).toBe(2)
    expect(waiters.count).toBe(4)
    expect(edges.count).toBe(6)
    expect(lab.debug.resources).toMatchObject({
      transactionCapacity: 3,
      resourceCapacity: 2,
      holderCapacity: 2,
      waitersPerResource: 2,
      edgeCapacity: 6,
      detectorCapacity: 1,
      deadlockHistoryCapacity: 1,
    })

    lab.dispose()
  })

  it('switches overview/inspect and paints holders, queues, graph, detector, and victim history', () => {
    const lab = createLockLab()
    const inspect = lab.object.getObjectByName(
      'lock-lab:inspect',
    ) as THREE.Group
    const transactionA = lab.object.getObjectByName(
      'lock-lab:transaction-a',
    ) as THREE.InstancedMesh
    const transactionB = lab.object.getObjectByName(
      'lock-lab:transaction-b',
    ) as THREE.InstancedMesh
    const transactionRetry = lab.object.getObjectByName(
      'lock-lab:transaction-retry',
    ) as THREE.InstancedMesh
    const edges = lab.object.getObjectByName(
      'lock-lab:wait-for-edges',
    ) as THREE.InstancedMesh
    const history = lab.object.getObjectByName(
      'lock-lab:deadlock-history',
    ) as THREE.Mesh
    const victim = lab.object.getObjectByName(
      'lock-lab:victim-marker',
    ) as THREE.Mesh
    const detector = lab.object.getObjectByName(
      'lock-lab:detector',
    ) as THREE.Mesh
    const before = JSON.stringify(ACTIVE_PROJECTION)

    expect(lab.object.visible).toBe(false)
    lab.update({ ...ACTIVE_PROJECTION, mode: 'overview' })
    expect(lab.object.visible).toBe(true)
    expect(inspect.visible).toBe(false)

    lab.update(ACTIVE_PROJECTION)
    expect(inspect.visible).toBe(true)
    expect(instanceScale(transactionA, 0).length()).toBeGreaterThan(0)
    expect(instanceScale(transactionA, 1).length()).toBeGreaterThan(0)
    expect(instanceScale(transactionA, 5).length()).toBeGreaterThan(0)
    expect(instanceScale(transactionB, 2).length()).toBeGreaterThan(0)
    expect(instanceScale(transactionB, 4).length()).toBeGreaterThan(0)
    expect(instanceScale(transactionRetry, 6).length()).toBeGreaterThan(0)
    expect(instanceScale(edges, 0).y).toBeGreaterThan(10)
    expect(instanceScale(edges, 1).y).toBeGreaterThan(10)
    expect(edges.userData.direction).toBe('waiter-to-holder')
    expect(history.visible).toBe(true)
    expect(history.userData.resolution).toBe('rolling_back')
    expect(victim.visible).toBe(true)
    expect(victim.userData.victimSlot).toBe(1)
    expect(detector.userData).toMatchObject({
      active: true,
      state: 'victim-selected',
      leaderStoreId: 'tikv-3',
    })
    expect(lab.transactionAnchors[2].userData).toMatchObject({
      transactionId: 'txn-b-2',
      attempt: 2,
      shape: 'double-ring',
    })
    expect(lab.resourceAnchors[0].userData).toMatchObject({
      resourceId: 'resource-a',
      storage: 'leader_memory',
      wakePolicy: 'smallest_start_ts_model_policy',
    })
    expect(JSON.stringify(ACTIVE_PROJECTION)).toBe(before)

    lab.dispose()
  })

  it('uses shape plus semantic color and suppresses pulse scaling for reduced motion', () => {
    const lab = createLockLab()
    const transactionA = lab.object.getObjectByName(
      'lock-lab:transaction-a',
    ) as THREE.InstancedMesh
    const transactionB = lab.object.getObjectByName(
      'lock-lab:transaction-b',
    ) as THREE.InstancedMesh
    const detector = lab.object.getObjectByName(
      'lock-lab:detector',
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    const history = lab.object.getObjectByName(
      'lock-lab:deadlock-history',
    ) as THREE.Mesh

    lab.update(ACTIVE_PROJECTION)
    const movingDetectorScale = detector.scale.x
    const movingHistoryScale = history.scale.x
    expect(instanceColor(transactionA, 0))
      .toBe(SEMANTIC_COLORS.night.client)
    expect(instanceColor(transactionB, 0))
      .toBe(SEMANTIC_COLORS.night.txn2pc)

    lab.update({ ...ACTIVE_PROJECTION, reducedMotion: true })
    expect(movingDetectorScale).toBeGreaterThan(detector.scale.x)
    expect(movingHistoryScale).toBeGreaterThan(history.scale.x)
    expect(detector.scale.x).toBeCloseTo(5.5)
    expect(history.scale.x).toBeCloseTo(9)

    lab.setTheme('day')
    expect(detector.material.color.getHex()).toBe(SEMANTIC_COLORS.day.tso)
    expect(instanceColor(transactionA, 0)).toBe(SEMANTIC_COLORS.day.client)
    lab.setTheme('night')
    expect(detector.material.color.getHex()).toBe(SEMANTIC_COLORS.night.tso)

    lab.dispose()
  })

  it('keeps object and GPU resource identities stable across repeated updates', () => {
    const lab = createLockLab()
    const initial = sceneCounts(lab.object)
    const resources = lab.debug.resources
    const edges = lab.object.getObjectByName('lock-lab:wait-for-edges')

    for (let index = 0; index < 40; index++) {
      lab.update({
        ...ACTIVE_PROJECTION,
        reducedMotion: index % 3 === 0,
        detector: {
          ...ACTIVE_PROJECTION.detector,
          pulse: index / 39,
        },
      })
    }

    const after = sceneCounts(lab.object)
    expect(after.objects).toBe(initial.objects)
    expect(after.geometries).toEqual(initial.geometries)
    expect(after.materials).toEqual(initial.materials)
    expect(lab.object.getObjectByName('lock-lab:wait-for-edges')).toBe(edges)
    expect(lab.debug.resources).toBe(resources)
    expect(lab.debug.updateCount).toBe(40)

    lab.dispose()
  })

  it('disposes every owned geometry and material exactly once', () => {
    const lab = createLockLab()
    const scene = sceneCounts(lab.object)
    let geometryDisposals = 0
    let materialDisposals = 0

    for (const geometry of scene.geometries) {
      geometry.addEventListener('dispose', () => {
        geometryDisposals++
      })
    }
    for (const material of scene.materials) {
      material.addEventListener('dispose', () => {
        materialDisposals++
      })
    }

    lab.dispose()
    lab.dispose()

    expect(geometryDisposals).toBe(lab.debug.resources.geometryCount)
    expect(materialDisposals).toBe(lab.debug.resources.materialCount)
    expect(lab.debug.disposed).toBe(true)
    expect(lab.object.children).toHaveLength(0)
  })
})
