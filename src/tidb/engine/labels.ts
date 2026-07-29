/*
 * Copyright 2026 TiCity contributors.
 * Licensed under the Apache License, Version 2.0.
 *
 * A deliberately small overview-label layer. It labels districts and service
 * instances, never all 108 Region peers, so the city remains readable.
 */

import * as THREE from 'three'
import type { CityViewMode } from './camera'
import type { TiDBSceneGraph } from '../world/city'
import { FOCUS_ANCHORS } from '../world/layout'
import type { Point3 } from '../world/layout'
import type { SemanticDomain } from '../world/palette'

export interface CityLabels {
  setMode(mode: CityViewMode): void
  update(force?: boolean): void
  dispose(): void
}

interface LabelSpec {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly domain: SemanticDomain
  readonly lift: number
  readonly anchor?: Point3
}

const LABELS: readonly LabelSpec[] = [
  { id: 'client.terminal', label: 'CLIENTS', detail: 'MySQL workloads', domain: 'client', lift: 90 },
  {
    id: 'tiproxy.0',
    label: 'TiProxy',
    detail: '2 connection routers',
    domain: 'sql',
    lift: 9,
    anchor: [0, 7, -220],
  },
  {
    id: 'tidb.1',
    label: 'TiDB SQL',
    detail: '3 stateless servers',
    domain: 'sql',
    lift: 64,
  },
  { id: 'pd.control', label: 'PD / TSO', detail: 'control plane', domain: 'tso', lift: 55 },
  { id: 'tikv.0', label: 'TiKV STORE 1', detail: '36 Region voters', domain: 'kv', lift: 29 },
  { id: 'tikv.1', label: 'TiKV STORE 2', detail: '36 Region voters', domain: 'kv', lift: 29 },
  { id: 'tikv.2', label: 'TiKV STORE 3', detail: '36 Region voters', domain: 'kv', lift: 29 },
  { id: 'gc.yard', label: 'MVCC GC', detail: 'safe-point yard', domain: 'gc', lift: 38 },
  { id: 'tiflash.0', label: 'TiFlash', detail: 'learner · MPP', domain: 'tiflash', lift: 46 },
] as const

interface LabelEntry {
  readonly spec: LabelSpec
  readonly node: HTMLDivElement
  readonly anchor: THREE.Vector3
  readonly projected: THREE.Vector3
  width: number
  height: number
  screenX: number
  screenY: number
  visible: boolean
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
  for (const spec of LABELS) {
    const component = city.registry.get(spec.id)
    if (!component) continue
    const node = document.createElement('div')
    node.className = 'tidb-world-label'
    node.dataset.domain = spec.domain
    const name = document.createElement('strong')
    name.textContent = spec.label
    const detail = document.createElement('small')
    detail.textContent = spec.detail
    node.append(name, detail)
    root.appendChild(node)
    entries.push({
      spec,
      node,
      anchor: spec.anchor
        ? new THREE.Vector3(spec.anchor[0], spec.anchor[1] + spec.lift, spec.anchor[2])
        : component.anchor.clone().add(new THREE.Vector3(0, spec.lift, 0)),
      projected: new THREE.Vector3(),
      width: 1,
      height: 1,
      screenX: 0,
      screenY: 0,
      visible: false,
    })
  }
  for (const entry of entries) {
    entry.width = Math.max(1, entry.node.offsetWidth)
    entry.height = Math.max(1, entry.node.offsetHeight)
  }

  let lastWidth = 0
  let lastHeight = 0
  let lastCameraX = Infinity
  let lastCameraY = Infinity
  let lastCameraZ = Infinity
  let lastCameraQx = Infinity
  let lastCameraQy = Infinity
  let lastCameraQz = Infinity
  let lastCameraQw = Infinity
  let hidden = false

  function update(force = false): void {
    if (hidden) return
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    const cameraMoved =
      Math.abs(camera.position.x - lastCameraX) > 0.02 ||
      Math.abs(camera.position.y - lastCameraY) > 0.02 ||
      Math.abs(camera.position.z - lastCameraZ) > 0.02 ||
      Math.abs(camera.quaternion.x - lastCameraQx) > 0.0002 ||
      Math.abs(camera.quaternion.y - lastCameraQy) > 0.0002 ||
      Math.abs(camera.quaternion.z - lastCameraQz) > 0.0002 ||
      Math.abs(camera.quaternion.w - lastCameraQw) > 0.0002
    if (!force && !cameraMoved && width === lastWidth && height === lastHeight) return

    lastWidth = width
    lastHeight = height
    lastCameraX = camera.position.x
    lastCameraY = camera.position.y
    lastCameraZ = camera.position.z
    lastCameraQx = camera.quaternion.x
    lastCameraQy = camera.quaternion.y
    lastCameraQz = camera.quaternion.z
    lastCameraQw = camera.quaternion.w

    const overview = FOCUS_ANCHORS['city.overview']
    const overviewDx = camera.position.x - overview[0]
    const overviewDy = camera.position.y - overview[1]
    const overviewDz = camera.position.z - overview[2]
    const overviewDistanceSq =
      overviewDx * overviewDx +
      overviewDy * overviewDy +
      overviewDz * overviewDz
    root.classList.toggle('is-overview', overviewDistanceSq > 950 * 950)
    root.classList.toggle('is-distant', overviewDistanceSq > 1_350 * 1_350)

    for (const entry of entries) {
      entry.projected.copy(entry.anchor).project(camera)
      const visible =
        entry.projected.z >= -1 &&
        entry.projected.z <= 1 &&
        entry.projected.x >= -1.12 &&
        entry.projected.x <= 1.12 &&
        entry.projected.y >= -1.12 &&
        entry.projected.y <= 1.12
      if (!visible) {
        entry.visible = false
        entry.node.hidden = true
        continue
      }
      entry.visible = true
      entry.node.hidden = false
      entry.screenX = (entry.projected.x * 0.5 + 0.5) * width
      entry.screenY = (-entry.projected.y * 0.5 + 0.5) * height
      if (entry.width <= 1 || entry.height <= 1) {
        entry.width = Math.max(1, entry.node.offsetWidth)
        entry.height = Math.max(1, entry.node.offsetHeight)
      }
      const distance = camera.position.distanceTo(entry.anchor)
      entry.node.classList.toggle('is-far', distance > 520)
    }

    /*
     * Keep overview signs legible in short desktop viewports. Labels are
     * ordered from top to bottom and only displaced when their actual screen
     * rectangles overlap horizontally and vertically.
     */
    entries.sort((left, right) => left.screenY - right.screenY)
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]
      if (!entry.visible) continue
      for (let previousIndex = 0; previousIndex < index; previousIndex++) {
        const previous = entries[previousIndex]
        if (!previous.visible) continue
        const overlapsX =
          Math.abs(entry.screenX - previous.screenX) <
          (entry.width + previous.width) / 2 + 8
        const overlapsY =
          entry.screenY - entry.height < previous.screenY + 5 &&
          entry.screenY > previous.screenY - previous.height - 5
        if (overlapsX && overlapsY) {
          entry.screenY = previous.screenY + entry.height + 6
        }
      }
      entry.screenY = Math.min(height - 10, Math.max(entry.height + 10, entry.screenY))
      entry.node.style.transform =
        `translate3d(${entry.screenX.toFixed(1)}px,${entry.screenY.toFixed(1)}px,0) ` +
        'translate(-50%,-100%)'
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
      root.remove()
    },
  }
}
