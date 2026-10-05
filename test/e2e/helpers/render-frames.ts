// SPDX-License-Identifier: Apache-2.0

import type { Page } from '@playwright/test'

/**
 * Wait for completed logical City renders instead of WebGL passes or rAFs.
 * The shell may yield after a slow software-rendered frame, so an rAF callback
 * is not evidence that the renderer has submitted another frame.
 */
export async function waitForRenderedFrames(page: Page, count = 1): Promise<void> {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Rendered frame count must be a positive integer: ${count}`)
  }

  const start = await page.evaluate(() => {
    const shell = window.TICITY?.world?.shell
    if (!shell) throw new Error('TiCity renderer is not available')
    return shell.renderedFrames
  })

  await page.waitForFunction(
    ({ start, count }) => {
      const shell = window.TICITY?.world?.shell
      return shell !== undefined && shell.renderedFrames >= start + count
    },
    { start, count },
  )
}
