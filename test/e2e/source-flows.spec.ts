// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

import { expect, test } from '@playwright/test'

test('SQL workbench separates PD control from data and Raft replication', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const panel = page.locator('[data-action="panel"]')
  if (await panel.getAttribute('aria-expanded') === 'false') await panel.click()

  await page.locator('.tidb-sql-textarea').fill('SELECT * FROM accounts WHERE id = 425')
  await page.locator('[data-action="analyze"]').click()
  const output = page.locator('.tidb-sql-output')
  await expect(output.locator('.tidb-status')).toContainText('point_read')
  await expect(output.locator('[data-route-plane="data"]')).not.toContainText('PD')
  await expect(output.locator('[data-route-plane="control"]')).toContainText('PD')
  await expect(output.locator('[data-route-plane="control"] [data-route-event]')).toHaveCount(2)

  await page.locator('.tidb-sql-textarea').fill('UPDATE accounts SET balance = balance + 1 WHERE id = 425')
  await page.locator('[data-action="analyze"]').click()
  await expect(output.locator('.tidb-status')).toContainText('update')
  await expect(output.locator('[data-route-plane="data"]')).not.toContainText('PD')
  await expect(output.locator('[data-route-plane="transaction"]')).toBeVisible()
  await expect(output.locator('[data-route-plane="replication"]')).toBeVisible()
})

test('scalar aggregation and unsupported negation retain their SQL boundaries', async ({ page }) => {
  await page.goto('/?lang=en')
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
  const panel = page.locator('[data-action="panel"]')
  if (await panel.getAttribute('aria-expanded') === 'false') await panel.click()
  const output = page.locator('.tidb-sql-output')

  await page.locator('.tidb-sql-textarea').fill('SELECT COUNT(*) FROM events')
  await page.locator('[data-action="analyze"]').click()
  await expect(output.locator('.tidb-status')).toContainText('aggregate')
  await expect(output.locator('.tidb-plan')).toContainText('HashAgg(Final) · root')
  await expect(output.locator('.tidb-plan')).not.toContainText('HashPartition')

  await page.locator('.tidb-sql-textarea').fill('SELECT account_id, COUNT(*) FROM events GROUP BY account_id')
  await page.locator('[data-action="analyze"]').click()
  await expect(output.locator('.tidb-plan')).toContainText('ExchangeSender(HashPartition)')

  await page.locator('.tidb-sql-textarea').fill('SELECT * FROM accounts WHERE NOT (id = 425)')
  await page.locator('[data-action="analyze"]').click()
  await expect(output.locator('.tidb-status')).toHaveClass(/--unsupported/)
  await expect(output.locator('[data-route-plane]')).toHaveCount(0)
})
