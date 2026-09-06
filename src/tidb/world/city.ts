/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import type { TiCityState } from '../model/types'
import {
  COMPONENT_ANCHORS,
  CONTROL_PATHS,
  DATA_PATHS,
  DISTRICT_BOUNDS,
  FOCUS_ANCHORS,
  GC_STORAGE_LAB_ORIGIN,
  HTAP_PATHS,
  LOCK_LAB_ORIGIN,
  PROTOCOL_LAB_ORIGIN,
  RAFT_LAB_ORIGIN,
  TIFLASH_MPP_LAB_ORIGIN,
  TRANSACTION_LAB_ORIGIN,
  TICITY_LAYOUT,
  TIKV_ARCHITECTURE,
  TIKV_BOUNDS,
  regionPeerPosition,
} from './layout'
import type { ComponentAnchorId, PlanBounds, Point3, RouteLeg } from './layout'
import { createCityEnvironment } from './environment'
import { createCityMaterials } from './palette'
import type { CityMaterials, CityTheme, SemanticDomain } from './palette'
import { createTransactionLab } from './transaction-lab'
import type { TransactionLab } from './transaction-lab'
import { createLockLab } from './lock-lab'
import type { LockLab } from './lock-lab'
import { createRaftLab } from './raft-lab'
import type { RaftLab } from './raft-lab'
import { createProtocolLab } from './protocol-lab'
import type { ProtocolLab } from './protocol-lab'
import { createGcStorageLab } from './gc-storage-lab'
import type { GcStorageLab } from './gc-storage-lab'
import { createTiFlashMppLab } from './tiflash-mpp-lab'
import type { TiFlashMppLab } from './tiflash-mpp-lab'
import { createCityGeometry } from './geometry'
import type { BoxInstance } from './geometry'
import { addBuildingDetails, SQL_TOWER_HEIGHTS } from './building-detail'
import { createRegionPeers } from './region-peers'

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
  readonly transactionLab: TransactionLab
  readonly lockLab: LockLab
  readonly raftLab: RaftLab
  readonly protocolLab: ProtocolLab
  readonly gcStorageLab: GcStorageLab
  readonly tiflashMppLab: TiFlashMppLab
  getAnchor(id: string, out: THREE.Vector3): boolean
  updateState(state: TiCityState): void
  updateVisuals(deltaSeconds: number): void
  setTheme(theme: CityTheme): void
  setNetworkEmphasis(active: boolean): void
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

function pointVector(point: Point3): THREE.Vector3 {
  return new THREE.Vector3(point[0], point[1], point[2])
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
  const segments = TICITY_LAYOUT.regionCount * 3
  const positions = new Float32Array(segments * 2 * 3)
  const ids: string[] = []
  let cursor = 0
  for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
    for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
      const next = (store + 1) % TICITY_LAYOUT.tikvCount
      const from = regionPeerPosition(store, region)
      const to = regionPeerPosition(next, region)
      positions[cursor++] = from[0]
      positions[cursor++] = TIKV_ARCHITECTURE.raftPortY
      positions[cursor++] = from[2]
      positions[cursor++] = to[0]
      positions[cursor++] = TIKV_ARCHITECTURE.raftPortY
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

export function createTiDBSceneGraph(): TiDBSceneGraph {
  const root = new THREE.Group()
  root.name = 'ticity:world'
  const registry = new Registry()
  const materials = createCityMaterials()
  const colliders: CityCollider[] = []
  const networks: CityNetwork[] = []
  const { addBox, addCylinder, addInstancedBoxes, addFacadeWindows, addBoxOutline, addHorizontalRing, batchStaticMeshes } = createCityGeometry()

  function addDistrictPad(
    parent: THREE.Object3D, bounds: PlanBounds, material: THREE.Material,
    name: string, height = 0.7,
  ): void {
    addBox(parent,
      [bounds.maxX - bounds.minX, height, bounds.maxZ - bounds.minZ],
      [(bounds.minX + bounds.maxX) / 2, height / 2, (bounds.minZ + bounds.maxZ) / 2],
      material, name)
  }

  const environment = createCityEnvironment()
  const ground = environment.ground
  root.add(environment.object)
  const transactionLab = createTransactionLab()
  transactionLab.object.position.set(...TRANSACTION_LAB_ORIGIN)
  transactionLab.object.scale.setScalar(0.92)
  root.add(transactionLab.object)
  const lockLab = createLockLab()
  lockLab.object.position.set(...LOCK_LAB_ORIGIN)
  lockLab.object.scale.setScalar(0.92)
  root.add(lockLab.object)
  const raftLab = createRaftLab()
  raftLab.object.position.set(...RAFT_LAB_ORIGIN)
  raftLab.object.scale.setScalar(0.92)
  root.add(raftLab.object)
  const protocolLab = createProtocolLab()
  protocolLab.object.position.set(...PROTOCOL_LAB_ORIGIN)
  protocolLab.object.scale.setScalar(0.92)
  root.add(protocolLab.object)
  const gcStorageLab = createGcStorageLab()
  gcStorageLab.object.position.set(...GC_STORAGE_LAB_ORIGIN)
  gcStorageLab.object.scale.setScalar(0.92)
  root.add(gcStorageLab.object)
  const tiflashMppLab = createTiFlashMppLab()
  tiflashMppLab.object.position.set(...TIFLASH_MPP_LAB_ORIGIN)
  tiflashMppLab.object.scale.setScalar(0.92)
  root.add(tiflashMppLab.object)

  /* Client terminal: workloads enter at grade, never from a floating cloud. */
  const clients = new THREE.Group()
  clients.name = 'district:clients'
  addDistrictPad(clients, DISTRICT_BOUNDS.clients, materials.pavement, 'clients:apron')
  addBox(clients, [64, 9, 22], [0, 4.8, -288], materials.darkStructure, 'clients:terminal', true)
  addBox(clients, [74, 1.6, 30], [0, 10.1, -288], materials.trim, 'clients:canopy')
  addBox(clients, [28, 7, 16], [0, 13.7, -288], materials.structure, 'clients:dispatch-deck', true)
  addBox(clients, [32, 1.2, 20], [0, 17.8, -288], materials.client, 'clients:signal-roof')
  for (const x of [-26, 26]) {
    addCylinder(clients, 2.6, 32, [x, 25, -288], materials.trim, 'clients:uplink-mast', 10, true)
    addHorizontalRing(clients, 5.4, 0.55, [x, 42, -288], materials.client, 'clients:uplink-ring')
    addHorizontalRing(clients, 3.2, 0.38, [x, 48, -288], materials.window, 'clients:uplink-signal')
  }
  addCylinder(clients, 5, 52, [0, 43, -288], materials.client, 'clients:request-beacon', 12, true)
  addHorizontalRing(clients, 9, 0.8, [0, 69, -288], materials.client, 'clients:request-ring')
  addHorizontalRing(clients, 5.5, 0.48, [0, 77, -288], materials.window, 'clients:request-signal')
  addFacadeWindows(
    clients,
    [0, 13.7, -288],
    28,
    7,
    16,
    5,
    2,
    materials.window,
    'clients:dispatch-windows',
  )
  addBoxOutline(
    clients,
    [64, 9, 22],
    [0, 4.8, -288],
    materials.edge,
    'clients:terminal-outline',
  )
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
  for (let proxy = 0; proxy < TICITY_LAYOUT.proxyCount; proxy++) {
    const anchor = COMPONENT_ANCHORS[`tiproxy.${proxy}` as 'tiproxy.0' | 'tiproxy.1']
    const group = new THREE.Group()
    group.name = `tiproxy:${proxy}`
    addBox(group, [5, 14, 5], [anchor[0] - 8, 7, anchor[2]], materials.structure, 'gate:left', true)
    addBox(group, [5, 14, 5], [anchor[0] + 8, 7, anchor[2]], materials.structure, 'gate:right', true)
    addBox(group, [21, 4, 5], [anchor[0], 13, anchor[2]], materials.sql, 'gate:balancer')
    addBox(group, [27, 1.2, 11], [anchor[0], 0.8, anchor[2]], materials.trim, 'gate:threshold')
    addInstancedBoxes(
      group,
      [
        { position: [anchor[0] - 8, 7, anchor[2] + 2.65], size: [1.5, 8.5, 0.35] },
        { position: [anchor[0] + 8, 7, anchor[2] + 2.65], size: [1.5, 8.5, 0.35] },
      ],
      materials.window,
      'gate:status-lights',
    )
    const halo = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.65, 8, 32), materials.sql)
    halo.position.set(anchor[0], 13, anchor[2] + 3)
    halo.name = 'gate:connection-halo'
    group.add(halo)
    addBoxOutline(
      group,
      [21, 4, 5],
      [anchor[0], 13, anchor[2]],
      materials.edge,
      'gate:balancer-outline',
    )
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
  for (let server = 0; server < TICITY_LAYOUT.tidbCount; server++) {
    const anchor = COMPONENT_ANCHORS[`tidb.${server}` as 'tidb.0' | 'tidb.1' | 'tidb.2']
    const height = SQL_TOWER_HEIGHTS[server]
    const centerY = height / 2 + 0.7
    const group = new THREE.Group()
    group.name = `tidb:${server}`
    // The structural core sits behind the continuous curtain wall authored in
    // building-detail. Narrow metal joints leave the glazed floors legible.
    addBox(group, [30, height, 30], [anchor[0], centerY, anchor[2]], materials.darkStructure, 'sql:tower', true)
    addBox(group, [24, 9, 24], [anchor[0], height + 5.2, anchor[2]], materials.darkStructure, 'sql:upper-tier', true)
    addBox(group, [18, 7, 18], [anchor[0], height + 13.2, anchor[2]], materials.darkStructure, 'sql:planner-tier')
    addBox(group, [32.4, 0.9, 32.4], [anchor[0], height + 0.8, anchor[2]], materials.structure, 'sql:optimizer')
    addBox(group, [25.5, 0.7, 25.5], [anchor[0], height + 9.7, anchor[2]], materials.structure, 'sql:upper-cornice')
    addBox(group, [19.7, 0.7, 19.7], [anchor[0], height + 16.9, anchor[2]], materials.structure, 'sql:roof-cornice')
    addCylinder(group, 4.4, 1.1, [anchor[0], height + 17.8, anchor[2]], materials.trim, 'sql:roof-plant-deck', 24)
    addCylinder(group, 2.2, 3.4, [anchor[0], height + 19.9, anchor[2]], materials.darkStructure, 'sql:stateless-core', 16)
    addCylinder(group, 0.35, 7.5, [anchor[0], height + 23.6, anchor[2]], materials.trim, 'sql:antenna', 8)
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
    addCollider(colliders, `tidb.${server}`, [anchor[0], centerY, anchor[2]], [30, height + 0.7, 30])
  }
  root.add(tidbDistrict)

  /* PD sits east of the data avenue. Gold links are control-plane only. */
  const pdDistrict = new THREE.Group()
  pdDistrict.name = 'district:pd'
  addDistrictPad(pdDistrict, DISTRICT_BOUNDS.pd, materials.pavement, 'pd:apron')
  const pdHub = new THREE.Group()
  pdHub.name = 'pd:control'
  addCylinder(pdHub, 30, 4, [232, 2.4, -102], materials.darkStructure, 'pd:control-deck', 32)
  addCylinder(pdHub, 19, 20, [232, 12.5, -102], materials.darkStructure, 'pd:control-tower', 32, true)
  addCylinder(pdHub, 12, 28, [232, 26.5, -102], materials.darkStructure, 'pd:tso-core', 32, true)
  addCylinder(pdHub, 1.15, 17, [232, 47.5, -102], materials.tso, 'pd:clock-spire', 16)
  // These flush service decks shape the tower without floating neon hoops.
  addCylinder(pdHub, 22, 0.8, [232, 8, -102], materials.tso, 'pd:scheduler-ring', 32)
  addCylinder(pdHub, 20.3, 1, [232, 22.4, -102], materials.structure, 'pd:terrace-cornice', 32)
  addCylinder(pdHub, 13.3, 0.8, [232, 40.5, -102], materials.structure, 'pd:clock-ring', 32)
  addCylinder(pdHub, 5.2, 1.2, [232, 41.4, -102], materials.trim, 'pd:clock-plinth', 24)
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
  addCollider(colliders, 'pd.control', [232, 12.5, -102], [60, 25, 60])
  for (let node = 0; node < TICITY_LAYOUT.pdCount; node++) {
    const anchor = COMPONENT_ANCHORS[`pd.${node}` as 'pd.0' | 'pd.1' | 'pd.2']
    const group = new THREE.Group()
    group.name = `pd:${node}`
    addCylinder(group, 9, 14, [anchor[0], 7.4, anchor[2]], materials.structure, 'pd:node', 12, true)
    addCylinder(group, 4.5, 15, [anchor[0], 10, anchor[2]], materials.tso, 'pd:tso-clock', 12)
    addCylinder(group, 0.65, 12, [anchor[0], 23, anchor[2]], materials.trim, 'pd:node-antenna', 8)
    addHorizontalRing(group, 7.2, 0.45, [anchor[0], 16, anchor[2]], materials.window, 'pd:node-status-ring')
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

  /* Multi-Raft TiKV stores. All rack bodies share one selectable instance batch. */
  const campusRoot = new THREE.Group()
  campusRoot.name = 'district:tikv'
  for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
    const bounds = TIKV_BOUNDS[store]
    addDistrictPad(campusRoot, bounds, materials.pavement, `tikv:${store}:campus`, 1.1)
    const anchor = COMPONENT_ANCHORS[`tikv.${store}` as 'tikv.0' | 'tikv.1' | 'tikv.2']
    const group = new THREE.Group()
    group.name = `tikv:${store}`
    addBox(group,
      [TIKV_ARCHITECTURE.deckWidth, TIKV_ARCHITECTURE.deckHeight, TIKV_ARCHITECTURE.deckWidth],
      [anchor[0], TIKV_ARCHITECTURE.deckCenterY, anchor[2]], materials.darkStructure, 'tikv:store', true)
    addBoxOutline(
      group,
      [100, 5, 100],
      [anchor[0], 2.9, anchor[2]],
      materials.edge,
      'tikv:deck-outline',
    )
    const cornerPylons: BoxInstance[] = []
    const cornerCaps: BoxInstance[] = []
    for (const dx of [-44, 44]) {
      for (const dz of [-44, 44]) {
        cornerPylons.push({
          position: [anchor[0] + dx, 10.5, anchor[2] + dz],
          size: [5, 16, 5],
        })
        cornerCaps.push({
          position: [anchor[0] + dx, 19, anchor[2] + dz],
          size: [6.8, 1.4, 6.8],
        })
      }
    }
    addInstancedBoxes(group, cornerPylons, materials.trim, 'tikv:campus-pylons', true)
    addInstancedBoxes(group, cornerCaps, materials.kv, 'tikv:campus-beacons')
    addBox(
      group,
      [36, 8, 3.2],
      [anchor[0], 9, anchor[2] - 49],
      materials.kv,
      'tikv:store-sign',
    )
    addFacadeWindows(
      group,
      [anchor[0], 9, anchor[2] - 49],
      36,
      8,
      3.2,
      6,
      2,
      materials.window,
      'tikv:store-sign-lights',
    )
    addCylinder(
      group,
      2.4,
      18,
      [anchor[0], 12, anchor[2] + 47],
      materials.trim,
      'tikv:telemetry-mast',
      10,
    )
    addHorizontalRing(
      group,
      6.5,
      0.55,
      [anchor[0], 21, anchor[2] + 47],
      materials.kv,
      'tikv:telemetry-ring',
    )
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
    addCollider(
      colliders,
      `tikv.${store}`,
      [anchor[0], 2.9, anchor[2]],
      [100, 5, 100],
    )
  }

  const regionPeers = createRegionPeers(registry, materials)
  campusRoot.add(regionPeers.object)
  root.add(campusRoot)

  /* GC yard makes safe-point progress spatially distinct from compaction. */
  const gc = new THREE.Group()
  gc.name = 'district:gc'
  addDistrictPad(gc, DISTRICT_BOUNDS.gc, materials.pavement, 'gc:apron')
  addBox(gc, [76, 7, 58], [-231, 3.8, 215], materials.darkStructure, 'gc:yard', true)
  for (let bin = 0; bin < 5; bin++) {
    const x = -259 + bin * 14
    addCylinder(gc, 6, 9, [x, 12, 215], materials.gc, `gc:versions:${bin}`, 10)
    addHorizontalRing(gc, 6.2, 0.42, [x, 16.5, 215], materials.window, `gc:bin-ring:${bin}`)
  }
  addInstancedBoxes(
    gc,
    [
      { position: [-265, 15, 190], size: [4, 24, 4] },
      { position: [-197, 15, 190], size: [4, 24, 4] },
      { position: [-265, 15, 240], size: [4, 24, 4] },
      { position: [-197, 15, 240], size: [4, 24, 4] },
      { position: [-231, 27, 190], size: [72, 4, 4] },
      { position: [-231, 27, 240], size: [72, 4, 4] },
    ],
    materials.trim,
    'gc:reclaimer-gantry',
    true,
  )
  addBox(gc, [28, 18, 18], [-231, 16, 244], materials.structure, 'gc:control-room', true)
  addFacadeWindows(
    gc,
    [-231, 16, 244],
    28,
    18,
    18,
    5,
    3,
    materials.window,
    'gc:control-windows',
  )
  addCylinder(gc, 2.2, 28, [-270, 18, 239], materials.trim, 'gc:exhaust-stack', 10)
  addHorizontalRing(gc, 3.4, 0.48, [-270, 32, 239], materials.gc, 'gc:safe-point-beacon')
  addBoxOutline(
    gc,
    [76, 7, 58],
    [-231, 3.8, 215],
    materials.edge,
    'gc:yard-outline',
  )
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
  addBox(tiflash, [82, 8, 66], [230, 4.4, 216], materials.darkStructure, 'tiflash:store', true)
  const tiflashCrowns: BoxInstance[] = []
  for (let column = 0; column < 6; column++) {
    const x = 196 + column * 14
    const height = 28 + (column % 2) * 8
    const y = 8.6 + height / 2
    addBox(
      tiflash,
      [8, height, 38],
      [x, y, 216],
      materials.darkStructure,
      `tiflash:column:${column}`,
      true,
    )
    tiflashCrowns.push({
      position: [x, y + height / 2 + 0.7, 216],
      size: [9.8, 1.2, 41],
    })
  }
  addInstancedBoxes(tiflash, tiflashCrowns, materials.structure, 'tiflash:column-crowns')
  addCylinder(tiflash, 3.3, 26, [230, 23, 248], materials.trim, 'tiflash:mpp-spine', 20)
  addCylinder(tiflash, 6.8, 1.1, [230, 36.5, 248], materials.structure, 'tiflash:mpp-ring', 24)
  addCylinder(tiflash, 2.1, 6, [230, 40, 248], materials.tiflash, 'tiflash:learner-ring', 16)
  addBoxOutline(
    tiflash,
    [82, 8, 66],
    [230, 4.4, 216],
    materials.edge,
    'tiflash:store-outline',
  )
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
  addCollider(colliders, 'tiflash.0', [230, 25, 216], [86, 50, 68])
  addBuildingDetails(root, materials)
  batchStaticMeshes(root)

  const dataLegs = DATA_PATHS.flat()
  const data = lineNetwork('network:data', 'sql', dataLegs, materials.dataLine, 2)
  const control = lineNetwork('network:control', 'tso', CONTROL_PATHS, materials.controlLine, 4)
  const htap = lineNetwork('network:htap', 'tiflash', HTAP_PATHS, materials.htapLine, 3)
  const raft = raftNetwork(materials.raft)
  networks.push(data, control, htap, raft)
  for (const network of networks) root.add(network.object)

  let theme: CityTheme = 'night'
  let focused: CityComponent | undefined
  let disposed = false

  return {
    root,
    ground,
    registry,
    colliders,
    networks,
    materials,
    transactionLab,
    lockLab,
    raftLab,
    protocolLab,
    gcStorageLab,
    tiflashMppLab,
    getAnchor(id: string, out: THREE.Vector3): boolean {
      const tiflashLabAnchor =
        id === 'tiflash.lab.store.0' ? tiflashMppLab.storeAnchors[0]
          : id === 'tiflash.lab.store.1' ? tiflashMppLab.storeAnchors[1]
            : id === 'tiflash.lab.learner.0'
              ? tiflashMppLab.learnerAnchors[0]
              : id === 'tiflash.lab.learner.1'
                ? tiflashMppLab.learnerAnchors[1]
                : id === 'tiflash.lab.learner.2'
                  ? tiflashMppLab.learnerAnchors[2]
                  : id === 'tiflash.lab.fragment.scan'
                    ? tiflashMppLab.fragmentAnchors[0]
                    : id === 'tiflash.lab.fragment.final'
                      ? tiflashMppLab.fragmentAnchors[1]
                      : id === 'tiflash.lab.task.0'
                        ? tiflashMppLab.taskAnchors[0]
                        : id === 'tiflash.lab.task.1'
                          ? tiflashMppLab.taskAnchors[1]
                          : id === 'tiflash.lab.task.2'
                            ? tiflashMppLab.taskAnchors[2]
                            : id === 'tiflash.lab.task.3'
                              ? tiflashMppLab.taskAnchors[3]
                              : id === 'tiflash.lab.root'
                                ? tiflashMppLab.rootAnchor
                                : undefined
      if (tiflashLabAnchor) {
        tiflashLabAnchor.getWorldPosition(out)
        return true
      }
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
    updateState: regionPeers.updateState,
    updateVisuals(deltaSeconds: number): void {
      environment.update(deltaSeconds)
    },
    setTheme(next: CityTheme): void {
      if (next === theme) return
      theme = next
      materials.apply(next)
      environment.setTheme(next)
      transactionLab.setTheme(next)
      lockLab.setTheme(next)
      raftLab.setTheme(next)
      protocolLab.setTheme(next)
      gcStorageLab.setTheme(next)
      tiflashMppLab.setTheme(next)
      regionPeers.setTheme(next)
    },
    setNetworkEmphasis(active: boolean): void {
      materials.setNetworkEmphasis(active)
    },
    setFocus(id: string | null): void {
      if (focused) focused.object.userData.focused = false
      focused = id ? registry.get(id) : undefined
      if (focused) focused.object.userData.focused = true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      environment.dispose()
      transactionLab.dispose()
      lockLab.dispose()
      raftLab.dispose()
      protocolLab.dispose()
      gcStorageLab.dispose()
      tiflashMppLab.dispose()
      regionPeers.dispose()
      const geometries = new Set<THREE.BufferGeometry>()
      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.geometry) geometries.add(mesh.geometry)
        if (object instanceof THREE.InstancedMesh) object.dispose()
      })
      for (const geometry of geometries) geometry.dispose()
      materials.dispose()
      root.clear()
    },
  }
}
