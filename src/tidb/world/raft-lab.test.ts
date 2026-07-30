/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SEMANTIC_COLORS } from './palette'
import {
  createRaftLab,
  type RaftLabPeerProjection,
  type RaftLabProjection,
} from './raft-lab'

function log(
  index: number,
  term: number,
  state: RaftLabPeerProjection['log'][number]['state'],
): RaftLabPeerProjection['log'][number] {
  return Object.freeze({ index, term, state })
}

function peer(
  storeId: string,
  role: RaftLabPeerProjection['role'],
  shape: RaftLabPeerProjection['shape'],
  health: RaftLabPeerProjection['health'],
  term: number,
  states: readonly [
    RaftLabPeerProjection['log'][number]['state'],
    RaftLabPeerProjection['log'][number]['state'],
    RaftLabPeerProjection['log'][number]['state'],
  ],
): RaftLabPeerProjection {
  return Object.freeze({
    visible: true,
    storeId,
    role,
    health,
    shape,
    term,
    matchIndex: health === 'down' ? 42 : 43,
    commitIndex: health === 'down' ? 42 : 43,
    appliedIndex: role === 'follower' ? 42 : 43,
    votedForStoreId: role === 'leader' ? storeId : 'tikv-2',
    previousLeader: storeId === 'tikv-1',
    log: Object.freeze([
      log(42, 1, states[0]),
      log(43, 2, states[1]),
      log(44, 0, states[2]),
    ] as const),
  })
}

const ACTIVE_PROJECTION: RaftLabProjection = Object.freeze({
  mode: 'inspect',
  phase: 'complete',
  reducedMotion: false,
  pulse: 1,
  regionId: 0,
  previousTerm: 1,
  term: 2,
  previousLeaderPeer: 0,
  leaderPeer: 1,
  candidatePeer: 1,
  peers: Object.freeze([
    peer(
      'tikv-1',
      'follower',
      'offline',
      'down',
      1,
      ['unavailable', 'unavailable', 'unavailable'],
    ),
    peer(
      'tikv-2',
      'leader',
      'crown',
      'up',
      2,
      ['applied', 'applied', 'absent'],
    ),
    peer(
      'tikv-3',
      'follower',
      'ring',
      'up',
      2,
      ['applied', 'committed', 'absent'],
    ),
  ] as const),
  electionEdges: Object.freeze([
    Object.freeze({
      visible: true,
      id: 'vote:request:tikv-1',
      stage: 'vote' as const,
      status: 'request' as const,
      fromPeer: 1 as const,
      toPeer: 0 as const,
    }),
    Object.freeze({
      visible: true,
      id: 'vote:unavailable:tikv-1',
      stage: 'vote' as const,
      status: 'unavailable' as const,
      fromPeer: 0 as const,
      toPeer: 1 as const,
    }),
    Object.freeze({
      visible: true,
      id: 'vote:request:tikv-3',
      stage: 'vote' as const,
      status: 'request' as const,
      fromPeer: 1 as const,
      toPeer: 2 as const,
    }),
    Object.freeze({
      visible: true,
      id: 'vote:granted:tikv-3',
      stage: 'vote' as const,
      status: 'granted' as const,
      fromPeer: 2 as const,
      toPeer: 1 as const,
    }),
    Object.freeze({
      visible: false,
      id: '',
      stage: 'prevote' as const,
      status: 'request' as const,
      fromPeer: -1 as const,
      toPeer: -1 as const,
    }),
    Object.freeze({
      visible: false,
      id: '',
      stage: 'prevote' as const,
      status: 'request' as const,
      fromPeer: -1 as const,
      toPeer: -1 as const,
    }),
  ] as const),
  quorum: Object.freeze({
    acknowledgements: 2,
    required: 2 as const,
    available: true,
    committed: true,
  }),
  clientRetry: Object.freeze({
    visible: true,
    source: 'tidb_tikv_client' as const,
    internal: true as const,
    attempt: 2,
    status: 'succeeded' as const,
    reason: 'transport_error' as const,
    previousTargetPeer: 0 as const,
    targetPeer: 1 as const,
  }),
  pdObservation: Object.freeze({
    visible: true,
    status: 'observed' as const,
    leaderPeer: 1 as const,
    electionAuthority: false as const,
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

describe('Raft Lab fixed-capacity world', () => {
  it('prebuilds one Region, three peers, bounded logs and election routes', () => {
    const lab = createRaftLab()
    const peers = lab.object.getObjectByName(
      'raft-lab:peer-bodies',
    ) as THREE.InstancedMesh
    const logs = lab.object.getObjectByName(
      'raft-lab:log-cells',
    ) as THREE.InstancedMesh
    const edges = lab.object.getObjectByName(
      'raft-lab:election-edges',
    ) as THREE.InstancedMesh
    const routes = lab.object.getObjectByName(
      'raft-lab:client-retry-routes',
    ) as THREE.InstancedMesh
    const pd = lab.object.getObjectByName('raft-lab:pd-observer')

    expect(lab.object.userData.provenance).toBe('MODEL / SIMULATED')
    expect(lab.object.userData.boundary).toContain('PD only observes')
    expect(peers.count).toBe(3)
    expect(peers.instanceColor).not.toBeNull()
    expect(
      (peers.material as THREE.MeshBasicMaterial).vertexColors,
    ).toBe(false)
    expect(logs.count).toBe(9)
    expect(logs.instanceColor).not.toBeNull()
    expect(logs.userData.columns).toEqual(['N-1', 'N', 'N+1'])
    expect(edges.count).toBe(6)
    expect(edges.instanceColor).not.toBeNull()
    expect(routes.count).toBe(2)
    expect(pd?.userData.electionAuthority).toBe(false)
    expect(lab.debug.resources).toMatchObject({
      peerCapacity: 3,
      logWindowCapacity: 3,
      logCellCapacity: 9,
      electionEdgeCapacity: 6,
      clientRouteCapacity: 2,
      quorumRequired: 2,
      pdObserverCapacity: 1,
    })

    lab.dispose()
  })

  it('switches hidden, overview, and inspect without constructing objects', () => {
    const lab = createRaftLab()
    const overview = lab.object.getObjectByName('raft-lab:overview')
    const inspect = lab.object.getObjectByName('raft-lab:inspect')
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

  it('uses shape as well as color for offline, pre-candidate, candidate, and leader roles', () => {
    const lab = createRaftLab()
    const offline = lab.object.getObjectByName(
      'raft-lab:offline-markers',
    ) as THREE.InstancedMesh
    const preCandidate = lab.object.getObjectByName(
      'raft-lab:pre-candidate-rings',
    ) as THREE.InstancedMesh
    const candidate = lab.object.getObjectByName(
      'raft-lab:candidate-diamonds',
    ) as THREE.InstancedMesh
    const leader = lab.object.getObjectByName(
      'raft-lab:leader-crowns',
    ) as THREE.InstancedMesh

    lab.update({
      ...ACTIVE_PROJECTION,
      phase: 'pre-vote',
      peers: [
        ACTIVE_PROJECTION.peers[0],
        {
          ...ACTIVE_PROJECTION.peers[1],
          role: 'pre-candidate',
          shape: 'double-ring',
        },
        ACTIVE_PROJECTION.peers[2],
      ],
    })
    expect(instanceScale(offline, 0).length()).toBeGreaterThan(0)
    expect(instanceScale(preCandidate, 2).length()).toBeGreaterThan(0)
    expect(instanceScale(preCandidate, 3).length()).toBeGreaterThan(0)
    expect(instanceScale(candidate, 1).length()).toBe(0)

    lab.update({
      ...ACTIVE_PROJECTION,
      phase: 'election',
      peers: [
        ACTIVE_PROJECTION.peers[0],
        {
          ...ACTIVE_PROJECTION.peers[1],
          role: 'candidate',
          shape: 'diamond',
        },
        ACTIVE_PROJECTION.peers[2],
      ],
    })
    expect(instanceScale(preCandidate, 2).length()).toBe(0)
    expect(instanceScale(candidate, 1).length()).toBeGreaterThan(0)

    lab.update(ACTIVE_PROJECTION)
    expect(instanceScale(candidate, 1).length()).toBe(0)
    expect(instanceScale(leader, 1).length()).toBeGreaterThan(0)
    expect(lab.peerAnchors[0].userData).toMatchObject({
      storeId: 'tikv-1',
      health: 'down',
      previousLeader: true,
      shape: 'offline',
    })
    expect(lab.peerAnchors[1].userData).toMatchObject({
      storeId: 'tikv-2',
      role: 'leader',
      term: 2,
      matchIndex: 43,
      commitIndex: 43,
      appliedIndex: 43,
    })

    lab.dispose()
  })

  it('projects term, logs, 2/3 quorum, internal retry, and PD observation without mutating input', () => {
    const lab = createRaftLab()
    const before = JSON.stringify(ACTIVE_PROJECTION)
    lab.update(ACTIVE_PROJECTION)

    const peers = lab.object.getObjectByName(
      'raft-lab:peer-bodies',
    ) as THREE.InstancedMesh
    const logs = lab.object.getObjectByName(
      'raft-lab:log-cells',
    ) as THREE.InstancedMesh
    const edges = lab.object.getObjectByName(
      'raft-lab:election-edges',
    ) as THREE.InstancedMesh
    const quorum = lab.object.getObjectByName(
      'raft-lab:quorum-ring',
    ) as THREE.Mesh
    const routes = lab.object.getObjectByName(
      'raft-lab:client-retry-routes',
    ) as THREE.InstancedMesh
    const pdRoute = lab.object.getObjectByName(
      'raft-lab:pd-observation-route',
    ) as THREE.InstancedMesh

    expect(Array.from(peers.userData.terms as Int32Array)).toEqual([1, 2, 2])
    expect(Array.from(peers.userData.matchIndices as Int32Array))
      .toEqual([42, 43, 43])
    expect(Array.from(logs.userData.indices as Int32Array)).toEqual([
      42, 43, 44,
      42, 43, 44,
      42, 43, 44,
    ])
    expect(Array.from(logs.userData.states as Uint8Array)).toEqual([
      4, 4, 4,
      3, 3, 0,
      3, 2, 0,
    ])
    expect(Array.from(edges.userData.stages as Uint8Array).slice(0, 4))
      .toEqual([2, 2, 2, 2])
    expect(Array.from(edges.userData.statuses as Uint8Array).slice(0, 4))
      .toEqual([1, 4, 1, 2])
    expect(Array.from(quorum.userData.acknowledgements as Uint8Array))
      .toEqual([2])
    expect(quorum.userData).toMatchObject({
      required: 2,
      available: true,
      committed: true,
    })
    expect(instanceScale(routes, 0).length()).toBeGreaterThan(0)
    expect(instanceScale(routes, 1).length()).toBeGreaterThan(0)
    expect(instanceScale(pdRoute, 0).length()).toBeGreaterThan(0)
    expect(lab.object.userData.clientRetry).toMatchObject({
      source: 'tidb_tikv_client',
      internal: true,
      attempt: 2,
      reason: 'transport_error',
    })
    expect(lab.object.userData.pdObservation.electionAuthority).toBe(false)
    expect(JSON.stringify(ACTIVE_PROJECTION)).toBe(before)

    lab.dispose()
  })

  it('holds animation static in reduced motion and reapplies semantic theme colors', () => {
    const lab = createRaftLab()
    const quorum = lab.object.getObjectByName(
      'raft-lab:quorum-ring',
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    const client = lab.object.getObjectByName(
      'raft-lab:tidb-client',
    ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>

    lab.update({
      ...ACTIVE_PROJECTION,
      reducedMotion: false,
      pulse: 1,
    })
    const animatedScale = quorum.scale.x
    lab.update({
      ...ACTIVE_PROJECTION,
      reducedMotion: true,
      pulse: 1,
    })
    expect(animatedScale).toBeGreaterThan(quorum.scale.x)
    expect(quorum.scale.x).toBeCloseTo(8.5)

    lab.setTheme('day')
    expect(client.material.color.getHex()).toBe(SEMANTIC_COLORS.day.client)
    lab.setTheme('night')
    expect(client.material.color.getHex()).toBe(SEMANTIC_COLORS.night.client)

    lab.dispose()
  })

  it('keeps object and GPU identities stable across repeated updates', () => {
    const lab = createRaftLab()
    const initial = sceneCounts(lab.object)
    const resources = lab.debug.resources
    const logs = lab.object.getObjectByName('raft-lab:log-cells')

    for (let index = 0; index < 40; index++) {
      lab.update({
        ...ACTIVE_PROJECTION,
        phase: index % 2 === 0 ? 'election' : 'quorum-commit',
        pulse: index / 39,
        reducedMotion: index % 3 === 0,
      })
    }

    const after = sceneCounts(lab.object)
    expect(after.objects).toBe(initial.objects)
    expect(after.geometries).toEqual(initial.geometries)
    expect(after.materials).toEqual(initial.materials)
    expect(lab.object.getObjectByName('raft-lab:log-cells')).toBe(logs)
    expect(lab.debug.resources).toBe(resources)
    expect(lab.debug.updateCount).toBe(40)

    lab.dispose()
  })

  it('disposes every owned geometry and material exactly once', () => {
    const lab = createRaftLab()
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
