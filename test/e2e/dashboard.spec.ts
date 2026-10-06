// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { waitForRenderedFrames } from './helpers/render-frames'

const DASHBOARD = '[data-dashboard]'
const METRICS = '[data-dashboard-metrics]'
const TOGGLE = '[data-action="dashboard-toggle"]'
const METRIC_IDS = ['statements', 'commits', 'raft', 'regions', 'gc', 'tiflash'] as const

function value(page: Page, id: typeof METRIC_IDS[number]) {
  return page.locator(`[data-dashboard-metric="${id}"] [data-dashboard-value]`)
}

async function numericValue(page: Page, id: Exclude<typeof METRIC_IDS[number], 'regions'>): Promise<number> {
  const raw = await page.locator(`[data-dashboard-metric="${id}"]`).getAttribute('data-value')
  return raw === null || raw === '' ? Number.NaN : Number(raw)
}

async function expectModelGauges(page: Page): Promise<void> {
  const expected = await page.evaluate(() => {
    const state = window.TICITY.model.state
    return {
      healthy: state.regions.filter((region) => region.health === 'healthy').length,
      total: state.regions.length,
      gc: state.gc.backlog,
      tiflash: state.tiflash.available ? state.tiflash.lagSeconds : null,
    }
  })
  await expect.poll(async () => (await value(page, 'regions').textContent())?.replaceAll(/\s/g, ''))
    .toBe(`${expected.healthy}/${expected.total}`)
  await expect.poll(() => numericValue(page, 'gc')).toBe(expected.gc)
  if (expected.tiflash === null) {
    await expect(value(page, 'tiflash')).toHaveText('—')
  } else {
    await expect.poll(() => numericValue(page, 'tiflash')).toBeCloseTo(expected.tiflash, 1)
  }
}

async function chartSnapshot(page: Page): Promise<string[]> {
  return page.locator('[data-dashboard-sparkline]').evaluateAll((charts) =>
    charts.map((chart) => chart.innerHTML))
}

async function captureDashboard(page: Page, info: TestInfo, name: string): Promise<void> {
  const path = `artifacts/dashboard/${name}.png`
  // Submit two real renders at the unchanged graphics quality before copying
  // the image. Between captures, DOM/model assertions need no continuous
  // software-WebGL submissions. The actual renderer and context stay alive.
  await page.evaluate(() => window.TICITY.world?.shell.start())
  await waitForRenderedFrames(page, 2)
  await page.evaluate(() => window.TICITY.world?.shell.stop())
  await page.screenshot({ path })
  await info.attach(name, { path, contentType: 'image/png' })
}

test('City dashboard projects actual model work, holds paused history, and clears isolated scenarios and resets', async ({ page }) => {
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.hostname !== '127.0.0.1') {
      external.push(request.url())
    }
  })
  await page.goto('/?lang=en&appearance=tidb&theme=day')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => window.TICITY.world?.shell.stop())
  await expect(page.locator(DASHBOARD)).toBeVisible()
  await expect(page.locator(DASHBOARD)).toContainText('MODEL / SIMULATED')
  await expect(page.locator(METRICS)).toBeVisible()
  for (const id of METRIC_IDS) await expect(value(page, id)).toBeVisible()

  // Establish a model-time-zero baseline before advancing precisely one
  // second. Expectations come from the original cumulative model counters,
  // independently of the dashboard collector and its formatting.
  await page.evaluate(() => {
    window.TICITY.reset()
    window.TICITY.setControl('paused', true)
  })
  for (const id of ['statements', 'commits', 'raft'] as const) {
    await expect(value(page, id)).toHaveText('—')
  }
  await expectModelGauges(page)
  await expect(page.locator(DASHBOARD)).toHaveAttribute('data-model-time', '0')
  await expect(page.locator(DASHBOARD)).toHaveAttribute('data-sample-count', '1')
  const workload = await page.evaluate(() => {
    const before = window.TICITY.model.state
    window.TICITY.setControl('paused', false)
    window.TICITY.model.update(1)
    window.TICITY.setControl('paused', true)
    const after = window.TICITY.model.state
    const elapsed = after.t - before.t
    return {
      elapsed,
      statements: (after.metrics.statements - before.metrics.statements) / elapsed,
      commits: (after.metrics.commits - before.metrics.commits) / elapsed,
      raft: (after.metrics.raftEntries - before.metrics.raftEntries) / elapsed,
    }
  })
  expect(workload.elapsed).toBeCloseTo(1, 9)
  for (const id of ['statements', 'commits', 'raft'] as const) {
    await expect.poll(() => numericValue(page, id)).toBeCloseTo(workload[id], 9)
  }
  await expectModelGauges(page)
  await expect(page.locator(DASHBOARD)).toHaveAttribute('data-sample-count', '2')
  const beforePaused = await page.evaluate(() => ({
    state: JSON.stringify(window.TICITY.model.state),
    trace: JSON.stringify(window.TICITY.trace),
  }))
  const pausedCharts = await chartSnapshot(page)
  expect(pausedCharts).toHaveLength(6)
  // Waiting for real UI animation callbacks proves wall-clock time cannot
  // move model-time history while the model is paused.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  expect(await chartSnapshot(page)).toEqual(pausedCharts)
  await expect(page.locator(DASHBOARD)).toHaveAttribute('data-sample-count', '2')
  expect(await page.evaluate(() => ({
    state: JSON.stringify(window.TICITY.model.state),
    trace: JSON.stringify(window.TICITY.trace),
  }))).toEqual(beforePaused)

  const privateMarker = 'DASHBOARD_PRIVATE_SQL_425'
  const request = await page.evaluate((marker) => {
    const before = window.TICITY.model.state
    const submission = window.TICITY.submitSql(`SELECT * FROM accounts WHERE id = 425 /* ${marker} */`)
    const after = window.TICITY.model.state
    return {
      status: submission.analysis.status,
      sameTime: after.t === before.t,
      statementsAdded: after.metrics.statements - before.metrics.statements,
    }
  }, privateMarker)
  expect(request).toEqual({ status: 'supported', sameTime: true, statementsAdded: 1 })
  for (const id of ['statements', 'commits', 'raft'] as const) {
    await expect.poll(() => numericValue(page, id)).toBeCloseTo(workload[id], 9)
  }
  expect(await chartSnapshot(page)).toEqual(pausedCharts)
  await expect(page.locator(DASHBOARD)).not.toContainText(privateMarker)

  await page.evaluate(() => {
    window.TICITY.runScenario('tikv-failover')
    window.TICITY.setControl('paused', true)
  })
  for (const id of ['statements', 'commits', 'raft'] as const) {
    await expect(value(page, id)).toHaveText('—')
  }
  await expectModelGauges(page)
  await expect(page.locator(DASHBOARD)).toHaveAttribute('data-sample-count', '1')
  expect(await chartSnapshot(page)).not.toEqual(pausedCharts)
  await page.evaluate(() => {
    window.TICITY.reset()
    window.TICITY.setControl('paused', true)
  })
  for (const id of ['statements', 'commits', 'raft'] as const) {
    await expect(value(page, id)).toHaveText('—')
  }
  await expectModelGauges(page)
  await expect(page.locator(DASHBOARD)).toHaveAttribute('data-model-time', '0')
  await expect(page.locator(DASHBOARD)).toHaveAttribute('data-sample-count', '1')
  expect(await page.evaluate(() => window.TICITY.trace)).toBeNull()
  expect(errors).toEqual([])
  expect(external).toEqual([])
})

test('mobile dashboard expands with a keyboard and preserves reachable navigation, inspection, and movement controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('/?lang=en&appearance=tidb&theme=day&scenario=cross-region-transaction&event=trace-1-event-9')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => {
    window.TICITY.model.setPlayback('step')
    window.TICITY.world?.shell.stop()
  })
  const toggle = page.locator(TOGGLE)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator(METRICS)).toBeHidden()
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator(METRICS)).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-controls', 'tidb-dashboard-metrics')

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 667 })
    const fits = await page.evaluate(() => {
      const dashboard = document.querySelector<HTMLElement>('[data-dashboard]')!
      const nav = document.querySelector<HTMLElement>('.tidb-top-actions')!
      const dashboardBox = dashboard.getBoundingClientRect()
      const view = document.querySelector<HTMLElement>('.tidb-view-actions')!.getBoundingClientRect()
      const lab = document.querySelector<HTMLElement>('.tidb-transaction-lab:not([hidden])')
      const labBox = lab?.getBoundingClientRect()
      const toggle = document.querySelector<HTMLButtonElement>('[data-action="dashboard-toggle"]')!
      const toggleBox = toggle.getBoundingClientRect()
      return {
        documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
        navigationFits: nav.scrollWidth <= nav.clientWidth + 1,
        dashboardFits: dashboardBox.left >= 0 && dashboardBox.right <= innerWidth + 1,
        dashboardClearOfView: dashboardBox.bottom <= view.top + 1 || view.bottom <= dashboardBox.top + 1,
        labClearOfDashboard: !labBox || labBox.width === 0 || labBox.height === 0 ||
          labBox.top >= dashboardBox.bottom + 4,
        toggleTarget: toggleBox.width >= 44 && toggleBox.height >= 44 &&
          toggle.contains(document.elementFromPoint(
            toggleBox.left + toggleBox.width / 2, toggleBox.top + toggleBox.height / 2,
          )),
      }
    })
    expect(fits, `Expanded dashboard layout at ${width}px`).toEqual({
      documentFits: true, navigationFits: true, dashboardFits: true,
      dashboardClearOfView: true, labClearOfDashboard: true, toggleTarget: true,
    })
    await expect(page.locator('.tidb-top-actions [data-nav="city"]')).toBeVisible()
    await expect(page.locator('[data-nav="appearance"]')).toBeVisible()
    await expect(page.locator('[data-nav="theme"]')).toBeVisible()
  }

  await page.setViewportSize({ width: 390, height: 667 })
  await expect(page.locator('[data-transaction-lab]')).toBeHidden()
  await page.evaluate(() => window.TICITY.setView('fly'))
  const metrics = page.locator(METRICS)
  await metrics.focus()
  const scrollable = await metrics.evaluate((element) => element.scrollHeight > element.clientHeight + 1)
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      document.body.dataset.dashboardArrowPrevented = String(event.defaultPrevented)
    }, { once: true })
  })
  await metrics.press('ArrowDown')
  await expect(page.locator('body')).toHaveAttribute('data-dashboard-arrow-prevented', 'false')
  if (scrollable) await expect.poll(() => metrics.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => {
    window.TICITY.setView('orbit')
    document.querySelector<HTMLElement>('[data-dashboard-metrics]')!.scrollTop = 0
  })
  await captureDashboard(page, info, 'tidb-fresh-day-mobile-expanded')
  const help = page.locator('[data-dashboard-help]')
  await help.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(help).toHaveAttribute('open', '')
  await expect(help).toContainText('not live-cluster monitoring')
  await page.keyboard.press('Escape')
  await expect(help).not.toHaveAttribute('open')
  await expect(help.locator('summary')).toBeFocused()
  await expect(page.locator(METRICS)).toBeVisible()

  // Collapse before choosing Fly on a short screen; the original movement
  // controls must still have unobstructed touch targets below the toolbar.
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator(METRICS)).toBeHidden()
  await expect(page.locator('[data-transaction-lab]')).toBeVisible()
  await page.evaluate(() => window.TICITY.setInspect(false))
  await page.locator('[data-view="fly"]').click()
  const controls = await page.locator('.tidb-movement-pad button').evaluateAll((buttons) =>
    buttons.filter((button) => !(button as HTMLButtonElement).hidden).map((button) => {
      const box = button.getBoundingClientRect()
      return box.width >= 44 && box.height >= 44 && button.contains(document.elementFromPoint(
        box.left + box.width / 2, box.top + box.height / 2,
      ))
    }))
  expect(controls).toHaveLength(7)
  expect(controls.every(Boolean)).toBe(true)
  await page.locator('[data-view="orbit"]').click()
  await page.locator('[data-nav="theme"]').click()
  await toggle.click()
  await captureDashboard(page, info, 'tidb-fresh-night-mobile-expanded')
  expect(await page.evaluate(() => localStorage.getItem('ticity:dashboard-expanded'))).toBe('true')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator(TOGGLE)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator(METRICS)).toBeVisible()
})

test('dashboard keeps contrast, translated accessible controls, and the same City across both palettes and day/night', async ({ page }, info) => {
  await page.goto('/?lang=en&appearance=tidb&theme=day')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await page.evaluate(() => {
    window.TICITY.model.setPlayback('step')
    window.TICITY.world?.shell.stop()
  })
  const original = await page.evaluateHandle(() => ({
    world: window.TICITY.world,
    renderer: window.TICITY.world!.shell.renderer,
    canvas: window.TICITY.world!.shell.renderer.domElement,
    context: window.TICITY.world!.shell.renderer.getContext(),
    state: JSON.stringify(window.TICITY.model.state),
    trace: window.TICITY.trace,
    traceJson: JSON.stringify(window.TICITY.trace),
  }))
  try {
    await expect(page.locator(DASHBOARD)).toHaveAttribute('aria-label', 'Model dashboard')
    for (const appearance of ['tidb', 'classic'] as const) {
      for (const theme of ['day', 'night'] as const) {
        await page.evaluate(({ appearance, theme }) => {
          window.TICITY.setAppearance(appearance)
          window.TICITY.setTheme(theme)
        }, { appearance, theme })
        await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const help = page.locator('[data-dashboard-help]')
        await help.locator('summary').click()
        await expect(help).toHaveAttribute('open', '')
        const result = await new AxeBuilder({ page })
          .include(DASHBOARD)
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        expect(result.violations, `${appearance}/${theme}: ${JSON.stringify(result.violations, null, 2)}`)
          .toEqual([])
        await help.locator('summary').click()
        await expect(help).not.toHaveAttribute('open')
        await expect(page.locator(TOGGLE)).toHaveAttribute('aria-label', 'Hide model dashboard metrics')
        if (appearance === 'tidb' && theme === 'day' || appearance === 'classic' && theme === 'night') {
          await captureDashboard(page, info, `${appearance}-${theme}-desktop`)
        }
      }
    }
    await page.locator('[data-action="panel"]').click()
    await page.locator('[data-locale="ja"]').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.locator(DASHBOARD)).toHaveAttribute('aria-label', 'モデルダッシュボード')
    await expect(page.locator(TOGGLE)).toHaveAttribute('aria-label', 'モデルダッシュボードの指標を隠す')
    await expect(page.locator('[data-dashboard-help] summary')).toHaveText('指標の読み方')
    await expect(page.locator(DASHBOARD)).toContainText('GC backlog · バージョン')
    await expect(page.locator(DASHBOARD)).toContainText('MODEL / SIMULATED')
    const conserved = await original.evaluate((before) => ({
      world: window.TICITY.world === before.world,
      renderer: window.TICITY.world!.shell.renderer === before.renderer,
      canvas: window.TICITY.world!.shell.renderer.domElement === before.canvas,
      context: window.TICITY.world!.shell.renderer.getContext() === before.context,
      contextAvailable: !before.context.isContextLost(),
      state: JSON.stringify(window.TICITY.model.state) === before.state,
      trace: window.TICITY.trace === before.trace,
      traceData: JSON.stringify(window.TICITY.trace) === before.traceJson,
    }))
    expect(conserved).toEqual({
      world: true, renderer: true, canvas: true, context: true,
      contextAvailable: true, state: true, trace: true, traceData: true,
    })
  } finally {
    await original.dispose()
  }
})
