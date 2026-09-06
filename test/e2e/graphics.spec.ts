// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from '@playwright/test'
import type { DirectionalLight } from 'three'

async function frames(page: Page, count = 4): Promise<void> {
  await page.evaluate((count) => new Promise<void>((resolve) => {
    function next(): void {
      if (--count <= 0) resolve()
      else requestAnimationFrame(next)
    }
    requestAnimationFrame(next)
  }), count)
}

async function captureSettledFrame(page: Page, path: string): Promise<void> {
  // The assertions above/below still exercise live frames. Pause only while
  // software WebGL reads back the settled image, avoiding GPU queue starvation.
  await page.evaluate(() => window.TICITY.world!.shell.stop())
  try {
    await page.screenshot({ path })
  } finally {
    await page.evaluate(() => window.TICITY.world!.shell.start())
  }
}

test('night retains its lighting with reduced motion and releases the renderer', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.TICITY?.world))
  await page.evaluate(() => {
    window.TICITY.model.setPlayback('step')
    window.TICITY.setTheme('night')
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await frames(page)
  const before = await page.evaluate(() => {
    const shell = window.TICITY.world!.shell
    return {
      stars: shell.city.root.getObjectByName('city:stars')!.rotation.y,
      clouds: shell.city.root.getObjectByName('city:clouds')!.rotation.y,
      memory: { ...shell.renderer.info.memory },
    }
  })
  await frames(page, 8)
  const after = await page.evaluate(() => {
    const shell = window.TICITY.world!.shell
    const sun = shell.scene.children.find((object) =>
      object.type === 'DirectionalLight' && object.castShadow,
    ) as DirectionalLight | undefined
    return {
      stars: shell.city.root.getObjectByName('city:stars')!.rotation.y,
      clouds: shell.city.root.getObjectByName('city:clouds')!.rotation.y,
      memory: { ...shell.renderer.info.memory },
      calls: shell.renderer.info.render.calls,
      triangles: shell.renderer.info.render.triangles,
      shadow: shell.renderer.shadowMap.enabled,
      shadowSize: sun?.shadow.mapSize.x,
      reflections: Boolean(shell.scene.environment),
    }
  })
  expect(after.stars).toBe(before.stars)
  expect(after.clouds).toBe(before.clouds)
  expect(after.memory).toEqual(before.memory)
  expect(after.reflections).toBe(true)
  expect(after.shadow).toBe(true)
  expect(after.shadowSize).toBe(4096)
  // These counters must include the scene, not merely the final fullscreen
  // output quad. The same bounded pipeline serves both motion preferences.
  expect(after.calls).toBeGreaterThan(100)
  expect(after.calls).toBeLessThanOrEqual(280)
  expect(after.triangles).toBeGreaterThan(20_000)
  // Real bevels, curtain walls and layered canopies deliberately spend more
  // triangles; the depth-based AO must not draw the campus a second time.
  expect(after.triangles).toBeLessThanOrEqual(140_000)
  await captureSettledFrame(page, info.outputPath('night-reduced-motion.png'))

  const teardown = await page.evaluate(() => {
    const shell = window.TICITY.world!.shell
    shell.dispose()
    shell.dispose()
    return { canvasAttached: shell.renderer.domElement.isConnected,
      environment: shell.scene.environment }
  })
  expect(teardown).toEqual({ canvasAttached: false, environment: null })
  expect(errors).toEqual([])
})

test('portrait opens on a full city with unobstructed touch controls', async ({ page }, info) => {
  for (const height of [844, 620]) {
    await page.setViewportSize({ width: 390, height })
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.TICITY?.world))
    await expect(page.locator('.tidb-layout')).toHaveAttribute('data-panel', 'closed')
    await frames(page)
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('.tidb-world canvas')!.getBoundingClientRect()
      const dock = document.querySelector('[data-trace-dock]')!.getBoundingClientRect()
      return { canvasHeight: canvas.height, dockBottom: dock.bottom,
        scrollHeight: document.documentElement.scrollHeight,
        height: innerHeight }
    })
    expect(layout.canvasHeight).toBe(layout.height)
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height + 1)
    expect(layout.dockBottom).toBeLessThanOrEqual(layout.height)
    await captureSettledFrame(page, info.outputPath(`portrait-${height}.png`))
    await page.locator('[data-view="fly"]').click()
    await expect(page.locator('.tidb-status-strip')).toBeHidden()
    const reachable = await page.locator('[data-camera-move="forward"]').evaluate((button) => {
      const bounds = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(
        bounds.x + bounds.width / 2, bounds.y + bounds.height / 2,
      ))
    })
    expect(reachable).toBe(true)
  }
})

test('selection follows a growing rack and refreshes its role without reselection', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.TICITY?.world))
  await page.evaluate(() => {
    window.TICITY.model.setPlayback('step')
    window.TICITY.world!.shell.picker.select('region.0.peer.0')
  })
  await expect(page.locator('.tidb-inspector p')).toHaveText('Raft leader voter')
  const initialY = await page.evaluate(() =>
    window.TICITY.world!.shell.picker.object.getObjectByName('selection:ring')!.position.y,
  )
  await page.evaluate(() => {
    // Exercise a new renderer snapshot without changing the simulation or
    // starting a scenario that intentionally changes the user's selection.
    const state = structuredClone(window.TICITY.model.state)
    state.regions[0].leaderStoreId = 'tikv-2'
    state.regions[0].hotScore = 100
    window.TICITY.world!.shell.city.updateState(state)
  })
  await frames(page)
  await expect(page.locator('.tidb-inspector p')).toHaveText('Raft follower voter')
  const selection = await page.evaluate(() => {
    const { picker } = window.TICITY.world!.shell
    return { y: picker.object.getObjectByName('selection:ring')!.position.y,
      anchorY: picker.selected!.anchor.y }
  })
  expect(selection.y).toBeGreaterThan(initialY)
  expect(selection.y).toBeGreaterThan(selection.anchorY)
})
