// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1] ?? fallback
}
const baseURL = option('--base-url', 'http://127.0.0.1:4173')
const siteURL = new URL(baseURL.endsWith('/') ? baseURL : `${baseURL}/`)
const directory = resolve(option('--output', 'artifacts/graphics'))
await mkdir(directory, { recursive: true })

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const failures = []
  page.on('pageerror', (error) => failures.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('3D world unavailable')) {
      failures.push(message.text())
    }
  })
  async function settle() {
    await page.evaluate(() => new Promise((done) => {
      const renderer = window.TICITY.world.shell.renderer
      const targetFrame = renderer.info.render.frame + 5
      function frame() {
        if (renderer.info.render.frame >= targetFrame) done()
        else requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }))
  }
  async function open(path = '/') {
    // Keep a deployment prefix such as /TiCity/ when capturing GitHub Pages.
    await page.goto(new URL(path.replace(/^\/+/, ''), siteURL).href)
    await page.waitForFunction(() => Boolean(window.TICITY?.world))
    await page.evaluate(() => {
      window.TICITY.model.setPlayback('step')
    })
    await settle()
  }
  async function capture(name) {
    await settle()
    // Freeze the settled frame so software WebGL can finish compositing the
    // high-quality image without competing with another animation frame.
    await page.evaluate(() => window.TICITY.world.shell.stop())
    try {
      await page.screenshot({ path: resolve(directory, `${name}.png`) })
    } finally {
      await page.evaluate(() => window.TICITY.world.shell.start())
    }
    console.log(name, await page.evaluate(() => {
      const { renderer } = window.TICITY.world.shell
      return { ...renderer.info.render, ...renderer.info.memory,
        programs: renderer.info.programs.length, pixelRatio: renderer.getPixelRatio() }
    }))
  }

  async function theme(next) {
    if (await page.locator('html').getAttribute('data-theme') !== next) {
      // Keep the control's next-theme label synchronized in saved images.
      await page.locator('[data-nav="theme"]').click()
    }
  }

  await open('/')
  await theme('day')
  await capture('city-day')
  await theme('night')
  await capture('city-night')
  await theme('day')
  await page.evaluate(() => window.TICITY.world.focus('tidb.1'))
  await capture('architecture-detail')
  await page.evaluate(() => window.TICITY.world.focus('tikv.1'))
  await capture('region-detail')

  await page.setViewportSize({ width: 390, height: 844 })
  await open('/')
  await theme('day')
  await capture('city-mobile')

  if (args.includes('--labs')) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    for (const [scenario, event] of [
      ['cross-region-transaction', 28], ['lock-deadlock', 9], ['tikv-failover', 16],
      ['commit-protocols', 32], ['gc-safe-point', 22], ['tiflash-mpp', 37],
    ]) {
      await open(`/?scenario=${scenario}&event=trace-1-event-${event}`)
      await page.evaluate(() => window.TICITY.setInspect(true))
      await capture(`lab-${scenario}`)
    }
  }
  if (failures.length) throw new Error(failures.join('\n'))
  console.log(`Graphics captures saved to ${directory}`)
} finally {
  await browser.close()
}
