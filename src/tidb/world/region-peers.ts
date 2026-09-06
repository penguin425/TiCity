/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { TiCityState } from '../model/types'
import type { CityComponent, CityRegistry } from './city'
import { TICITY_LAYOUT, TIKV_ARCHITECTURE, regionPeerPosition } from './layout'
import { SEMANTIC_COLORS } from './palette'
import type { CityMaterials, CityTheme } from './palette'

export interface RegionPeers {
  readonly object: THREE.Group
  updateState(state: TiCityState): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

/**
 * Bodies, cabinet doors, roof equipment, status strips, and non-colour role
 * marks share the same projection. A heated rack grows upwards from its fixed
 * deck footing; ports and selection anchors never remain behind in the platform.
 */
export function createRegionPeers(registry: CityRegistry, materials: CityMaterials): RegionPeers {
  const object = new THREE.Group()
  object.name = 'tikv:peer-racks'
  const count = TICITY_LAYOUT.regionCount * TICITY_LAYOUT.peersPerRegion
  const { peerWidth, peerHeight, peerDepth, peerFootY } = TIKV_ARCHITECTURE
  const bodyGeometry = new RoundedBoxGeometry(peerWidth, peerHeight, peerDepth, 1, 0.16)
  const detailGeometry = new THREE.BoxGeometry(1, 1, 1)
  const leaderGeometry = new THREE.ConeGeometry(1.65, 1.8, 3)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.54, metalness: 0.32,
  })
  bodyMaterial.name = 'region-peer:semantic'
  // InstancedMesh colour is independent of vertexColors. The unit primitives
  // deliberately have no vertex colour attribute.
  const statusMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  statusMaterial.name = 'region-peer:status'

  function instances(geometry: THREE.BufferGeometry, material: THREE.Material, amount: number, name: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, amount)
    mesh.name = name
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.receiveShadow = true
    object.add(mesh)
    return mesh
  }

  const bodies = instances(bodyGeometry, bodyMaterial, count, 'tikv:region-peers')
  bodies.castShadow = true
  const roofs = instances(detailGeometry, materials.trim, count, 'tikv:peer-roofs')
  const vents = instances(detailGeometry, materials.darkStructure, count * 3, 'tikv:peer-vents')
  // Six shallow boxes per rack give both visible faces recessed cabinet doors
  // and raised metal stiles: two draws and 7,776 triangles for all 108 racks.
  // The body remains the selectable enclosure and supplies the door bezels.
  const doors = instances(detailGeometry, materials.darkStructure, count * 2, 'tikv:peer-door-insets')
  const doorRails = instances(detailGeometry, materials.trim, count * 4, 'tikv:peer-door-rails')
  const status = instances(detailGeometry, statusMaterial, count * 4, 'tikv:peer-status-lights')
  const leaders = instances(leaderGeometry, statusMaterial, count, 'tikv:peer-leader-marks')
  const faults = instances(detailGeometry, statusMaterial, count * 2, 'tikv:peer-fault-marks')
  const meshes = [bodies, roofs, vents, doors, doorRails, status, leaders, faults] as const
  const components = new Array<CityComponent>(count)
  const locations = new Float32Array(count * 2)
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  const rotation = new THREE.Quaternion()
  const axis = new THREE.Vector3(0, 1, 0)
  const color = new THREE.Color()
  const semantic = new THREE.Color()
  let theme: CityTheme = 'night'
  let latestState: TiCityState | null = null
  let disposed = false

  function setTransform(mesh: THREE.InstancedMesh, index: number,
    x: number, y: number, z: number, sx: number, sy: number, sz: number, angle = 0): void {
    position.set(x, y, z)
    scale.set(sx, sy, sz)
    rotation.setFromAxisAngle(axis, angle)
    matrix.compose(position, rotation, scale)
    mesh.setMatrixAt(index, matrix)
  }

  function project(instance: number, heat: number, leader: boolean, unhealthy: boolean): void {
    const x = locations[instance * 2]
    const z = locations[instance * 2 + 1]
    const stretch = 1 + heat
    const centerY = peerFootY + peerHeight / 2 * stretch
    const roofY = peerFootY + peerHeight * stretch
    const domain = unhealthy ? 'fault' : leader ? 'raft' : 'kv'
    semantic.setHex(SEMANTIC_COLORS[theme][domain])
    color.setHex(theme === 'night' ? 0x59727d : 0xaebbc0).lerp(semantic, unhealthy ? 0.28 : 0.13)
    bodies.setColorAt(instance, color)
    setTransform(bodies, instance, x, centerY, z, 1, stretch, 1)
    setTransform(roofs, instance, x, roofY + 0.28, z, peerWidth + 0.3, 0.56, peerDepth + 0.35)
    for (let vent = 0; vent < 3; vent++) {
      setTransform(vents, instance * 3 + vent, x - 2.2 + vent * 2.2, roofY + 0.62, z, 1.3, 0.18, 4.6)
    }
    for (let face = 0; face < 2; face++) {
      const direction = face === 0 ? 1 : -1
      setTransform(doors, instance * 2 + face,
        x, centerY, z + direction * (peerDepth / 2 + 0.02),
        peerWidth - 1.2, (peerHeight - 1.2) * stretch, 0.09)
      for (let edge = 0; edge < 2; edge++) {
        setTransform(doorRails, instance * 4 + face * 2 + edge,
          x + (edge === 0 ? -1 : 1) * (peerWidth / 2 - 0.55), centerY,
          z + direction * (peerDepth / 2 + 0.08),
          0.22, (peerHeight - 0.96) * stretch, 0.22)
      }
    }
    for (let strip = 0; strip < 4; strip++) {
      const front = strip < 2 ? 1 : -1
      setTransform(status, instance * 4 + strip,
        x, centerY + (strip % 2 === 0 ? 1.6 : -1.6) * stretch, z + front * (peerDepth / 2 + 0.08),
        unhealthy ? 2.8 : 5.7, 0.52, 0.2)
      status.setColorAt(instance * 4 + strip, semantic)
    }
    const leaderSize = leader && !unhealthy ? 1 : 0
    setTransform(leaders, instance, x, roofY + 1.5, z + 1.2, leaderSize, leaderSize, leaderSize)
    leaders.setColorAt(instance, semantic)
    for (let arm = 0; arm < 2; arm++) {
      const faultSize = unhealthy ? 1 : 0
      setTransform(faults, instance * 2 + arm, x, roofY + 0.95, z,
        5.8 * faultSize, 0.4 * faultSize, 0.9 * faultSize, arm === 0 ? Math.PI / 4 : -Math.PI / 4)
      faults.setColorAt(instance * 2 + arm, semantic)
    }
    const component = components[instance]
    component.anchor.set(x, centerY, z)
    component.peerRole = leader ? 'leader' : 'follower'
    component.domain = domain
    component.role = unhealthy ? 'Unavailable Raft voter' : leader ? 'Raft leader voter' : 'Raft follower voter'
  }

  function flush(): void {
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      // Heat can double the rack height. Recompute bounds only on model/theme
      // projection, so frustum culling and selection cover its actual extent.
      mesh.computeBoundingSphere()
    }
  }

  for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
    for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
      const instance = store * TICITY_LAYOUT.regionCount + region
      const point = regionPeerPosition(store, region)
      locations[instance * 2] = point[0]
      locations[instance * 2 + 1] = point[2]
      const component: CityComponent = {
        id: `region.${region}.peer.${store}`,
        name: `Region ${region + 1} peer on TiKV ${store + 1}`,
        role: 'Raft follower voter', kind: 'region-peer', domain: 'kv',
        object: bodies, anchor: new THREE.Vector3(...point), instanceId: instance,
        regionId: region, storeId: store, peerRole: 'follower',
      }
      components[instance] = component
      registry.registerInstance(component)
      project(instance, 0, store === region % TICITY_LAYOUT.tikvCount, false)
    }
  }
  flush()

  function updateState(state: TiCityState): void {
    latestState = state
    for (const region of state.regions) {
      if (region.id < 0 || region.id >= TICITY_LAYOUT.regionCount) continue
      const leaderStore = region.leaderStoreId.charCodeAt(region.leaderStoreId.length - 1) - 49
      const heat = Math.min(1, Math.max(0, region.hotScore / 100))
      for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
        let healthy = true
        for (const peer of region.peers) {
          if (peer.storeId.charCodeAt(peer.storeId.length - 1) - 49 === store) {
            healthy = peer.healthy
            break
          }
        }
        project(store * TICITY_LAYOUT.regionCount + region.id, heat, store === leaderStore,
          region.health === 'unavailable' || !healthy)
      }
    }
    flush()
  }

  return {
    object, updateState,
    setTheme(next): void {
      theme = next
      if (latestState) updateState(latestState)
      else {
        for (let instance = 0; instance < count; instance++) {
          project(instance, 0, components[instance].peerRole === 'leader', false)
        }
        flush()
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const mesh of meshes) mesh.dispose()
      bodyGeometry.dispose()
      detailGeometry.dispose()
      leaderGeometry.dispose()
      bodyMaterial.dispose()
      statusMaterial.dispose()
      object.clear()
    },
  }
}
