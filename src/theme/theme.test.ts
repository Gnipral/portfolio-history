import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  currentPalette,
  nextThemePreference,
  PALETTE_EVENT,
  PALETTES,
  readPalette,
  readThemePreference,
  storePalette,
  storeThemePreference,
} from './theme.ts'

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
  it('is standard by default, stored when chosen, and announced, but never set on the whole page', () => {
    localStorage.clear()
    expect(readPalette()).toBe('standard')
    const heard: unknown[] = []
    const listen = (e: Event) => heard.push((e as CustomEvent).detail)
    window.addEventListener(PALETTE_EVENT, listen)
    storePalette('neon')
    expect(readPalette()).toBe('neon')
    expect(currentPalette()).toBe('neon')
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false)
    storePalette('standard')
    expect(localStorage.getItem('palette')).toBeNull()
    expect(heard).toEqual(['neon', 'standard'])
    window.removeEventListener(PALETTE_EVENT, listen)
  })

  it('has a light and a dark value for every color it changes', () => {
    const css = readFileSync(resolve(__dirname, 'global.css'), 'utf8')
    for (const { id } of PALETTES.filter((p) => p.id !== 'standard')) {
      const tokens = (selector: string) => {
        const start = css.indexOf(`${selector} {`)
        expect(start, selector).toBeGreaterThan(-1)
        return [...css.slice(start, css.indexOf('}', start)).matchAll(/--([\w-]+):/g)].map((m) => m[1]).sort()
      }
      const light = tokens(`
[data-palette='${id}']`)
      expect(tokens(`:root:not([data-theme='light']) [data-palette='${id}']`)).toEqual(light)
      expect(tokens(`:root[data-theme='dark'] [data-palette='${id}']`)).toEqual(light)
    }
  })
})
