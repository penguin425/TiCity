/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Procedural city dressing. These objects add scale, atmosphere, and readable
 * geography without introducing a second model of the TiDB topology.
 */

import * as THREE from 'three'
import { DISTRICT_BOUNDS, TICITY_LAYOUT } from './layout'
import type { Point3 } from './layout'
import type { CityTheme } from './palette'

export interface CityEnvironment {
  readonly object: THREE.Group
  readonly ground: THREE.Mesh
  update(deltaSeconds: number): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

interface RoadSegment {
  readonly name: string
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
}

const _cameraWorld = new THREE.Vector3()

const ROAD_SEGMENTS: readonly RoadSegment[] = [
  { name: 'client-approach', x: 0, z: -339, width: 28, depth: 40 },
  { name: 'gateway-avenue', x: 0, z: -253, width: 28, depth: 54 },
  { name: 'sql-avenue', x: 0, z: -188, width: 28, depth: 28 },
  { name: 'fabric-boulevard', x: 0, z: -25, width: 654, depth: 22 },
  { name: 'storage-boulevard', x: 0, z: 155, width: 654, depth: 20 },
  { name: 'service-boulevard', x: 0, z: 286, width: 654, depth: 18 },
  { name: 'west-service-road', x: -318, z: -12, width: 18, depth: 614 },
  { name: 'east-service-road', x: 318, z: -12, width: 18, depth: 614 },
] as const

const DISTRICT_LABEL_HEIGHT: Readonly<Record<string, number>> = {
  clients: 0.9,
  tiproxy: 0.9,
  tidb: 0.9,
  pd: 0.9,
  tikv0: 1.3,
  tikv1: 1.3,
  tikv2: 1.3,
  gc: 0.9,
  tiflash: 0.9,
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunStrength;
varying vec3 vWorldPosition;

void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  float altitude = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  float skyMix = smoothstep(0.18, 0.88, altitude);
  vec3 color = mix(uHorizon, uZenith, skyMix);
  float haze = 1.0 - smoothstep(0.42, 0.58, altitude);
  color = mix(color, uHaze, haze * 0.4);
  float sun = pow(max(dot(direction, normalize(uSunDirection)), 0.0), 420.0);
  float halo = pow(max(dot(direction, normalize(uSunDirection)), 0.0), 18.0);
  color += uSunColor * (sun * 1.7 + halo * 0.08) * uSunStrength;
  gl_FragColor = vec4(color, 1.0);
}
`

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
}

function setMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  position: Point3,
  scale: Point3 = [1, 1, 1],
): void {
  const matrix = new THREE.Matrix4()
  matrix.compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    new THREE.Quaternion(),
    new THREE.Vector3(scale[0], scale[1], scale[2]),
  )
  mesh.setMatrixAt(index, matrix)
}

function createGrid(
  size: number,
  spacing: number,
  y: number,
  material: THREE.LineBasicMaterial,
  name: string,
): THREE.LineSegments {
  const half = size / 2
  const lineCount = Math.floor(size / spacing) + 1
  const positions = new Float32Array(lineCount * 4 * 3)
  let cursor = 0
  for (let index = 0; index < lineCount; index++) {
    const coordinate = -half + index * spacing
    positions[cursor++] = coordinate
    positions[cursor++] = y
    positions[cursor++] = -half
    positions[cursor++] = coordinate
    positions[cursor++] = y
    positions[cursor++] = half
    positions[cursor++] = -half
    positions[cursor++] = y
    positions[cursor++] = coordinate
    positions[cursor++] = half
    positions[cursor++] = y
    positions[cursor++] = coordinate
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const grid = new THREE.LineSegments(geometry, material)
  grid.name = name
  grid.renderOrder = 1
  return grid
}

function createDistrictFrames(material: THREE.LineBasicMaterial): THREE.LineSegments {
  const positions: number[] = []
  for (const [district, bounds] of Object.entries(DISTRICT_BOUNDS)) {
    const y = DISTRICT_LABEL_HEIGHT[district] ?? 0.9
    positions.push(
      bounds.minX, y, bounds.minZ, bounds.maxX, y, bounds.minZ,
      bounds.maxX, y, bounds.minZ, bounds.maxX, y, bounds.maxZ,
      bounds.maxX, y, bounds.maxZ, bounds.minX, y, bounds.maxZ,
      bounds.minX, y, bounds.maxZ, bounds.minX, y, bounds.minZ,
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const frame = new THREE.LineSegments(geometry, material)
  frame.name = 'city:district-frames'
  frame.renderOrder = 3
  return frame
}

function createLaneMarks(material: THREE.LineDashedMaterial): THREE.LineSegments {
  const points: number[] = []
  for (const road of ROAD_SEGMENTS) {
    if (road.width >= road.depth) {
      points.push(
        road.x - road.width / 2, 0.3, road.z,
        road.x + road.width / 2, 0.3, road.z,
      )
    } else {
      points.push(
        road.x, 0.3, road.z - road.depth / 2,
        road.x, 0.3, road.z + road.depth / 2,
      )
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const marks = new THREE.LineSegments(geometry, material)
  marks.name = 'city:road-lane-marks'
  marks.computeLineDistances()
  marks.renderOrder = 4
  return marks
}

function createStreetFurniture(
  poleMaterial: THREE.MeshStandardMaterial,
  lampMaterial: THREE.MeshStandardMaterial,
  foliageMaterial: THREE.MeshStandardMaterial,
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'city:street-furniture'

  const lampPositions: Point3[] = []
  for (let x = -280; x <= 280; x += 40) {
    lampPositions.push([x, 0, -40], [x, 0, 166])
  }
  for (let z = -300; z <= 260; z += 40) {
    lampPositions.push([-304, 0, z], [304, 0, z])
  }

  const poleGeometry = new THREE.CylinderGeometry(0.28, 0.42, 7.5, 8)
  const lampGeometry = new THREE.OctahedronGeometry(0.9, 0)
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, lampPositions.length)
  const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, lampPositions.length)
  poles.name = 'city:lamp-posts'
  lamps.name = 'city:lamp-heads'
  for (let index = 0; index < lampPositions.length; index++) {
    const point = lampPositions[index]
    setMatrix(poles, index, [point[0], 3.75, point[2]])
    setMatrix(lamps, index, [point[0], 8.05, point[2]], [1, 1.25, 1])
  }
  poles.instanceMatrix.needsUpdate = true
  lamps.instanceMatrix.needsUpdate = true
  poles.castShadow = true
  poles.receiveShadow = true
  root.add(poles, lamps)

  const treePositions: Point3[] = []
  for (let x = -278; x <= 278; x += 48) {
    if (Math.abs(x) < 42) continue
    treePositions.push([x, 0, -52], [x + 12, 0, 178])
  }
  const trunkGeometry = new THREE.CylinderGeometry(0.55, 0.8, 4.5, 7)
  const crownGeometry = new THREE.ConeGeometry(3.8, 8.5, 9)
  const trunks = new THREE.InstancedMesh(trunkGeometry, poleMaterial, treePositions.length)
  const crowns = new THREE.InstancedMesh(crownGeometry, foliageMaterial, treePositions.length)
  trunks.name = 'city:data-grove-trunks'
  crowns.name = 'city:data-grove-crowns'
  for (let index = 0; index < treePositions.length; index++) {
    const point = treePositions[index]
    const scale = 0.8 + (index % 4) * 0.08
    setMatrix(trunks, index, [point[0], 2.25, point[2]], [scale, scale, scale])
    setMatrix(crowns, index, [point[0], 8, point[2]], [scale, scale, scale])
  }
  trunks.instanceMatrix.needsUpdate = true
  crowns.instanceMatrix.needsUpdate = true
  trunks.castShadow = true
  crowns.castShadow = true
  root.add(trunks, crowns)

  return root
}

function createSkyline(
  material: THREE.MeshStandardMaterial,
  beaconMaterial: THREE.MeshStandardMaterial,
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'city:distant-skyline'
  const random = seededRandom(4_250)
  const buildings: { readonly x: number; readonly z: number; readonly width: number; readonly depth: number; readonly height: number }[] = []

  for (let index = 0; index < 52; index++) {
    const side = index % 3
    const along = -338 + random() * 676
    const width = 8 + random() * 13
    const depth = 8 + random() * 13
    const height = 10 + random() * 46
    if (side === 0) {
      buildings.push({ x: along, z: -344 + random() * 9, width, depth, height })
    } else {
      buildings.push({
        x: (index % 2 === 0 ? -1 : 1) * (340 + random() * 6),
        z: along,
        width,
        depth,
        height,
      })
    }
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const mesh = new THREE.InstancedMesh(geometry, material, buildings.length)
  const beaconGeometry = new THREE.OctahedronGeometry(0.8, 0)
  const beacons = new THREE.InstancedMesh(beaconGeometry, beaconMaterial, buildings.length)
  mesh.name = 'city:skyline-towers'
  beacons.name = 'city:skyline-beacons'
  for (let index = 0; index < buildings.length; index++) {
    const building = buildings[index]
    setMatrix(
      mesh,
      index,
      [building.x, building.height / 2 - 0.1, building.z],
      [building.width, building.height, building.depth],
    )
    setMatrix(
      beacons,
      index,
      [building.x, building.height + 0.8, building.z],
      [0.8, 1.15, 0.8],
    )
  }
  mesh.instanceMatrix.needsUpdate = true
  beacons.instanceMatrix.needsUpdate = true
  mesh.castShadow = true
  mesh.receiveShadow = true
  root.add(mesh, beacons)
  return root
}

function createStars(material: THREE.PointsMaterial): THREE.Points {
  const random = seededRandom(8_508)
  const positions = new Float32Array(540 * 3)
  for (let index = 0; index < 540; index++) {
    const azimuth = random() * Math.PI * 2
    const elevation = 0.08 + random() * 1.15
    const radius = 770 + random() * 70
    const cosElevation = Math.cos(elevation)
    positions[index * 3] = Math.cos(azimuth) * cosElevation * radius
    positions[index * 3 + 1] = Math.sin(elevation) * radius
    positions[index * 3 + 2] = Math.sin(azimuth) * cosElevation * radius
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const stars = new THREE.Points(geometry, material)
  stars.name = 'city:stars'
  stars.frustumCulled = false
  return stars
}

function createCloudTexture(): THREE.DataTexture {
  const width = 128
  const height = 64
  const pixels = new Uint8Array(width * height * 4)
  const blobs = [
    [0.2, 0.57, 0.19, 0.2],
    [0.36, 0.45, 0.24, 0.28],
    [0.54, 0.5, 0.28, 0.32],
    [0.72, 0.58, 0.22, 0.22],
    [0.87, 0.62, 0.14, 0.15],
  ] as const
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const normalizedX = x / (width - 1)
      const normalizedY = y / (height - 1)
      let density = 0
      for (const [centerX, centerY, radiusX, radiusY] of blobs) {
        const dx = (normalizedX - centerX) / radiusX
        const dy = (normalizedY - centerY) / radiusY
        density = Math.max(density, Math.exp(-(dx * dx + dy * dy) * 1.75))
      }
      const edgeFade = Math.sin(normalizedX * Math.PI) * Math.sin(normalizedY * Math.PI)
      const alpha = Math.max(0, Math.min(1, (density - 0.08) * 1.25 * edgeFade))
      const offset = (y * width + x) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createClouds(material: THREE.PointsMaterial): THREE.Points {
  const random = seededRandom(2_026)
  const cloudCount = 10
  const positions = new Float32Array(cloudCount * 3)
  for (let cloud = 0; cloud < cloudCount; cloud++) {
    positions[cloud * 3] = -620 + random() * 1_240
    positions[cloud * 3 + 1] = 165 + random() * 95
    positions[cloud * 3 + 2] = -620 - random() * 150
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const clouds = new THREE.Points(geometry, material)
  clouds.name = 'city:clouds'
  clouds.frustumCulled = false
  return clouds
}

function followCamera(object: THREE.Object3D): void {
  object.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(_cameraWorld)
    if (object.parent) object.parent.worldToLocal(_cameraWorld)
    object.position.copy(_cameraWorld)
    object.updateMatrixWorld(true)
  }
}

export function createCityEnvironment(): CityEnvironment {
  const object = new THREE.Group()
  object.name = 'ticity:environment'

  const foundationMaterial = new THREE.MeshStandardMaterial({
    color: 0x07111e,
    roughness: 0.86,
    metalness: 0.12,
  })
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0x0a1826,
    roughness: 0.95,
    metalness: 0.03,
  })
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x09131f,
    roughness: 0.88,
    metalness: 0.08,
  })
  const gridMinorMaterial = new THREE.LineBasicMaterial({
    color: 0x1b5271,
    transparent: true,
    opacity: 0.24,
  })
  const gridMajorMaterial = new THREE.LineBasicMaterial({
    color: 0x2c84a8,
    transparent: true,
    opacity: 0.46,
  })
  const laneMaterial = new THREE.LineDashedMaterial({
    color: 0x5eddf5,
    transparent: true,
    opacity: 0.8,
    dashSize: 8,
    gapSize: 6,
    toneMapped: false,
  })
  const districtMaterial = new THREE.LineBasicMaterial({
    color: 0x34d5ff,
    transparent: true,
    opacity: 0.65,
    toneMapped: false,
  })
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x24384b,
    roughness: 0.62,
    metalness: 0.48,
  })
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0xffb632,
    emissiveIntensity: 2.4,
    roughness: 0.25,
    metalness: 0.08,
    toneMapped: false,
  })
  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: 0x177a68,
    roughness: 0.9,
    metalness: 0,
  })
  const skylineMaterial = new THREE.MeshStandardMaterial({
    color: 0x10243a,
    emissive: 0x071829,
    emissiveIntensity: 0.35,
    roughness: 0.82,
    metalness: 0.14,
  })
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0x58ddff,
    emissive: 0x3edaff,
    emissiveIntensity: 2.6,
    roughness: 0.2,
    toneMapped: false,
  })
  const pulseMaterial = new THREE.MeshBasicMaterial({
    color: 0x34d5ff,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  })
  const starMaterial = new THREE.PointsMaterial({
    color: 0xd8ecff,
    size: 1.65,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false,
  })
  const cloudTexture = createCloudTexture()
  const cloudMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    map: cloudTexture,
    size: 220,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.25,
    alphaTest: 0.01,
    depthWrite: false,
    fog: false,
  })
  const skyMaterial = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x020712) },
      uHorizon: { value: new THREE.Color(0x172c46) },
      uHaze: { value: new THREE.Color(0x091a2a) },
      uSunDirection: { value: new THREE.Vector3(-0.42, 0.42, -0.8).normalize() },
      uSunColor: { value: new THREE.Color(0xffd894) },
      uSunStrength: { value: 0.36 },
    },
  })

  const materials: readonly THREE.Material[] = [
    foundationMaterial,
    groundMaterial,
    roadMaterial,
    gridMinorMaterial,
    gridMajorMaterial,
    laneMaterial,
    districtMaterial,
    poleMaterial,
    lampMaterial,
    foliageMaterial,
    skylineMaterial,
    beaconMaterial,
    pulseMaterial,
    starMaterial,
    cloudMaterial,
    skyMaterial,
  ]

  const sky = new THREE.Mesh(new THREE.SphereGeometry(930, 36, 20), skyMaterial)
  sky.name = 'city:sky-dome'
  sky.renderOrder = -100
  sky.frustumCulled = false
  followCamera(sky)
  object.add(sky)

  const stars = createStars(starMaterial)
  const clouds = createClouds(cloudMaterial)
  followCamera(stars)
  followCamera(clouds)
  object.add(stars, clouds)

  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(TICITY_LAYOUT.groundSize - 4, 3.2, TICITY_LAYOUT.groundSize - 4),
    foundationMaterial,
  )
  foundation.position.y = -2
  foundation.name = 'city:foundation-slab'
  foundation.receiveShadow = true
  object.add(foundation)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(TICITY_LAYOUT.groundSize - 8, TICITY_LAYOUT.groundSize - 8),
    groundMaterial,
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.28
  ground.receiveShadow = true
  ground.name = 'ticity:ground'
  object.add(ground)

  object.add(
    createGrid(TICITY_LAYOUT.groundSize - 16, 20, -0.04, gridMinorMaterial, 'city:grid-minor'),
    createGrid(TICITY_LAYOUT.groundSize - 16, 100, -0.02, gridMajorMaterial, 'city:grid-major'),
  )

  const roads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    roadMaterial,
    ROAD_SEGMENTS.length,
  )
  roads.name = 'city:roads'
  roads.receiveShadow = true
  for (let index = 0; index < ROAD_SEGMENTS.length; index++) {
    const road = ROAD_SEGMENTS[index]
    setMatrix(roads, index, [road.x, 0.02, road.z], [road.width, 0.34, road.depth])
  }
  roads.instanceMatrix.needsUpdate = true
  object.add(roads, createLaneMarks(laneMaterial))

  object.add(createDistrictFrames(districtMaterial))

  object.add(
    createStreetFurniture(poleMaterial, lampMaterial, foliageMaterial),
    createSkyline(skylineMaterial, beaconMaterial),
  )

  const pulseAnchors: readonly Point3[] = [
    [0, 0.5, -220],
    [0, 0.5, -132],
    [232, 0.5, -102],
    [-150, 0.7, 84],
    [0, 0.7, 84],
    [150, 0.7, 84],
    [-231, 0.5, 215],
    [230, 0.5, 216],
  ]
  const ringGeometry = new THREE.RingGeometry(7.5, 8.2, 48)
  const pulseMesh = new THREE.InstancedMesh(ringGeometry, pulseMaterial, pulseAnchors.length)
  pulseMesh.name = 'city:district-pulses'
  pulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  pulseMesh.frustumCulled = false
  pulseMesh.renderOrder = 6
  const pulseMatrix = new THREE.Matrix4()
  const pulsePosition = new THREE.Vector3()
  const pulseScale = new THREE.Vector3()
  const pulseRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
  for (let index = 0; index < pulseAnchors.length; index++) {
    const point = pulseAnchors[index]
    pulsePosition.set(point[0], point[1], point[2])
    pulseScale.setScalar(0.72 + index * 0.025)
    pulseMatrix.compose(pulsePosition, pulseRotation, pulseScale)
    pulseMesh.setMatrixAt(index, pulseMatrix)
  }
  pulseMesh.instanceMatrix.needsUpdate = true
  object.add(pulseMesh)

  let theme: CityTheme = 'night'
  let clock = 0

  function setTheme(next: CityTheme): void {
    theme = next
    const night = next === 'night'
    foundationMaterial.color.setHex(night ? 0x07111e : 0x9aa8b2)
    groundMaterial.color.setHex(night ? 0x0a1826 : 0xcbd5d9)
    roadMaterial.color.setHex(night ? 0x09131f : 0x667681)
    gridMinorMaterial.color.setHex(night ? 0x1b5271 : 0x879aa4)
    gridMinorMaterial.opacity = night ? 0.24 : 0.34
    gridMajorMaterial.color.setHex(night ? 0x2c84a8 : 0x617985)
    gridMajorMaterial.opacity = night ? 0.46 : 0.52
    laneMaterial.color.setHex(night ? 0x5eddf5 : 0xf4d56c)
    laneMaterial.opacity = night ? 0.8 : 0.72
    districtMaterial.color.setHex(night ? 0x34d5ff : 0x177e9e)
    districtMaterial.opacity = night ? 0.65 : 0.8
    poleMaterial.color.setHex(night ? 0x24384b : 0x566771)
    lampMaterial.color.setHex(night ? 0xffd166 : 0xd28a00)
    lampMaterial.emissive.setHex(night ? 0xffb632 : 0x5a2b00)
    lampMaterial.emissiveIntensity = night ? 2.4 : 0.25
    foliageMaterial.color.setHex(night ? 0x177a68 : 0x4e8e66)
    skylineMaterial.color.setHex(night ? 0x10243a : 0x8495a2)
    skylineMaterial.emissive.setHex(night ? 0x071829 : 0x000000)
    skylineMaterial.emissiveIntensity = night ? 0.35 : 0
    beaconMaterial.color.setHex(night ? 0x58ddff : 0xb66a00)
    beaconMaterial.emissive.setHex(night ? 0x3edaff : 0x4a2100)
    beaconMaterial.emissiveIntensity = night ? 2.6 : 0.25
    pulseMaterial.color.setHex(night ? 0x34d5ff : 0x087b96)
    pulseMaterial.opacity = night ? 0.46 : 0.34
    starMaterial.opacity = night ? 0.8 : 0
    clouds.visible = !night
    cloudMaterial.opacity = night ? 0 : 0.25

    const uniforms = skyMaterial.uniforms
    ;(uniforms.uZenith.value as THREE.Color).setHex(night ? 0x020712 : 0x79b8df)
    ;(uniforms.uHorizon.value as THREE.Color).setHex(night ? 0x172c46 : 0xcce5f2)
    ;(uniforms.uHaze.value as THREE.Color).setHex(night ? 0x091a2a : 0xe6d9bd)
    ;(uniforms.uSunDirection.value as THREE.Vector3)
      .set(night ? -0.42 : 0.48, night ? 0.42 : 0.2, night ? -0.8 : -0.85)
      .normalize()
    ;(uniforms.uSunColor.value as THREE.Color).setHex(night ? 0xbfd8ff : 0xfff2c8)
    uniforms.uSunStrength.value = night ? 0.25 : 1.18
  }

  function update(deltaSeconds: number): void {
    clock += Math.max(0, Math.min(0.05, deltaSeconds))
    stars.rotation.y += deltaSeconds * 0.002
    clouds.rotation.y += deltaSeconds * 0.0012
    for (let index = 0; index < pulseAnchors.length; index++) {
      const phase = (clock * 0.32 + index * 0.17) % 1
      const scale = 0.7 + phase * 1.65
      const point = pulseAnchors[index]
      pulsePosition.set(point[0], point[1], point[2])
      pulseScale.setScalar(scale)
      pulseMatrix.compose(pulsePosition, pulseRotation, pulseScale)
      pulseMesh.setMatrixAt(index, pulseMatrix)
    }
    pulseMesh.instanceMatrix.needsUpdate = true
    pulseMaterial.opacity = (theme === 'night' ? 0.42 : 0.3) * (0.65 + Math.sin(clock * 1.7) * 0.18)
  }

  setTheme('night')

  return {
    object,
    ground,
    update,
    setTheme,
    dispose(): void {
      object.traverse((child) => {
        const drawable = child as THREE.Mesh | THREE.LineSegments | THREE.Points
        drawable.geometry?.dispose()
      })
      for (const material of materials) material.dispose()
      cloudTexture.dispose()
      object.clear()
    },
  }
}
