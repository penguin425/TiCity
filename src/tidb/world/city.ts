/*
 * Copyright 2026 TiDB City contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import type { TiDBCityState } from '../model/types'
import {
  COMPONENT_ANCHORS,
  CONTROL_PATHS,
  DATA_PATHS,
  DISTRICT_BOUNDS,
  FOCUS_ANCHORS,
  HTAP_PATHS,
  TIDB_CITY,
  TIKV_BOUNDS,
  regionPeerPosition,
} from './layout'
import type { ComponentAnchorId, PlanBounds, Point3, RouteLeg } from './layout'
import { SEMANTIC_COLORS, createCityMaterials } from './palette'
import type { CityMaterials, CityTheme, SemanticDomain } from './palette'

export type CityComponentKind =
  | 'client'
  | 'tiproxy'
  | 'tidb'
  | 'pd'
  | 'tikv'
  | 'region-peer'
  | 'gc'
  | 'tiflash'

export interface CityComponent {
  readonly id: string
  readonly name: string
  role: string
  readonly kind: CityComponentKind
  domain: SemanticDomain
  readonly object: THREE.Object3D
  readonly anchor: THREE.Vector3
  readonly instanceId?: number
  readonly regionId?: number
  readonly storeId?: number
  peerRole?: 'leader' | 'follower'
}

export interface CityCollider {
  readonly id: string
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}

export interface CityNetwork {
  readonly domain: SemanticDomain
  readonly object: THREE.LineSegments
  readonly componentIds: readonly string[]
}

export interface CityRegistry {
  register(component: CityComponent): void
  registerInstance(component: CityComponent): void
  get(id: string): CityComponent | undefined
  all(): readonly CityComponent[]
  roots(): readonly THREE.Object3D[]
  resolve(object: THREE.Object3D | null, instanceId?: number): CityComponent | undefined
}

export interface TiDBSceneGraph {
  readonly root: THREE.Group
  readonly ground: THREE.Mesh
  readonly registry: CityRegistry
  readonly colliders: readonly CityCollider[]
  readonly networks: readonly CityNetwork[]
  readonly materials: CityMaterials
  getAnchor(id: string, out: THREE.Vector3): boolean
  updateState(state: TiDBCityState): void
  setTheme(theme: CityTheme): void
  setFocus(id: string | null): void
  dispose(): void
}

class Registry implements CityRegistry {
  private readonly byId = new Map<string, CityComponent>()
  private readonly byObject = new Map<THREE.Object3D, CityComponent>()
  private readonly byInstance = new Map<THREE.Object3D, CityComponent[]>()
  private readonly ordered: CityComponent[] = []
  private readonly rootList: THREE.Object3D[] = []

  register(component: CityComponent): void {
    if (this.byId.has(component.id)) throw new Error(`duplicate component id: ${component.id}`)
    this.byId.set(component.id, component)
    this.byObject.set(component.object, component)
    this.ordered.push(component)
    this.rootList.push(component.object)
    component.object.userData.componentId = component.id
  }

  registerInstance(component: CityComponent): void {
    if (component.instanceId === undefined) {
      throw new Error(`instance component ${component.id} has no instanceId`)
    }
    if (this.byId.has(component.id)) throw new Error(`duplicate component id: ${component.id}`)
    this.byId.set(component.id, component)
    this.ordered.push(component)
    let instances = this.byInstance.get(component.object)
    if (!instances) {
      instances = []
      this.byInstance.set(component.object, instances)
      this.rootList.push(component.object)
    }
    instances[component.instanceId] = component
  }

  get(id: string): CityComponent | undefined {
    return this.byId.get(id)
  }

  all(): readonly CityComponent[] {
    return this.ordered
  }

  roots(): readonly THREE.Object3D[] {
    return this.rootList
  }

  resolve(object: THREE.Object3D | null, instanceId?: number): CityComponent | undefined {
    let cursor = object
    let guard = 0
    while (cursor && guard++ < 64) {
      if (instanceId !== undefined) {
        const instance = this.byInstance.get(cursor)?.[instanceId]
        if (instance) return instance
      }
      const direct = this.byObject.get(cursor)
      if (direct) return direct
      cursor = cursor.parent
    }
    return undefined
  }
}

const _matrix = new THREE.Matrix4()
const _position = new THREE.Vector3()
const _scale = new THREE.Vector3(1, 1, 1)
const _rotation = new THREE.Quaternion()
const _color = new THREE.Color()

function pointVector(point: Point3): THREE.Vector3 {
  return new THREE.Vector3(point[0], point[1], point[2])
}

function addBox(
  parent: THREE.Object3D,
  size: Point3,
  position: Point3,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function addCylinder(
  parent: THREE.Object3D,
  radius: number,
  height: number,
  position: Point3,
  material: THREE.Material,
  name: string,
  sides = 12,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.name = name
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function addCollider(
  colliders: CityCollider[],
  id: string,
  center: Point3,
  size: Point3,
): void {
  colliders.push({
    id,
    minX: center[0] - size[0] / 2,
    maxX: center[0] + size[0] / 2,
    minY: center[1] - size[1] / 2,
    maxY: center[1] + size[1] / 2,
    minZ: center[2] - size[2] / 2,
    maxZ: center[2] + size[2] / 2,
  })
}

function registerGroup(
  registry: Registry,
  id: string,
  name: string,
  role: string,
  kind: CityComponentKind,
  domain: SemanticDomain,
  group: THREE.Group,
  anchor: Point3,
): void {
  registry.register({
    id,
    name,
    role,
    kind,
    domain,
    object: group,
    anchor: pointVector(anchor),
  })
}

function lineNetwork(
  name: string,
  domain: SemanticDomain,
  legs: readonly RouteLeg[],
  material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
  lift: number,
): CityNetwork {
  const positions = new Float32Array(legs.length * 2 * 3)
  const ids: string[] = []
  for (let i = 0; i < legs.length; i++) {
    const from = COMPONENT_ANCHORS[legs[i].from]
    const to = COMPONENT_ANCHORS[legs[i].to]
    const offset = i * 6
    positions[offset] = from[0]
    positions[offset + 1] = from[1] + lift
    positions[offset + 2] = from[2]
    positions[offset + 3] = to[0]
    positions[offset + 4] = to[1] + lift
    positions[offset + 5] = to[2]
    ids.push(legs[i].from, legs[i].to)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const object = new THREE.LineSegments(geometry, material)
  object.name = name
  object.userData.domain = domain
  if (material instanceof THREE.LineDashedMaterial) object.computeLineDistances()
  return { domain, object, componentIds: ids }
}

function raftNetwork(material: THREE.LineBasicMaterial): CityNetwork {
  /* A triangle per Region: three voter links, visibly distinct from 2PC. */
  const segments = TIDB_CITY.regionCount * 3
  const positions = new Float32Array(segments * 2 * 3)
  const ids: string[] = []
  let cursor = 0
  for (let region = 0; region < TIDB_CITY.regionCount; region++) {
    for (let store = 0; store < TIDB_CITY.tikvCount; store++) {
      const next = (store + 1) % TIDB_CITY.tikvCount
      const from = regionPeerPosition(store, region)
      const to = regionPeerPosition(next, region)
      positions[cursor++] = from[0]
      positions[cursor++] = 2.2
      positions[cursor++] = from[2]
      positions[cursor++] = to[0]
      positions[cursor++] = 2.2
      positions[cursor++] = to[2]
      ids.push(`region.${region}.peer.${store}`, `region.${region}.peer.${next}`)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const object = new THREE.LineSegments(geometry, material)
  object.name = 'network:raft'
  object.userData.domain = 'raft'
  return { domain: 'raft', object, componentIds: ids }
}

function makeGround(materials: CityMaterials): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(TIDB_CITY.groundSize, TIDB_CITY.groundSize, 1, 1)
  const mesh = new THREE.Mesh(geometry, materials.ground)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = -0.2
  mesh.receiveShadow = true
  mesh.name = 'tidb-city:ground'
  return mesh
}

function addDistrictPad(
  root: THREE.Object3D,
  bounds: PlanBounds,
  material: THREE.Material,
  name: string,
  height = 0.7,
): void {
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  addBox(
    root,
    [width, height, depth],
    [(bounds.minX + bounds.maxX) / 2, height / 2, (bounds.minZ + bounds.maxZ) / 2],
    material,
    name,
  )
}

export function createTiDBSceneGraph(): TiDBSceneGraph {
  const root = new THREE.Group()
  root.name = 'tidb-city:world'
  const registry = new Registry()
  const materials = createCityMaterials()
  const colliders: CityCollider[] = []
  const networks: CityNetwork[] = []

  const ground = makeGround(materials)
  root.add(ground)

  /* Client terminal: workloads enter at grade, never from a floating cloud. */
  const clients = new THREE.Group()
  clients.name = 'district:clients'
  addDistrictPad(clients, DISTRICT_BOUNDS.clients, materials.pavement, 'clients:apron')
  addBox(clients, [64, 9, 22], [0, 4.8, -288], materials.darkStructure, 'clients:terminal')
  for (let i = 0; i < 5; i++) {
    addBox(
      clients,
      [7, 3.2, 4],
      [-24 + i * 12, 2.3, -275],
      materials.client,
      `clients:workload:${i}`,
    )
  }
  root.add(clients)
  registerGroup(
    registry,
    'client.terminal',
    'Client workloads',
    'Applications speaking the MySQL protocol',
    'client',
    'client',
    clients,
    COMPONENT_ANCHORS['client.terminal'],
  )
  addCollider(colliders, 'client.terminal', [0, 4.8, -288], [64, 9, 22])

  /* TiProxy is a pair of gates. It balances connections, not SQL operators. */
  const proxyDistrict = new THREE.Group()
  proxyDistrict.name = 'district:tiproxy'
  addDistrictPad(proxyDistrict, DISTRICT_BOUNDS.tiproxy, materials.pavement, 'tiproxy:apron')
  for (let proxy = 0; proxy < TIDB_CITY.proxyCount; proxy++) {
    const anchor = COMPONENT_ANCHORS[`tiproxy.${proxy}` as 'tiproxy.0' | 'tiproxy.1']
    const group = new THREE.Group()
    group.name = `tiproxy:${proxy}`
    addBox(group, [5, 14, 5], [anchor[0] - 8, 7, anchor[2]], materials.structure, 'gate:left')
    addBox(group, [5, 14, 5], [anchor[0] + 8, 7, anchor[2]], materials.structure, 'gate:right')
    addBox(group, [21, 4, 5], [anchor[0], 13, anchor[2]], materials.sql, 'gate:balancer')
    proxyDistrict.add(group)
    registerGroup(
      registry,
      `tiproxy.${proxy}`,
      `TiProxy ${proxy + 1}`,
      'Connection routing and load balancing',
      'tiproxy',
      'sql',
      group,
      anchor,
    )
    addCollider(colliders, `tiproxy.${proxy}.left`, [anchor[0] - 8, 7, anchor[2]], [5, 14, 5])
    addCollider(colliders, `tiproxy.${proxy}.right`, [anchor[0] + 8, 7, anchor[2]], [5, 14, 5])
  }
  root.add(proxyDistrict)

  /* Stateless TiDB SQL layer. */
  const tidbDistrict = new THREE.Group()
  tidbDistrict.name = 'district:tidb'
  addDistrictPad(tidbDistrict, DISTRICT_BOUNDS.tidb, materials.pavement, 'tidb:apron')
  for (let server = 0; server < TIDB_CITY.tidbCount; server++) {
    const anchor = COMPONENT_ANCHORS[`tidb.${server}` as 'tidb.0' | 'tidb.1' | 'tidb.2']
    const group = new THREE.Group()
    group.name = `tidb:${server}`
    addBox(group, [30, 30, 30], [anchor[0], 15.7, anchor[2]], materials.structure, 'sql:tower')
    addBox(group, [23, 3, 23], [anchor[0], 22, anchor[2]], materials.sql, 'sql:optimizer')
    addCylinder(group, 3, 13, [anchor[0], 36, anchor[2]], materials.sql, 'sql:stateless-core', 10)
    tidbDistrict.add(group)
    registerGroup(
      registry,
      `tidb.${server}`,
      `TiDB Server ${server + 1}`,
      'Stateless SQL parsing, planning, and distributed execution',
      'tidb',
      'sql',
      group,
      anchor,
    )
    addCollider(colliders, `tidb.${server}`, [anchor[0], 15.7, anchor[2]], [30, 31, 30])
  }
  root.add(tidbDistrict)

  /* PD sits east of the data avenue. Gold links are control-plane only. */
  const pdDistrict = new THREE.Group()
  pdDistrict.name = 'district:pd'
  addDistrictPad(pdDistrict, DISTRICT_BOUNDS.pd, materials.pavement, 'pd:apron')
  const pdHub = new THREE.Group()
  pdHub.name = 'pd:control'
  addCylinder(pdHub, 30, 4, [232, 2.4, -102], materials.darkStructure, 'pd:control-deck', 24)
  pdDistrict.add(pdHub)
  registerGroup(
    registry,
    'pd.control',
    'PD control plane',
    'Timestamp oracle, metadata, and scheduling — not a row data path',
    'pd',
    'tso',
    pdHub,
    COMPONENT_ANCHORS['pd.control'],
  )
  for (let node = 0; node < TIDB_CITY.pdCount; node++) {
    const anchor = COMPONENT_ANCHORS[`pd.${node}` as 'pd.0' | 'pd.1' | 'pd.2']
    const group = new THREE.Group()
    group.name = `pd:${node}`
    addCylinder(group, 9, 14, [anchor[0], 7.4, anchor[2]], materials.structure, 'pd:node', 12)
    addCylinder(group, 4.5, 15, [anchor[0], 10, anchor[2]], materials.tso, 'pd:tso-clock', 12)
    pdDistrict.add(group)
    registerGroup(
      registry,
      `pd.${node}`,
      `PD ${node + 1}`,
      node === 0 ? 'PD leader and TSO service' : 'PD follower',
      'pd',
      'tso',
      group,
      anchor,
    )
    addCollider(colliders, `pd.${node}`, [anchor[0], 7.4, anchor[2]], [18, 14, 18])
  }
  root.add(pdDistrict)

  /* Multi-Raft TiKV stores. One InstancedMesh contains all 108 peers. */
  const campusRoot = new THREE.Group()
  campusRoot.name = 'district:tikv'
  for (let store = 0; store < TIDB_CITY.tikvCount; store++) {
    const bounds = TIKV_BOUNDS[store]
    addDistrictPad(campusRoot, bounds, materials.pavement, `tikv:${store}:campus`, 1.1)
    const anchor = COMPONENT_ANCHORS[`tikv.${store}` as 'tikv.0' | 'tikv.1' | 'tikv.2']
    const group = new THREE.Group()
    group.name = `tikv:${store}`
    addBox(group, [100, 5, 100], [anchor[0], 2.9, anchor[2]], materials.darkStructure, 'tikv:store')
    campusRoot.add(group)
    registerGroup(
      registry,
      `tikv.${store}`,
      `TiKV Store ${store + 1}`,
      'A storage node hosting peers for many independent Raft groups',
      'tikv',
      'kv',
      group,
      anchor,
    )
  }

  const peerCount = TIDB_CITY.regionCount * TIDB_CITY.peersPerRegion
  const peerBase = new Float32Array(peerCount * 3)
  const peerComponents = new Array<CityComponent>(peerCount)
  const peerGeometry = new THREE.BoxGeometry(8.4, 5.2, 7.2)
  const peerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x1a3144,
    emissiveIntensity: 0.72,
    roughness: 0.62,
    metalness: 0.22,
    vertexColors: true,
  })
  peerMaterial.name = 'region-peer:semantic'
  const peers = new THREE.InstancedMesh(peerGeometry, peerMaterial, peerCount)
  peers.name = 'tikv:region-peers'
  peers.castShadow = true
  peers.receiveShadow = true
  let peerInstance = 0
  for (let store = 0; store < TIDB_CITY.tikvCount; store++) {
    for (let region = 0; region < TIDB_CITY.regionCount; region++) {
      const point = regionPeerPosition(store, region)
      const leaderStore = region % TIDB_CITY.tikvCount
      const leader = store === leaderStore
      _position.set(point[0], point[1], point[2])
      _matrix.compose(_position, _rotation, _scale)
      peers.setMatrixAt(peerInstance, _matrix)
      peerBase[peerInstance * 3] = point[0]
      peerBase[peerInstance * 3 + 1] = point[1]
      peerBase[peerInstance * 3 + 2] = point[2]
      _color.setHex(leader ? SEMANTIC_COLORS.night.raft : SEMANTIC_COLORS.night.kv)
      if (!leader) _color.multiplyScalar(0.54)
      peers.setColorAt(peerInstance, _color)
      const component: CityComponent = {
        id: `region.${region}.peer.${store}`,
        name: `Region ${region + 1} peer on TiKV ${store + 1}`,
        role: leader ? 'Raft leader voter' : 'Raft follower voter',
        kind: 'region-peer',
        domain: leader ? 'raft' : 'kv',
        object: peers,
        anchor: pointVector(point),
        instanceId: peerInstance,
        regionId: region,
        storeId: store,
        peerRole: leader ? 'leader' : 'follower',
      }
      peerComponents[peerInstance] = component
      registry.registerInstance(component)
      peerInstance++
    }
  }
  peers.instanceMatrix.needsUpdate = true
  if (peers.instanceColor) peers.instanceColor.needsUpdate = true
  campusRoot.add(peers)
  root.add(campusRoot)

  /* GC yard makes safe-point progress spatially distinct from compaction. */
  const gc = new THREE.Group()
  gc.name = 'district:gc'
  addDistrictPad(gc, DISTRICT_BOUNDS.gc, materials.pavement, 'gc:apron')
  addBox(gc, [76, 7, 58], [-231, 3.8, 215], materials.darkStructure, 'gc:yard')
  for (let bin = 0; bin < 5; bin++) {
    addCylinder(gc, 6, 9, [-259 + bin * 14, 8, 215], materials.gc, `gc:versions:${bin}`, 10)
  }
  root.add(gc)
  registerGroup(
    registry,
    'gc.yard',
    'MVCC GC yard',
    'GC safe point, Resolve Locks, and obsolete-version cleanup',
    'gc',
    'gc',
    gc,
    COMPONENT_ANCHORS['gc.yard'],
  )
  addCollider(colliders, 'gc.yard', [-231, 3.8, 215], [76, 7, 58])

  /* TiFlash is a learner/MPP quarter, never a direct transactional writer. */
  const tiflash = new THREE.Group()
  tiflash.name = 'district:tiflash'
  addDistrictPad(tiflash, DISTRICT_BOUNDS.tiflash, materials.pavement, 'tiflash:apron')
  addBox(tiflash, [82, 8, 66], [230, 4.4, 216], materials.darkStructure, 'tiflash:store')
  for (let column = 0; column < 6; column++) {
    addBox(
      tiflash,
      [8, 28 + (column % 2) * 8, 38],
      [196 + column * 14, 18 + (column % 2) * 4, 216],
      materials.tiflash,
      `tiflash:column:${column}`,
    )
  }
  root.add(tiflash)
  registerGroup(
    registry,
    'tiflash.0',
    'TiFlash learner and MPP',
    'Asynchronous learner replication and columnar analytical execution',
    'tiflash',
    'tiflash',
    tiflash,
    COMPONENT_ANCHORS['tiflash.0'],
  )
  addCollider(colliders, 'tiflash.0', [230, 17, 216], [86, 34, 68])

  const dataLegs = DATA_PATHS.flat()
  const data = lineNetwork('network:data', 'sql', dataLegs, materials.dataLine, 2)
  const control = lineNetwork('network:control', 'tso', CONTROL_PATHS, materials.controlLine, 4)
  const htap = lineNetwork('network:htap', 'tiflash', HTAP_PATHS, materials.htapLine, 3)
  const raft = raftNetwork(materials.raft)
  networks.push(data, control, htap, raft)
  for (const network of networks) root.add(network.object)

  let theme: CityTheme = 'night'
  let focused: CityComponent | undefined
  let latestState: TiDBCityState | null = null

  function paintPeers(next: CityTheme): void {
    peerMaterial.emissive.setHex(next === 'night' ? 0x1a3144 : 0x000000)
    peerMaterial.emissiveIntensity = next === 'night' ? 0.72 : 0
    for (let region = 0; region < TIDB_CITY.regionCount; region++) {
      for (let store = 0; store < TIDB_CITY.tikvCount; store++) {
        const instance = store * TIDB_CITY.regionCount + region
        const leader = store === region % TIDB_CITY.tikvCount
        _color.setHex(
          leader ? SEMANTIC_COLORS[next].raft : SEMANTIC_COLORS[next].kv,
        )
        if (!leader) _color.multiplyScalar(next === 'night' ? 0.54 : 0.84)
        peers.setColorAt(instance, _color)
      }
    }
    if (peers.instanceColor) peers.instanceColor.needsUpdate = true
  }

  function updateState(state: TiDBCityState): void {
    latestState = state
    for (let region = 0; region < TIDB_CITY.regionCount; region++) {
      const regionState = state.regions.find((candidate) => candidate.id === region)
      if (!regionState) continue
      const leaderStore = Math.max(
        0,
        Math.min(
          TIDB_CITY.tikvCount - 1,
          regionState.leaderStoreId.charCodeAt(regionState.leaderStoreId.length - 1) - 49,
        ),
      )
      const heat = Math.min(1, Math.max(0, regionState.hotScore / 100))
      for (let store = 0; store < TIDB_CITY.tikvCount; store++) {
        const instance = store * TIDB_CITY.regionCount + region
        const component = peerComponents[instance]
        let peerHealthy = true
        for (let peerIndex = 0; peerIndex < regionState.peers.length; peerIndex++) {
          const peer = regionState.peers[peerIndex]
          const peerStore = peer.storeId.charCodeAt(peer.storeId.length - 1) - 49
          if (peerStore === store) {
            peerHealthy = peer.healthy
            break
          }
        }
        const leader = store === leaderStore
        const unhealthy = regionState.health === 'unavailable' || !peerHealthy

        const base = instance * 3
        _position.set(peerBase[base], peerBase[base + 1] + heat * 2.6, peerBase[base + 2])
        _scale.set(1, 1 + heat, 1)
        _matrix.compose(_position, _rotation, _scale)
        peers.setMatrixAt(instance, _matrix)

        _color.setHex(
          unhealthy
            ? SEMANTIC_COLORS[theme].fault
            : leader
              ? SEMANTIC_COLORS[theme].raft
              : SEMANTIC_COLORS[theme].kv,
        )
        if (!leader && !unhealthy) _color.multiplyScalar(theme === 'night' ? 0.54 : 0.84)
        peers.setColorAt(instance, _color)

        component.peerRole = leader ? 'leader' : 'follower'
        component.domain = unhealthy ? 'fault' : leader ? 'raft' : 'kv'
        component.role = unhealthy
          ? 'Unavailable Raft voter'
          : leader
            ? 'Raft leader voter'
            : 'Raft follower voter'
      }
    }
    peers.instanceMatrix.needsUpdate = true
    if (peers.instanceColor) peers.instanceColor.needsUpdate = true
  }

  return {
    root,
    ground,
    registry,
    colliders,
    networks,
    materials,
    getAnchor(id: string, out: THREE.Vector3): boolean {
      const component = registry.get(id)
      if (component) {
        out.copy(component.anchor)
        return true
      }
      const staticAnchor = COMPONENT_ANCHORS[id as ComponentAnchorId]
      const focusAnchor = FOCUS_ANCHORS[id as keyof typeof FOCUS_ANCHORS]
      const anchor = staticAnchor ?? focusAnchor
      if (!anchor) return false
      out.set(anchor[0], anchor[1], anchor[2])
      return true
    },
    updateState,
    setTheme(next: CityTheme): void {
      if (next === theme) return
      theme = next
      materials.apply(next)
      if (latestState) updateState(latestState)
      else paintPeers(next)
    },
    setFocus(id: string | null): void {
      if (focused) focused.object.userData.focused = false
      focused = id ? registry.get(id) : undefined
      if (focused) focused.object.userData.focused = true
    },
    dispose(): void {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
      })
      peerMaterial.dispose()
      materials.dispose()
      root.clear()
    },
  }
}
