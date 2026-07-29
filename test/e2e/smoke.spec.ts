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
