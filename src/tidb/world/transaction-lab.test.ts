/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import {
  createTransactionLab,
  type TransactionLabProjection,
} from './transaction-lab'

const ACTIVE_PROJECTION: TransactionLabProjection = Object.freeze({
  mode: 'inspect',
  phase: 'prewrite',
  reducedMotion: false,
  coordinatorActive: true,
  tso: Object.freeze({ active: true, pulse: 0.75 }),
  mutations: Object.freeze([
    Object.freeze({ keyRole: 'primary' as const, state: 'prewriting' as const }),
    Object.freeze({ keyRole: 'secondary' as const, state: 'buffered' as const }),
  ] as const),
  regions: Object.freeze([
    Object.freeze({
      id: 'region-7',
      keyRole: 'primary' as const,
      leaderPeer: 0 as const,
      peers: Object.freeze([
        Object.freeze({ storeId: 'tikv-1', log: 'applied' as const }),
        Object.freeze({ storeId: 'tikv-2', log: 'committed' as const }),
        Object.freeze({ storeId: 'tikv-3', log: 'appended' as const }),
      ] as const),
      quorumAcks: 2,
      apply: 'applied' as const,
      lock: 'pessimistic-memory' as const,
      mvcc: Object.freeze({
        lock: 'pending' as const,
        default: 'pending' as const,
        write: 'empty' as const,
      }),
    }),
    Object.freeze({
      id: 'region-20',
      keyRole: 'secondary' as const,
      leaderPeer: 2 as const,
      peers: Object.freeze([
        Object.freeze({ storeId: 'tikv-1', log: 'committed' as const }),
        Object.freeze({ storeId: 'tikv-2', log: 'unavailable' as const }),
        Object.freeze({ storeId: 'tikv-3', log: 'committed' as const }),
      ] as const),
      quorumAcks: 2,
      apply: 'ready' as const,
      lock: 'prewrite' as const,
      mvcc: Object.freeze({
        lock: 'pending' as const,
        default: 'committed' as const,
        write: 'pending' as const,
      }),
    }),
  ] as const),
})

function instanceScale(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const matrix = new THREE.Matrix4()
  mesh.getMatrixAt(index, matrix)
  return new THREE.Vector3().setFromMatrixScale(matrix)
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

describe('Transaction Lab cutaway', () => {
  it('prebuilds two Regions with exactly three Raft voters and one quorum display each', () => {
    const lab = createTransactionLab()
    const voters = lab.object.getObjectByName('transaction-lab:raft-voters')
    const quorum = lab.object.getObjectByName('transaction-lab:quorum-indicators')
    const mvcc = lab.object.getObjectByName('transaction-lab:mvcc-cells')

    expect(voters).toBeInstanceOf(THREE.InstancedMesh)
    expect((voters as THREE.InstancedMesh).count).toBe(6)
    expect(voters?.userData.votersPerRegion).toBe(3)
    expect(quorum).toBeInstanceOf(THREE.InstancedMesh)
    expect((quorum as THREE.InstancedMesh).count).toBe(2)
    expect(quorum?.userData.required).toBe(2)
    expect(mvcc).toBeInstanceOf(THREE.InstancedMesh)
    expect((mvcc as THREE.InstancedMesh).count).toBe(6)
    expect(mvcc?.userData.columns).toEqual(['LOCK', 'DEFAULT', 'WRITE'])
    expect(lab.debug.resources).toMatchObject({
      regionCapacity: 2,
      votersPerRegion: 3,
      mutationSlots: 2,
      mvccCells: 6,
    })

    lab.dispose()
  })

  it('switches between hidden, overview, and inspect without constructing objects', () => {
    const lab = createTransactionLab()
    const overview = lab.object.getObjectByName('transaction-lab:overview')
    const inspect = lab.object.getObjectByName('transaction-lab:inspect')
    const resources = lab.debug.resources

    expect(lab.object.visible).toBe(false)

    lab.update({ ...ACTIVE_PROJECTION, mode: 'overview' })
    expect(lab.object.visible).toBe(true)
    expect(overview?.visible).toBe(true)
    expect(inspect?.visible).toBe(false)

    lab.update(ACTIVE_PROJECTION)
    expect(inspect?.visible).toBe(true)

    lab.update({ ...ACTIVE_PROJECTION, mode: 'hidden' })
    expect(lab.object.visible).toBe(false)
    expect(lab.debug.resources).toBe(resources)

    lab.dispose()
  })

  it('projects leaders, leader-only memory locks, quorum, MVCC, and key roles', () => {
    const lab = createTransactionLab()
    const before = JSON.stringify(ACTIVE_PROJECTION)
    lab.update(ACTIVE_PROJECTION)

    const leaders = lab.object.getObjectByName(
      'transaction-lab:raft-leaders',
    ) as THREE.InstancedMesh
    const locks = lab.object.getObjectByName(
      'transaction-lab:leader-memory-locks',
    ) as THREE.InstancedMesh
    const primary = lab.object.getObjectByName(
      'transaction-lab:primary-markers',
    ) as THREE.InstancedMesh
    const secondary = lab.object.getObjectByName(
      'transaction-lab:secondary-markers',
    ) as THREE.InstancedMesh
    const quorum = lab.object.getObjectByName(
      'transaction-lab:quorum-indicators',
    ) as THREE.InstancedMesh
    const apply = lab.object.getObjectByName(
      'transaction-lab:apply-indicators',
    ) as THREE.InstancedMesh

    expect(instanceScale(leaders, 0).y).toBeGreaterThan(4)
    expect(instanceScale(leaders, 1).length()).toBe(0)
    expect(instanceScale(leaders, 5).y).toBeGreaterThan(4)
    expect(instanceScale(locks, 0).x).toBeGreaterThan(4)
    expect(instanceScale(locks, 1).length()).toBe(0)
    /* A prewrite lock is represented in MVCC, never as a leader-memory lock. */
    expect(instanceScale(locks, 5).length()).toBe(0)

    expect(Array.from(quorum.userData.acknowledgements as Uint8Array))
      .toEqual([2, 2])
    expect(Array.from(apply.userData.states as Uint8Array)).toEqual([2, 1])
    expect(instanceScale(primary, 0).y).toBeGreaterThan(0)
    expect(instanceScale(primary, 1).length()).toBe(0)
    expect(instanceScale(secondary, 0).length()).toBe(0)
    expect(instanceScale(secondary, 1).y).toBeGreaterThan(0)
    expect(lab.labelAnchors[0].userData).toMatchObject({
      regionId: 'region-7',
      keyRole: 'primary',
      label: 'PRIMARY',
    })
    expect(lab.labelAnchors[1].userData).toMatchObject({
      regionId: 'region-20',
      keyRole: 'secondary',
      label: 'SECONDARY',
    })
    expect(JSON.stringify(ACTIVE_PROJECTION)).toBe(before)

    lab.dispose()
  })

  it('uses a static reduced-motion TSO state and applies day/night semantic colors', () => {
    const lab = createTransactionLab()
    const pulse = lab.object.getObjectByName(
      'transaction-lab:tso-pulse',
    ) as THREE.Mesh
    const route = lab.object.getObjectByName(
      'transaction-lab:2pc-route',
    ) as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>

    lab.update({
      ...ACTIVE_PROJECTION,
      tso: { active: true, pulse: 1 },
      reducedMotion: false,
    })
    const animatedScale = pulse.scale.x

    lab.update({
      ...ACTIVE_PROJECTION,
      tso: { active: true, pulse: 1 },
      reducedMotion: true,
    })
    expect(animatedScale).toBeGreaterThan(pulse.scale.x)
    expect(pulse.scale.x).toBeCloseTo(7)

    lab.setTheme('day')
    expect(route.material.color.getHex()).toBe(SEMANTIC_COLORS.day.txn2pc)
    lab.setTheme('night')
    expect(route.material.color.getHex()).toBe(SEMANTIC_COLORS.night.txn2pc)

    lab.dispose()
  })

  it('keeps object and GPU resource identities stable across repeated updates', () => {
    const lab = createTransactionLab()
    const initial = sceneCounts(lab.object)
    const resources = lab.debug.resources
    const voters = lab.object.getObjectByName('transaction-lab:raft-voters')

    for (let index = 0; index < 40; index++) {
      lab.update({
        ...ACTIVE_PROJECTION,
        phase: index % 2 === 0 ? 'prewrite' : 'commit-primary',
        reducedMotion: index % 3 === 0,
        tso: { active: true, pulse: index / 39 },
      })
    }

    const after = sceneCounts(lab.object)
    expect(after.objects).toBe(initial.objects)
    expect(after.geometries).toEqual(initial.geometries)
    expect(after.materials).toEqual(initial.materials)
    expect(lab.object.getObjectByName('transaction-lab:raft-voters')).toBe(voters)
    expect(lab.debug.resources).toBe(resources)
    expect(lab.debug.updateCount).toBe(40)

    lab.dispose()
  })

  it('disposes every owned geometry and material exactly once', () => {
    const lab = createTransactionLab()
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
