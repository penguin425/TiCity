// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { CATALOG, resolveLocale } from './catalog'
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
