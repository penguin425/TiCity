// SPDX-License-Identifier: Apache-2.0

import { message, type Locale } from './catalog'
import { element } from './dom'

export function createModelBadge(locale: Locale): HTMLElement {
  return element(
    'span',
    {
      className: 'tidb-model-badge',
      text: message(locale, 'modelBadge'),
      attrs: {
        'data-model-label': 'true',
        title: message(locale, 'modelDisclosure'),
      },
    },
  )
}

export function createLegalPanel(locale: Locale): HTMLElement {
  return element(
    'section',
    { className: 'tidb-legal', attrs: { 'aria-labelledby': 'tidb-legal-title' } },
    element('div', { className: 'tidb-section-heading' },
      element('h2', { text: message(locale, 'legalTitle'), attrs: { id: 'tidb-legal-title' } }),
      createModelBadge(locale),
    ),
    element('p', { text: message(locale, 'modelDisclosure') }),
    element('p', { text: message(locale, 'legalAttribution') }),
    element('p', { text: message(locale, 'legalIndependence') }),
    element('p', { text: message(locale, 'legalPrivacy') }),
    element('p', { className: 'tidb-legal-links' },
      element('a', {
        text: message(locale, 'projectLicense'),
        attrs: { href: './LICENSE' },
      }),
      element('span', { text: ' · ', attrs: { 'aria-hidden': 'true' } }),
      element('a', {
        text: message(locale, 'projectNotice'),
        attrs: { href: './NOTICE' },
      }),
      element('span', { text: ' · ', attrs: { 'aria-hidden': 'true' } }),
      element('a', {
        text: message(locale, 'thirdPartyLicenses'),
        attrs: { href: './THIRD_PARTY_NOTICES.txt' },
      }),
    ),
  )
}
