// SPDX-License-Identifier: Apache-2.0

/** A visual palette, independent from the day/night lighting and model state. */
export type CityAppearance = 'tidb' | 'classic'

export function isCityAppearance(value: unknown): value is CityAppearance {
  return value === 'tidb' || value === 'classic'
}
