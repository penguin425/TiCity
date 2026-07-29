/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * A compact horizontal collision map for fly/walk navigation. It consumes the
 * authored building boxes instead of raycasting the render graph every frame.
 */

import type { CityCollider } from '../world/city'

export interface CollisionMove {
  x: number
  z: number
  hitX: boolean
  hitZ: boolean
  blocked: boolean
}
export interface CollisionMap {
  move(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
    out: CollisionMove,
  ): CollisionMove
  contains(x: number, z: number, radius?: number): boolean
}

export function createCollisionMove(): CollisionMove {
  return { x: 0, z: 0, hitX: false, hitZ: false, blocked: false }
}

export function createCollisionMap(colliders: readonly CityCollider[]): CollisionMap {
  function contains(x: number, z: number, radius = 0): boolean {
    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i]
      if (
        x > box.minX - radius &&
        x < box.maxX + radius &&
        z > box.minZ - radius &&
        z < box.maxZ + radius
      ) {
        return true
      }
    }
    return false
  }

  function move(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
    out: CollisionMove,
  ): CollisionMove {
    let x = toX
    let z = toZ
    let hitX = false
    let hitZ = false

    /* Resolve one axis at a time so a pedestrian slides along a wall. */
    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i]
      const minX = box.minX - radius
      const maxX = box.maxX + radius
      const minZ = box.minZ - radius
      const maxZ = box.maxZ + radius
      if (fromZ <= minZ || fromZ >= maxZ) continue
      if (fromX <= minX && x > minX) {
        x = minX
        hitX = true
      } else if (fromX >= maxX && x < maxX) {
        x = maxX
        hitX = true
      }
    }

    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i]
      const minX = box.minX - radius
      const maxX = box.maxX + radius
      const minZ = box.minZ - radius
      const maxZ = box.maxZ + radius
      if (x <= minX || x >= maxX) continue
      if (fromZ <= minZ && z > minZ) {
        z = minZ
        hitZ = true
      } else if (fromZ >= maxZ && z < maxZ) {
        z = maxZ
        hitZ = true
      }
    }

    out.x = x
    out.z = z
    out.hitX = hitX
    out.hitZ = hitZ
    out.blocked = hitX || hitZ
    return out
  }

  return { move, contains }
}
