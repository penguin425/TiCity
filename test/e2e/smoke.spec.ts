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
  await expect(dock).toBeVisible()
  await expect(dock).toHaveAttribute('data-event-count', '31')
  await expect(dock).toHaveAttribute('data-phase', 'playing')
  expect(Number(await dock.getAttribute('data-presentation-duration-ms'))).toBeGreaterThan(6_000)
  await expect(page.locator('[data-trace-label]')).not.toBeEmpty()
  await expect(page.locator('[data-trace-route]')).toContainText('→')

  // One presentation second must no longer collapse a 31-event trace.
  await page.evaluate(() => window.TICITY.world!.shell.flows.update(1))
  await expect(dock).not.toHaveAttribute('data-phase', 'complete')

  await page.locator('[data-action="trace-toggle"]').click()
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  const pausedIndex = Number(await dock.getAttribute('data-event-index'))
  await page.evaluate(() => window.TICITY.world!.shell.flows.update(5))
  await expect(dock).toHaveAttribute('data-event-index', String(pausedIndex))

  await page.locator('[data-action="trace-next"]').click()
  await expect(dock).toHaveAttribute('data-event-index', String(pausedIndex + 1))
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
  expect(layout.controls).toHaveLength(4)
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
