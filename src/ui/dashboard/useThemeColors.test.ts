import { describe, expect, it } from 'vitest'
import { fullHex } from './useThemeColors.ts'

describe('fullHex', () => {
  // The production build writes #000000 as #000; with two alpha digits appended that is no color.
  it('expands short hex colors, so transparency can be appended', () => {
    expect(fullHex('#000')).toBe('#000000')
    expect(fullHex('#fA0')).toBe('#ffAA00')
    expect(`${fullHex('#000')}40`).toBe('#00000040')
    expect(fullHex('#0008')).toBe('#00000088')
  })

  it('leaves full hex and other colors alone', () => {
    expect(fullHex('#0072b2')).toBe('#0072b2')
    expect(fullHex('rgb(0, 0, 0)')).toBe('rgb(0, 0, 0)')
    expect(fullHex('')).toBe('')
  })
})
