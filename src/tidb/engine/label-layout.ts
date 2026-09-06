// SPDX-License-Identifier: Apache-2.0
// TiCity changes Copyright 2026 TiCity contributors.

export interface CityLabelPlacement {
  readonly width: number
  readonly height: number
  readonly anchorX: number
  readonly anchorY: number
  readonly side: -1 | 0 | 1
  x: number
  y: number
  visible: boolean
}

const MARGIN = 10
const GAP = 6

/**
 * Resolve only small, local collisions around the actual building anchor.
 * Candidates move sideways before vertically, so dense central labels cannot
 * cascade down the city and become associated with another district.
 * The caller reuses both the placements and their ordered array.
 */
export function placeCityLabels(
  labels: readonly CityLabelPlacement[],
  width: number,
  height: number,
): void {
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index]
    if (!label.visible) continue
    const halfWidth = label.width / 2
    const lateralStep = halfWidth + 16
    const preferredX = label.anchorX + label.side * lateralStep
    const preferredY = label.anchorY - 10
    let placed = false

    // An identity that cannot fit nearby is omitted until the camera gives it
    // enough room. Long detached leaders would imply the wrong geography.
    for (let row = 0; row < 5 && !placed; row++) {
      const rowOffset = row === 0 ? 0 : Math.ceil(row / 2) * (row % 2 ? -1 : 1)
      const y = preferredY + rowOffset * (label.height + GAP)
      if (y - label.height < MARGIN || y > height - MARGIN) continue
      for (let column = 0; column < 3; column++) {
        const columnOffset = column === 0 ? 0 : column === 1 ? -1 : 1
        const x = Math.max(
          halfWidth + MARGIN,
          Math.min(width - halfWidth - MARGIN, preferredX + columnOffset * lateralStep),
        )
        if (Math.abs(x - label.anchorX) > halfWidth + 70) continue
        let overlaps = false
        for (let previousIndex = 0; previousIndex < index; previousIndex++) {
          const previous = labels[previousIndex]
          if (!previous.visible) continue
          if (
            Math.abs(x - previous.x) < (label.width + previous.width) / 2 + GAP &&
            y - label.height < previous.y + GAP &&
            y > previous.y - previous.height - GAP
          ) {
            overlaps = true
            break
          }
        }
        if (!overlaps) {
          label.x = x
          label.y = y
          placed = true
          break
        }
      }
    }
    label.visible = placed
  }
}
