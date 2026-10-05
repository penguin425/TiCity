// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { createTiDBSimulation } from '../model'
import { CATALOG } from './catalog'
import {
  MAX_SQL_BYTES,
  mountSqlWorkbench,
  presentSql,
  projectSqlRouteGroups,
  sqlByteLength,
  truncateSql,
} from './sql'

describe('TiCity SQL workbench', () => {
  it('routes supported SQL without inventing result rows', () => {
    const dom = installTestDom()
    const root = dom.mount('sql') as unknown as HTMLElement
    const submitted: string[] = []
    mountSqlWorkbench(root, {
      locale: 'en',
      analyzeSql(sql) {
        submitted.push(sql)
        return {
          status: 'supported',
          statement: 'Point Get',
          route: ['TiProxy', 'TiDB', 'TiKV Region leader'],
          plan: ['Point_Get', 'TableRowIDScan'],
          receipt: { events: [] },
        }
      },
    })

    const input = root.querySelector('textarea')!
    input.value = 'SELECT * FROM accounts WHERE id = 42'
    root.querySelector<HTMLButtonElement>('[data-action="analyze"]')!.click()

    expect(submitted).toEqual(['SELECT * FROM accounts WHERE id = 42'])
    expect(root.textContent).toContain('TiProxy')
    expect(root.textContent).toContain('Point_Get')
    expect(root.textContent).toContain('No result rows are generated')
    expect(root.querySelector('tbody')).toBeNull()
  })

  it('enforces 64 KiB in memory and never writes SQL into storage', () => {
    const dom = installTestDom()
    const root = dom.mount('sql') as unknown as HTMLElement
    let analyzed = ''
    mountSqlWorkbench(root, {
      locale: 'ja',
      analyzeSql(sql) {
        analyzed = sql
        return {
          status: 'unsupported',
          statement: 'unknown',
          route: [],
          plan: [],
          warning: '未対応です。',
        }
      },
    })

    const input = root.querySelector('textarea')!
    input.value = 'x'.repeat(MAX_SQL_BYTES + 100)
    input.dispatchEvent(new Event('input'))
    expect(input.value).toHaveLength(MAX_SQL_BYTES)
    root.querySelector<HTMLButtonElement>('[data-action="analyze"]')!.click()
    expect(analyzed).toHaveLength(MAX_SQL_BYTES)
    expect(dom.window.localStorage.getItem('ticity:sql')).toBeNull()
  })

  it('never cuts a multibyte character into an invalid or oversized string', () => {
    const truncated = truncateSql('界'.repeat(30_000))
    expect(sqlByteLength(truncated)).toBeLessThanOrEqual(MAX_SQL_BYTES)
    expect(truncated).not.toContain('\ufffd')
  })

  it('keeps PD timestamp and Region metadata requests off the data route', () => {
    const simulation = createTiDBSimulation({ seed: 425 })
    const submission = simulation.submitSql('SELECT * FROM accounts WHERE id = 425')
    const presentation = presentSql(submission)
    const data = presentation.routeGroups!.find((group) => group.plane === 'data')!
    const control = presentation.routeGroups!.find((group) => group.plane === 'control')!

    expect(data.events.some((event) => event.kind === 'point_get')).toBe(true)
    expect(data.events.some((event) =>
      event.source?.startsWith('pd') || event.target?.startsWith('pd'),
    )).toBe(false)
    expect(control.events.map((event) => event.kind)).toEqual(['snapshot_ts', 'locate_regions'])
    expect(submission.receipt!.events.find((event) => event.kind === 'locate_regions')!.domain).toBe('tso')
    expect(presentation.route.some((stop) => /\bPD\b/i.test(stop))).toBe(false)
  })

  it('preserves distinct transaction and replication edges without joining parallel Regions', () => {
    const receipt = createTiDBSimulation({ seed: 425 }).runScenario('cross-region-transaction')
    const groups = projectSqlRouteGroups(receipt)
    const transaction = groups.find((group) => group.plane === 'transaction')!
    const replication = groups.find((group) => group.plane === 'replication')!

    expect(transaction.events.some((event) => event.kind === 'prewrite')).toBe(true)
    expect(replication.events.every((event) => event.domain === 'raft')).toBe(true)
    expect(new Set(replication.events.map((event) => event.regionId))).toEqual(new Set([0, 19]))
    expect(groups.flatMap((group) => group.events).map((event) => event.id).sort()).toEqual(
      receipt.events
        .filter((event) => event.source && event.target && event.source !== event.target)
        .map((event) => event.id).sort(),
    )
    expect(replication.events.some((event) => event.path === 'background')).toBe(true)
  })

  it('renders separately labelled directed hops in both languages', () => {
    for (const locale of ['ja', 'en'] as const) {
      const dom = installTestDom()
      const root = dom.mount(`sql-${locale}`) as unknown as HTMLElement
      const simulation = createTiDBSimulation({ seed: 425 })
      mountSqlWorkbench(root, {
        locale,
        analyzeSql: (sql) => simulation.submitSql(sql),
        initialSql: 'SELECT * FROM accounts WHERE id = 425',
      })
      root.querySelector<HTMLButtonElement>('[data-action="analyze"]')!.click()
      const data = root.querySelector('[data-route-plane="data"]')!
      const control = root.querySelector('[data-route-plane="control"]')!

      expect(data.textContent).toContain(CATALOG[locale].routePlanes.data)
      expect(control.textContent).toContain(CATALOG[locale].routePlanes.control)
      expect(data.textContent).not.toContain('PD')
      expect(control.textContent).toContain('PD')
      expect(control.textContent).toContain('→')
      expect(root.textContent).toContain(CATALOG[locale].routeHelp)
      expect(root.querySelector('ol.tidb-route')).toBeNull()
    }
  })

  it('localizes the scalar aggregate explanation in the Japanese workbench', () => {
    const dom = installTestDom()
    const root = dom.mount('sql-scalar-ja') as unknown as HTMLElement
    const simulation = createTiDBSimulation({ seed: 425 })
    mountSqlWorkbench(root, {
      locale: 'ja',
      analyzeSql: (sql) => simulation.submitSql(sql),
      initialSql: 'SELECT count(*) FROM events',
    })
    root.querySelector<HTMLButtonElement>('[data-action="analyze"]')!.click()
    expect(root.textContent).toContain('TiDB の root task で最終集約します')
    expect(root.textContent).not.toContain('Modeled as a scalar aggregate')
  })
})
