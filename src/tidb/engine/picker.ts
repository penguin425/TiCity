/*
 * Copyright 2026 TiDB City contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import type { CityComponent, TiDBSceneGraph } from '../world/city'
import { SEMANTIC_COLORS } from '../world/palette'
import type { CityTheme } from '../world/palette'

export interface CityPicker {
  readonly object: THREE.Group
  readonly selected: CityComponent | null
  select(id: string | null): CityComponent | null
  pick(clientX: number, clientY: number): CityComponent | null
  resize(): void
  update(): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface CityPickerOptions {
  readonly dom: HTMLElement
  readonly container: HTMLElement
  readonly camera: THREE.PerspectiveCamera
  readonly city: TiDBSceneGraph
  readonly onSelect?: (component: CityComponent | null) => void
}

const _ndc = new THREE.Vector2()
const _projected = new THREE.Vector3()
const _hits: THREE.Intersection[] = []

export function createCityPicker(options: CityPickerOptions): CityPicker {
  const { dom, container, camera, city } = options
  const raycaster = new THREE.Raycaster()
  const candidates = city.registry.roots() as THREE.Object3D[]
  const root = new THREE.Group()
  root.name = 'tidb-city:selection'

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: SEMANTIC_COLORS.night.return,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  })
  const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7, 32), ringMaterial)
  ring.name = 'selection:ring'
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.9
  ring.visible = false
  root.add(ring)

  const label = document.createElement('div')
  label.className = 'tidb-city-selection-label'
  label.setAttribute('role', 'status')
  label.setAttribute('aria-live', 'polite')
  label.style.cssText =
    'position:absolute;display:none;z-index:20;max-width:270px;padding:8px 10px;' +
    'border:1px solid currentColor;border-radius:6px;background:rgba(6,14,24,.9);' +
    'color:#f7fbff;font:600 12px/1.35 system-ui,sans-serif;pointer-events:none;' +
    'transform:translate(-50%,-115%);white-space:normal'
  container.appendChild(label)

  let selected: CityComponent | null = null
  let downX = 0
  let downY = 0
  let downPointer = -1
  let rectLeft = 0
  let rectTop = 0
  let rectWidth = 1
  let rectHeight = 1

  function resize(): void {
    const rect = dom.getBoundingClientRect()
    rectLeft = rect.left
    rectTop = rect.top
    rectWidth = Math.max(1, rect.width)
    rectHeight = Math.max(1, rect.height)
  }

  function select(id: string | null): CityComponent | null {
    selected = id ? city.registry.get(id) ?? null : null
    city.setFocus(selected?.id ?? null)
    ring.visible = selected !== null
    label.style.display = selected ? 'block' : 'none'
    if (selected) {
      ring.position.x = selected.anchor.x
      ring.position.z = selected.anchor.z
      label.textContent = `${selected.name} — ${selected.role}`
    } else {
      label.textContent = ''
    }
    options.onSelect?.(selected)
    return selected
  }

  function pick(clientX: number, clientY: number): CityComponent | null {
    resize()
    _ndc.set(
      ((clientX - rectLeft) / rectWidth) * 2 - 1,
      -((clientY - rectTop) / rectHeight) * 2 + 1,
    )
    raycaster.setFromCamera(_ndc, camera)
    _hits.length = 0
    raycaster.intersectObjects(candidates, true, _hits)
    for (let i = 0; i < _hits.length; i++) {
      const hit = _hits[i]
      const component = city.registry.resolve(hit.object, hit.instanceId)
      if (component) return component
    }
    return null
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return
    downPointer = event.pointerId
    downX = event.clientX
    downY = event.clientY
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== downPointer) return
    downPointer = -1
    const dx = event.clientX - downX
    const dy = event.clientY - downY
    if (dx * dx + dy * dy > 25) return
    select(pick(event.clientX, event.clientY)?.id ?? null)
  }

  function update(): void {
    if (!selected) return
    _projected.copy(selected.anchor).project(camera)
    const x = (_projected.x * 0.5 + 0.5) * rectWidth + rectLeft
    const y = (-_projected.y * 0.5 + 0.5) * rectHeight + rectTop
    label.style.left = `${x}px`
    label.style.top = `${y}px`
    label.style.visibility = _projected.z < -1 || _projected.z > 1 ? 'hidden' : 'visible'
  }

  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointerup', onPointerUp)
  resize()

  return {
    object: root,
    get selected(): CityComponent | null {
      return selected
    },
    select,
    pick,
    resize,
    update,
    setTheme(theme: CityTheme): void {
      ringMaterial.color.setHex(SEMANTIC_COLORS[theme].return)
      label.style.background = theme === 'night' ? 'rgba(6,14,24,.9)' : 'rgba(247,250,252,.94)'
      label.style.color = theme === 'night' ? '#f7fbff' : '#263746'
    },
    dispose(): void {
      dom.removeEventListener('pointerdown', onPointerDown)
      dom.removeEventListener('pointerup', onPointerUp)
      ring.geometry.dispose()
      ringMaterial.dispose()
      label.remove()
      root.clear()
    },
  }
}
