/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createTiDBSimulation } from '../model'
import { TICITY_LAYOUT } from './layout'
import { createTiDBSceneGraph } from './city'

describe('TiCity scene graph', () => {
  it('builds one selectable peer per Region and TiKV store', () => {
    const city = createTiDBSceneGraph()
    const peers = city.registry.all().filter((component) => component.kind === 'region-peer')
    expect(peers).toHaveLength(TICITY_LAYOUT.regionCount * TICITY_LAYOUT.peersPerRegion)

    for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
      const voters = peers.filter((peer) => peer.regionId === region)
      expect(voters).toHaveLength(3)
      expect(voters.filter((peer) => peer.peerRole === 'leader')).toHaveLength(1)
    }
    city.dispose()
  })

  it('draws Raft separately from SQL and control networks', () => {
    const city = createTiDBSceneGraph()
    const raft = city.root.getObjectByName('network:raft')
    const sql = city.root.getObjectByName('network:data')
    const control = city.root.getObjectByName('network:control')
    expect(raft?.userData.domain).toBe('raft')
    expect(sql?.userData.domain).toBe('sql')
    expect(control?.userData.domain).toBe('tso')

    const positions = (
      raft as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    ).geometry.getAttribute('position')
    expect(positions.count / 2).toBe(TICITY_LAYOUT.regionCount * 3)
    city.dispose()
  })

  it('keeps PD out of every data-network segment', () => {
    const city = createTiDBSceneGraph()
    const data = city.networks.find((network) => network.domain === 'sql')
    expect(data).toBeDefined()
    expect(data?.componentIds.some((id) => id.startsWith('pd.'))).toBe(false)
    city.dispose()
  })

  it('resolves a peer by its InstancedMesh instance id', () => {
    const city = createTiDBSceneGraph()
    const peer = city.registry.get('region.17.peer.2')
    expect(peer?.instanceId).toBeTypeOf('number')
    expect(city.registry.resolve(peer?.object ?? null, peer?.instanceId)).toBe(peer)
    city.dispose()
  })

  it('projects leader election and hotspot state without losing it on theme change', () => {
    const city = createTiDBSceneGraph()
    const simulation = createTiDBSimulation({ seed: 7 })
    simulation.state.regions[0].leaderStoreId = 'tikv-2'
    simulation.state.regions[0].hotScore = 100
    city.updateState(simulation.state)

    expect(city.registry.get('region.0.peer.1')?.peerRole).toBe('leader')
    expect(city.registry.get('region.0.peer.0')?.peerRole).toBe('follower')
    const peer = city.registry.get('region.0.peer.1')!
    const matrix = new THREE.Matrix4()
    const peerMesh = peer.object as THREE.InstancedMesh
    peerMesh.getMatrixAt(peer.instanceId!, matrix)
    const scale = new THREE.Vector3()
    scale.setFromMatrixScale(matrix)
    expect(scale.y).toBeCloseTo(2)

    city.setTheme('day')
    expect(city.registry.get('region.0.peer.1')?.peerRole).toBe('leader')
    city.dispose()
  })

  it('projects stable Region ids after a logical split changes array order', () => {
    const city = createTiDBSceneGraph()
    const simulation = createTiDBSimulation()
    simulation.runScenario('hotspot-split')
    const visible = simulation.state.regions.find((region) => region.id === 35)!
    visible.leaderStoreId = 'tikv-3'
    for (const peer of visible.peers) {
      peer.raftRole = peer.storeId === 'tikv-3' ? 'leader' : 'follower'
    }

    city.updateState(simulation.state)

    expect(city.registry.get('region.35.peer.2')?.peerRole).toBe('leader')
    expect(city.registry.get('region.35.peer.0')?.peerRole).toBe('follower')
    city.dispose()
  })
})
