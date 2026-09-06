// SPDX-License-Identifier: Apache-2.0

import type { Page } from '@playwright/test'

/**
 * Wait for completed WebGL renders instead of merely counting browser rAFs.
 * The shell may yield after a slow software-rendered frame, so an rAF callback
 * is not evidence that the renderer has submitted another frame.
 */
export async function waitForRenderedFrames(page: Page, count = 1): Promise<void> {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Rendered frame count must be a positive integer: ${count}`)
  }

  const start = await page.evaluate(() => {
    const renderer = window.TICITY?.world?.shell.renderer
    if (!renderer) throw new Error('TiCity renderer is not available')
    return renderer.info.render.frame
  })

  await page.waitForFunction(
    ({ start, count }) => {
      const renderer = window.TICITY?.world?.shell.renderer
      return renderer !== undefined && renderer.info.render.frame >= start + count
    },
    { start, count },
  )
}
