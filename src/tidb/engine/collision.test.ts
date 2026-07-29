/*
 * Copyright 2026 TiDB City contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import { describe, expect, it } from 'vitest'
import { createCollisionMap, createCollisionMove } from './collision'

describe('TiDB City collision map', () => {
  const map = createCollisionMap([
    { id: 'tower', minX: -5, maxX: 5, minY: 0, maxY: 30, minZ: -5, maxZ: 5 },
  ])

  it('blocks a walk into a tower and preserves the free axis', () => {
    const result = createCollisionMove()
    map.move(-8, 0, 0, 4, 0.5, result)
    expect(result.blocked).toBe(true)
    expect(result.x).toBeLessThanOrEqual(-5.5)
    expect(result.z).toBe(4)
  })

  it('allows a route that clears the collider', () => {
    const result = createCollisionMove()
    map.move(-8, -8, -8, 8, 0.5, result)
    expect(result).toMatchObject({ x: -8, z: 8, blocked: false })
  })
})
