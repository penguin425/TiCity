// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from '@playwright/test'

const previewPort = Number(process.env.TICITY_PREVIEW_PORT ?? 4173)
const previewUrl = `http://127.0.0.1:${previewPort}`

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  /*
   * Chromium software WebGL is CPU-heavy, especially with contact shading and
   * high-resolution shadows. Use one browser per runner; CI shards the suite
   * across separate runners. Two-CPU software rendering can also delay browser
   * commands. Long lab/transport cases and recorded retries can take minutes,
   * so CI gets 300s per test without lowering graphics or expected results.
   */
  workers: 1,
  timeout: process.env.CI ? 300_000 : 60_000,
  // A correct polling result can arrive after 5s while software WebGL finishes
  // a frame. Keep the assertion values intact and budget for that round trip.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: previewUrl,
    // Continuous trace/video capture adds GPU readbacks to every WebGL frame.
    // Preserve diagnostics on the first retry without recording passing runs.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
