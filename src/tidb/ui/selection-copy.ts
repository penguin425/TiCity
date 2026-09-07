// SPDX-License-Identifier: Apache-2.0

import type { CityComponent } from '../world/city'
import type { Locale } from './catalog'
import {
  MODEL_DISCLOSURE,
  projectCityComponent,
  type CityComponentCopy,
} from './component-copy'

export interface CitySelectionCopy extends CityComponentCopy {
  readonly visibleLabel: string
  readonly ariaLabel: string
}

/**
 * Shared screen-reader and floating-label projection for a selected city
 * component. The scene graph keeps its stable ids and model-facing fields;
 * only this UI projection is localized.
 */
export function selectionCopy(
  locale: Locale,
  component: CityComponent,
): CitySelectionCopy {
  const componentCopy = projectCityComponent(locale, component)
  return {
    ...componentCopy,
    visibleLabel: componentCopy.name,
    ariaLabel: `${componentCopy.disclosure}: ${componentCopy.name} — ${componentCopy.role}`,
  }
}

export { MODEL_DISCLOSURE }
