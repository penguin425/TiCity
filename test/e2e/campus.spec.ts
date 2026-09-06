// SPDX-License-Identifier: Apache-2.0

import { expect, test } from '@playwright/test'

const overviewUrls = [
  ['default URL', '/'],
  ['legacy city-view URL', '/?view=city'],
] as const

for (const [name, path] of overviewUrls) {
  test(`${name} opens the educational overview`, async ({ page }, info) => {
    const forbiddenAssetRequests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/assets/urban/metal-panels-v1.png')) {
        forbiddenAssetRequests.push(request.url())
      }
    })

    await page.goto(path)
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
    await expect(page.locator('[data-view="city"]')).toHaveCount(0)
    await expect(page.locator('[data-view="orbit"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.tidb-world-labels')).toBeVisible()
    await expect(page.locator('.tidb-world-label').first()).toBeVisible()

    const dock = page.locator('[data-trace-dock]')
    await expect(dock).toBeVisible()
    await expect(page.locator('[data-trace-route]')).toBeVisible()
    await expect(page.locator('[data-trace-route]')).not.toBeEmpty()

    // Keep the default receipt, but freeze its first routed event so the
    // geometry assertions cannot race a transition to a local-only event.
    await page.evaluate(() => {
      const receipt = window.TICITY.trace
      if (!receipt?.events[0]) throw new Error('Expected the default trace')
      window.TICITY.model.setPlayback('step')
      const flows = window.TICITY.world!.shell.flows
      if (!flows.seek(receipt.events[0].id)) throw new Error('Could not select the default route')
      flows.update(0)
    })

    await expect.poll(async () => page.evaluate(() => {
      const guide = window.TICITY.world?.shell.flows.object
        .getObjectByName('trace-flow:route-guide') as { count?: number } | undefined
      return guide?.count ?? 0
    })).toBeGreaterThan(0)

    const visual = await page.evaluate(() => {
      const { city, flows } = window.TICITY.world!.shell
      return {
        campusVisible: city.root.visible,
        flowVisible: flows.object.visible,
        guide: (flows.object.getObjectByName('trace-flow:route-guide') as {
          count?: number
        } | undefined)?.count ?? 0,
        endpoints: (flows.object.getObjectByName('trace-flow:endpoints') as {
          count?: number
        } | undefined)?.count ?? 0,
      }
    })
    expect(visual).toMatchObject({ campusVisible: true, flowVisible: true })
    expect(visual.guide).toBeGreaterThan(0)
    expect(visual.endpoints).toBe(2)
    expect(forbiddenAssetRequests).toEqual([])

    await page.evaluate(() => window.TICITY.world!.shell.stop())
    try {
      await page.screenshot({ path: info.outputPath(`${name.replaceAll(' ', '-')}.png`) })
    } finally {
      await page.evaluate(() => window.TICITY.world!.shell.start())
    }
  })
}
