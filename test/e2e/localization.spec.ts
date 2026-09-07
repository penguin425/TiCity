// SPDX-License-Identifier: Apache-2.0

import { expect, test } from '@playwright/test'
import { waitForRenderedFrames } from './helpers/render-frames'

test('selection copy follows locale and a changing Region leader', async ({ page }) => {
  await page.goto('/?lang=ja')
  await page.waitForFunction(() => Boolean(window.TICITY?.world))
  await page.evaluate(() => {
    window.TICITY.model.setPlayback('step')
    window.TICITY.world!.shell.picker.select('region.0.peer.0')
  })

  await expect(page.locator('.tidb-world canvas')).toHaveAttribute(
    'aria-label',
    'TiCityの対話型3Dアーキテクチャ。画面上の表示切替またはキーボードで探索できます。',
  )
  await expect(page.locator('.tidb-inspector strong')).toHaveText('Regionピア · Region 0 / TiKV 1')
  await expect(page.locator('.tidb-inspector p')).toHaveText('Raftリーダー投票者')
  await expect(page.locator('.tidb-inspector small')).toContainText('MODEL / SIMULATED')
  await expect(page.locator('.ticity-selection-label__name')).toHaveText('Regionピア · Region 0 / TiKV 1')
  await expect(page.locator('.ticity-selection-label__disclosure')).toHaveText('MODEL / SIMULATED')
  await expect(page.locator('.ticity-selection-label')).toHaveAttribute(
    'aria-label',
    /MODEL \/ SIMULATED:.*Raftリーダー投票者/,
  )

  await expect(page.locator('.tidb-status-strip dt')).toHaveText(['QPS', '取引', 'Region数', '再生位置'])
  await expect(page.locator('.tidb-scene-legend')).toHaveAttribute('aria-label', '意味を表す色')
  await page.locator('[data-action="panel"]').click()
  await page.locator('[data-locale="en"]').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('.tidb-world canvas')).toHaveAttribute(
    'aria-label',
    'TiCity interactive 3D architecture. Use the view controls or keyboard to explore.',
  )
  await expect(page.locator('.tidb-inspector strong')).toHaveText('Region 0 peer on TiKV 1')
  await expect(page.locator('.tidb-inspector p')).toHaveText('Raft leader voter')
  await expect(page.locator('.ticity-selection-label__name')).toHaveText('Region 0 peer on TiKV 1')
  await expect(page.locator('.ticity-selection-label__disclosure')).toHaveText('MODEL / SIMULATED')
  await expect(page.locator('.ticity-selection-label')).toHaveAttribute(
    'aria-label',
    /MODEL \/ SIMULATED:.*Raft leader voter/,
  )
  await expect(page.locator('.tidb-status-strip dt')).toHaveText(['QPS', 'Txn', 'Regions', 'Trace'])
  await expect(page.locator('.tidb-scene-legend')).toHaveAttribute('aria-label', 'Semantic colours')
  await expect(page.locator('.tidb-scene-legend [data-domain="sql"]')).toHaveText('SQL / data route')

  await page.evaluate(() => {
    const state = structuredClone(window.TICITY.model.state)
    state.regions[0].leaderStoreId = 'tikv-2'
    state.regions[0].hotScore = 100
    window.TICITY.world!.shell.city.updateState(state)
  })
  await waitForRenderedFrames(page, 4)
  await expect(page.locator('.tidb-inspector p')).toHaveText('Raft follower voter')
  await expect(page.locator('.ticity-selection-label')).toHaveAttribute(
    'aria-label',
    /MODEL \/ SIMULATED:.*Raft follower voter/,
  )
})

test('the world locale API updates district labels without depending on document language', async ({ page }) => {
  await page.goto('/?lang=ja')
  await page.waitForFunction(() => Boolean(window.TICITY?.world))
  const clientDetail = page.locator('.tidb-world-label[data-component="client.terminal"] small')
  await expect(clientDetail).toHaveText('MySQL ワークロード')
  await page.evaluate(() => {
    window.TICITY.model.setPlayback('step')
    window.TICITY.world!.setLocale('en')
    window.TICITY.setTheme('night')
  })
  await waitForRenderedFrames(page, 2)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(clientDetail).toHaveText('MySQL workloads')
  await expect(page.locator('.tidb-world canvas')).toHaveAttribute('aria-label', /interactive 3D architecture/)
  await page.evaluate(() => window.TICITY.world!.setLocale('ja'))
  await expect(clientDetail).toHaveText('MySQL ワークロード')
})

test('narrow Machine and Diagnose pages keep a visible link back to the City overview', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })

  for (const surface of ['machine', 'diagnose'] as const) {
    await page.goto(`/${surface}/?lang=ja`)
    await expect(page.locator('body')).toHaveAttribute('data-ready', 'true')
    const city = page.locator('.tidb-top-actions [data-nav="city"]')
    await expect(city).toBeVisible()
    await expect(city).toHaveAttribute('href', /\.\.\/\?lang=ja/)
    await city.click()
    await expect(page).toHaveURL(/\/\?lang=ja$/)
    await expect(page.locator('[data-nav="city"]')).toHaveAttribute('aria-current', 'page')
  }
})
