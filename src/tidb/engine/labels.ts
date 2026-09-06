/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * District identities are screen-space annotations of the city geography.
 * Layout is bounded around the projected roof, with a leader back to it.
 */

import * as THREE from 'three'
import type { CityViewMode } from './camera'
import type { TiDBSceneGraph } from '../world/city'
import { FOCUS_ANCHORS } from '../world/layout'
import type { Point3 } from '../world/layout'
import type { SemanticDomain } from '../world/palette'
import type { Locale } from '../ui/catalog'
import { CITY_LABEL_COPY, type CityLabelId } from './label-copy'
import { placeCityLabels, type CityLabelPlacement } from './label-layout'

export interface CityLabels {
  setMode(mode: CityViewMode): void
  update(force?: boolean): void
  dispose(): void
}

interface LabelSpec {
  readonly id: CityLabelId
  readonly domain: SemanticDomain
  readonly lift: number
  readonly side?: -1 | 1
  readonly anchor?: Point3
}

const LABELS: readonly LabelSpec[] = [
  { id: 'client.terminal', domain: 'client', lift: 76 },
  { id: 'tiproxy.0', domain: 'sql', lift: 9, anchor: FOCUS_ANCHORS['tiproxy.gate'], side: -1 },
  { id: 'tidb.1', domain: 'sql', lift: 57.5, side: 1 },
  { id: 'pd.control', domain: 'tso', lift: 55 },
  { id: 'tikv.0', domain: 'kv', lift: 29 },
  { id: 'tikv.1', domain: 'kv', lift: 29 },
  { id: 'tikv.2', domain: 'kv', lift: 29 },
  { id: 'gc.yard', domain: 'gc', lift: 38 },
  { id: 'tiflash.0', domain: 'tiflash', lift: 46 },
]

interface LabelEntry extends CityLabelPlacement {
  readonly spec: LabelSpec
  readonly node: HTMLDivElement
  readonly name: HTMLElement
  readonly detail: HTMLElement
  readonly leader: HTMLDivElement
  readonly anchor: THREE.Vector3
  readonly projected: THREE.Vector3
  width: number
  height: number
  anchorX: number
  anchorY: number
}

export function createCityLabels(
  container: HTMLElement,
  camera: THREE.PerspectiveCamera,
  city: TiDBSceneGraph,
): CityLabels {
  const root = document.createElement('div')
  root.className = 'tidb-world-labels'
  root.setAttribute('aria-hidden', 'true')
  container.appendChild(root)

  const entries: LabelEntry[] = []
  let locale: Locale = document.documentElement.lang === 'en' ? 'en' : 'ja'
  for (const spec of LABELS) {
    const component = city.registry.get(spec.id)
    if (!component) continue
    const node = document.createElement('div')
    node.className = 'tidb-world-label'
    node.dataset.domain = spec.domain
    node.dataset.component = spec.id
    const name = document.createElement('strong')
    const detail = document.createElement('small')
    name.textContent = CITY_LABEL_COPY[locale][spec.id].name
    detail.textContent = CITY_LABEL_COPY[locale][spec.id].detail
    node.append(name, detail)
    const leader = document.createElement('div')
    leader.className = 'tidb-world-label-leader'
    leader.dataset.domain = spec.domain
    root.append(leader, node)
    entries.push({
      spec, node, name, detail, leader,
      anchor: spec.anchor
        ? new THREE.Vector3(spec.anchor[0], spec.anchor[1] + spec.lift, spec.anchor[2])
        : component.anchor.clone().add(new THREE.Vector3(0, spec.lift, 0)),
      projected: new THREE.Vector3(),
      side: spec.side ?? 0,
      width: 1, height: 1,
      anchorX: 0, anchorY: 0,
      x: 0, y: 0,
      visible: false,
    })
  }
  const orderedEntries = [...entries]
  let measuresDirty = true
  let lastWidth = 0
  let lastHeight = 0
  const lastCameraPosition = new THREE.Vector3(Infinity, Infinity, Infinity)
  const lastCameraQuaternion = new THREE.Quaternion(0, 0, 0, 0)
  let hidden = false

  // The page shell writes html.lang and data-theme on every language/theme
  // change. Observe these explicit signals, never measure DOM every frame.
  const appearanceObserver = new MutationObserver(() => {
    const next: Locale = document.documentElement.lang === 'en' ? 'en' : 'ja'
    if (next !== locale) {
      locale = next
      for (const entry of entries) {
        entry.name.textContent = CITY_LABEL_COPY[locale][entry.spec.id].name
        entry.detail.textContent = CITY_LABEL_COPY[locale][entry.spec.id].detail
      }
    }
    measuresDirty = true
    update(true)
  })
  appearanceObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang', 'data-theme', 'class'],
  })

  function update(force = false): void {
    if (hidden) return
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    const cameraMoved =
      camera.position.distanceToSquared(lastCameraPosition) > 0.0004 ||
      1 - Math.abs(camera.quaternion.dot(lastCameraQuaternion)) > 0.00000002
    if (!force && !measuresDirty && !cameraMoved && width === lastWidth && height === lastHeight) return

    if (width !== lastWidth || height !== lastHeight) measuresDirty = true
    lastWidth = width
    lastHeight = height
    lastCameraPosition.copy(camera.position)
    lastCameraQuaternion.copy(camera.quaternion)

    const overview = FOCUS_ANCHORS['city.overview']
    const overviewDistanceSq =
      (camera.position.x - overview[0]) ** 2 +
      (camera.position.y - overview[1]) ** 2 +
      (camera.position.z - overview[2]) ** 2
    const compact = width <= 720 || height < 700 || overviewDistanceSq > 1_350 * 1_350
    if (root.classList.contains('is-overview') !== compact) measuresDirty = true
    root.classList.toggle('is-overview', compact)
    root.classList.toggle('is-distant', overviewDistanceSq > 1_350 * 1_350)

    // Batch reads after compact/locale writes. Temporarily expose hidden nodes
    // so their cached size stays valid when they enter the viewport again.
    if (measuresDirty) {
      for (const entry of entries) entry.node.hidden = false
      for (const entry of entries) {
        entry.width = Math.max(1, entry.node.offsetWidth)
        entry.height = Math.max(1, entry.node.offsetHeight)
      }
      measuresDirty = false
    }

    for (const entry of entries) {
      entry.projected.copy(entry.anchor).project(camera)
      entry.visible =
        entry.projected.z >= -1 && entry.projected.z <= 1 &&
        entry.projected.x >= -1 && entry.projected.x <= 1 &&
        entry.projected.y >= -1 && entry.projected.y <= 1
      entry.anchorX = (entry.projected.x * 0.5 + 0.5) * width
      entry.anchorY = (-entry.projected.y * 0.5 + 0.5) * height
    }
    orderedEntries.sort((left, right) => left.anchorY - right.anchorY)
    placeCityLabels(orderedEntries, width, height)

    for (const entry of entries) {
      entry.node.hidden = !entry.visible
      entry.leader.hidden = !entry.visible
      if (!entry.visible) continue
      entry.node.style.transform =
        `translate3d(${entry.x.toFixed(1)}px,${entry.y.toFixed(1)}px,0) translate(-50%,-100%)`
      // Join the nearest point of the sign, not its centre, to the roof.
      const startX = Math.max(entry.x - entry.width / 2, Math.min(entry.x + entry.width / 2, entry.anchorX))
      const startY = Math.max(entry.y - entry.height, Math.min(entry.y, entry.anchorY))
      const dx = entry.anchorX - startX
      const dy = entry.anchorY - startY
      const length = Math.hypot(dx, dy)
      entry.leader.hidden = length < 3
      entry.leader.style.width = `${length.toFixed(1)}px`
      entry.leader.style.transform =
        `translate3d(${startX.toFixed(1)}px,${startY.toFixed(1)}px,0) rotate(${Math.atan2(dy, dx)}rad)`
    }
  }

  update(true)
  return {
    setMode(mode: CityViewMode): void {
      hidden = mode === 'walk'
      root.hidden = hidden
      if (!hidden) update(true)
    },
    update,
    dispose(): void {
      appearanceObserver.disconnect()
      root.remove()
    },
  }
}
