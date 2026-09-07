// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from '@playwright/test'
import { AdditiveBlending, NormalBlending } from 'three'
import { waitForRenderedFrames } from './helpers/render-frames'

async function environmentSnapshot(page: Page) {
  return page.evaluate(() => {
    const { scene, city, renderer } = window.TICITY.world!.shell
    return {
      environment: scene.environment!.uuid,
      name: scene.environment!.name,
      blending: [city.materials.dataLine, city.materials.controlLine,
        city.materials.htapLine].map((material) => material.blending),
      glassMaps: [city.materials.glass.map, city.materials.glass.roughnessMap,
        city.materials.glass.bumpMap].map((texture) => texture?.name),
      memory: { ...renderer.info.memory },
    }
  })
}

test('outdoor reflections and readable route blending follow the theme without reallocating', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.TICITY?.world))
  await page.evaluate(() => {
    window.TICITY.model.setPlayback('step')
    window.TICITY.setTheme('day')
  })
  await waitForRenderedFrames(page, 2)
  const day = await environmentSnapshot(page)
  await expect(page.locator('[data-nav="theme"]')).toHaveAttribute('aria-pressed', 'false')
  expect(day.name).toBe('TiCity outdoor reflections: day')
  expect(day.blending).toEqual([NormalBlending, NormalBlending, NormalBlending])
  expect(day.glassMaps).toEqual([
    'architectural:glass:color', 'architectural:glass:roughness', 'architectural:glass:bump',
  ])

  await page.evaluate(() => window.TICITY.setTheme('night'))
  await waitForRenderedFrames(page, 2)
  const night = await environmentSnapshot(page)
  await expect(page.locator('[data-nav="theme"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-nav="theme"]')).toHaveAttribute('aria-label', '昼テーマに切り替える')
  expect(night.name).toBe('TiCity outdoor reflections: night')
  expect(night.environment).not.toBe(day.environment)
  expect(night.blending).toEqual([AdditiveBlending, AdditiveBlending, AdditiveBlending])

  await page.evaluate(() => window.TICITY.setTheme('day'))
  await waitForRenderedFrames(page, 2)
  expect((await environmentSnapshot(page)).environment).toBe(day.environment)
  await page.evaluate(() => window.TICITY.setTheme('night'))
  await waitForRenderedFrames(page, 2)
  const repeated = await environmentSnapshot(page)
  expect(repeated.environment).toBe(night.environment)
  expect(repeated.memory).toEqual(night.memory)
  expect(errors).toEqual([])
})

test.describe('high-DPI architectural surfaces', () => {
  test.use({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })

  test('retains night reflections across desktop and compact render paths', async ({ page }, info) => {
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
      window.TICITY.world!.focus('tidb.1')
    })
    await waitForRenderedFrames(page, 4)

    async function dimensions() {
      return page.evaluate(() => {
        const { renderer, scene } = window.TICITY.world!.shell
        const sun = scene.children.find((object) => object.type === 'DirectionalLight' &&
          object.castShadow) as import('three').DirectionalLight
        return {
          width: renderer.domElement.width,
          height: renderer.domElement.height,
          ratio: renderer.getPixelRatio(),
          shadow: sun.shadow.mapSize.x,
          environment: scene.environment!.uuid,
        }
      })
    }
    const desktop = await dimensions()
    expect(desktop).toMatchObject({ width: 2400, height: 1600, ratio: 2, shadow: 4096 })

    await page.setViewportSize({ width: 390, height: 844 })
    await waitForRenderedFrames(page, 4)
    const compact = await dimensions()
    expect(compact).toMatchObject({ width: 487, height: 1055, ratio: 1.25, shadow: 2048,
      environment: desktop.environment })

    await page.setViewportSize({ width: 1200, height: 800 })
    await waitForRenderedFrames(page, 4)
    expect(await dimensions()).toEqual(desktop)
    await page.evaluate(() => window.TICITY.world!.shell.stop())
    try {
      await page.screenshot({ path: info.outputPath('architecture-night-2x.png') })
    } finally {
      await page.evaluate(() => window.TICITY.world!.shell.start())
    }
    expect(errors).toEqual([])
  })
})
