// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../test/dom'
import { createNavigation } from './page-shell'

describe('TiDB page shell navigation', () => {
  it('identifies every destination so responsive navigation can select it', () => {
    installTestDom()
    const navigation = createNavigation('city', 'ja')

    expect(navigation.root.querySelector('[data-nav="city"]')?.getAttribute('aria-current')).toBe('page')
    expect(navigation.root.querySelector('[data-nav="machine"]')).not.toBeNull()
    expect(navigation.root.querySelector('[data-nav="diagnose"]')).not.toBeNull()
    expect(navigation.root.querySelector('[data-nav="github"]')).not.toBeNull()
    expect(navigation.root.querySelector('[data-nav="theme"]')).not.toBeNull()

    navigation.setLocale('en')
    expect(navigation.root.querySelector('[data-nav="city"]')?.textContent).toBe('3D City')
    expect(navigation.root.querySelector('[data-nav="diagnose"]')?.textContent).toBe('Diagnose')
  })
})
