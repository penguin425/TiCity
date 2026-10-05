// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { CATALOG, resolveLocale, sqlExplanation } from './catalog'
import { SQL_SUBSET_EXPLANATIONS } from '../model/sql'
import { TOUR_CHAPTERS } from './tour'

describe('TiCity locale catalog', () => {
  it('keeps the English catalog structurally identical to Japanese', () => {
    expect(Object.keys(CATALOG.en)).toEqual(Object.keys(CATALOG.ja))
  })

  it('prefers a valid URL language, then storage, then Japanese', () => {
    const storage = {
      getItem: (key: string) => (key === 'ticity:lang' ? 'ja' : null),
      setItem: () => {},
    }

    expect(resolveLocale('?lang=en', storage)).toBe('en')
    expect(resolveLocale('?lang=invalid', { ...storage, getItem: () => 'en' })).toBe('en')
    expect(resolveLocale('', { ...storage, getItem: () => null })).toBe('ja')
  })

  it('localizes the conservative SQL subset and both aggregate shapes without changing metadata', () => {
    for (const explanation of Object.values(SQL_SUBSET_EXPLANATIONS)) {
      expect(sqlExplanation('en', explanation)).toBe(explanation)
      expect(sqlExplanation('ja', explanation)).not.toBe(explanation)
    }
    expect(sqlExplanation('ja', 'OVER is outside the current route model.')).toContain('対応範囲外')
    const wrapped = `Modeled EXPLAIN wrapper: ${SQL_SUBSET_EXPLANATIONS.scalar}`
    expect(sqlExplanation('ja', wrapped)).toContain('TiDB の root task で最終集約')
    expect(sqlExplanation('en', wrapped)).toBe(wrapped)
  })

  it('ships the same ten guided lessons in both languages', () => {
    expect(TOUR_CHAPTERS).toHaveLength(10)
    expect(new Set(TOUR_CHAPTERS.map((chapter) => chapter.id)).size).toBe(10)
    for (const chapter of TOUR_CHAPTERS) {
      expect(chapter.ja.title.length).toBeGreaterThan(0)
      expect(chapter.ja.body.length).toBeGreaterThan(0)
      expect(chapter.en.title.length).toBeGreaterThan(0)
      expect(chapter.en.body.length).toBeGreaterThan(0)
    }
  })
})
