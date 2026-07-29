// SPDX-License-Identifier: Apache-2.0
// TiDB City changes Copyright 2026 TiDB City contributors.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const entry = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url))

const pkg = JSON.parse(readFileSync(entry('./package.json'), 'utf8')) as {
  version: string
}

const legalFileNames = ['LICENSE', 'NOTICE'] as const

function shortGitSha(): string {
  const supplied = process.env.TIDBCITY_GIT_SHA ?? process.env.GITHUB_SHA
  if (supplied && /^[0-9a-f]{7,40}$/i.test(supplied)) {
    return supplied.slice(0, 7).toLowerCase()
  }

  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: entry('.'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  // A relative base keeps all three static pages deployable both on GitHub
  // Pages and from a local folder without a server-side router.
  base: './',
  plugins: [
    {
      name: 'tidb-city-legal-documents',
      generateBundle() {
        for (const fileName of legalFileNames) {
          this.emitFile({
            type: 'asset',
            fileName,
            source: readFileSync(entry(`./${fileName}`), 'utf8'),
          })
        }
      },
    },
  ],
  define: {
    __TIDBCITY_VERSION__: JSON.stringify(pkg.version),
    __TIDBCITY_GIT_SHA__: JSON.stringify(shortGitSha()),
  },
  server: {
    host: true,
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        city: entry('./index.html'),
        machine: entry('./machine/index.html'),
        diagnose: entry('./diagnose/index.html'),
      },
    },
  },
  test: {
    include: [
      'src/tidb/**/*.test.ts',
      'test/tidb/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      '.agents/**',
    ],
    testTimeout: 10_000,
  },
})
