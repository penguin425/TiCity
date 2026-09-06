/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * Procedural city dressing. These objects add scale, atmosphere, and readable
 * geography without introducing a second model of the TiDB topology.
 */

import * as THREE from 'three'
import { DISTRICT_BOUNDS, TICITY_LAYOUT } from './layout'
import type { CityTheme } from './palette'
import { createSkyline } from './environment-skyline'
import { createCampusStreets, createLightPoolTexture, ROAD_SEGMENTS } from './environment-streets'
import { applyCampusSurface, createCampusSurface } from './environment-surfaces'

export interface CityEnvironment {
  readonly object: THREE.Group
  readonly ground: THREE.Mesh
  update(deltaSeconds: number): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

const _cameraWorld = new THREE.Vector3()

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
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
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
    roughness: 0.82,
    metalness: 0.03,
  })
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x09131f,
    roughness: 0.76,
    metalness: 0.08,
  })
  const pavingMaterial = new THREE.MeshStandardMaterial({
    color: 0x364955, roughness: 0.8, metalness: 0.02,
  })
  const laneMaterial = new THREE.LineDashedMaterial({
    depthWrite: false,
    color: 0x5eddf5,
    transparent: true,
    opacity: 0.8,
    dashSize: 8,
    gapSize: 6,
    toneMapped: false,
  })
  const districtMaterial = new THREE.LineBasicMaterial({
    depthWrite: false,
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
  const lawnMaterial = new THREE.MeshStandardMaterial({
    color: 0x45684b, roughness: 1, metalness: 0,
  })
  const timberMaterial = new THREE.MeshStandardMaterial({
    color: 0x977249, roughness: 0.78, metalness: 0,
  })
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x244952, roughness: 0.16, metalness: 0.6,
  })
  const skylineMaterial = new THREE.MeshStandardMaterial({
    color: 0x10243a,
    emissive: 0x071829,
    emissiveIntensity: 0.35,
    roughness: 0.38,
    metalness: 0.38,
  })
  const beaconMaterial = new THREE.MeshStandardMaterial({
    color: 0x58ddff,
    emissive: 0x3edaff,
    emissiveIntensity: 2.6,
    roughness: 0.2,
    toneMapped: false,
  })
  const lightPoolTexture = createLightPoolTexture()
  const lightPoolMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc47a,
    map: lightPoolTexture,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
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

  const stoneTexture = createCampusSurface('stone')
  const asphaltTexture = createCampusSurface('asphalt')
  const turfTexture = createCampusSurface('turf')
  const timberTexture = createCampusSurface('timber')
  applyCampusSurface(groundMaterial, stoneTexture, 12, 0.2)
  applyCampusSurface(pavingMaterial, stoneTexture, 8, 0.16)
  applyCampusSurface(roadMaterial, asphaltTexture, 7, 0.1)
  applyCampusSurface(lawnMaterial, turfTexture, 12, 0.19)
  applyCampusSurface(timberMaterial, timberTexture, 4, 0.055)
  const textures = [cloudTexture, lightPoolTexture, stoneTexture, asphaltTexture, turfTexture, timberTexture]

  const materials: readonly THREE.Material[] = [
    foundationMaterial,
    groundMaterial,
    roadMaterial,
    pavingMaterial,
    laneMaterial,
    districtMaterial,
    poleMaterial,
    lampMaterial,
    foliageMaterial,
    lawnMaterial,
    timberMaterial,
    waterMaterial,
    skylineMaterial,
    beaconMaterial,
    lightPoolMaterial,
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
    createLaneMarks(laneMaterial),
    createDistrictFrames(districtMaterial),
    createCampusStreets({
      road: roadMaterial,
      paving: pavingMaterial,
      pole: poleMaterial,
      lamp: lampMaterial,
      foliage: foliageMaterial,
      lawn: lawnMaterial,
      timber: timberMaterial,
      water: waterMaterial,
      lightPool: lightPoolMaterial,
    }),
    createSkyline(skylineMaterial, beaconMaterial),
  )

  function setTheme(next: CityTheme): void {
    const night = next === 'night'
    foundationMaterial.color.setHex(night ? 0x142430 : 0x344c52)
    groundMaterial.color.setHex(night ? 0x21333f : 0x778785)
    roadMaterial.color.setHex(night ? 0x13232d : 0x30434d)
    pavingMaterial.color.setHex(night ? 0x566772 : 0xaab0a5)
    laneMaterial.color.setHex(night ? 0xb5ae8a : 0xe3c875)
    laneMaterial.opacity = night ? 0.5 : 0.66
    districtMaterial.color.setHex(night ? 0x497486 : 0x466f7a)
    districtMaterial.opacity = night ? 0.3 : 0.38
    poleMaterial.color.setHex(night ? 0x293b44 : 0x344749)
    lampMaterial.color.setHex(night ? 0xffdfa7 : 0xe5d9b4)
    lampMaterial.emissive.setHex(night ? 0xffc680 : 0x000000)
    lampMaterial.emissiveIntensity = night ? 1.55 : 0
    foliageMaterial.color.setHex(night ? 0x345f4b : 0x52714a)
    lawnMaterial.color.setHex(night ? 0x345746 : 0x66815c)
    timberMaterial.color.setHex(night ? 0x7b634b : 0xac8056)
    waterMaterial.color.setHex(night ? 0x173443 : 0x294c56)
    skylineMaterial.color.setHex(night ? 0x274453 : 0x59747c)
    skylineMaterial.emissive.setHex(night ? 0x0e2432 : 0x000000)
    skylineMaterial.emissiveIntensity = night ? 0.22 : 0
    beaconMaterial.color.setHex(night ? 0xeed2a3 : 0x8faeb4)
    beaconMaterial.emissive.setHex(night ? 0xcfac72 : 0x000000)
    beaconMaterial.emissiveIntensity = night ? 0.4 : 0
    lightPoolMaterial.opacity = night ? 0.4 : 0
    starMaterial.opacity = night ? 0.8 : 0
    stars.visible = night
    clouds.visible = !night
    cloudMaterial.opacity = night ? 0 : 0.25

    const uniforms = skyMaterial.uniforms
    ;(uniforms.uZenith.value as THREE.Color).setHex(night ? 0x071120 : 0x75add7)
    ;(uniforms.uHorizon.value as THREE.Color).setHex(night ? 0x23354e : 0xb4dcec)
    ;(uniforms.uHaze.value as THREE.Color).setHex(night ? 0x182c42 : 0x94bccd)
    ;(uniforms.uSunDirection.value as THREE.Vector3)
      .set(-240, 280, 160)
      .normalize()
    ;(uniforms.uSunColor.value as THREE.Color).setHex(night ? 0xbfd8ff : 0xfff2c8)
    uniforms.uSunStrength.value = night ? 0.25 : 1.18
  }

  function update(deltaSeconds: number): void {
    const delta = Math.max(0, Math.min(0.05, deltaSeconds))
    stars.rotation.y += delta * 0.002
    clouds.rotation.y += delta * 0.0012
  }

  setTheme('night')
  let disposed = false

  return {
    object,
    ground,
    update,
    setTheme,
    dispose(): void {
      if (disposed) return
      disposed = true
      const geometries = new Set<THREE.BufferGeometry>()
      object.traverse((child) => {
        const drawable = child as THREE.Mesh | THREE.LineSegments | THREE.Points
        if (drawable.geometry) geometries.add(drawable.geometry)
        if (child instanceof THREE.InstancedMesh) child.dispose()
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      for (const texture of textures) texture.dispose()
      object.clear()
    },
  }
}
