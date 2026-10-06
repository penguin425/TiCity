// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'

import { installTestDom } from '../../test/dom'
import {
  applyAppearance,
  applyTheme,
  createNavigation,
  prepareDocument,
  resolveAppearance,
  resolveTheme,
} from './page-shell'

describe('TiDB page shell navigation', () => {
  it('identifies every destination so responsive navigation can select it', () => {
    installTestDom()
    const navigation = createNavigation('city', 'ja')

    expect(navigation.root.querySelector('[data-nav="city"]')?.getAttribute('aria-current')).toBe('page')
    expect(navigation.root.querySelector('[data-nav="machine"]')).not.toBeNull()
    expect(navigation.root.querySelector('[data-nav="diagnose"]')).not.toBeNull()
    expect(navigation.root.querySelector('[data-nav="github"]')).not.toBeNull()
    expect(navigation.root.querySelector('[data-nav="theme"]')).not.toBeNull()
    expect(navigation.root.querySelector('[data-nav="appearance"]')).toBe(navigation.appearanceSelect)
    expect(navigation.appearanceSelect.getAttribute('aria-label')).toBe('配色')
    expect(navigation.appearanceSelect.querySelector('[value="tidb"]')?.textContent).toBe('TiDB フレッシュ')
    expect(navigation.appearanceSelect.querySelector('[value="classic"]')?.textContent).toBe('クラシック')
    expect(navigation.root.querySelector('[data-nav="city"]')?.textContent).toBe('3D俯瞰')
    expect(navigation.root.querySelector('[data-nav="machine"]')?.textContent).toBe('2D構成図')

    navigation.setLocale('en')
    expect(navigation.root.querySelector('[data-nav="city"]')?.textContent).toBe('3D City')
    expect(navigation.root.querySelector('[data-nav="diagnose"]')?.textContent).toBe('Diagnose')
    expect(navigation.appearanceSelect.getAttribute('aria-label')).toBe('Palette')
    expect(navigation.appearanceSelect.querySelector('[value="tidb"]')?.textContent).toBe('TiDB Fresh')
    expect(navigation.appearanceSelect.querySelector('[value="classic"]')?.textContent).toBe('Classic')
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
      'machine/?scenario=lock-deadlock&event=trace-1-event-9&lang=ja&theme=day&appearance=tidb',
    )

    navigation.setTraceContext('lock-deadlock', 'trace-1-event-14')
    navigation.setLocale('en')
    const diagnose = navigation.root.querySelector(
      '[data-nav="diagnose"]',
    ) as unknown as HTMLAnchorElement
    expect(diagnose.href).toBe(
      'diagnose/?scenario=lock-deadlock&event=trace-1-event-14&lang=en&theme=day&appearance=tidb',
    )
  })

  it('localizes the shared skip link during page preparation', () => {
    installTestDom()
    const skip = document.createElement('a')
    skip.className = 'skip-link'
    document.body.append(skip)

    prepareDocument('en')
    expect(document.documentElement.lang).toBe('en')
    expect(document.documentElement.dataset.appearance).toBe('tidb')
    expect(document.documentElement.dataset.theme).toBe('day')
    expect(skip.textContent).toBe('Skip to main content')

    prepareDocument('ja')
    expect(skip.textContent).toBe('メインコンテンツへ移動')
  })

  it('refreshes the next-theme label and pressed state after an external theme change', () => {
    installTestDom()
    applyTheme('day')
    const navigation = createNavigation('city', 'ja')
    const originalMachineLink = navigation.root.querySelector('[data-nav="machine"]')
    expect(navigation.themeButton.getAttribute('aria-label')).toBe('夜テーマに切り替える')

    applyTheme('night')
    navigation.syncTheme()
    expect(navigation.themeButton.textContent).toBe('☀ 昼')
    expect(navigation.themeButton.getAttribute('aria-pressed')).toBe('true')
    expect(navigation.root.querySelector('[data-nav="machine"]')).toBe(originalMachineLink)

    navigation.setLocale('en')
    expect(navigation.themeButton.getAttribute('aria-label')).toBe('Switch to day theme')
    applyTheme('day')
    navigation.syncTheme()
    expect(navigation.themeButton.textContent).toBe('☾ Night')
    expect(navigation.themeButton.getAttribute('aria-pressed')).toBe('false')
  })

  it('uses TiDB Fresh by default and validates URL and remembered palettes', () => {
    const dom = installTestDom()
    expect(resolveAppearance()).toBe('tidb')
    dom.window.localStorage.setItem('ticity:appearance', 'classic')
    expect(resolveAppearance()).toBe('classic')
    expect(resolveAppearance('?appearance=tidb')).toBe('tidb')
    expect(resolveAppearance('?appearance=classic')).toBe('classic')
    expect(resolveAppearance('?appearance=invalid')).toBe('classic')
    dom.window.localStorage.setItem('ticity:appearance', 'invalid')
    expect(resolveAppearance('?appearance=invalid')).toBe('tidb')
  })

  it('remembers palette changes without changing day/night lighting', () => {
    const dom = installTestDom()
    applyTheme('night')
    applyAppearance('classic')
    expect(document.documentElement.dataset.theme).toBe('night')
    expect(document.documentElement.dataset.appearance).toBe('classic')
    expect(dom.window.localStorage.getItem('ticity:appearance')).toBe('classic')
    expect(dom.window.localStorage.getItem('ticity:theme')).toBe('night')
    applyAppearance('tidb')
    expect(document.documentElement.dataset.theme).toBe('night')
    expect(resolveAppearance('')).toBe('tidb')
    applyTheme('day')
    expect(document.documentElement.dataset.appearance).toBe('tidb')
  })

  it('applies URL settings when localStorage access itself is rejected', () => {
    const dom = installTestDom()
    Object.defineProperty(dom.window, 'localStorage', {
      get() { throw new Error('Storage is unavailable') },
    })
    dom.window.location.search = '?appearance=classic&theme=night'
    expect(() => prepareDocument('ja')).not.toThrow()
    expect(document.documentElement.dataset.appearance).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('night')
    expect(resolveAppearance('')).toBe('tidb')
    expect(resolveTheme('')).toBe('day')
  })

  it('continues when exposed storage rejects both reads and writes', () => {
    const dom = installTestDom()
    vi.spyOn(dom.window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Reads are restricted')
    })
    vi.spyOn(dom.window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Writes are restricted')
    })
    expect(resolveAppearance('')).toBe('tidb')
    expect(resolveTheme('')).toBe('day')
    expect(resolveAppearance('?appearance=classic')).toBe('classic')
    expect(() => applyAppearance('classic')).not.toThrow()
    expect(() => applyTheme('night')).not.toThrow()
    expect(document.documentElement.dataset.appearance).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('night')
  })

  it('updates theme-color for both palettes and both lighting choices', () => {
    installTestDom()
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.body.append(meta)
    applyAppearance('tidb')
    applyTheme('day')
    expect(meta.getAttribute('content')).toBe('#eaf5fa')
    applyTheme('night')
    expect(meta.getAttribute('content')).toBe('#102331')
    applyAppearance('classic')
    expect(meta.getAttribute('content')).toBe('#07121f')
    applyTheme('day')
    expect(meta.getAttribute('content')).toBe('#d7e9f1')
  })

  it('updates explicit shared URL settings while preserving other parameters and the fragment', () => {
    const dom = installTestDom()
    dom.window.location.pathname = '/TiCity/machine/'
    dom.window.location.search = '?appearance=tidb&theme=day&lang=ja&scenario=raft-failover'
    dom.window.location.hash = '#event-details'
    const replace = vi.spyOn(dom.window.history, 'replaceState').mockImplementation((_state, _unused, url) => {
      const next = new URL(String(url), 'https://example.test')
      dom.window.location.search = next.search
    })
    applyAppearance('classic')
    expect(replace).toHaveBeenLastCalledWith(null, '',
      '/TiCity/machine/?appearance=classic&theme=day&lang=ja&scenario=raft-failover#event-details')
    applyTheme('night')
    expect(replace).toHaveBeenLastCalledWith(null, '',
      '/TiCity/machine/?appearance=classic&theme=night&lang=ja&scenario=raft-failover#event-details')
    expect(resolveAppearance()).toBe('classic')
    expect(resolveTheme()).toBe('night')
    dom.window.location.search = '?lang=en&scenario=raft-failover'
    replace.mockClear()
    applyAppearance('tidb')
    applyTheme('day')
    expect(replace).not.toHaveBeenCalled()
  })

  it('keeps explicit URL display controls functional if history replacement is rejected', () => {
    const dom = installTestDom()
    dom.window.location.search = '?appearance=tidb&theme=day'
    vi.spyOn(dom.window.history, 'replaceState').mockImplementation(() => {
      throw new Error('History changes are restricted')
    })
    expect(() => applyAppearance('classic')).not.toThrow()
    expect(() => applyTheme('night')).not.toThrow()
    expect(document.documentElement.dataset.appearance).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('night')
  })

  it('also applies explicit URL choices in a minimal window without a history API', () => {
    const dom = installTestDom()
    dom.window.location.search = '?appearance=tidb&theme=day'
    Object.defineProperty(dom.window, 'history', { value: undefined })
    expect(() => applyAppearance('classic')).not.toThrow()
    expect(() => applyTheme('night')).not.toThrow()
    expect(document.documentElement.dataset.appearance).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('night')
  })

  it('changes the palette and surface links in place without losing select focus', () => {
    installTestDom()
    prepareDocument('en')
    const navigation = createNavigation('machine', 'en')
    document.body.append(navigation.root)
    const select = navigation.appearanceSelect
    const originalParent = select.parentElement
    const originalCity = navigation.root.querySelector('[data-nav="city"]') as HTMLAnchorElement
    select.focus()
    select.value = 'classic'
    select.dispatchEvent(new Event('change'))
    expect(document.documentElement.dataset.appearance).toBe('classic')
    expect(document.documentElement.dataset.theme).toBe('day')
    expect(originalCity.href).toBe('../?lang=en&theme=day&appearance=classic')
    navigation.setTraceContext('raft-failover', 'trace-2-event-6')
    navigation.setLocale('ja')
    expect(navigation.appearanceSelect).toBe(select)
    expect(select.parentElement).toBe(originalParent)
    expect(document.activeElement).toBe(select)
    expect(navigation.root.querySelector('[data-nav="city"]')).toBe(originalCity)
    expect(originalCity.href).toBe('../?scenario=raft-failover&event=trace-2-event-6&lang=ja&theme=day&appearance=classic')
    applyAppearance('tidb')
    navigation.syncAppearance()
    expect(select.value).toBe('tidb')
    expect(originalCity.href).toContain('appearance=tidb')
    navigation.themeButton.click()
    expect(document.documentElement.dataset.theme).toBe('night')
    expect(originalCity.href).toContain('theme=night&appearance=tidb')
  })
})
