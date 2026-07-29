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
   * GitHub-hosted Chromium uses software WebGL. Running two live Three.js
   * cities at once can starve Playwright's control channel even though the
   * assertions themselves are fast and deterministic.
   */
  workers: process.env.CI ? 1 : undefined,
  timeout: process.env.CI ? 60_000 : 30_000,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: previewUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
