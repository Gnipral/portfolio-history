import { afterEach, describe, expect, it } from 'vitest'
import { nextThemePreference, readThemePreference, storeThemePreference } from './theme.ts'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme', () => {
  it('defaults to the system setting', () => {
    expect(readThemePreference()).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('stores and applies a manual choice', () => {
    storeThemePreference('dark')
    expect(readThemePreference()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('returns to the system setting', () => {
    storeThemePreference('light')
    storeThemePreference('system')
    expect(readThemePreference()).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('cycles system -> light -> dark -> system', () => {
    expect(nextThemePreference('system')).toBe('light')
    expect(nextThemePreference('light')).toBe('dark')
    expect(nextThemePreference('dark')).toBe('system')
  })
})
