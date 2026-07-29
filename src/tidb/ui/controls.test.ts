// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { mountCityUi } from './index'

describe('TiCity controls', () => {
  it('wires scenarios, controls, and playback through the simulation bridge', () => {
    const dom = installTestDom()
    const root = dom.mount('city') as unknown as HTMLElement
    const calls: string[] = []
    const controls = {
      qps: 500,
      writeRatio: 0.25,
      keyDistribution: 'uniform',
      transactionMode: 'pessimistic',
      commitProtocol: 'auto',
      readPolicy: 'leader',
      regionSplitThresholdMiB: 96,
      gcLifetimeSeconds: 120,
      networkLatencyMs: 10,
      tiflashLagSeconds: 2,
      playbackSpeed: 1,
      paused: false,
    } as const
    const simulation = {
      state: { controls, playback: 'slow' as const },
      submitSql: () => ({
        analysis: {
          status: 'invalid' as const,
          kind: 'unknown' as const,
          statementKind: 'unknown' as const,
          table: null,
          accessPath: 'none' as const,
          readOnly: true,
          plan: [],
          warnings: [],
          explanation: '',
        },
        receipt: null,
      }),
      runScenario(id: string) {
        calls.push(`scenario:${id}`)
        return { id, events: [] }
      },
      setControl(key: string, value: unknown) {
        calls.push(`control:${key}:${String(value)}`)
      },
      setPlayback(mode: string) {
        calls.push(`playback:${mode}`)
      },
    }

    mountCityUi(root, { simulation })
    root.querySelector<HTMLButtonElement>('[data-scenario="point-read"]')!.click()
    const qps = root.querySelector<HTMLInputElement>('[data-control="qps"]')!
    qps.value = '900'
    qps.dispatchEvent(new Event('input'))
    const playback = root.querySelector<HTMLSelectElement>('[data-control="playback"]')!
    playback.value = 'step'
    playback.dispatchEvent(new Event('change'))

    expect(calls).toContain('scenario:point-read')
    expect(calls).toContain('control:qps:900')
    expect(calls).toContain('playback:step')
    expect(root.querySelectorAll('[data-scenario]')).toHaveLength(8)
  })

  it('provides Machine, Diagnose, and source navigation', () => {
    const dom = installTestDom()
    const root = dom.mount('city') as unknown as HTMLElement
    mountCityUi(root, {})

    expect(root.querySelector('[data-nav="machine"]')?.getAttribute('href')).toBe('machine/')
    expect(root.querySelector('[data-nav="diagnose"]')?.getAttribute('href')).toBe('diagnose/')
    expect(root.querySelector('[data-nav="github"]')?.getAttribute('href')).toContain('github.com')
  })
})
