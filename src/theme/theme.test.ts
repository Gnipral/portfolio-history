import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextThemePreference, PALETTES, readPalette, readThemePreference, storePalette, storeThemePreference } from './theme.ts'

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

describe('palette', () => {
  it('is standard by default, and is stored and applied when chosen', () => {
    localStorage.clear()
    expect(readPalette()).toBe('standard')
    storePalette('colorblind')
    expect(readPalette()).toBe('colorblind')
    expect(document.documentElement.getAttribute('data-palette')).toBe('colorblind')
    storePalette('standard')
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false)
    expect(localStorage.getItem('palette')).toBeNull()
  })

  it('has a light and a dark value for every color it changes', () => {
    const css = readFileSync(resolve(__dirname, 'global.css'), 'utf8')
    for (const { id } of PALETTES.filter((p) => p.id !== 'standard')) {
      const tokens = (selector: string) => {
        const start = css.indexOf(`${selector} {`)
        expect(start, selector).toBeGreaterThan(-1)
        return [...css.slice(start, css.indexOf('}', start)).matchAll(/--([\w-]+):/g)].map((m) => m[1]).sort()
      }
      const light = tokens(`:root[data-palette='${id}']`)
      expect(tokens(`:root[data-palette='${id}']:not([data-theme='light'])`)).toEqual(light)
      expect(tokens(`:root[data-palette='${id}'][data-theme='dark']`)).toEqual(light)
    }
  })
})
