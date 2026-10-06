// SPDX-License-Identifier: Apache-2.0

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { createTiDBSimulation } from '../../src/tidb/model'

// Resolve stable model identifiers without relying on a presentation index.
const fixture = createTiDBSimulation({ seed: 425 }).runScenario('tiflash-mpp')
const selected = fixture.events.find((event) =>
  event.kind === 'tiflash_learner_apply_command' && event.regionId === 25)
if (!selected?.presentationAfter || selected.dependsOn?.length !== 1) {
  throw new Error('Expected independent learner apply with a presentation fence')
}
const EVENT_ID = selected.id
const PARENT_ID = selected.dependsOn[0]
const FENCE_ID = selected.presentationAfter
const SCENARIO = 'tiflash-mpp'
const PINS = [
  'd13e52ed6e22cc5789bed7c64c861578cd2ed55b',
  '6e12ba23c70f358f2ffbee837feac24118a3e988',
] as const

function recordExternalRequests(page: Page): string[] {
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol !== 'data:' && url.protocol !== 'blob:' && url.hostname !== '127.0.0.1') {
      requests.push(request.url())
    }
  })
  return requests
}

async function expectFixedSources(inspector: Locator): Promise<void> {
  const links = inspector.locator('[data-inspector-source]')
  await expect(links).toHaveCount(2)
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')!))
  for (const [index, href] of hrefs.entries()) {
    expect(href).toContain(`/blob/${PINS[index]}/`)
    expect(new URL(href).origin).toBe('https://github.com')
    expect(new URL(href).search).toBe('')
  }
}

async function expectSeparatedFence(inspector: Locator): Promise<void> {
  await expect(inspector).toHaveAttribute('data-inspector-event-id', EVENT_ID)
  await expect(inspector).toHaveAttribute('data-inspector-source-group', 'tiflash')
  await expect(inspector.locator('[data-inspector-relation="parent"]')).toHaveCount(1)
  await expect(inspector.locator('[data-inspector-relation="parent"]'))
    .toHaveAttribute('data-inspector-select', PARENT_ID)
  await expect(inspector.locator('[data-inspector-relation="fence"]'))
    .toHaveAttribute('data-inspector-select', FENCE_ID)
  await expect(inspector.locator(`[data-inspector-relations="parent"] [data-inspector-select="${FENCE_ID}"]`))
    .toHaveCount(0)
}

test('Machine inspector separates causal edges from fences and pauses for keyboard navigation', async ({ page }) => {
  const external = recordExternalRequests(page)
  await page.goto(`/machine/?lang=en&scenario=${SCENARIO}&event=${EVENT_ID}`)
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const inspector = page.locator('[data-trace-inspector]')
  await expect(inspector).toHaveAttribute('open', '')
  await expectSeparatedFence(inspector)
  await expect(inspector).toContainText('Reference implementations for this model')
  await expect(inspector).toContainText('excluded from causal parents and children')
  await expectFixedSources(inspector)

  await page.locator('[data-action="play"]').click()
  await expect(page.locator('[data-action="play"]')).toHaveAttribute('aria-pressed', 'true')
  await inspector.locator('summary').focus()
  await expect(page.locator('[data-action="play"]')).toHaveAttribute('aria-pressed', 'false')
  await inspector.locator('[data-inspector-relation="parent"]').focus()
  await page.keyboard.press('Enter')
  await expect(inspector).toHaveAttribute('data-inspector-event-id', PARENT_ID)
  await expect(inspector.locator('summary')).toBeFocused()
  await inspector.locator(`[data-inspector-relations="child"] [data-inspector-select="${EVENT_ID}"]`).click()
  await expectSeparatedFence(inspector)
  await inspector.locator('[data-inspector-relation="fence"]').click()
  await expect(inspector).toHaveAttribute('data-inspector-event-id', FENCE_ID)
  await expect(page.locator(`[data-event-id="${FENCE_ID}"]`)).toHaveAttribute('aria-current', 'step')
  expect(external).toEqual([])
})

test('Diagnose Japanese inspector keeps causal cursor navigation in the same scenario and locale', async ({ page }) => {
  const external = recordExternalRequests(page)
  await page.goto(`/diagnose/?lang=ja&scenario=${SCENARIO}&event=${EVENT_ID}`)
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const inspector = page.locator('[data-trace-inspector]')
  await expectSeparatedFence(inspector)
  await expect(inspector).toContainText('直接の因果親')
  await expect(inspector).toContainText('行単位の対応ではありません')
  await expectFixedSources(inspector)
  await inspector.locator('[data-inspector-relation="parent"]').click()
  await expect(inspector).toHaveAttribute('data-inspector-event-id', PARENT_ID)
  await inspector.locator(`[data-inspector-relations="child"] [data-inspector-select="${EVENT_ID}"]`).click()
  await expectSeparatedFence(inspector)
  await inspector.locator('[data-inspector-relation="fence"]').click()
  await expect(inspector).toHaveAttribute('data-inspector-event-id', FENCE_ID)
  const url = new URL(page.url())
  expect(Object.fromEntries(url.searchParams)).toEqual({
    event: FENCE_ID,
    scenario: SCENARIO,
    lang: 'ja',
    theme: 'day',
    appearance: 'tidb',
  })
  await expect(page.locator('select[aria-label="投影するイベント時点"]')).toHaveValue(FENCE_ID)
  expect(external).toEqual([])
})

test('City inspector keeps focus, touch controls, and clear mobile and midsize layouts', async ({ page }) => {
  const external = recordExternalRequests(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/?lang=en&scenario=${SCENARIO}&event=${EVENT_ID}`)
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true', { timeout: 15_000 })
  const inspector = page.locator('[data-trace-inspector]')
  await expect(inspector).not.toHaveAttribute('open')
  await inspector.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(inspector).toHaveAttribute('open', '')
  await expectSeparatedFence(inspector)
  await expectFixedSources(inspector)
  // Resume and focus in one browser task: focusin must pause the playback
  // before a rendered frame can replace the focused Inspector control.
  await page.evaluate(() => {
    const toggle = document.querySelector<HTMLElement>('[data-action="trace-toggle"]')!
    // A synthetic click does not transfer focus as a pointer click would.
    // Move it explicitly so returning to the summary really emits focusin.
    toggle.focus()
    toggle.click()
    document.querySelector<HTMLElement>('[data-trace-inspector] summary')!.focus()
  })
  await expect(page.locator('[data-trace-dock]')).toHaveAttribute('data-phase', 'paused')
  // Touch and accessible activation may leave focus on the summary. Opening
  // or closing it must still pause, without relying on a new focusin event.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-action="trace-toggle"]')!.click()
    document.querySelector<HTMLElement>('[data-trace-inspector] summary')!.click()
  })
  await expect(page.locator('[data-trace-dock]')).toHaveAttribute('data-phase', 'paused')
  await expect(inspector).not.toHaveAttribute('open')
  await inspector.locator('summary').click()
  await expect(inspector).toHaveAttribute('open', '')
  await inspector.locator('[data-inspector-relation="fence"]').click()
  await expect(inspector).toHaveAttribute('data-inspector-event-id', FENCE_ID)
  await expect(inspector).toHaveAttribute('open', '')
  await expect(inspector.locator('summary')).toBeFocused()
  await expect(page.locator('[data-trace-dock]')).toHaveAttribute('data-phase', 'paused')
  const fits = await inspector.evaluate((node) => {
    const box = node.getBoundingClientRect()
    return box.left >= 0 && box.right <= window.innerWidth + 1 &&
      document.documentElement.scrollWidth <= window.innerWidth + 1
  })
  expect(fits).toBe(true)
  const mobileControls = await page.locator('[data-trace-dock]').evaluate((node) => ({
    widths: [...node.querySelectorAll('.tidb-trace-playback__controls button')]
      .map((button) => button.getBoundingClientRect().width),
    labelWidth: node.querySelector('.tidb-trace-playback__label')!.getBoundingClientRect().width,
  }))
  expect(mobileControls.widths).toHaveLength(5)
  expect(mobileControls.widths.every((width) => width >= 45)).toBe(true)
  expect(mobileControls.labelWidth).toBeGreaterThanOrEqual(200)
  const accessibility = await new AxeBuilder({ page }).include('[data-trace-inspector]').analyze()
  expect(accessibility.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'))
    .toEqual([])

  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(page.locator('[data-tiflash-mpp-lab]')).toBeVisible()
  for (const open of [true, false]) {
    if ((await inspector.getAttribute('open') !== null) !== open) {
      await inspector.locator('summary').click()
    }
    const layout = await page.evaluate(() => {
      const lab = document.querySelector('[data-tiflash-mpp-lab]')!.getBoundingClientRect()
      const dock = document.querySelector('[data-trace-dock]')!.getBoundingClientRect()
      return {
        separated: lab.right <= dock.left + 1 || dock.right <= lab.left + 1,
        visibleLab: lab.width > 0 && lab.height > 0,
        fits: dock.top >= 0 && dock.bottom <= innerHeight + 1 && dock.right <= innerWidth + 1,
        buttons: [...document.querySelectorAll('.tidb-trace-playback__controls button')]
          .map((button) => {
            const box = button.getBoundingClientRect()
            return { width: box.width, height: box.height }
          }),
        labelWidth: document.querySelector('.tidb-trace-playback__label')!.getBoundingClientRect().width,
      }
    })
    expect(layout.visibleLab).toBe(true)
    expect(layout.separated, `Lab and dock overlap at 1024px with Inspector open=${open}`).toBe(true)
    expect(layout.fits).toBe(true)
    expect(layout.buttons).toHaveLength(5)
    expect(layout.buttons.every((button) => button.width >= 45 && button.height >= 44)).toBe(true)
    expect(layout.labelWidth).toBeGreaterThanOrEqual(200)
    await expect(page.locator('[data-trace-status]')).toBeVisible()
    await expect(page.locator('[data-trace-dock]')).toHaveAttribute('data-phase', 'paused')
  }
  expect(external).toEqual([])
})

test('Inspector links stay fixed and SQL stays private while inspecting a public SQL submission', async ({ page }) => {
  const external = recordExternalRequests(page)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/?lang=en&scenario=point-read&event=trace-1-event-4')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const marker = 'INSPECTOR_PRIVATE_SQL_425'
  const submission = await page.evaluate((value) => {
    window.TICITY.model.setPlayback('step')
    const result = window.TICITY.submitSql(`SELECT * FROM accounts WHERE id = 425 /* ${value} */`)
    return { status: result.analysis.status, receiptId: result.receipt?.id }
  }, marker)
  expect(submission.status).toBe('supported')
  expect(submission.receiptId).toBeDefined()
  const inspector = page.locator('[data-trace-inspector]')
  await expect(inspector).toHaveAttribute('data-inspector-event-id', new RegExp(`^${submission.receiptId}-event-`))
  const dock = page.locator('[data-trace-dock]')
  if (await dock.getAttribute('data-phase') !== 'paused') {
    await page.locator('[data-action="trace-toggle"]').click()
  }
  await expect(dock).toHaveAttribute('data-phase', 'paused')
  const before = await page.evaluate(() => JSON.stringify(window.TICITY.trace))
  await inspector.locator('summary').click()
  await expect(inspector).toHaveAttribute('open', '')
  const hrefs = await inspector.locator('[data-inspector-source]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')!))
  expect(hrefs).toHaveLength(2)
  for (const href of hrefs) {
    expect(href).toMatch(/^https:\/\/github\.com\/(pingcap|tikv)\/[a-z-]+\/blob\/[a-f0-9]{40}\//)
    expect(href).not.toContain(marker)
    expect(new URL(href).search).toBe('')
  }
  expect(await page.evaluate(() => JSON.stringify(window.TICITY.trace))).toBe(before)
  expect(await page.evaluate((value) => [localStorage, sessionStorage].some((storage) =>
    Object.keys(storage).some((key) => storage.getItem(key)?.includes(value))), marker)).toBe(false)
  expect(requests.some((url) => url.includes(marker))).toBe(false)
  expect(external).toEqual([])
})
