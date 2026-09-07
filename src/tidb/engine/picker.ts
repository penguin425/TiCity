/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 */

import * as THREE from 'three'
import type { CityComponent, TiDBSceneGraph } from '../world/city'
import { SEMANTIC_COLORS } from '../world/palette'
import type { CityTheme } from '../world/palette'
import type { Locale } from '../ui/catalog'
import { MODEL_DISCLOSURE, selectionCopy } from '../ui/selection-copy'

export interface CityPicker {
  readonly object: THREE.Group
  readonly selected: CityComponent | null
  select(id: string | null): CityComponent | null
  pick(clientX: number, clientY: number): CityComponent | null
  resize(): void
  update(): void
  setLocale(locale: Locale): void
  setTheme(theme: CityTheme): void
  dispose(): void
}

export interface CityPickerOptions {
  readonly dom: HTMLElement
  readonly container: HTMLElement
  readonly camera: THREE.PerspectiveCamera
  readonly city: TiDBSceneGraph
  readonly locale?: Locale
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
  root.name = 'ticity:selection'

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: SEMANTIC_COLORS.night.return,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  })
  const ring = new THREE.Mesh(new THREE.RingGeometry(6, 7, 32), ringMaterial)
  ring.name = 'selection:ring'
  ring.rotation.x = -Math.PI / 2
  ring.renderOrder = 20
  ring.visible = false
  root.add(ring)

  const label = document.createElement('div')
  label.className = 'ticity-selection-label'
  label.setAttribute('role', 'status')
  label.setAttribute('aria-live', 'polite')
  const labelName = document.createElement('strong')
  labelName.className = 'ticity-selection-label__name'
  const labelDisclosure = document.createElement('small')
  labelDisclosure.className = 'ticity-selection-label__disclosure'
  labelDisclosure.setAttribute('aria-hidden', 'true')
  label.append(labelName, labelDisclosure)
  label.style.cssText =
    'position:absolute;display:none;z-index:20;max-width:270px;padding:5px 8px;' +
    'border:1px solid currentColor;border-radius:6px;background:rgba(6,14,24,.9);' +
    'color:#f7fbff;font:600 12px/1.35 system-ui,sans-serif;pointer-events:none;' +
    'transform:translate(-50%,-115%);white-space:normal;gap:2px'
  labelName.style.display = 'block'
  labelDisclosure.style.cssText =
    'display:inline-block;padding:1px 4px;border:1px solid currentColor;border-radius:3px;' +
    'font:600 8px/1.2 ui-monospace,monospace;letter-spacing:.04em;opacity:.9;white-space:nowrap'
  container.appendChild(label)

  let selected: CityComponent | null = null
  let selectedRole = ''
  let selectedDomain = ''
  let selectedPeerRole: CityComponent['peerRole']
  let locale: Locale = options.locale
    ?? (document.documentElement.lang === 'en' ? 'en' : 'ja')
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

  function syncSelectionCopy(force = false): boolean {
    if (!selected) return false
    const changed = force ||
      selected.role !== selectedRole ||
      selected.domain !== selectedDomain ||
      selected.peerRole !== selectedPeerRole
    if (!changed) return false
    const projection = selectionCopy(locale, selected)
    labelName.textContent = projection.visibleLabel
    labelDisclosure.textContent = projection.disclosure
    label.setAttribute('aria-label', projection.ariaLabel)
    label.setAttribute('data-model-disclosure', MODEL_DISCLOSURE)
    selectedRole = selected.role
    selectedDomain = selected.domain
    selectedPeerRole = selected.peerRole
    return true
  }

  function select(id: string | null): CityComponent | null {
    selected = id ? city.registry.get(id) ?? null : null
    city.setFocus(selected?.id ?? null)
    ring.visible = selected !== null
    label.style.display = selected ? 'grid' : 'none'
    if (selected) {
      ring.position.copy(selected.anchor)
      ring.position.y += 0.75
      selectedRole = ''
      selectedDomain = ''
      selectedPeerRole = undefined
      syncSelectionCopy(true)
    } else {
      labelName.textContent = ''
      labelDisclosure.textContent = ''
      label.removeAttribute('aria-label')
      label.removeAttribute('data-model-disclosure')
      selectedRole = ''
      selectedDomain = ''
      selectedPeerRole = undefined
    }
    options.onSelect?.(selected)
    return selected
  }

  function pick(clientX: number, clientY: number): CityComponent | null {
    if (!city.root.visible) return null
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
    if (event.button !== 0 || !city.root.visible) return
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
    ring.position.copy(selected.anchor)
    ring.position.y += 0.75
    if (syncSelectionCopy()) {
      options.onSelect?.(selected)
    }
    _projected.copy(selected.anchor).project(camera)
    const x = (_projected.x * 0.5 + 0.5) * rectWidth
    const y = (-_projected.y * 0.5 + 0.5) * rectHeight
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
    setLocale(next: Locale): void {
      if (locale === next) return
      locale = next
      if (selected) {
        syncSelectionCopy(true)
        options.onSelect?.(selected)
      }
    },
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
