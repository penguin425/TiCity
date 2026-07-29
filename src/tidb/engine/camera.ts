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

export interface CityCameraController {
  readonly mode: CityViewMode
  setMode(mode: CityViewMode): void
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

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
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

  const pressed = new Set<string>()
  const move = createCollisionMove()
  let mode: CityViewMode = options.initialMode ?? 'orbit'
  let yaw = 0
  let pitch = -0.25
  let dragging = false
  let dragPointer = -1
  let flySpeed = 72

  function readCameraAngles(): void {
    camera.getWorldDirection(_look)
    pitch = Math.asin(Math.max(-1, Math.min(1, _look.y)))
    yaw = Math.atan2(-_look.x, -_look.z)
  }

  function applyLook(): void {
    camera.rotation.order = 'YXZ'
    camera.rotation.set(pitch, yaw, 0)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return
    pressed.add(event.code)
    if (mode !== 'orbit' && event.code.startsWith('Arrow')) event.preventDefault()
  }

  function onKeyUp(event: KeyboardEvent): void {
    pressed.delete(event.code)
  }

  function onPointerDown(event: PointerEvent): void {
    if (mode === 'orbit' || event.button !== 0) return
    dragging = true
    dragPointer = event.pointerId
    dom.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: PointerEvent): void {
    const locked = typeof document !== 'undefined' && document.pointerLockElement === dom
    if (mode === 'orbit' || (!dragging && !locked)) return
    yaw -= event.movementX * 0.0023
    pitch -= event.movementY * 0.0023
    pitch = Math.max(-1.48, Math.min(1.48, pitch))
    applyLook()
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== dragPointer) return
    dragging = false
    dragPointer = -1
    dom.releasePointerCapture?.(event.pointerId)
  }

  function onDoubleClick(): void {
    if (mode !== 'orbit') void dom.requestPointerLock?.()
  }

  function onWheel(event: WheelEvent): void {
    if (mode !== 'fly') return
    flySpeed = Math.max(12, Math.min(220, flySpeed * Math.exp(-event.deltaY * 0.001)))
  }

  function setMode(next: CityViewMode): void {
    if (next === mode) return
    if (typeof document !== 'undefined' && document.pointerLockElement === dom) {
      document.exitPointerLock()
    }
    pressed.clear()
    dragging = false
    mode = next
    orbit.enabled = mode === 'orbit'
    if (mode === 'walk') {
      readCameraAngles()
      pitch = Math.max(-1.1, Math.min(1.1, pitch))
      if (collision.contains(camera.position.x, camera.position.z, 0.7)) {
        camera.position.set(0, 1.7, -190)
        yaw = 0
      } else {
        camera.position.y = 1.7
      }
      applyLook()
    } else if (mode === 'fly') {
      readCameraAngles()
      applyLook()
    } else {
      orbit.target.set(...CITY_ORBIT.target)
      orbit.update()
    }
  }

  function focus(point: THREE.Vector3): void {
    if (mode === 'orbit') {
      orbit.target.copy(point)
      camera.position.copy(point).add(_focusOffset)
      orbit.update()
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
      return
    }
    const dt = Math.min(0.05, Math.max(0, deltaSeconds))
    let forward = 0
    let strafe = 0
    if (pressed.has('KeyW') || pressed.has('ArrowUp')) forward += 1
    if (pressed.has('KeyS') || pressed.has('ArrowDown')) forward -= 1
    if (pressed.has('KeyD') || pressed.has('ArrowRight')) strafe += 1
    if (pressed.has('KeyA') || pressed.has('ArrowLeft')) strafe -= 1
    const length = Math.sqrt(forward * forward + strafe * strafe)
    if (length > 1) {
      forward /= length
      strafe /= length
    }
    const speed =
      (mode === 'walk' ? 15 : flySpeed) *
      (pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 1.9 : 1)
    const distance = speed * dt
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    const targetX = camera.position.x + (-sin * forward + cos * strafe) * distance
    const targetZ = camera.position.z + (-cos * forward - sin * strafe) * distance
    const edge = TICITY_LAYOUT.groundSize * 0.5 - 5

    if (mode === 'walk') {
      collision.move(
        camera.position.x,
        camera.position.z,
        Math.max(-edge, Math.min(edge, targetX)),
        Math.max(-edge, Math.min(edge, targetZ)),
        0.58,
        move,
      )
      camera.position.set(move.x, 1.7, move.z)
    } else {
      camera.position.x = Math.max(-edge, Math.min(edge, targetX))
      camera.position.z = Math.max(-edge, Math.min(edge, targetZ))
      let vertical = 0
      if (pressed.has('Space') || pressed.has('KeyE')) vertical += 1
      if (pressed.has('ControlLeft') || pressed.has('KeyQ')) vertical -= 1
      camera.position.y = Math.max(2, Math.min(430, camera.position.y + vertical * distance))
    }
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerup', onPointerUp)
  dom.addEventListener('pointercancel', onPointerUp)
  dom.addEventListener('dblclick', onDoubleClick)
  dom.addEventListener('wheel', onWheel, { passive: true })
  orbit.enabled = mode === 'orbit'
  if (mode !== 'orbit') {
    readCameraAngles()
    if (mode === 'walk') camera.position.y = 1.7
    applyLook()
  }

  return {
    get mode(): CityViewMode {
      return mode
    },
    setMode,
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
      dom.removeEventListener('dblclick', onDoubleClick)
      dom.removeEventListener('wheel', onWheel)
    },
  }
}
