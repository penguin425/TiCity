// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { BufferGeometry, Material, Mesh, MeshStandardMaterial } from 'three'

import { waitForRenderedFrames } from './helpers/render-frames'

const PALETTE = 'select[data-nav="appearance"]'

async function expectPalette(page: Page, appearance: 'tidb' | 'classic'): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance)
  await expect(page.locator(PALETTE)).toHaveValue(appearance)
}

async function captureSettledFrame(page: Page, info: TestInfo, name: string): Promise<void> {
  // Pausing only the image readback avoids submitting more software-WebGL
  // work while the screenshot is being copied. Model and quality stay intact.
  const path = `artifacts/appearance/${name}.png`
  await page.evaluate(() => window.TICITY.world?.shell.stop())
  try {
    await page.screenshot({ path })
    await info.attach(name, { path, contentType: 'image/png' })
  } finally {
    await page.evaluate(() => window.TICITY.world?.shell.start())
  }
}

async function expectMobileNavigationFits(page: Page): Promise<void> {
  const layout = await page.locator('.tidb-top-actions').evaluate((nav) => {
    const visibleControls = [...nav.querySelectorAll<HTMLElement>('a, button, select')]
      .filter((control) => control.getBoundingClientRect().width > 0)
    const lab = document.querySelector<HTMLElement>('.tidb-transaction-lab:not([hidden])')
    const actions = document.querySelector<HTMLElement>('.tidb-view-actions')
    return {
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
      navigationFits: nav.scrollWidth <= nav.clientWidth + 1,
      controlsFit: visibleControls.every((control) => {
        const box = control.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth + 1
      }),
      labClear: !lab || !actions || lab.getBoundingClientRect().top >= actions.getBoundingClientRect().bottom + 4,
    }
  })
  expect(layout).toEqual({ documentFits: true, navigationFits: true, controlsFit: true, labClear: true })
  await expect(page.locator(PALETTE)).toBeVisible()
  await expect(page.locator('[data-nav="theme"]')).toBeVisible()
  await expect(page.locator('.tidb-top-actions [data-nav="city"]')).toBeVisible()
}

test('palette and day/night changes reuse the City and preserve its trace, state, and semantic colours', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const contexts = new Set<unknown>()
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = getContext.apply(this, args)
      if (context && ['webgl', 'webgl2', 'experimental-webgl'].includes(args[0])) {
        contexts.add(context)
      }
      return context
    } as typeof getContext
    Object.defineProperty(window, '__appearanceWebGLContextCount', {
      get: () => contexts.size,
    })
  })
  await page.goto('/?lang=en&theme=day')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'tidb')
  await page.evaluate(() => window.TICITY.model.setPlayback('step'))
  await waitForRenderedFrames(page)

  // Keep real references in the browser rather than inferring reuse merely
  // from stable counts. A new renderer or replacement resources must fail.
  const original = await page.evaluateHandle(() => {
    const shell = window.TICITY.world!.shell
    const geometries = new Set<BufferGeometry>()
    const materials = new Set<Material>()
    shell.scene.traverse((object) => {
      const mesh = object as Mesh
      if (mesh.geometry) geometries.add(mesh.geometry)
      if (mesh.material) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(material)
        }
      }
    })
    let contextLost = false
    shell.renderer.domElement.addEventListener('webglcontextlost', () => { contextLost = true })
    return {
      world: window.TICITY.world,
      shell,
      renderer: shell.renderer,
      canvas: shell.renderer.domElement,
      context: shell.renderer.getContext(),
      trace: window.TICITY.trace,
      traceJson: JSON.stringify(window.TICITY.trace),
      stateJson: JSON.stringify(window.TICITY.model.state),
      geometries,
      materials,
      contextCount: (window as typeof window & { __appearanceWebGLContextCount: number })
        .__appearanceWebGLContextCount,
      get contextLost() { return contextLost },
    }
  })
  expect(await original.evaluate((before) => before.contextCount)).toBeGreaterThan(0)

  const colourSnapshot = () => page.evaluate(() => {
    const { city } = window.TICITY.world!.shell
    return {
      structure: city.materials.structure.color.getHex(),
      ground: (city.ground.material as MeshStandardMaterial).color.getHex(),
      txn2pc: city.materials.txn2pc.color.getHex(),
      raft: city.materials.raft.color.getHex(),
      client: city.materials.client.color.getHex(),
      clientUi: getComputedStyle(document.documentElement).getPropertyValue('--domain-client').trim(),
      modelAccent: getComputedStyle(document.querySelector<HTMLElement>('.tidb-surface')!)
        .getPropertyValue('--tc-model-accent').trim(),
    }
  })
  const expectOriginalCity = async () => {
    const unchanged = await original.evaluate((before) => {
      const shell = window.TICITY.world!.shell
      const geometries = new Set<BufferGeometry>()
      const materials = new Set<Material>()
      shell.scene.traverse((object) => {
        const mesh = object as Mesh
        if (mesh.geometry) geometries.add(mesh.geometry)
        if (mesh.material) {
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            materials.add(material)
          }
        }
      })
      return {
        world: window.TICITY.world === before.world,
        shell: shell === before.shell,
        renderer: shell.renderer === before.renderer,
        canvas: shell.renderer.domElement === before.canvas,
        context: shell.renderer.getContext() === before.context,
        contextAvailable: !before.contextLost && !shell.renderer.getContext().isContextLost(),
        noAdditionalContext: (window as typeof window & { __appearanceWebGLContextCount: number })
          .__appearanceWebGLContextCount === before.contextCount,
        trace: window.TICITY.trace === before.trace,
        traceData: JSON.stringify(window.TICITY.trace) === before.traceJson,
        state: JSON.stringify(window.TICITY.model.state) === before.stateJson,
        geometries: geometries.size === before.geometries.size &&
          [...geometries].every((geometry) => before.geometries.has(geometry)),
        materials: materials.size === before.materials.size &&
          [...materials].every((material) => before.materials.has(material)),
      }
    })
    expect(unchanged).toEqual({
      world: true, shell: true, renderer: true, canvas: true, context: true,
      contextAvailable: true, noAdditionalContext: true, trace: true, traceData: true, state: true,
      geometries: true, materials: true,
    })
    await expect(page.locator('.tidb-world canvas')).toHaveCount(1)
  }

  try {
    const freshDay = await colourSnapshot()
    await captureSettledFrame(page, info, 'tidb-fresh-day-desktop')
    const select = page.locator(PALETTE)
    await select.focus()
    await select.selectOption('classic')
    await expectPalette(page, 'classic')
    await expect(select).toBeFocused()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
    await waitForRenderedFrames(page)
    const classicDay = await colourSnapshot()
    expect(classicDay.structure).not.toBe(freshDay.structure)
    expect(classicDay.ground).not.toBe(freshDay.ground)
    expect([classicDay.txn2pc, classicDay.raft, classicDay.client, classicDay.clientUi, classicDay.modelAccent])
      .toEqual([freshDay.txn2pc, freshDay.raft, freshDay.client, freshDay.clientUi, freshDay.modelAccent])
    await expectOriginalCity()
    await captureSettledFrame(page, info, 'classic-day-desktop')

    await page.locator('[data-nav="theme"]').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
    await expectPalette(page, 'classic')
    await waitForRenderedFrames(page)
    const classicNight = await colourSnapshot()
    await expectOriginalCity()

    await page.evaluate(() => window.TICITY.setAppearance('tidb'))
    await expectPalette(page, 'tidb')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
    await waitForRenderedFrames(page)
    const freshNight = await colourSnapshot()
    expect(freshNight.structure).not.toBe(classicNight.structure)
    expect(freshNight.ground).not.toBe(classicNight.ground)
    expect([freshNight.txn2pc, freshNight.raft, freshNight.client, freshNight.clientUi, freshNight.modelAccent])
      .toEqual([classicNight.txn2pc, classicNight.raft, classicNight.client, classicNight.clientUi, classicNight.modelAccent])
    await expectOriginalCity()
    await captureSettledFrame(page, info, 'tidb-fresh-night-desktop')

    await page.evaluate(() => window.TICITY.setTheme('day'))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
    await expectPalette(page, 'tidb')
    await waitForRenderedFrames(page)
    expect(await colourSnapshot()).toEqual(freshDay)
    await expectOriginalCity()
    expect(errors).toEqual([])
  } finally {
    await original.dispose()
  }
})

test('palette defaults to TiDB Fresh, persists through real surface navigation, and honours a shared URL', async ({ page }) => {
  await page.goto('/?lang=ja')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'tidb')
  await expect(page.locator(PALETTE)).toHaveAttribute('aria-label', '配色')
  await page.locator(PALETTE).selectOption('classic')
  expect(await page.evaluate(() => localStorage.getItem('ticity:appearance'))).toBe('classic')

  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'classic')
  await page.locator('.tidb-top-actions [data-nav="machine"]').click()
  await expect(page).toHaveURL(/\/machine\//)
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'classic')
  await expect(page.locator(PALETTE)).toHaveAttribute('aria-label', '配色')
  await page.locator('.tidb-top-actions [data-nav="diagnose"]').click()
  await expect(page).toHaveURL(/\/diagnose\//)
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'classic')

  // An explicit shared URL must win over the saved choice. The other display
  // dimension remains independent, including on the non-WebGL surfaces.
  await page.goto('/diagnose/?lang=en&appearance=tidb&theme=night')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'tidb')
  await expect(page.locator(PALETTE)).toHaveAttribute('aria-label', 'Palette')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  expect(await page.evaluate(() => localStorage.getItem('ticity:appearance'))).toBe('tidb')
  await page.locator('.tidb-top-actions [data-nav="machine"]').click()
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'tidb')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')

  // Switching a choice on a URL with explicit display parameters must also
  // update that URL; otherwise its old values would undo the choice on reload.
  await page.locator(PALETTE).selectOption('classic')
  await page.locator('[data-nav="theme"]').click()
  await expectPalette(page, 'classic')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
  const updated = new URL(page.url())
  expect(updated.searchParams.get('appearance')).toBe('classic')
  expect(updated.searchParams.get('theme')).toBe('day')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expectPalette(page, 'classic')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
  await expect(page.locator(PALETTE)).toHaveAttribute('aria-label', 'Palette')
})

test('TiDB Fresh keeps mobile navigation reachable and WCAG contrast on every surface in day and night', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const surface of ['city', 'machine', 'diagnose'] as const) {
    const path = surface === 'city' ? '/' : `/${surface}/`
    await page.goto(`${path}?lang=en&appearance=tidb&theme=day&scenario=cross-region-transaction&event=trace-1-event-9`)
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
    await expectPalette(page, 'tidb')
    if (surface === 'city') await waitForRenderedFrames(page)

    if (surface === 'city') {
      // The scrollable lab must keep arrow-key access even in a movement mode.
      await page.evaluate(() => window.TICITY.setView('fly'))
      const lab = page.locator('[data-transaction-lab]')
      await lab.focus()
      await page.evaluate(() => {
        window.addEventListener('keydown', (event) => {
          document.body.dataset.labArrowPrevented = String(event.defaultPrevented)
        }, { once: true })
      })
      await lab.press('ArrowDown')
      await expect(page.locator('body')).toHaveAttribute('data-lab-arrow-prevented', 'false')
      await expect.poll(() => lab.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
      await page.evaluate(() => {
        window.TICITY.setView('orbit')
        document.querySelector<HTMLElement>('[data-transaction-lab]')!.scrollTop = 0
      })
    }

    for (const theme of ['day', 'night'] as const) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.locator('[data-nav="theme"]').click()
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expectPalette(page, 'tidb')
      await expectMobileNavigationFits(page)
      if (surface === 'city') {
        await waitForRenderedFrames(page)
        await page.evaluate(() => window.TICITY.world!.shell.stop())
      }
      try {
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        expect(result.violations, `${surface} / ${theme}: ${JSON.stringify(result.violations, null, 2)}`)
          .toEqual([])
      } finally {
        if (surface === 'city') await page.evaluate(() => window.TICITY.world!.shell.start())
      }
      if (surface === 'city') {
        await captureSettledFrame(page, info, `tidb-fresh-${theme}-mobile`)
      }
    }
    await page.setViewportSize({ width: 320, height: 844 })
    await expectMobileNavigationFits(page)
    await page.setViewportSize({ width: 390, height: 844 })
  }
})
