// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const pages = [
  { path: '/', title: /TiCity/ },
  { path: '/machine/', title: /Machine · TiCity/ },
  { path: '/diagnose/', title: /Diagnose · TiCity/ },
] as const

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze()
  const violations = result.violations.filter(({ impact }) =>
    impact === 'serious' || impact === 'critical',
  )
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
}

interface CameraSnapshot {
  readonly position: readonly [number, number, number]
  readonly direction: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
}

async function cameraSnapshot(page: Page): Promise<CameraSnapshot> {
  return page.evaluate(() => {
    const { camera } = window.TICITY.world!.shell
    camera.updateMatrixWorld(true)
    const matrix = camera.matrixWorld.elements
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      direction: [-matrix[8], -matrix[9], -matrix[10]],
      quaternion: [
        camera.quaternion.x,
        camera.quaternion.y,
        camera.quaternion.z,
        camera.quaternion.w,
      ],
    }
  })
}

function distance3(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

for (const surface of pages) {
  test(`${surface.path} boots offline and passes the accessibility gate`, async ({ page }) => {
    const thirdPartyRequests: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (
        url.protocol !== 'data:' &&
        url.protocol !== 'blob:' &&
        url.hostname !== '127.0.0.1'
      ) {
        thirdPartyRequests.push(request.url())
      }
    })

    await page.goto(surface.path)
    await expect(page).toHaveTitle(surface.title)
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('main')).toBeVisible()
    await expect(page.locator('.tidb-wordmark strong')).toHaveText('TiCity')
    await expectNoSeriousAccessibilityViolations(page)
    expect(thirdPartyRequests).toEqual([])
  })
}

test('city exposes the documented model API and defaults to Japanese', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')

  const publicApi = await page.evaluate(() => {
    const api = (
      window as typeof window & {
        TICITY?: Record<string, unknown>
      }
    ).TICITY
    const retiredGlobalName = ['TIDB', 'CITY'].join('')
    return {
      keys: api ? Object.keys(api).sort() : [],
      retiredGlobalPresent: Object.prototype.hasOwnProperty.call(window, retiredGlobalName),
    }
  })

  expect(publicApi.keys).toEqual(
    expect.arrayContaining(['model', 'runScenario', 'submitSql', 'trace']),
  )
  expect(publicApi.retiredGlobalPresent).toBe(false)

  const snapshot = await page.evaluate(() => {
    const state = window.TICITY.model.state
    const before = state.controls.qps
    try {
      state.controls.qps = 9_999
    } catch {
      // Frozen snapshots throw in module strict mode; either way the model
      // itself must remain unchanged.
    }
    return {
      frozen: Object.isFrozen(state) && Object.isFrozen(state.controls),
      before,
      after: window.TICITY.model.state.controls.qps,
    }
  })
  expect(snapshot.frozen).toBe(true)
  expect(snapshot.after).toBe(snapshot.before)
})

test('the language query parameter selects English', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('Machine and Diagnose share the same detailed event cursor through the URL', async ({
  page,
}) => {
  const eventId = 'trace-1-event-7'
  await page.goto(
    `/machine/?lang=en&scenario=cross-region-transaction&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('[data-event-index][aria-current="step"]'))
    .toHaveAttribute('data-event-domain', 'txn2pc')
  await expect(page.locator('.tidb-machine__detail')).toContainText('pessimistic lock')
  expect(new URL(page.url()).searchParams.get('event')).toBe(eventId)

  await page.goto(
    `/diagnose/?lang=en&scenario=cross-region-transaction&event=${eventId}`,
  )
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('select[aria-label="State at event"]')).toHaveValue(eventId)
  const regionTable = page.locator('[data-table-section="regions"]')
  await expect(regionTable).toContainText('cfLock')
  await expect(regionTable).toContainText('empty')
  await expect(regionTable).toContainText('leader_memory')
})

test('desktop controls start collapsed and toggle the panel accessibly', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const layout = page.locator('.tidb-layout')
  const panel = page.locator('[data-action="panel"]')
  const controls = page.locator('#tidb-control-panel')
  await expect(layout).toHaveAttribute('data-panel', 'closed')
  await expect(panel).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toHaveAttribute('aria-pressed', 'false')
  await expect(controls).toBeHidden()

  await panel.click()
  await expect(layout).toHaveAttribute('data-panel', 'open')
  await expect(panel).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toHaveAttribute('aria-pressed', 'true')
  await expect(controls).toBeVisible()

  await panel.click()
  await expect(layout).toHaveAttribute('data-panel', 'closed')
  await expect(panel).toHaveAttribute('aria-expanded', 'false')
  await expect(controls).toBeHidden()
})

test('orbit view can zoom out to a city-scale overview without clipping the atmosphere', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const canvas = page.locator('.tidb-world canvas')
  await expect(canvas).toBeVisible()
  const initial = await page.evaluate(() => {
    const { camera } = window.TICITY.world!.shell
    const target = { x: 0, y: 14, z: 30 }
    return {
      distance: Math.hypot(
        camera.position.x - target.x,
        camera.position.y - target.y,
        camera.position.z - target.z,
      ),
      far: camera.far,
    }
  })

  const orbitBeforeDrag = await cameraSnapshot(page)
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('Orbit canvas has no layout box')
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.62,
    canvasBox.y + canvasBox.height * 0.48,
  )
  await page.mouse.down()
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.68,
    canvasBox.y + canvasBox.height * 0.52,
    { steps: 4 },
  )
  await page.mouse.up()
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const orbitAfterDrag = await cameraSnapshot(page)
  expect(distance3(orbitAfterDrag.position, orbitBeforeDrag.position)).toBeGreaterThan(1)
  expect(distance3(orbitAfterDrag.direction, orbitBeforeDrag.direction)).toBeGreaterThan(0.01)

  // One high-resolution trackpad gesture should be enough to exercise the
  // configured OrbitControls ceiling, independent of browser wheel batching.
  await canvas.dispatchEvent('wheel', {
    clientX: 720,
    clientY: 450,
    deltaMode: 0,
    deltaY: 2_000,
  })
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  const overview = await page.evaluate(() => {
    const { camera, scene, city } = window.TICITY.world!.shell
    const target = { x: 0, y: 14, z: 30 }
    const sky = city.root.getObjectByName('city:sky-dome')
    const fogFar = 'far' in (scene.fog ?? {}) ? scene.fog?.far ?? 0 : 0
    return {
      distance: Math.hypot(
        camera.position.x - target.x,
        camera.position.y - target.y,
        camera.position.z - target.z,
      ),
      far: camera.far,
      fogFar,
      skyDistance: sky ? sky.position.distanceTo(camera.position) : Number.POSITIVE_INFINITY,
      labelsDistant: document.querySelector('.tidb-world-labels')
        ?.classList.contains('is-distant') ?? false,
    }
  })

  expect(initial.distance).toBeGreaterThan(590)
  expect(initial.distance).toBeLessThan(610)
  expect(overview.distance).toBeGreaterThan(initial.distance * 2.7)
  expect(overview.distance).toBeLessThanOrEqual(1_651)
  expect(overview.far).toBeGreaterThanOrEqual(4_000)
  expect(overview.fogFar).toBeGreaterThanOrEqual(2_800)
  expect(overview.skyDistance).toBeLessThan(0.01)
  expect(overview.labelsDistant).toBe(true)
})

test('fly keeps the overview pose, follows the full view vector, and clears movement on blur', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  // Stop the render clock so every camera integration below is explicit and
  // independent of browser scheduling.
  await page.evaluate(() => window.TICITY.world!.shell.stop())
  const canvas = page.locator('.tidb-world canvas')
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('Fly canvas has no layout box')
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.52,
    canvasBox.y + canvasBox.height * 0.46,
  )
  await page.mouse.down()
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.58,
    canvasBox.y + canvasBox.height * 0.49,
  )
  await page.mouse.up()
  // Because the render loop is stopped, OrbitControls still has a damping
  // remainder here. A mode round-trip must not apply that private residue.
  const overview = await cameraSnapshot(page)

  const fly = page.locator('[data-view="fly"]')
  await fly.click()
  await expect(fly).toHaveAttribute('aria-pressed', 'true')
  const idle = await page.evaluate(() => {
    const shell = window.TICITY.world!.shell
    shell.controls.update(1 / 60)
    return shell.controls.mode
  })
  expect(idle).toBe('fly')

  const flyStart = await cameraSnapshot(page)
  expect(distance3(flyStart.position, overview.position)).toBeLessThan(0.001)
  expect(distance3(flyStart.direction, overview.direction)).toBeLessThan(0.001)

  const orbit = page.locator('[data-view="orbit"]')
  await orbit.click()
  await page.evaluate(() => {
    const controls = window.TICITY.world!.shell.controls
    for (let frame = 0; frame < 60; frame++) controls.update(1 / 60)
  })
  const orbitRestored = await cameraSnapshot(page)
  expect(distance3(orbitRestored.position, overview.position)).toBeLessThan(0.01)
  expect(distance3(orbitRestored.direction, overview.direction)).toBeLessThan(0.001)
  await fly.click()

  const lookStartX = canvasBox.x + canvasBox.width * 0.55
  const lookStartY = canvasBox.y + canvasBox.height * 0.5
  const beforeDragLook = await cameraSnapshot(page)
  // Start with a trusted mouse press so the canvas owns pointer capture, then
  // send an unlocked move whose raw movement is deliberately zero. The camera
  // must derive the drag from client coordinates for touch/Safari parity.
  await page.mouse.move(lookStartX, lookStartY)
  await page.mouse.down()
  await canvas.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: lookStartX + 80,
    clientY: lookStartY,
    movementX: 0,
    movementY: 0,
  })
  await page.mouse.up()
  const afterDragLook = await cameraSnapshot(page)
  expect(distance3(afterDragLook.direction, beforeDragLook.direction)).toBeGreaterThan(0.05)

  const forward = await page.evaluate(() => {
    const { camera, controls: controller } = window.TICITY.world!.shell
    camera.updateMatrixWorld(true)
    const matrix = camera.matrixWorld.elements
    const direction = [-matrix[8], -matrix[9], -matrix[10]] as const
    const before = [camera.position.x, camera.position.y, camera.position.z] as const

    controller.setMovement('forward', true)
    controller.update(0.05)
    controller.setMovement('forward', false)

    const displacement = [
      camera.position.x - before[0],
      camera.position.y - before[1],
      camera.position.z - before[2],
    ] as const
    const length = Math.hypot(...displacement)
    const alignment =
      (displacement[0] * direction[0] +
        displacement[1] * direction[1] +
        displacement[2] * direction[2]) /
      Math.max(1e-9, length)
    return { direction, displacement, length, alignment }
  })
  expect(forward.direction[1]).toBeLessThan(-0.3)
  expect(forward.displacement[1]).toBeLessThan(-0.5)
  expect(forward.length).toBeGreaterThan(1)
  expect(forward.alignment).toBeGreaterThan(0.995)

  const beforeBlur = await cameraSnapshot(page)
  await page.keyboard.down('w')
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    window.TICITY.world!.shell.controls.update(0.05)
  })
  await page.keyboard.up('w')
  const afterBlur = await cameraSnapshot(page)
  expect(distance3(afterBlur.position, beforeBlur.position)).toBeLessThan(0.001)
})

test('walk starts safely, moves at pedestrian height, and returns to the saved orbit view', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => window.TICITY.world!.shell.stop())
  const overview = await cameraSnapshot(page)

  const walk = page.locator('[data-view="walk"]')
  await walk.click()
  await expect(walk).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tidb-world-labels')).toBeHidden()

  const pedestrian = await page.evaluate(() => {
    const { camera, city, controls: controller } = window.TICITY.world!.shell
    controller.update(1 / 60)
    camera.updateMatrixWorld(true)
    const matrix = camera.matrixWorld.elements
    const start = [camera.position.x, camera.position.y, camera.position.z] as const
    const insideCollider = city.colliders.some((box) =>
      camera.position.x > box.minX - 0.58 &&
      camera.position.x < box.maxX + 0.58 &&
      camera.position.z > box.minZ - 0.58 &&
      camera.position.z < box.maxZ + 0.58
    )

    controller.setMovement('forward', true)
    controller.update(0.05)
    controller.setMovement('forward', false)
    const end = [camera.position.x, camera.position.y, camera.position.z] as const
    return {
      mode: controller.mode,
      start,
      end,
      directionY: -matrix[9],
      insideCollider,
      horizontalTravel: Math.hypot(end[0] - start[0], end[2] - start[2]),
    }
  })

  expect(pedestrian.mode).toBe('walk')
  expect(Math.abs(pedestrian.start[0])).toBeLessThanOrEqual(355)
  expect(Math.abs(pedestrian.start[2])).toBeLessThanOrEqual(355)
  expect(pedestrian.start[1]).toBeCloseTo(1.7, 3)
  expect(Math.abs(pedestrian.directionY)).toBeLessThan(0.2)
  expect(pedestrian.insideCollider).toBe(false)
  expect(pedestrian.horizontalTravel).toBeGreaterThan(0.2)
  expect(pedestrian.end[1]).toBeCloseTo(1.7, 3)

  const orbit = page.locator('[data-view="orbit"]')
  await orbit.click()
  await expect(orbit).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.tidb-world-labels')).toBeVisible()
  await page.evaluate(() => {
    const controls = window.TICITY.world!.shell.controls
    for (let frame = 0; frame < 120; frame++) controls.update(1 / 60)
  })
  const restored = await cameraSnapshot(page)
  const quaternionDot = Math.abs(
    overview.quaternion[0] * restored.quaternion[0] +
    overview.quaternion[1] * restored.quaternion[1] +
    overview.quaternion[2] * restored.quaternion[2] +
    overview.quaternion[3] * restored.quaternion[3],
  )
  expect(distance3(restored.position, overview.position)).toBeLessThan(0.01)
  expect(1 - quaternionDot).toBeLessThan(1e-6)
})

test('short 390px mobile exposes Fly and a non-overlapping movement pad', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const fly = page.locator('[data-view="fly"]')
  await expect(fly).toBeVisible()
  await fly.click()
  await expect(fly).toHaveAttribute('aria-pressed', 'true')

  const forward = page.locator('[data-camera-move="forward"]')
  await expect(forward).toBeVisible()
  const padLayout = await forward.evaluate((control) => {
    const box = control.getBoundingClientRect()
    const pad = control.closest('.tidb-movement-pad')!
    const padBox = pad.getBoundingClientRect()
    const dockBox = document.querySelector('[data-trace-dock]')!.getBoundingClientRect()
    const viewBox = document.querySelector('.tidb-view-actions')!.getBoundingClientRect()
    const targets = [...pad.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => !button.hidden)
      .map((button) => {
        const target = button.getBoundingClientRect()
        return {
          width: target.width,
          height: target.height,
          topHit: button.contains(document.elementFromPoint(
            target.left + target.width / 2,
            target.top + target.height / 2,
          )),
        }
      })
    return {
      width: box.width,
      height: box.height,
      label: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      clearOfViewControls: padBox.top >= viewBox.bottom,
      clearOfTraceDock:
        padBox.right <= dockBox.left ||
        dockBox.right <= padBox.left ||
        padBox.bottom <= dockBox.top ||
        dockBox.bottom <= padBox.top,
      targets,
    }
  })
  expect(padLayout.width).toBeGreaterThanOrEqual(44)
  expect(padLayout.height).toBeGreaterThanOrEqual(44)
  expect(padLayout.label).not.toBe('')
  expect(padLayout.noHorizontalScroll).toBe(true)
  expect(padLayout.clearOfViewControls).toBe(true)
  expect(padLayout.clearOfTraceDock).toBe(true)
  expect(
    padLayout.targets.every(({ width, height, topHit }) =>
      width >= 44 && height >= 44 && topHit
    ),
  ).toBe(true)

  await page.evaluate(() => window.TICITY.world!.shell.stop())
  const before = await cameraSnapshot(page)
  const box = await forward.boundingBox()
  if (!box) throw new Error('Forward camera movement control has no layout box')
  const pointer = {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  }
  await forward.dispatchEvent('pointerdown', pointer)
  await page.evaluate(() => window.TICITY.world!.shell.controls.update(0.05))
  await forward.dispatchEvent('pointerup', pointer)
  const moved = await cameraSnapshot(page)
  expect(distance3(moved.position, before.position)).toBeGreaterThan(1)

  await page.evaluate(() => window.TICITY.world!.shell.controls.update(0.05))
  const released = await cameraSnapshot(page)
  expect(distance3(released.position, moved.position)).toBeLessThan(0.001)
})

test('day is the default theme and the selected theme survives reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const root = page.locator('html')
  const theme = page.locator('[data-nav="theme"]')
  await expect(root).toHaveAttribute('data-theme', 'day')
  await expect(theme).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('ticity:theme'))).toBe('day')

  await theme.click()
  await expect(root).toHaveAttribute('data-theme', 'night')
  await expect(theme).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('ticity:theme'))).toBe('night')

  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(root).toHaveAttribute('data-theme', 'night')
  await expect(theme).toHaveAttribute('aria-pressed', 'true')
})

test('overview labels remain present without selection across visual updates', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const labels = page.locator('.tidb-world-label')
  const names = page.locator('.tidb-world-label strong')
  await expect(page.locator('.tidb-world-labels')).toBeVisible()
  await expect(page.locator('.tidb-inspector')).toBeHidden()
  await expect(labels).toHaveCount(9)
  expect(await names.allTextContents()).toEqual(expect.arrayContaining([
    'CLIENTS',
    'TiProxy',
    'TiDB SQL',
    'PD / TSO',
    'TiKV STORE 1',
    'TiKV STORE 2',
    'TiKV STORE 3',
    'MVCC GC',
    'TiFlash',
  ]))

  await page.evaluate(() => {
    window.TICITY.runScenario('hotspot-split')
    window.TICITY.setTheme('night')
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await expect(labels).toHaveCount(9)
  await expect(page.getByText('PD / TSO', { exact: true })).toBeVisible()
  await expect(page.getByText('TiFlash', { exact: true })).toBeVisible()
})

test('overview labels do not overlap in a short desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1_200, height: 630 })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  const verticalLayout = await page.evaluate(() => ({
    viewport: window.innerHeight,
    document: document.documentElement.scrollHeight,
  }))
  expect(verticalLayout.document).toBeLessThanOrEqual(verticalLayout.viewport + 1)

  const rectangles = await page.locator('.tidb-world-label').evaluateAll((labels) =>
    labels
      .filter((label) => {
        const element = label as HTMLElement
        return !element.hidden && getComputedStyle(element).display !== 'none'
      })
      .map((label) => {
        const rectangle = label.getBoundingClientRect()
        return {
          name: label.querySelector('strong')?.textContent ?? '',
          left: rectangle.left,
          right: rectangle.right,
          top: rectangle.top,
          bottom: rectangle.bottom,
        }
      }),
  )
  expect(rectangles.length).toBeGreaterThanOrEqual(8)

  const overlaps: string[] = []
  for (let left = 0; left < rectangles.length; left++) {
    for (let right = left + 1; right < rectangles.length; right++) {
      const horizontal =
        Math.min(rectangles[left].right, rectangles[right].right) -
        Math.max(rectangles[left].left, rectangles[right].left)
      const vertical =
        Math.min(rectangles[left].bottom, rectangles[right].bottom) -
        Math.max(rectangles[left].top, rectangles[right].top)
      // Fractional CSS pixels differ slightly across browser rasterizers.
      if (horizontal > 1 && vertical > 1) {
        overlaps.push(`${rectangles[left].name} / ${rectangles[right].name}`)
      }
    }
  }
  expect(overlaps).toEqual([])
})

test('trace replay keeps the causal route readable and supports transport controls', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => {
    window.TICITY.runScenario('cross-region-transaction')
  })

  const dock = page.locator('[data-trace-dock]')
  const eventCount = await page.evaluate(() => window.TICITY.trace?.events.length ?? 0)
  expect(eventCount).toBeGreaterThanOrEqual(32)
  await expect(dock).toBeVisible()
  await expect(dock).toHaveAttribute('data-event-count', String(eventCount))
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  expect(Number(await dock.getAttribute('data-presentation-duration-ms'))).toBeGreaterThan(6_000)
  await expect(page.locator('[data-trace-label]')).not.toBeEmpty()
  await expect(page.locator('[data-trace-route]')).toContainText('→')
  await expect(page.locator('[data-action="inspect"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-transaction-lab]')).toBeVisible()

  // One presentation second must not collapse the detailed trace.
  await page.evaluate(() => window.TICITY.world!.shell.flows.update(1))
  await expect(dock).not.toHaveAttribute('data-phase', 'complete')

  await page.locator('[data-action="trace-toggle"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  const pausedIndex = Number(await dock.getAttribute('data-event-index'))
  await page.evaluate(() => window.TICITY.world!.shell.flows.update(5))
  await expect(dock).toHaveAttribute('data-event-index', String(pausedIndex))

  await page.locator('[data-action="trace-next"]').click()
  await expect.poll(async () => Number(await dock.getAttribute('data-event-index')))
    .toBeGreaterThan(pausedIndex)
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  if (await page.locator('[data-trace-route]').getAttribute('data-local') === 'true') {
    await page.locator('[data-action="trace-next"]').click()
  }

  const visual = await page.evaluate(() => {
    const { city, flows } = window.TICITY.world!.shell
    return {
      guide: (flows.object.getObjectByName('trace-flow:route-guide') as {
        count?: number
      } | undefined)?.count ?? 0,
      endpoints: (flows.object.getObjectByName('trace-flow:endpoints') as {
        count?: number
      } | undefined)?.count ?? 0,
      networkOpacity: city.materials.dataLine.opacity,
      dropped: flows.dropped,
    }
  })
  expect(visual.guide).toBeGreaterThan(0)
  expect(visual.endpoints).toBe(2)
  expect(visual.networkOpacity).toBeLessThan(0.12)
  expect(visual.dropped).toBe(0)

  await page.locator('[data-action="trace-replay"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  await expect(dock).toHaveAttribute('data-event-index', '0')

  const loop = await page.evaluate(() => {
    const receipt = window.TICITY.trace
    if (!receipt) throw new Error('Expected an active TraceReceipt')
    const flows = window.TICITY.world!.shell.flows
    const receiptBefore = JSON.stringify(receipt)
    const presentationDurationBefore = flows.playback.durationMs

    flows.update(presentationDurationBefore / 1_000 + 1)
    const holding = {
      phase: flows.playback.phase,
      atEnd: flows.playback.atEnd,
      iteration: flows.playback.iteration,
      currentIndex: flows.playback.currentIndex,
      total: flows.playback.total,
    }

    // The longest end hold is 2.6 seconds for a failed trace. Advancing three
    // real seconds therefore starts the next presentation iteration.
    flows.update(3)
    return {
      holding,
      looped: {
        phase: flows.playback.phase,
        atEnd: flows.playback.atEnd,
        iteration: flows.playback.iteration,
        currentIndex: flows.playback.currentIndex,
        presentationDuration: flows.playback.durationMs,
      },
      sameReceiptReference: window.TICITY.trace === receipt,
      sameReceiptValue: JSON.stringify(window.TICITY.trace) === receiptBefore,
    }
  })
  expect(loop.holding).toEqual({
    phase: 'holding',
    atEnd: true,
    iteration: 1,
    currentIndex: loop.holding.total - 1,
    total: loop.holding.total,
  })
  expect(loop.looped).toMatchObject({
    phase: 'playing',
    atEnd: false,
    iteration: 2,
    currentIndex: 0,
  })
  expect(loop.looped.presentationDuration).toBeGreaterThan(6_000)
  expect(loop.sameReceiptReference).toBe(true)
  expect(loop.sameReceiptValue).toBe(true)
  await expect(dock).toHaveAttribute('data-looping', 'true')
  await expect(dock).toHaveAttribute('data-iteration', '2')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.locator('[data-action="trace-replay"]').click()
  await expect(dock).toHaveAttribute('data-iteration', '1')

  // A trace is historical presentation data: it can resume and replay even
  // while the deterministic workload remains held in model step mode.
  await page.evaluate(() => window.TICITY.model.setPlayback('step'))
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  await page.locator('[data-action="trace-toggle"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  await page.locator('[data-action="trace-replay"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  await expect(dock).toHaveAttribute('data-event-index', '0')
})

test('mobile reduced-motion keeps a static route and usable trace controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')

  const dock = page.locator('[data-trace-dock]')
  await expect(dock).toBeVisible()
  await expect(dock).toHaveAttribute('data-motion', 'reduced')
  await expect(dock).toHaveAttribute('data-looping', 'false')
  await expect(page.locator('[data-action="trace-loop"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.locator('[data-trace-label]')).not.toBeEmpty()
  await expect(page.locator('[data-trace-route]')).toBeVisible()

  const layout = await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('[data-trace-dock]')!
    const world = document.querySelector<HTMLElement>('.tidb-world')!
    const dockBox = dock.getBoundingClientRect()
    const worldBox = world.getBoundingClientRect()
    const controls = [...dock.querySelectorAll<HTMLButtonElement>('[data-action]')]
      .filter((control) => getComputedStyle(control).display !== 'none')
      .map((control) => {
        const box = control.getBoundingClientRect()
        return { width: box.width, height: box.height }
      })
    const flows = window.TICITY.world!.shell.flows
    const guideMesh = flows.object.getObjectByName('trace-flow:route-guide') as {
      count: number
      instanceMatrix: { array: ArrayLike<number> }
      instanceColor?: { array: ArrayLike<number> } | null
    }
    // Freeze the presentation clock so this assertion measures reduced-motion
    // rendering, not an incidental event-boundary transition.
    flows.setPaused(true)
    flows.update(0.05)
    const before = Array.from(flows.mesh.instanceMatrix.array.slice(0, 16))
    const guideBefore = Array.from(guideMesh.instanceMatrix.array).slice(
      0,
      guideMesh.count * 16,
    )
    const guideColorBefore = guideMesh.instanceColor
      ? Array.from(guideMesh.instanceColor.array).slice(0, guideMesh.count * 3)
      : []
    flows.update(0.1)
    const after = Array.from(flows.mesh.instanceMatrix.array.slice(0, 16))
    const guideAfter = Array.from(guideMesh.instanceMatrix.array).slice(
      0,
      guideMesh.count * 16,
    )
    const guideColorAfter = guideMesh.instanceColor
      ? Array.from(guideMesh.instanceColor.array).slice(0, guideMesh.count * 3)
      : []
    flows.setPaused(false)
    return {
      dockInsideWorld:
        dockBox.left >= worldBox.left - 1 &&
        dockBox.right <= worldBox.right + 1 &&
        dockBox.top >= worldBox.top - 1 &&
        dockBox.bottom <= worldBox.bottom + 1,
      controls,
      noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
      staticPacket: before.every((value, index) => value === after[index]),
      staticGuide:
        guideBefore.every((value, index) => value === guideAfter[index]) &&
        guideColorBefore.every((value, index) => value === guideColorAfter[index]),
      guide: guideMesh.count,
      endpoints: (flows.object.getObjectByName('trace-flow:endpoints') as {
        count?: number
      } | undefined)?.count ?? 0,
    }
  })
  expect(layout.dockInsideWorld).toBe(true)
  expect(layout.controls).toHaveLength(5)
  expect(layout.controls.every(({ width, height }) => width >= 44 && height >= 44)).toBe(true)
  expect(layout.noHorizontalScroll).toBe(true)
  expect(layout.staticPacket).toBe(true)
  expect(layout.staticGuide).toBe(true)
  expect(layout.guide).toBeGreaterThan(0)
  expect(layout.endpoints).toBe(2)
})

test('city rendering stays within the desktop frame budget', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  const metrics = await page.evaluate(() => {
    const renderer = window.TICITY.world?.shell.renderer
    if (!renderer) return null
    return {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? 0,
      pixelRatio: renderer.getPixelRatio(),
      backingPixels: renderer.domElement.width * renderer.domElement.height,
      cssPixels: renderer.domElement.clientWidth * renderer.domElement.clientHeight,
      dropped: window.TICITY.world?.shell.flows.dropped ?? 0,
    }
  })

  expect(metrics).not.toBeNull()
  if (!metrics) throw new Error('WebGL renderer did not start')
  // Broad ceilings catch multiplicative regressions without snapshotting
  // driver-specific renderer counters.
  expect(metrics.calls).toBeGreaterThan(0)
  expect(metrics.calls).toBeLessThanOrEqual(280)
  expect(metrics.triangles).toBeLessThanOrEqual(80_000)
  expect(metrics.geometries).toBeLessThanOrEqual(225)
  expect(metrics.programs).toBeLessThanOrEqual(32)
  expect(metrics.pixelRatio).toBeLessThanOrEqual(1.5)
  expect(metrics.backingPixels).toBeLessThanOrEqual(metrics.cssPixels * 2.25)
  expect(metrics.dropped).toBe(0)
})

test('SQL analysis stays local and does not retain a submitted literal', async ({ page }) => {
  const outbound: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:' &&
      url.hostname !== '127.0.0.1'
    ) {
      outbound.push(request.url())
    }
  })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const panel = page.locator('[data-action="panel"]')
  if (await panel.getAttribute('aria-expanded') === 'false') await panel.click()

  const secret = 'customer-secret-425'
  await page.locator('.tidb-sql-textarea').fill(
    `SELECT * FROM accounts WHERE note = '${secret}' AND id = 7`,
  )
  await page.locator('[data-action="analyze"]').click()
  await expect(page.locator('.tidb-sql-output')).toContainText('point_read')
  await page.locator('[data-locale="en"]').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  const retained = await page.evaluate(() => ({
    trace: JSON.stringify(window.TICITY.trace),
    storage: JSON.stringify({ ...localStorage }),
  }))
  expect(retained.trace).not.toContain(secret)
  expect(retained.storage).not.toContain(secret)
  expect(outbound).toEqual([])
})
