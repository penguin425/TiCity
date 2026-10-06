// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { CITY_LABEL_COPY } from './label-copy'
import { placeCityLabels, type CityLabelPlacement } from './label-layout'

function label(
  anchorX: number,
  anchorY: number,
  side: -1 | 0 | 1 = 0,
  width = 96,
  height = 22,
): CityLabelPlacement {
  return { anchorX, anchorY, side, width, height, x: 0, y: 0, visible: true }
}

function expectSeparated(labels: readonly CityLabelPlacement[]): void {
  for (let left = 0; left < labels.length; left++) {
    if (!labels[left].visible) continue
    for (let right = left + 1; right < labels.length; right++) {
      if (!labels[right].visible) continue
      const a = labels[left]
      const b = labels[right]
      const overlapsX = Math.abs(a.x - b.x) < (a.width + b.width) / 2
      const overlapsY = a.y - a.height < b.y && a.y > b.y - b.height
      expect(overlapsX && overlapsY).toBe(false)
    }
  }
}

describe('district label geography', () => {
  it('keeps crowded central districts attached without pushing labels down the city', () => {
    const entries = [
      label(600, 150), label(600, 170, 1), label(600, 188, -1),
      label(850, 200), label(395, 290), label(600, 290), label(805, 290),
      label(270, 410), label(930, 410),
    ]
    placeCityLabels(entries, 1_200, 630)
    expect(entries.filter((entry) => entry.visible)).toHaveLength(9)
    expectSeparated(entries)
    expect(entries[1].x).toBeGreaterThan(entries[1].anchorX)
    expect(entries[2].x).toBeLessThan(entries[2].anchorX)
    for (const entry of entries) {
      expect(Math.abs(entry.y - entry.anchorY)).toBeLessThanOrEqual(66)
    }
  })

  it('keeps compact names inside mobile bounds with no intersections', () => {
    const entries = [
      label(195, 160), label(195, 180, 1), label(195, 198, -1),
      label(332, 210), label(110, 280), label(195, 280), label(280, 280),
      label(40, 400), label(350, 400),
    ]
    placeCityLabels(entries, 390, 844)
    expect(entries.filter((entry) => entry.visible).length).toBeGreaterThanOrEqual(8)
    expectSeparated(entries)
    for (const entry of entries.filter((entry) => entry.visible)) {
      expect(entry.x - entry.width / 2).toBeGreaterThanOrEqual(10)
      expect(entry.x + entry.width / 2).toBeLessThanOrEqual(380)
    }
  })

  it('keeps a collapsed dashboard clear while retaining all short-height district identities', () => {
    const entries = [
      label(600, 150), label(600, 170, 1), label(600, 188, -1),
      label(850, 200), label(395, 290), label(600, 290), label(805, 290),
      label(270, 410), label(930, 410),
    ]
    placeCityLabels(entries, 1_200, 630, 100)
    expect(entries.filter((entry) => entry.visible)).toHaveLength(9)
    expectSeparated(entries)
    for (const entry of entries) {
      expect(entry.y - entry.height).toBeGreaterThanOrEqual(106)
      expect(Math.abs(entry.y - entry.anchorY)).toBeLessThanOrEqual(66)
      expect(Math.abs(entry.x - entry.anchorX)).toBeLessThanOrEqual(entry.width / 2 + 70)
    }
  })

  it('moves only nearby labels below an expanded dashboard and omits unreachable anchors', () => {
    const entries = [
      label(195, 40), label(195, 150), label(195, 170, 1),
      label(195, 188, -1), label(330, 260),
    ]
    placeCityLabels(entries, 390, 844, 140)
    expect(entries[0].visible).toBe(false)
    expect(entries[1].visible).toBe(true)
    expect(entries[1].y).toBeGreaterThan(entries[1].anchorY)
    expect(entries.filter((entry) => entry.visible)).toHaveLength(4)
    expectSeparated(entries)
    for (const entry of entries.filter((entry) => entry.visible)) {
      expect(entry.y - entry.height).toBeGreaterThanOrEqual(146)
      expect(Math.abs(entry.y - entry.anchorY)).toBeLessThanOrEqual(66)
      expect(Math.abs(entry.x - entry.anchorX)).toBeLessThanOrEqual(entry.width / 2 + 70)
    }
  })

  it('restores the original placement when the top overlay is collapsed', () => {
    const entries = [label(180, 140), label(190, 155, 1), label(200, 172, -1)]
    const original = entries.map((entry) => ({ ...entry }))
    placeCityLabels(original, 390, 844)
    placeCityLabels(entries, 390, 844, 160)
    for (const entry of entries) entry.visible = true
    placeCityLabels(entries, 390, 844, 0)
    expect(entries).toEqual(original)
  })

  it('preserves the omitted-inset API and normalizes invalid insets to the original bounds', () => {
    const entries = [label(180, 32), label(190, 55, 1), label(200, 72, -1)]
    const original = entries.map((entry) => ({ ...entry }))
    placeCityLabels(original, 390, 844)
    for (const inset of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
      const normalized = entries.map((entry) => ({ ...entry }))
      placeCityLabels(normalized, 390, 844, inset)
      expect(normalized).toEqual(original)
    }
  })

  it('reflows changed language and compact dimensions without stale rectangles', () => {
    const entries = [label(180, 140), label(190, 155, 1), label(200, 172, -1)]
    placeCityLabels(entries, 390, 844)
    expectSeparated(entries)
    const expanded = entries.map((entry) => ({ ...entry, width: 164, height: 40, visible: true }))
    placeCityLabels(expanded, 390, 844)
    expectSeparated(expanded)
    expect(expanded.every((entry) => entry.visible)).toBe(true)
  })

  it('keeps the nine identities and supplies both detail languages', () => {
    expect(Object.keys(CITY_LABEL_COPY.ja)).toEqual(Object.keys(CITY_LABEL_COPY.en))
    expect(Object.keys(CITY_LABEL_COPY.ja)).toHaveLength(9)
    for (const id of Object.keys(CITY_LABEL_COPY.ja) as (keyof typeof CITY_LABEL_COPY.ja)[]) {
      expect(CITY_LABEL_COPY.ja[id].name).toBe(CITY_LABEL_COPY.en[id].name)
      expect(CITY_LABEL_COPY.ja[id].detail).toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/)
      expect(CITY_LABEL_COPY.en[id].detail).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/)
    }
  })
})
