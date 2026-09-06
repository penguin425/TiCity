/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createTiDBSceneGraph } from './city'

describe('city graphics resource contracts', () => {
  it('keeps diagram lines and sky sprites out of the contact-shading depth buffer', () => {
    const city = createTiDBSceneGraph()
    const invalid: string[] = []
    city.root.traverse((object) => {
      if (!(object instanceof THREE.Line) && !(object instanceof THREE.Points)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (material.depthWrite) invalid.push(object.name)
      }
    })
    // Lines still depth-test against real buildings; only their depth writes
    // are disabled so faint topology does not become an opaque AO occluder.
    expect(invalid).toEqual([])
    city.dispose()
  })

  it('never multiplies instance colours by a missing vertex colour attribute', () => {
    const city = createTiDBSceneGraph()
    const invalid: string[] = []
    city.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      for (const material of materials) {
        if (material.vertexColors && !object.geometry.hasAttribute('color')) {
          invalid.push(`${object.name}: ${material.name}`)
        }
      }
    })
    // Covers the overview and all six hidden lab geometries. InstancedMesh
    // colours work independently; enabling vertexColors on an uncoloured box
    // caused the original black Region racks, transaction slots and lock edges.
    expect(invalid).toEqual([])
    city.dispose()
  })

  it('releases shared geometry, materials, textures and instance buffers exactly once', () => {
    const city = createTiDBSceneGraph()
    const resources = new Map<
      THREE.BufferGeometry | THREE.Material | THREE.Texture | THREE.InstancedMesh,
      number
    >()
    city.root.traverse((object) => {
      const drawable = object as THREE.Mesh
      if (!drawable.geometry || !drawable.material) return
      // Instance matrices/colours belong to the mesh and are separate from its
      // shared geometry. Include the six initially hidden labs in this audit.
      if (object instanceof THREE.InstancedMesh) resources.set(object, 0)
      resources.set(drawable.geometry, 0)
      const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material]
      for (const material of materials) {
        resources.set(material, 0)
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) resources.set(value, 0)
        }
      }
    })
    for (const resource of resources.keys()) {
      const onDispose = (): void => {
        resources.set(resource, (resources.get(resource) ?? 0) + 1)
      }
      if (resource instanceof THREE.InstancedMesh) {
        resource.addEventListener('dispose', onDispose)
      } else {
        resource.addEventListener('dispose', onDispose)
      }
    }
    city.dispose()
    city.dispose()
    const incorrect = [...resources].filter(([, count]) => count !== 1)
      .map(([resource, count]) => `${resource.type}:${resource.name || resource.uuid}: ${count}`)
    expect(incorrect).toEqual([])
  })
})
