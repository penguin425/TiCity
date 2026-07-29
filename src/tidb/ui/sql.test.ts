// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../../test/dom'
import { MAX_SQL_BYTES, mountSqlWorkbench, sqlByteLength, truncateSql } from './sql'

describe('TiDB City SQL workbench', () => {
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
    expect(dom.window.localStorage.getItem('tidb-city:sql')).toBeNull()
  })

  it('never cuts a multibyte character into an invalid or oversized string', () => {
    const truncated = truncateSql('界'.repeat(30_000))
    expect(sqlByteLength(truncated)).toBeLessThanOrEqual(MAX_SQL_BYTES)
    expect(truncated).not.toContain('\ufffd')
  })
})
