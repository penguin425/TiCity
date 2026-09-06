// SPDX-License-Identifier: Apache-2.0

import { expect, test, type Page } from '@playwright/test'

async function expectReadableLabels(page: Page, minimum: number): Promise<void> {
  const layout = await page.locator('.tidb-world-labels').evaluate((root) => {
    const bounds = root.getBoundingClientRect()
    const labels = Array.from(root.querySelectorAll<HTMLElement>('.tidb-world-label'))
      .filter((label) => !label.hidden)
      .map((label) => {
        const box = label.getBoundingClientRect()
        return { name: label.querySelector('strong')!.textContent, ...box.toJSON() }
      })
    const collisions: string[] = []
    for (let left = 0; left < labels.length; left++) {
      for (let right = left + 1; right < labels.length; right++) {
        const a = labels[left]
        const b = labels[right]
        if (
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        ) collisions.push(`${a.name} / ${b.name}`)
      }
    }
    return {
      count: labels.length,
      collisions,
      clipped: labels.filter((label) =>
        label.left < bounds.left - 1 || label.right > bounds.right + 1 ||
        label.top < bounds.top - 1 || label.bottom > bounds.bottom + 1,
      ).map((label) => label.name),
    }
  })
  expect(layout.count).toBeGreaterThanOrEqual(minimum)
  expect(layout.collisions).toEqual([])
  expect(layout.clipped).toEqual([])
}

test('district details follow language controls and keep their layout across themes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/?lang=ja')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const client = page.locator('.tidb-world-label[data-component="client.terminal"]')
  await expect(client.locator('small')).toHaveText('MySQL ワークロード')
  await expectReadableLabels(page, 9)

  await page.locator('[data-action="panel"]').click()
  await page.locator('[data-locale="en"]').click()
  await expect(client.locator('small')).toHaveText('MySQL workloads')
  await page.locator('[data-action="panel"]').click()
  await page.evaluate(() => window.TICITY.setTheme('night'))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night')
  await expectReadableLabels(page, 9)
})

test('short and mobile views retain compact district identities without overlaps', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.goto('/')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.tidb-world-labels')).toHaveClass(/is-overview/)
  await expectReadableLabels(page, 9)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.tidb-world-labels')).toBeVisible()
  await expect.poll(async () => page.locator('.tidb-world-labels').evaluate((root) => root.clientWidth))
    .toBe(390)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await expectReadableLabels(page, 5)
  await expect(page.locator('.tidb-world-label small').first()).toBeHidden()
})
