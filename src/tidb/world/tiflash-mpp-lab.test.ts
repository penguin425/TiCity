/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import {
  createTiFlashMppLab,
  TIFLASH_MPP_LAB_FRAGMENT_CAPACITY,
  TIFLASH_MPP_LAB_LEARNER_CAPACITY,
  TIFLASH_MPP_LAB_PACKET_CAPACITY,
  TIFLASH_MPP_LAB_STORE_CAPACITY,
  TIFLASH_MPP_LAB_TASK_CAPACITY,
  TIFLASH_MPP_LAB_TUNNEL_CAPACITY,
} from './tiflash-mpp-lab'
import type {
  TiFlashMppLabProjection,
  TiFlashMppLabTunnelProjection,
} from './tiflash-mpp-lab'

const ACTIVE_PROJECTION: TiFlashMppLabProjection = {
  mode: 'inspect',
  phase: 'exchanging',
  reducedMotion: false,
  pulse: 0.25,
  stores: [
    { visible: true, storeId: 'tiflash-1', active: true },
    { visible: true, storeId: 'tiflash-2', active: true },
  ],
  learners: [
    {
      visible: true,
      regionId: 24,
      leaderStoreId: 'tikv-1',
      tiflashStoreId: 'tiflash-1',
      storeSlot: 0,
      replicaAvailable: true,
      leaderCommitIndex: 130,
      replicatedIndex: 130,
      appliedIndex: 130,
      requestedReadIndex: 130,
      gateState: 'ready',
      gateReason: 'applied_index_ready',
    },
    {
      visible: true,
      regionId: 25,
      leaderStoreId: 'tikv-2',
      tiflashStoreId: 'tiflash-2',
      storeSlot: 1,
      replicaAvailable: true,
      leaderCommitIndex: 142,
      replicatedIndex: 142,
      appliedIndex: 142,
      requestedReadIndex: null,
      gateState: 'requesting',
      gateReason: 'read_index_pending',
    },
    {
      visible: true,
      regionId: 26,
      leaderStoreId: 'tikv-3',
      tiflashStoreId: 'tiflash-1',
      storeSlot: 0,
      replicaAvailable: true,
      leaderCommitIndex: 155,
      replicatedIndex: 155,
      appliedIndex: 153,
      requestedReadIndex: 155,
      gateState: 'waiting',
      gateReason: 'applied_index_behind',
    },
  ],
  tasks: [
    {
      visible: true,
      id: 'task-scan-1',
      taskId: 'task-scan-1',
      storeId: 'tiflash-1',
      storeSlot: 0,
      fragment: 'scan_partial',
      stage: 'exchange_sending',
      regionIds: [24, 26],
    },
    {
      visible: true,
      id: 'task-scan-2',
      taskId: 'task-scan-2',
      storeId: 'tiflash-2',
      storeSlot: 1,
      fragment: 'scan_partial',
      stage: 'exchange_sending',
      regionIds: [25],
    },
    {
      visible: true,
      id: 'task-final-1',
      taskId: 'task-final-1',
      storeId: 'tiflash-1',
      storeSlot: 0,
      fragment: 'final_aggregate',
      stage: 'exchange_receiving',
      regionIds: [],
    },
    {
      visible: true,
      id: 'task-final-2',
      taskId: 'task-final-2',
      storeId: 'tiflash-2',
      storeSlot: 1,
      fragment: 'final_aggregate',
      stage: 'exchange_receiving',
      regionIds: [],
    },
  ],
  tunnels: [
    {
      visible: true,
      id: 'tunnel-hash-1',
      senderTaskId: 'task-scan-1',
      receiverTaskId: 'task-final-1',
      senderTaskSlot: 0,
      receiverTaskSlot: 2,
      locality: 'local',
      state: 'streaming',
    },
    {
      visible: true,
      id: 'tunnel-hash-2',
      senderTaskId: 'task-scan-1',
      receiverTaskId: 'task-final-2',
      senderTaskSlot: 0,
      receiverTaskSlot: 3,
      locality: 'remote',
      state: 'streaming',
    },
    {
      visible: true,
      id: 'tunnel-hash-3',
      senderTaskId: 'task-scan-2',
      receiverTaskId: 'task-final-1',
      senderTaskSlot: 1,
      receiverTaskSlot: 2,
      locality: 'remote',
      state: 'finished',
    },
    {
      visible: true,
      id: 'tunnel-hash-4',
      senderTaskId: 'task-scan-2',
      receiverTaskId: 'task-final-2',
      senderTaskSlot: 1,
      receiverTaskSlot: 3,
      locality: 'local',
      state: 'registered',
    },
    {
      visible: true,
      id: 'tunnel-root-1',
      senderTaskId: 'task-final-1',
      receiverTaskId: 'tidb-root',
      senderTaskSlot: 2,
      receiverTaskSlot: -1,
      locality: 'tidb_root',
      state: 'registered',
    },
    {
      visible: true,
      id: 'tunnel-root-2',
      senderTaskId: 'task-final-2',
      receiverTaskId: 'tidb-root',
      senderTaskSlot: 3,
      receiverTaskSlot: -1,
      locality: 'tidb_root',
      state: 'registered',
    },
  ],
  root: {
    visible: true,
    taskId: 'tidb-root',
    state: 'idle',
  },
  overflow: {
    stores: 0,
    learners: 0,
    fragments: 0,
    tasks: 0,
    tunnels: 0,
    total: 0,
  },
}

function instanceScale(
  mesh: THREE.InstancedMesh,
  index: number,
): THREE.Vector3 {
  const matrix = new THREE.Matrix4()
  const scale = new THREE.Vector3()
  mesh.getMatrixAt(index, matrix)
  return scale.setFromMatrixScale(matrix)
}

function instancePosition(
  mesh: THREE.InstancedMesh,
  index: number,
): THREE.Vector3 {
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  mesh.getMatrixAt(index, matrix)
  return position.setFromMatrixPosition(matrix)
}

function instanceColor(mesh: THREE.InstancedMesh, index: number): number {
  const color = new THREE.Color()
  mesh.getColorAt(index, color)
  return color.getHex()
}

function sceneResources(root: THREE.Object3D): {
  readonly objects: readonly string[]
  readonly geometries: ReadonlySet<THREE.BufferGeometry>
  readonly materials: ReadonlySet<THREE.Material>
  readonly shadows: number
} {
  const objects: string[] = []
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  let shadows = 0
  root.traverse((object) => {
    objects.push(object.uuid)
    const drawable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
      castShadow?: boolean
      receiveShadow?: boolean
    }
    if (drawable.geometry) geometries.add(drawable.geometry)
    if (drawable.material) {
      const bound = Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]
      for (const material of bound) materials.add(material)
    }
    if (drawable.castShadow || drawable.receiveShadow) shadows++
  })
  return { objects, geometries, materials, shadows }
}

describe('fixed-capacity TiFlash MPP Lab renderer', () => {
  it('allocates two stores, three learners, two fragments, four tasks, six tunnels, and at most six packets', () => {
    const lab = createTiFlashMppLab()
    const stores = lab.object.getObjectByName(
      'tiflash-mpp-lab:stores',
    ) as THREE.InstancedMesh
    const learners = lab.object.getObjectByName(
      'tiflash-mpp-lab:learners',
    ) as THREE.InstancedMesh
    const fragments = lab.object.getObjectByName(
      'tiflash-mpp-lab:fragment-decks',
    ) as THREE.InstancedMesh
    const tasks = lab.object.getObjectByName(
      'tiflash-mpp-lab:tasks',
    ) as THREE.InstancedMesh
    const tunnels = lab.object.getObjectByName(
      'tiflash-mpp-lab:mpp-exchange-rails',
    ) as THREE.InstancedMesh
    const packets = lab.object.getObjectByName(
      'tiflash-mpp-lab:mpp-packets',
    ) as THREE.InstancedMesh

    expect(stores.count).toBe(TIFLASH_MPP_LAB_STORE_CAPACITY)
    expect(learners.count).toBe(TIFLASH_MPP_LAB_LEARNER_CAPACITY)
    expect(learners.userData).toMatchObject({
      role: 'learner',
      voter: false,
    })
    expect(fragments.count).toBe(TIFLASH_MPP_LAB_FRAGMENT_CAPACITY)
    expect(fragments.userData.fragments).toEqual([
      'scan_partial',
      'final_aggregate',
    ])
    expect(tasks.count).toBe(TIFLASH_MPP_LAB_TASK_CAPACITY)
    expect(tunnels.count).toBe(TIFLASH_MPP_LAB_TUNNEL_CAPACITY)
    expect(packets.count).toBe(TIFLASH_MPP_LAB_PACKET_CAPACITY)
    expect(lab.debug.resources).toMatchObject({
      storeCapacity: 2,
      learnerCapacity: 3,
      fragmentCapacity: 2,
      taskCapacity: 4,
      tunnelCapacity: 6,
      packetCapacity: 6,
      shadowCount: 0,
    })

    lab.dispose()
  })

  it('keeps persistent learner rails separate from ephemeral query exchange and exposes Region gates', () => {
    const lab = createTiFlashMppLab()
    const learnerRails = lab.object.getObjectByName(
      'tiflash-mpp-lab:learner-replication-rails',
    ) as THREE.InstancedMesh
    const exchangeRails = lab.object.getObjectByName(
      'tiflash-mpp-lab:mpp-exchange-rails',
    ) as THREE.InstancedMesh
    const gates = lab.object.getObjectByName(
      'tiflash-mpp-lab:snapshot-gates',
    ) as THREE.InstancedMesh
    const packets = lab.object.getObjectByName(
      'tiflash-mpp-lab:mpp-packets',
    ) as THREE.InstancedMesh

    lab.update(ACTIVE_PROJECTION)

    expect(learnerRails.userData.persistence).toBe('persistent')
    expect(exchangeRails.userData.persistence).toBe('ephemeral')
    expect(instanceScale(learnerRails, 0).length()).toBeGreaterThan(0)
    expect(instanceScale(exchangeRails, 0).length()).toBeGreaterThan(0)
    expect(instanceScale(packets, 0).length()).toBeGreaterThan(0)
    expect(instanceScale(packets, 2).length()).toBe(0)
    expect(instanceColor(gates, 0)).toBe(SEMANTIC_COLORS.night.return)
    expect(instanceColor(gates, 1)).toBe(SEMANTIC_COLORS.night.tso)
    expect(lab.learnerAnchors[2].userData).toMatchObject({
      regionId: 26,
      role: 'learner',
      voter: false,
      gateState: 'waiting',
      gateReason: 'applied_index_behind',
      appliedIndex: 153,
      requestedReadIndex: 155,
    })
    expect(lab.taskAnchors[0].userData).toMatchObject({
      taskId: 'task-scan-1',
      fragment: 'scan_partial',
      storeId: 'tiflash-1',
    })
    expect(lab.rootAnchor.userData).toMatchObject({
      taskId: -1,
      snapshotTargetId: 'tidb-root',
    })

    lab.dispose()
  })

  it('does not allocate scene objects, geometries, or materials while updating and reports overflow', () => {
    const lab = createTiFlashMppLab()
    const before = sceneResources(lab.object)
    const resourceCounts = lab.debug.resources
    const source = JSON.stringify(ACTIVE_PROJECTION)

    for (let index = 0; index < 12; index++) {
      lab.update({
        ...ACTIVE_PROJECTION,
        pulse: index / 11,
        overflow: {
          stores: 1,
          learners: 2,
          fragments: 1,
          tasks: 3,
          tunnels: 4,
          total: 11,
        },
      })
    }

    const after = sceneResources(lab.object)
    expect(after.objects).toEqual(before.objects)
    expect(after.geometries).toEqual(before.geometries)
    expect(after.materials).toEqual(before.materials)
    expect(after.shadows).toBe(0)
    expect(lab.debug.resources).toBe(resourceCounts)
    expect(lab.object.userData.overflow).toBe(11)
    expect(JSON.stringify(ACTIVE_PROJECTION)).toBe(source)

    lab.dispose()
  })

  it('freezes streaming packets at their midpoint for reduced motion and reapplies day colors', () => {
    const lab = createTiFlashMppLab()
    const packets = lab.object.getObjectByName(
      'tiflash-mpp-lab:mpp-packets',
    ) as THREE.InstancedMesh
    const gates = lab.object.getObjectByName(
      'tiflash-mpp-lab:snapshot-gates',
    ) as THREE.InstancedMesh
    const remoteTunnel = lab.object.getObjectByName(
      'tiflash-mpp-lab:mpp-exchange-rails',
    ) as THREE.InstancedMesh

    lab.update({ ...ACTIVE_PROJECTION, pulse: 0.1 })
    const movingStart = instancePosition(packets, 0)
    lab.update({ ...ACTIVE_PROJECTION, pulse: 0.9 })
    const movingEnd = instancePosition(packets, 0)
    expect(movingStart.equals(movingEnd)).toBe(false)

    lab.update({
      ...ACTIVE_PROJECTION,
      reducedMotion: true,
      pulse: 0.1,
    })
    const reducedStart = instancePosition(packets, 0)
    lab.update({
      ...ACTIVE_PROJECTION,
      reducedMotion: true,
      pulse: 0.9,
    })
    const reducedEnd = instancePosition(packets, 0)
    expect(reducedStart.equals(reducedEnd)).toBe(true)

    lab.setTheme('day')
    expect(instanceColor(gates, 0)).toBe(SEMANTIC_COLORS.day.return)
    expect(instanceColor(remoteTunnel, 1)).toBe(
      SEMANTIC_COLORS.day.tiflash,
    )

    lab.dispose()
  })

  it('stays within its renderer budget with zero shadows', () => {
    const lab = createTiFlashMppLab()
    const resources = sceneResources(lab.object)

    expect(lab.debug.resources.drawableCount).toBeLessThanOrEqual(10)
    expect(resources.geometries.size).toBeLessThanOrEqual(5)
    expect(resources.materials.size).toBeLessThanOrEqual(3)
    expect(resources.shadows).toBe(0)

    lab.dispose()
  })

  it('disposes every owned geometry and material exactly once', () => {
    const lab = createTiFlashMppLab()
    const resources = sceneResources(lab.object)
    const geometrySpies = [...resources.geometries].map((geometry) =>
      vi.spyOn(geometry, 'dispose'))
    const materialSpies = [...resources.materials].map((material) =>
      vi.spyOn(material, 'dispose'))

    lab.dispose()
    lab.dispose()

    expect(lab.debug.disposed).toBe(true)
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1)
    for (const spy of materialSpies) expect(spy).toHaveBeenCalledTimes(1)
  })

  it('hides all MPP exchange rails when tunnels are not registered', () => {
    const lab = createTiFlashMppLab()
    const exchangeRails = lab.object.getObjectByName(
      'tiflash-mpp-lab:mpp-exchange-rails',
    ) as THREE.InstancedMesh
    const idleTunnels = ACTIVE_PROJECTION.tunnels.map(
      (tunnel): TiFlashMppLabTunnelProjection => ({
        ...tunnel,
        state: 'idle',
      }),
    ) as unknown as TiFlashMppLabProjection['tunnels']

    lab.update({
      ...ACTIVE_PROJECTION,
      tunnels: idleTunnels,
    })

    for (let index = 0; index < TIFLASH_MPP_LAB_TUNNEL_CAPACITY; index++) {
      expect(instanceScale(exchangeRails, index).length()).toBe(0)
    }
    lab.dispose()
  })
})
