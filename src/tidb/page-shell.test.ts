// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

import { installTestDom } from '../../test/dom'
import { createNavigation, prepareDocument } from './page-shell'

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

  it('carries the scenario and exact event id across all three surfaces', () => {
    const dom = installTestDom()
    dom.window.location.search =
      '?scenario=lock-deadlock&event=trace-1-event-9&lang=ja'
    const navigation = createNavigation('city', 'ja')

    const machine = navigation.root.querySelector(
      '[data-nav="machine"]',
    ) as unknown as HTMLAnchorElement
    expect(machine.href).toBe(
      'machine/?scenario=lock-deadlock&event=trace-1-event-9&lang=ja',
    )

    navigation.setTraceContext('lock-deadlock', 'trace-1-event-14')
    navigation.setLocale('en')
    const diagnose = navigation.root.querySelector(
      '[data-nav="diagnose"]',
    ) as unknown as HTMLAnchorElement
    expect(diagnose.href).toBe(
      'diagnose/?scenario=lock-deadlock&event=trace-1-event-14&lang=en',
    )
  })

  it('localizes the shared skip link during page preparation', () => {
    installTestDom()
    const skip = document.createElement('a')
    skip.className = 'skip-link'
    document.body.append(skip)

    prepareDocument('en')
    expect(document.documentElement.lang).toBe('en')
    expect(skip.textContent).toBe('Skip to main content')

    prepareDocument('ja')
    expect(skip.textContent).toBe('メインコンテンツへ移動')
  })
})
