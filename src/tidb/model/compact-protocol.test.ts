// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { createTiDBSimulation } from './simulation'
import { analyzeSql } from './sql'
import { traceEventCopy } from '../ui/event-copy'

describe('compact optimized commit timestamp authority', () => {
  it.each(['1pc', 'async_commit'] as const)(
    'separates PD latest TSO from the %s TiKV result and client boundary',
    (protocol) => {
      const simulation = createTiDBSimulation({ seed: 425 })
      simulation.setControl('transactionMode', 'optimistic')
      simulation.setControl('commitProtocol', protocol)
      const receipt = simulation.requestTrace({
        analysis: analyzeSql('INSERT INTO events (id, account_id) VALUES (425, 7)'),
        regionIds: protocol === '1pc' ? [24] : [25, 26, 27],
      })!
      const events = receipt.events
      const floor = events.find((event) => event.kind === 'min_commit_ts')!
      const latestTs = Number(floor.metadata.latestTs)
      const minCommitTs = Number(floor.metadata.minCommitTs)
      const responseIndex = events.findIndex((event) => event.kind === 'complete')
      expect(floor.source).toMatch(/^tidb-/)
      expect(floor.target).toBe('pd-1')
      expect(minCommitTs).toBe(latestTs + 1)
      expect(simulation.state.tso.lastAllocated).toBe(latestTs)
      expect(simulation.state.tso.allocations).toBe(2)
      expect(events.filter((event) => event.domain === 'tso')).toHaveLength(2)
      expect(events.some((event) => event.kind === 'commit_ts')).toBe(false)
      expect(receipt.commitTs).toBeGreaterThan(latestTs)
      expect(receipt.committed).toBe(true)
      expect(events.slice(0, responseIndex + 1).every((event) =>
        event.path === 'critical')).toBe(true)

      if (protocol === '1pc') {
        const result = events.find((event) => event.kind === 'one_pc_result')!
        expect(result.metadata.source).toBe('tikv_calculated')
        expect(result.metadata.onePcCommitTs).toBe(receipt.commitTs)
        expect(events.indexOf(result)).toBeGreaterThan(
          events.findIndex((event) => event.kind === 'quorum_commit'),
        )
        expect(events.indexOf(result)).toBeLessThan(responseIndex)
        expect(events.some((event) => event.path === 'background')).toBe(false)
      } else {
        const results = events.filter((event) => event.kind === 'async_prewrite_result')
        expect(results).toHaveLength(3)
        expect(results.every((event) =>
          event.metadata.source === 'tikv_calculated' &&
          Number(event.metadata.minCommitTs) >= minCommitTs &&
          events.indexOf(event) < responseIndex)).toBe(true)
        expect(receipt.commitTs).toBe(Math.max(
          ...results.map((event) => Number(event.metadata.minCommitTs)),
        ))
        const background = events.filter((event) => event.kind === 'commit_background')
        expect(background).toHaveLength(3)
        expect(background.every((event) =>
          event.path === 'background' && events.indexOf(event) > responseIndex)).toBe(true)
      }
      for (const event of events.filter((event) =>
        ['min_commit_ts', 'commit_background', 'one_pc_result', 'async_prewrite_result'].includes(event.kind))) {
        for (const locale of ['ja', 'en'] as const) {
          expect(traceEventCopy(event, locale).detail).not.toContain('stable kind')
          expect(traceEventCopy(event, locale).detail).not.toContain('安定したkind')
        }
      }
      const read = simulation.submitSql('SELECT * FROM accounts WHERE id = 425').receipt!
      expect(read.startTs).toBeGreaterThanOrEqual(receipt.commitTs!)
    },
  )
})
