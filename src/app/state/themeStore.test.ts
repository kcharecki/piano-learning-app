/**
 * `themeStore.ts` (roadmap UI-05): the DOM contract — `setTheme`/`hydrate`
 * both write (or clear) `data-theme` on the root element, which is the one
 * thing `src/design-system/tokens/colors.css` keys its palette off. The
 * persistence round-trip itself (restore applying the attribute, a corrupt
 * payload degrading to the default) is covered in `persistence.test.ts`,
 * matching every sibling slice's own split between "the store's own
 * contract" and "the persistence plumbing".
 */
import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, useThemeStore } from './themeStore.ts'

function resetStore(): void {
  useThemeStore.setState({ theme: 'system' })
  document.documentElement.removeAttribute('data-theme')
}

afterEach(resetStore)

describe('useThemeStore', () => {
  it('defaults to system, with no data-theme attribute', () => {
    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('setTheme("dark") sets data-theme="dark" and updates state', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('setTheme("light") sets data-theme="light" and updates state', () => {
    useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('setTheme("system") REMOVES data-theme rather than hardcoding a palette', () => {
    useThemeStore.getState().setTheme('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(true)

    useThemeStore.getState().setTheme('system')
    expect(useThemeStore.getState().theme).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('hydrate applies the attribute the same way setTheme does', () => {
    useThemeStore.getState().hydrate('light')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('applyTheme is exported standalone for a caller that needs to apply without a state change', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
