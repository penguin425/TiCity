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
  HTAP_PATHS,
  LOCK_LAB_ORIGIN,
  TRANSACTION_LAB_ORIGIN,
  TICITY_LAYOUT,
  TIKV_BOUNDS,
  regionPeerPosition,
} from './layout'
import type { ComponentAnchorId, PlanBounds, Point3, RouteLeg } from './layout'
import { createCityEnvironment } from './environment'
import { SEMANTIC_COLORS, createCityMaterials } from './palette'
import type { CityMaterials, CityTheme, SemanticDomain } from './palette'
import { createTransactionLab } from './transaction-lab'
import type { TransactionLab } from './transaction-lab'
import { createLockLab } from './lock-lab'
import type { LockLab } from './lock-lab'

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
  castShadow = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.name = name
  mesh.castShadow = castShadow
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
  castShadow = false,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.name = name
  mesh.castShadow = castShadow
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

interface BoxInstance {
  readonly position: Point3
  readonly size: Point3
  readonly rotationY?: number
}

function addInstancedBoxes(
  parent: THREE.Object3D,
  instances: readonly BoxInstance[],
  material: THREE.Material,
  name: string,
  castShadow = false,
): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
  mesh.name = name
  mesh.castShadow = castShadow
  mesh.receiveShadow = castShadow
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const axis = new THREE.Vector3(0, 1, 0)
  for (let index = 0; index < instances.length; index++) {
    const instance = instances[index]
    position.set(instance.position[0], instance.position[1], instance.position[2])
    scale.set(instance.size[0], instance.size[1], instance.size[2])
    rotation.setFromAxisAngle(axis, instance.rotationY ?? 0)
    matrix.compose(position, rotation, scale)
    mesh.setMatrixAt(index, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  parent.add(mesh)
  return mesh
}

function addFacadeWindows(
  parent: THREE.Object3D,
  center: Point3,
  width: number,
  height: number,
  depth: number,
  columns: number,
  rows: number,
  material: THREE.Material,
  name: string,
): THREE.InstancedMesh {
  const instances: BoxInstance[] = []
  const panelWidth = Math.max(1.2, (width - 5) / columns * 0.6)
  const panelHeight = Math.max(0.7, (height - 5) / rows * 0.38)
  const yBottom = center[1] - height / 2 + 3.2
  const yStep = (height - 5.2) / Math.max(1, rows - 1)
  const xStep = (width - 7) / Math.max(1, columns - 1)
  const sideColumns = Math.max(2, Math.round(columns * depth / width))
  const zStep = (depth - 7) / Math.max(1, sideColumns - 1)
  for (let row = 0; row < rows; row++) {
    const y = yBottom + row * yStep
    for (let column = 0; column < columns; column++) {
      const x = center[0] - (width - 7) / 2 + column * xStep
      instances.push(
        { position: [x, y, center[2] + depth / 2 + 0.12], size: [panelWidth, panelHeight, 0.32] },
        { position: [x, y, center[2] - depth / 2 - 0.12], size: [panelWidth, panelHeight, 0.32] },
      )
    }
    for (let column = 0; column < sideColumns; column++) {
      const z = center[2] - (depth - 7) / 2 + column * zStep
      instances.push(
        { position: [center[0] + width / 2 + 0.12, y, z], size: [0.32, panelHeight, panelWidth] },
        { position: [center[0] - width / 2 - 0.12, y, z], size: [0.32, panelHeight, panelWidth] },
      )
    }
  }
  return addInstancedBoxes(parent, instances, material, name)
}

function addHorizontalBands(
  parent: THREE.Object3D,
  center: Point3,
  width: number,
  height: number,
  depth: number,
  count: number,
  material: THREE.Material,
  name: string,
): THREE.InstancedMesh {
  const instances: BoxInstance[] = []
  for (let index = 0; index < count; index++) {
    const y = center[1] - height / 2 + ((index + 1) / (count + 1)) * height
    instances.push({
      position: [center[0], y, center[2]],
      size: [width + 0.7, 0.45, depth + 0.7],
    })
  }
  return addInstancedBoxes(parent, instances, material, name)
}

function addBoxOutline(
  parent: THREE.Object3D,
  size: Point3,
  position: Point3,
  material: THREE.LineBasicMaterial,
  name: string,
): THREE.LineSegments {
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2]), 24),
    material,
  )
  lines.position.set(position[0], position[1], position[2])
  lines.name = name
  lines.renderOrder = 5
  parent.add(lines)
  return lines
}

function addHorizontalRing(
  parent: THREE.Object3D,
  radius: number,
  tube: number,
  position: Point3,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 36), material)
  ring.position.set(position[0], position[1], position[2])
  ring.rotation.x = Math.PI / 2
  ring.name = name
  parent.add(ring)
  return ring
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
  root.name = 'ticity:world'
  const registry = new Registry()
  const materials = createCityMaterials()
  const colliders: CityCollider[] = []
  const networks: CityNetwork[] = []

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
    const group = new THREE.Group()
    group.name = `tidb:${server}`
    addBox(group, [30, 30, 30], [anchor[0], 15.7, anchor[2]], materials.structure, 'sql:tower', true)
    addBox(group, [24, 9, 24], [anchor[0], 34.7, anchor[2]], materials.darkStructure, 'sql:upper-tier', true)
    addBox(group, [18, 7, 18], [anchor[0], 42.7, anchor[2]], materials.structure, 'sql:planner-tier')
    addBox(group, [32, 2.4, 32], [anchor[0], 29.8, anchor[2]], materials.sql, 'sql:optimizer')
    addCylinder(group, 3.2, 13, [anchor[0], 52.4, anchor[2]], materials.sql, 'sql:stateless-core', 10)
    addCylinder(group, 0.65, 13, [anchor[0], 63.5, anchor[2]], materials.trim, 'sql:antenna', 8)
    addHorizontalRing(group, 7.2, 0.7, [anchor[0], 49, anchor[2]], materials.sql, 'sql:execution-ring')
    addHorizontalRing(group, 5, 0.45, [anchor[0], 57.5, anchor[2]], materials.window, 'sql:signal-ring')
    addFacadeWindows(
      group,
      [anchor[0], 15.7, anchor[2]],
      30,
      30,
      30,
      4,
      5,
      materials.window,
      'sql:tower-windows',
    )
    addFacadeWindows(
      group,
      [anchor[0], 34.7, anchor[2]],
      24,
      9,
      24,
      4,
      2,
      materials.window,
      'sql:upper-windows',
    )
    addHorizontalBands(
      group,
      [anchor[0], 15.7, anchor[2]],
      30,
      30,
      30,
      4,
      materials.trim,
      'sql:tower-bands',
    )
    addBoxOutline(
      group,
      [30, 30, 30],
      [anchor[0], 15.7, anchor[2]],
      materials.edge,
      'sql:tower-outline',
    )
    addBoxOutline(
      group,
      [24, 9, 24],
      [anchor[0], 34.7, anchor[2]],
      materials.edge,
      'sql:upper-outline',
    )
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
  addCylinder(pdHub, 19, 20, [232, 12.5, -102], materials.structure, 'pd:control-tower', 18, true)
  addCylinder(pdHub, 12, 28, [232, 26.5, -102], materials.darkStructure, 'pd:tso-core', 16, true)
  addCylinder(pdHub, 2.2, 24, [232, 48, -102], materials.tso, 'pd:clock-spire', 10)
  addHorizontalRing(pdHub, 22, 1.1, [232, 8, -102], materials.tso, 'pd:scheduler-ring')
  addHorizontalRing(pdHub, 15, 0.8, [232, 22, -102], materials.window, 'pd:tso-ring')
  addHorizontalRing(pdHub, 8.5, 0.55, [232, 40, -102], materials.tso, 'pd:clock-ring')
  addFacadeWindows(
    pdHub,
    [232, 12.5, -102],
    31,
    18,
    31,
    6,
    4,
    materials.window,
    'pd:control-windows',
  )
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

  /* Multi-Raft TiKV stores. One InstancedMesh contains all 108 peers. */
  const campusRoot = new THREE.Group()
  campusRoot.name = 'district:tikv'
  for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
    const bounds = TIKV_BOUNDS[store]
    addDistrictPad(campusRoot, bounds, materials.pavement, `tikv:${store}:campus`, 1.1)
    const anchor = COMPONENT_ANCHORS[`tikv.${store}` as 'tikv.0' | 'tikv.1' | 'tikv.2']
    const group = new THREE.Group()
    group.name = `tikv:${store}`
    addBox(group, [100, 5, 100], [anchor[0], 2.9, anchor[2]], materials.darkStructure, 'tikv:store', true)
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

  const peerCount = TICITY_LAYOUT.regionCount * TICITY_LAYOUT.peersPerRegion
  const peerBase = new Float32Array(peerCount * 3)
  const peerComponents = new Array<CityComponent>(peerCount)
  const peerGeometry = new THREE.BoxGeometry(8.4, 7.2, 7.2)
  const peerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x1a3144,
    emissiveIntensity: 0.94,
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
  for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
    for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
      const point = regionPeerPosition(store, region)
      const leaderStore = region % TICITY_LAYOUT.tikvCount
      const leader = store === leaderStore
      _position.set(point[0], point[1], point[2])
      _matrix.compose(_position, _rotation, _scale)
      peers.setMatrixAt(peerInstance, _matrix)
      peerBase[peerInstance * 3] = point[0]
      peerBase[peerInstance * 3 + 1] = point[1]
      peerBase[peerInstance * 3 + 2] = point[2]
      _color.setHex(leader ? SEMANTIC_COLORS.night.raft : SEMANTIC_COLORS.night.kv)
      if (!leader) _color.multiplyScalar(0.76)
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

  const peerLights: BoxInstance[] = []
  for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
    for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
      const point = regionPeerPosition(store, region)
      peerLights.push(
        {
          position: [point[0] - 1.8, point[1] + 0.2, point[2] + 3.68],
          size: [1.4, 0.55, 0.24],
        },
        {
          position: [point[0] + 1.8, point[1] + 0.2, point[2] + 3.68],
          size: [1.4, 0.55, 0.24],
        },
      )
    }
  }
  addInstancedBoxes(
    campusRoot,
    peerLights,
    materials.window,
    'tikv:peer-status-lights',
  )
  root.add(campusRoot)

  /* GC yard makes safe-point progress spatially distinct from compaction. */
  const gc = new THREE.Group()
  gc.name = 'district:gc'
  addDistrictPad(gc, DISTRICT_BOUNDS.gc, materials.pavement, 'gc:apron')
  addBox(gc, [76, 7, 58], [-231, 3.8, 215], materials.darkStructure, 'gc:yard', true)
  for (let bin = 0; bin < 5; bin++) {
    const x = -259 + bin * 14
    addCylinder(gc, 6, 9, [x, 8, 215], materials.gc, `gc:versions:${bin}`, 10)
    addHorizontalRing(gc, 6.2, 0.42, [x, 12.5, 215], materials.window, `gc:bin-ring:${bin}`)
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
  const tiflashWindows: BoxInstance[] = []
  const tiflashCrowns: BoxInstance[] = []
  for (let column = 0; column < 6; column++) {
    const x = 196 + column * 14
    const height = 28 + (column % 2) * 8
    const y = 18 + (column % 2) * 4
    addBox(
      tiflash,
      [8, height, 38],
      [x, y, 216],
      materials.tiflash,
      `tiflash:column:${column}`,
      true,
    )
    for (let row = 0; row < 5; row++) {
      tiflashWindows.push({
        position: [x, y - height / 2 + 5 + row * ((height - 9) / 4), 235.2],
        size: [4.8, 1.1, 0.38],
      })
    }
    tiflashCrowns.push({
      position: [x, y + height / 2 + 2.5, 216],
      size: [10, 4.2 + (column % 2) * 1.5, 42],
    })
  }
  addInstancedBoxes(tiflash, tiflashWindows, materials.window, 'tiflash:column-windows')
  addInstancedBoxes(tiflash, tiflashCrowns, materials.trim, 'tiflash:column-crowns')
  addCylinder(tiflash, 4, 30, [230, 25, 248], materials.trim, 'tiflash:mpp-spine', 12)
  addHorizontalRing(tiflash, 10, 0.75, [230, 40, 248], materials.tiflash, 'tiflash:mpp-ring')
  addHorizontalRing(tiflash, 6.5, 0.5, [230, 47, 248], materials.window, 'tiflash:learner-ring')
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
  let latestState: TiCityState | null = null

  function paintPeers(next: CityTheme): void {
    peerMaterial.emissive.setHex(next === 'night' ? 0x1a3144 : 0x000000)
    peerMaterial.emissiveIntensity = next === 'night' ? 0.72 : 0
    for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
      for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
        const instance = store * TICITY_LAYOUT.regionCount + region
        const leader = store === region % TICITY_LAYOUT.tikvCount
        _color.setHex(
          leader ? SEMANTIC_COLORS[next].raft : SEMANTIC_COLORS[next].kv,
        )
        if (!leader) _color.multiplyScalar(next === 'night' ? 0.76 : 0.9)
        peers.setColorAt(instance, _color)
      }
    }
    if (peers.instanceColor) peers.instanceColor.needsUpdate = true
  }

  function updateState(state: TiCityState): void {
    latestState = state
    for (let region = 0; region < TICITY_LAYOUT.regionCount; region++) {
      const regionState = state.regions.find((candidate) => candidate.id === region)
      if (!regionState) continue
      const leaderStore = Math.max(
        0,
        Math.min(
          TICITY_LAYOUT.tikvCount - 1,
          regionState.leaderStoreId.charCodeAt(regionState.leaderStoreId.length - 1) - 49,
        ),
      )
      const heat = Math.min(1, Math.max(0, regionState.hotScore / 100))
      for (let store = 0; store < TICITY_LAYOUT.tikvCount; store++) {
        const instance = store * TICITY_LAYOUT.regionCount + region
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
        if (!leader && !unhealthy) _color.multiplyScalar(theme === 'night' ? 0.76 : 0.9)
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
    transactionLab,
    lockLab,
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
      if (latestState) updateState(latestState)
      else paintPeers(next)
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
      environment.dispose()
      transactionLab.dispose()
      lockLab.dispose()
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
