/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import {
  createProtocolLab,
  PROTOCOL_LAB_INDICATOR_CAPACITY,
  PROTOCOL_LAB_LANE_CAPACITY,
  PROTOCOL_LAB_MVCC_CELL_CAPACITY,
  PROTOCOL_LAB_REGION_CAPACITY,
  PROTOCOL_LAB_VOTER_CAPACITY,
  type ProtocolLabLaneProjection,
  type ProtocolLabProjection,
  type ProtocolLabRegionProjection,
} from './protocol-lab'

function region(
  regionId: number,
  role: 'primary' | 'secondary',
  leaderPeer: 0 | 1 | 2,
  options: {
    readonly visible?: boolean
    readonly raftStage?: ProtocolLabRegionProjection['raftStage']
    readonly acknowledgements?: number
    readonly committed?: boolean
    readonly asyncCommit?: boolean
  } = {},
): ProtocolLabRegionProjection {
  const visible = options.visible ?? true
  const raftStage = options.raftStage ?? 'persisted_quorum'
  const acknowledgements = options.acknowledgements ?? 2
  const committed = options.committed ?? false
  const log = raftStage === 'proposed' ? 'proposed'
    : raftStage === 'persisted_quorum' ? 'persisted'
      : raftStage === 'committed' || raftStage === 'applied'
        ? 'committed'
        : 'idle'
  return Object.freeze({
    visible,
    regionId,
    role,
    leaderPeer,
    operation: raftStage === 'idle'
      ? null
      : committed ? 'commit_primary' : 'prewrite',
    raftStage,
    peers: Object.freeze([
      Object.freeze({
        storeId: 'tikv-1',
        leader: leaderPeer === 0,
        log,
      }),
      Object.freeze({
        storeId: 'tikv-2',
        leader: leaderPeer === 1,
        log: acknowledgements >= 2 ? log : 'idle',
      }),
      Object.freeze({
        storeId: 'tikv-3',
        leader: leaderPeer === 2,
        log: acknowledgements >= 3 ? log : 'idle',
      }),
    ] as const),
    quorum: Object.freeze({
      acknowledgements,
      required: 2 as const,
      reached: acknowledgements >= 2,
    }),
    applied: raftStage === 'applied',
    mvcc: Object.freeze({
      default: raftStage === 'idle' ? 'empty' as const : 'value' as const,
      lock:
        raftStage !== 'idle' && !committed
          ? 'prewrite' as const
          : 'empty' as const,
      write: committed ? 'commit' as const : 'empty' as const,
      asyncCommit: options.asyncCommit ?? false,
      secondaryCount:
        options.asyncCommit && role === 'primary' && !committed ? 1 : 0,
    }),
    returnedMinCommitTs: options.asyncCommit ?? false,
  })
}

function hiddenRegion(): ProtocolLabRegionProjection {
  return region(-1, 'secondary', 0, {
    visible: false,
    raftStage: 'idle',
    acknowledgements: 0,
  })
}

function lane(
  id: ProtocolLabLaneProjection['id'],
  protocol: ProtocolLabLaneProjection['protocol'],
  shape: ProtocolLabLaneProjection['shape'],
  path: ProtocolLabLaneProjection['path'],
  regions: ProtocolLabLaneProjection['regions'],
  focused = false,
): ProtocolLabLaneProjection {
  return Object.freeze({
    visible: true,
    id,
    protocol,
    shape,
    focused,
    stage:
      path === 'complete' ? 'complete'
        : path === 'background' ? 'background'
          : 'prewriting',
    path,
    timestampStage: path === 'complete' ? 'commit' : 'latest',
    clientResponded: path === 'background' || path === 'complete',
    backgroundComplete: path === 'complete' && protocol !== '1pc',
    regions,
    overflowRegions: 0,
  })
}

const ACTIVE_PROJECTION: ProtocolLabProjection = Object.freeze({
  mode: 'inspect',
  phase: 'running',
  reducedMotion: false,
  pulse: 1,
  focusLaneId: 'two_pc',
  lanes: Object.freeze([
    lane(
      'one_pc',
      '1pc',
      'triangle',
      'complete',
      Object.freeze([
        region(11, 'primary', 0, {
          raftStage: 'applied',
          committed: true,
        }),
        hiddenRegion(),
      ] as const),
    ),
    lane(
      'async_commit',
      'async_commit',
      'diamond',
      'background',
      Object.freeze([
        region(21, 'primary', 1, {
          raftStage: 'applied',
          acknowledgements: 3,
          asyncCommit: true,
        }),
        region(22, 'secondary', 2, {
          raftStage: 'persisted_quorum',
          asyncCommit: true,
        }),
      ] as const),
    ),
    lane(
      'two_pc',
      '2pc',
      'cylinder',
      'critical',
      Object.freeze([
        region(31, 'primary', 0, {
          raftStage: 'proposed',
          acknowledgements: 0,
        }),
        region(32, 'secondary', 1, {
          raftStage: 'persisted_quorum',
        }),
      ] as const),
      true,
    ),
  ] as const),
  capacities: Object.freeze({
    lanes: 3 as const,
    regionsPerLane: 2 as const,
    votersPerRegion: 3 as const,
  }),
  overflowRegions: 0,
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
  drawables: number
  geometries: Set<THREE.BufferGeometry>
  materials: Set<THREE.Material>
  shadows: number
} {
  let drawables = 0
  let shadows = 0
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    const drawable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
      castShadow?: boolean
      receiveShadow?: boolean
    }
    if (drawable.geometry) {
      drawables++
      geometries.add(drawable.geometry)
    }
    if (drawable.material) {
      const bound = Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]
      for (const material of bound) materials.add(material)
    }
    if (drawable.castShadow || drawable.receiveShadow) shadows++
  })
  return { drawables, geometries, materials, shadows }
}

describe('Protocol Lab fixed-capacity world', () => {
  it('prebuilds three lanes, at most two Regions, and three voters per Region', () => {
    const lab = createProtocolLab()
    const decks = lab.object.getObjectByName(
      'protocol-lab:lane-decks',
    ) as THREE.InstancedMesh
    const regions = lab.object.getObjectByName(
      'protocol-lab:region-bodies',
    ) as THREE.InstancedMesh
    const voters = lab.object.getObjectByName(
      'protocol-lab:raft-voters',
    ) as THREE.InstancedMesh
    const mvcc = lab.object.getObjectByName(
      'protocol-lab:mvcc-cells',
    ) as THREE.InstancedMesh
    const laneIndicators = lab.object.getObjectByName(
      'protocol-lab:lane-path-indicators',
    ) as THREE.InstancedMesh
    const quorumIndicators = lab.object.getObjectByName(
      'protocol-lab:region-quorum-indicators',
    ) as THREE.InstancedMesh

    expect(lab.object.userData.provenance).toBe('MODEL / SIMULATED')
    expect(lab.object.userData.boundary).toContain(
      'separate from per-Region Raft',
    )
    expect(decks.count).toBe(PROTOCOL_LAB_LANE_CAPACITY)
    expect(regions.count).toBe(PROTOCOL_LAB_REGION_CAPACITY)
    expect(regions.userData.capacityPerLane).toBe(2)
    expect(voters.count).toBe(PROTOCOL_LAB_VOTER_CAPACITY)
    expect(voters.userData.votersPerRegion).toBe(3)
    expect(mvcc.count).toBe(PROTOCOL_LAB_MVCC_CELL_CAPACITY)
    expect(mvcc.userData.columns).toEqual(['LOCK', 'DEFAULT', 'WRITE'])
    expect(laneIndicators.count + quorumIndicators.count)
      .toBe(PROTOCOL_LAB_INDICATOR_CAPACITY)
    expect(lab.debug.resources).toMatchObject({
      laneCapacity: 3,
      regionCapacityPerLane: 2,
      regionCapacity: 6,
      votersPerRegion: 3,
      voterCapacity: 18,
      mvccCellCapacity: 18,
      indicatorCapacity: 9,
      shadowCount: 0,
    })

    lab.dispose()
  })

  it('stays within the strict drawable, geometry, material, and shadow budget', () => {
    const lab = createProtocolLab()
    const counts = sceneCounts(lab.object)

    expect(counts.drawables).toBeLessThanOrEqual(10)
    expect(counts.geometries.size).toBeLessThanOrEqual(5)
    expect(counts.materials.size).toBeLessThanOrEqual(3)
    expect(counts.shadows).toBe(0)
    expect(lab.debug.resources).toMatchObject({
      drawableCount: counts.drawables,
      geometryCount: counts.geometries.size,
      materialCount: counts.materials.size,
      shadowCount: 0,
    })

    lab.dispose()
  })

  it('uses distinct protocol shapes and paints critical/background state', () => {
    const lab = createProtocolLab()
    const onePc = lab.object.getObjectByName(
      'protocol-lab:one-pc-marker',
    ) as THREE.InstancedMesh
    const asyncCommit = lab.object.getObjectByName(
      'protocol-lab:async-commit-marker',
    ) as THREE.InstancedMesh
    const twoPc = lab.object.getObjectByName(
      'protocol-lab:two-pc-marker',
    ) as THREE.InstancedMesh
    const path = lab.object.getObjectByName(
      'protocol-lab:lane-path-indicators',
    ) as THREE.InstancedMesh
    const before = JSON.stringify(ACTIVE_PROJECTION)

    lab.update(ACTIVE_PROJECTION)

    expect(onePc.geometry).toBeInstanceOf(THREE.ConeGeometry)
    expect(onePc.userData.shape).toBe('triangle')
    expect(asyncCommit.geometry).toBeInstanceOf(THREE.OctahedronGeometry)
    expect(asyncCommit.userData.shape).toBe('diamond')
    expect(twoPc.geometry).toBeInstanceOf(THREE.CylinderGeometry)
    expect(twoPc.userData.shape).toBe('cylinder')
    expect(instanceColor(path, 0)).toBe(SEMANTIC_COLORS.night.kv)
    expect(instanceColor(path, 1)).toBe(SEMANTIC_COLORS.night.tso)
    expect(instanceColor(path, 2)).toBe(SEMANTIC_COLORS.night.txn2pc)
    expect(lab.laneAnchors[0].userData).toMatchObject({
      laneId: 'one_pc',
      protocol: '1pc',
      shape: 'triangle',
      path: 'complete',
    })
    expect(lab.laneAnchors[1].userData).toMatchObject({
      laneId: 'async_commit',
      shape: 'diamond',
      path: 'background',
      clientResponded: true,
    })
    expect(lab.laneAnchors[2].userData).toMatchObject({
      laneId: 'two_pc',
      shape: 'cylinder',
      path: 'critical',
      focused: true,
    })
    expect(JSON.stringify(ACTIVE_PROJECTION)).toBe(before)

    lab.dispose()
  })

  it('switches overview/inspect and projects Region Raft quorum plus MVCC', () => {
    const lab = createProtocolLab()
    const inspect = lab.object.getObjectByName(
      'protocol-lab:inspect',
    ) as THREE.Group
    const regions = lab.object.getObjectByName(
      'protocol-lab:region-bodies',
    ) as THREE.InstancedMesh
    const voters = lab.object.getObjectByName(
      'protocol-lab:raft-voters',
    ) as THREE.InstancedMesh
    const quorum = lab.object.getObjectByName(
      'protocol-lab:region-quorum-indicators',
    ) as THREE.InstancedMesh
    const resources = lab.debug.resources

    expect(lab.object.visible).toBe(false)
    lab.update({ ...ACTIVE_PROJECTION, mode: 'overview' })
    expect(lab.object.visible).toBe(true)
    expect(inspect.visible).toBe(false)

    lab.update(ACTIVE_PROJECTION)
    expect(inspect.visible).toBe(true)
    /* Unused 1PC Region slot is hidden without changing capacity. */
    expect(instanceScale(regions, 1).length()).toBe(0)
    /* Async primary is lane 1, Region slot 0, leader peer 1. */
    expect(instanceScale(voters, 7).y).toBeGreaterThan(
      instanceScale(voters, 6).y,
    )
    expect(instanceColor(quorum, 2)).toBe(SEMANTIC_COLORS.night.raft)
    expect(lab.regionAnchors[2].userData).toMatchObject({
      regionId: 21,
      role: 'primary',
      raftStage: 'applied',
      acknowledgements: 3,
      quorum: 2,
      applied: true,
      returnedMinCommitTs: true,
    })
    expect(lab.debug.resources).toBe(resources)

    lab.update({ ...ACTIVE_PROJECTION, mode: 'hidden' })
    expect(lab.object.visible).toBe(false)

    lab.dispose()
  })

  it('suppresses focus pulse for reduced motion and reapplies day colors', () => {
    const lab = createProtocolLab()
    const twoPc = lab.object.getObjectByName(
      'protocol-lab:two-pc-marker',
    ) as THREE.InstancedMesh
    const path = lab.object.getObjectByName(
      'protocol-lab:lane-path-indicators',
    ) as THREE.InstancedMesh

    lab.update(ACTIVE_PROJECTION)
    const animated = instanceScale(twoPc, 0).x
    lab.update({ ...ACTIVE_PROJECTION, reducedMotion: true })
    const staticScale = instanceScale(twoPc, 0).x
    expect(animated).toBeGreaterThan(staticScale)

    lab.setTheme('day')
    expect(instanceColor(path, 2)).toBe(SEMANTIC_COLORS.day.txn2pc)

    lab.dispose()
  })

  it('disposes every owned geometry and material exactly once', () => {
    const lab = createProtocolLab()
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    lab.object.traverse((object) => {
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
    const geometrySpies = [...geometries].map((geometry) =>
      vi.spyOn(geometry, 'dispose'))
    const materialSpies = [...materials].map((material) =>
      vi.spyOn(material, 'dispose'))

    lab.dispose()
    lab.dispose()

    expect(lab.debug.disposed).toBe(true)
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalledTimes(1)
    for (const spy of materialSpies) expect(spy).toHaveBeenCalledTimes(1)
  })
})
