/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TICITY_LAYOUT } from '../world/layout'
import type { CollisionMap, CollisionMove } from './collision'
import { createCollisionMove } from './collision'

export type CityViewMode = 'orbit' | 'fly' | 'walk'
export type CityMovementInput =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'ascend'
  | 'descend'
  | 'sprint'

export interface CityCameraController {
  readonly mode: CityViewMode
  setMode(mode: CityViewMode): void
  setMovement(input: CityMovementInput, active: boolean): void
  focus(point: THREE.Vector3): void
  update(deltaSeconds: number): void
  dispose(): void
}
export interface CityCameraOptions {
  readonly camera: THREE.PerspectiveCamera
  readonly dom: HTMLElement
  readonly collision: CollisionMap
  readonly initialMode?: CityViewMode
}

export const CITY_ORBIT = {
  homePosition: [0, 305, 555],
  target: [0, 14, 30],
  minDistance: 24,
  maxDistance: 1_650,
} as const

const _look = new THREE.Vector3()
const _focusOffset = new THREE.Vector3(88, 72, 104)
const WALK_EYE_HEIGHT = 1.7
const WALK_START_PITCH = 0.025
const WALK_SAFE_YAW = 0.26
// Service boulevard, aimed through the gap between the TiKV campuses.
const WALK_SAFE_POSITION = new THREE.Vector3(75, WALK_EYE_HEIGHT, 286)
const FLY_HORIZONTAL_LIMIT = 2_400
const FLY_MAX_HEIGHT = 2_000

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'A' ||
    element.isContentEditable
  )
}

function movementForCode(code: string): CityMovementInput | null {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      return 'forward'
    case 'KeyS':
    case 'ArrowDown':
      return 'backward'
    case 'KeyA':
    case 'ArrowLeft':
      return 'left'
    case 'KeyD':
    case 'ArrowRight':
      return 'right'
    case 'Space':
    case 'KeyE':
      return 'ascend'
    case 'KeyQ':
    case 'KeyC':
    case 'ControlLeft':
    case 'ControlRight':
      return 'descend'
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'sprint'
    default:
      return null
  }
}

export function createCityCameraController(options: CityCameraOptions): CityCameraController {
  const { camera, dom, collision } = options
  const orbit = new OrbitControls(camera, dom)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.075
  orbit.minDistance = CITY_ORBIT.minDistance
  orbit.maxDistance = CITY_ORBIT.maxDistance
  orbit.maxPolarAngle = Math.PI * 0.495
  orbit.target.set(...CITY_ORBIT.target)
  orbit.update()

  const pressedCodes = new Set<string>()
  const directMovement = new Set<CityMovementInput>()
  const move = createCollisionMove()
  const savedOrbitPosition = camera.position.clone()
  const savedOrbitTarget = orbit.target.clone()
  let mode: CityViewMode = 'orbit'
  let yaw = 0
  let pitch = -0.25
  let dragging = false
  let dragPointer = -1
  let pointerX = 0
  let pointerY = 0
  let suppressLockedMovement = false
  let pointerLockReleaseFrame = 0
  let flySpeed = 72

  function rememberOrbit(): void {
    savedOrbitPosition.copy(camera.position)
    savedOrbitTarget.copy(orbit.target)
  }

  function restoreOrbit(): void {
    /*
     * OrbitControls keeps damping deltas in private state. Drain them while
     * the Fly/Walk pose is hidden, then restore the exact view we saved.
     */
    const damping = orbit.enableDamping
    orbit.enableDamping = false
    orbit.update()
    camera.position.copy(savedOrbitPosition)
    orbit.target.copy(savedOrbitTarget)
    orbit.update()
    orbit.enableDamping = damping
  }

  function readCameraAngles(): void {
    camera.getWorldDirection(_look)
    pitch = Math.asin(Math.max(-1, Math.min(1, _look.y)))
    yaw = Math.atan2(-_look.x, -_look.z)
  }

  function applyLook(): void {
    camera.rotation.order = 'YXZ'
    camera.rotation.set(pitch, yaw, 0)
  }

  function movementActive(input: CityMovementInput): boolean {
    if (directMovement.has(input)) return true
    for (const code of pressedCodes) {
      if (movementForCode(code) === input) return true
    }
    return false
  }

  function stopPointerLockSuppression(): void {
    if (pointerLockReleaseFrame !== 0) {
      window.cancelAnimationFrame(pointerLockReleaseFrame)
      pointerLockReleaseFrame = 0
    }
    suppressLockedMovement = false
  }

  function releasePointerLockSuppressionAfterSettle(): void {
    if (pointerLockReleaseFrame !== 0) {
      window.cancelAnimationFrame(pointerLockReleaseFrame)
    }
    suppressLockedMovement = true
    pointerLockReleaseFrame = window.requestAnimationFrame(() => {
      pointerLockReleaseFrame = window.requestAnimationFrame(() => {
        pointerLockReleaseFrame = 0
        suppressLockedMovement = false
      })
    })
  }

  function clearInput(): void {
    if (dragPointer >= 0 && dom.hasPointerCapture?.(dragPointer)) {
      try {
        dom.releasePointerCapture?.(dragPointer)
      } catch {
        // Pointer capture may already have ended while the page lost focus.
      }
    }
    pressedCodes.clear()
    directMovement.clear()
    dragging = false
    dragPointer = -1
    stopPointerLockSuppression()
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return
    if (mode === 'orbit' || movementForCode(event.code) === null) return
    pressedCodes.add(event.code)
    event.preventDefault()
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressedCodes.delete(event.code)
    if (mode !== 'orbit' && movementForCode(event.code) !== null) event.preventDefault()
  }

  function onPointerDown(event: PointerEvent): void {
    if (mode === 'orbit' || event.button !== 0) return
    dragging = true
    dragPointer = event.pointerId
    pointerX = event.clientX
    pointerY = event.clientY
    dom.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: PointerEvent): void {
    const locked = typeof document !== 'undefined' && document.pointerLockElement === dom
    if (mode === 'orbit' || (!dragging && !locked)) return
    if (!locked && event.pointerId !== dragPointer) return
    if (locked && suppressLockedMovement) return
    const dx = locked ? event.movementX : event.clientX - pointerX
    const dy = locked ? event.movementY : event.clientY - pointerY
    pointerX = event.clientX
    pointerY = event.clientY
    yaw -= dx * 0.0023
    pitch -= dy * 0.0023
    pitch = Math.max(-1.48, Math.min(1.48, pitch))
    applyLook()
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== dragPointer) return
    dragging = false
    dragPointer = -1
    if (dom.hasPointerCapture?.(event.pointerId)) {
      try {
        dom.releasePointerCapture?.(event.pointerId)
      } catch {
        // The browser may release capture just before pointercancel arrives.
      }
    }
  }

  function onLostPointerCapture(event: PointerEvent): void {
    if (event.pointerId !== dragPointer) return
    dragging = false
    dragPointer = -1
  }

  async function onDoubleClick(): Promise<void> {
    if (mode === 'orbit' || typeof dom.requestPointerLock !== 'function') return
    stopPointerLockSuppression()
    // Locking can warp the pointer before pointerlockchange is dispatched.
    suppressLockedMovement = true
    try {
      await dom.requestPointerLock()
    } catch {
      stopPointerLockSuppression()
      // Drag-to-look remains available when pointer-lock permission is denied.
    }
  }

  function onWheel(event: WheelEvent): void {
    if (mode !== 'fly') return
    event.preventDefault()
    flySpeed = Math.max(12, Math.min(220, flySpeed * Math.exp(-event.deltaY * 0.001)))
  }

  function onPointerLockChange(): void {
    if (typeof document === 'undefined' || document.pointerLockElement !== dom) {
      stopPointerLockSuppression()
      return
    }
    /*
     * Chromium can emit several warp events while pointer lock settles. Ignore
     * the whole transition window instead of only the first synthetic move.
     */
    releasePointerLockSuppressionAfterSettle()
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') clearInput()
  }

  function isSafeWalkPosition(x: number, z: number): boolean {
    const edge = TICITY_LAYOUT.groundSize * 0.5 - 5
    return (
      Number.isFinite(x) &&
      Number.isFinite(z) &&
      Math.abs(x) <= edge &&
      Math.abs(z) <= edge &&
      !collision.contains(x, z, 0.7)
    )
  }

  function setMode(next: CityViewMode): void {
    if (next === mode) return
    if (mode === 'orbit') rememberOrbit()
    if (typeof document !== 'undefined' && document.pointerLockElement === dom) {
      document.exitPointerLock()
    }
    clearInput()
    mode = next
    orbit.enabled = mode === 'orbit'
    if (mode === 'walk') {
      readCameraAngles()
      if (!isSafeWalkPosition(camera.position.x, camera.position.z)) {
        camera.position.copy(WALK_SAFE_POSITION)
        yaw = WALK_SAFE_YAW
      } else {
        camera.position.y = WALK_EYE_HEIGHT
      }
      pitch = WALK_START_PITCH
      applyLook()
    } else if (mode === 'fly') {
      readCameraAngles()
      applyLook()
    } else {
      restoreOrbit()
    }
  }

  function setMovement(input: CityMovementInput, active: boolean): void {
    if (!active) {
      directMovement.delete(input)
      return
    }
    if (mode !== 'orbit') directMovement.add(input)
  }

  function focus(point: THREE.Vector3): void {
    if (mode === 'orbit') {
      orbit.target.copy(point)
      camera.position.copy(point).add(_focusOffset)
      orbit.update()
      rememberOrbit()
      return
    }
    const dx = point.x - camera.position.x
    const dy = point.y - camera.position.y
    const dz = point.z - camera.position.z
    const horizontal = Math.sqrt(dx * dx + dz * dz)
    yaw = Math.atan2(-dx, -dz)
    pitch = Math.atan2(dy, Math.max(0.001, horizontal))
    pitch = Math.max(-1.48, Math.min(1.48, pitch))
    applyLook()
  }

  function update(deltaSeconds: number): void {
    if (mode === 'orbit') {
      orbit.update()
      rememberOrbit()
      return
    }
    const dt = Math.min(0.05, Math.max(0, deltaSeconds))
    let forward = 0
    let strafe = 0
    if (movementActive('forward')) forward += 1
    if (movementActive('backward')) forward -= 1
    if (movementActive('right')) strafe += 1
    if (movementActive('left')) strafe -= 1
    const length = Math.sqrt(forward * forward + strafe * strafe)
    if (length > 1) {
      forward /= length
      strafe /= length
    }
    const speed =
      (mode === 'walk' ? 15 : flySpeed) *
      (movementActive('sprint') ? 1.9 : 1)
    const distance = speed * dt
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    const targetX = camera.position.x + (-sin * forward + cos * strafe) * distance
    const targetZ = camera.position.z + (-cos * forward - sin * strafe) * distance
    const edge = TICITY_LAYOUT.groundSize * 0.5 - 5

    if (mode === 'walk') {
      if (forward === 0 && strafe === 0) {
        camera.position.y = WALK_EYE_HEIGHT
        return
      }
      collision.move(
        camera.position.x,
        camera.position.z,
        Math.max(-edge, Math.min(edge, targetX)),
        Math.max(-edge, Math.min(edge, targetZ)),
        0.58,
        move,
      )
      camera.position.set(move.x, WALK_EYE_HEIGHT, move.z)
    } else {
      let vertical = 0
      if (movementActive('ascend')) vertical += 1
      if (movementActive('descend')) vertical -= 1
      let x = (-sin * Math.cos(pitch) * forward + cos * strafe)
      let y = Math.sin(pitch) * forward + vertical
      let z = (-cos * Math.cos(pitch) * forward - sin * strafe)
      const flyLength = Math.sqrt(x * x + y * y + z * z)
      if (flyLength === 0) return
      x /= flyLength
      y /= flyLength
      z /= flyLength
      camera.position.x = Math.max(
        -FLY_HORIZONTAL_LIMIT,
        Math.min(FLY_HORIZONTAL_LIMIT, camera.position.x + x * distance),
      )
      camera.position.y = Math.max(
        2,
        Math.min(FLY_MAX_HEIGHT, camera.position.y + y * distance),
      )
      camera.position.z = Math.max(
        -FLY_HORIZONTAL_LIMIT,
        Math.min(FLY_HORIZONTAL_LIMIT, camera.position.z + z * distance),
      )
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerup', onPointerUp)
  dom.addEventListener('pointercancel', onPointerUp)
  dom.addEventListener('lostpointercapture', onLostPointerCapture)
  dom.addEventListener('dblclick', onDoubleClick)
  dom.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('blur', clearInput)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('pointerlockchange', onPointerLockChange)
  const initialMode = options.initialMode ?? 'orbit'
  if (initialMode !== 'orbit') {
    setMode(initialMode)
  }

  return {
    get mode(): CityViewMode {
      return mode
    },
    setMode,
    setMovement,
    focus,
    update,
    dispose(): void {
      orbit.dispose()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointermove', onPointerMove)
      dom.removeEventListener('pointerup', onPointerUp)
      dom.removeEventListener('pointercancel', onPointerUp)
      dom.removeEventListener('lostpointercapture', onLostPointerCapture)
      dom.removeEventListener('dblclick', onDoubleClick)
      dom.removeEventListener('wheel', onWheel)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      stopPointerLockSuppression()
    },
  }
}
