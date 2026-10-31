import { afterEach, describe, expect, it } from 'vitest'
import { formatEur, formatEurExact, formatPercent, formatQuantity, formatSignedEur, HIDDEN, setAmountsHidden } from './format.ts'

afterEach(() => setAmountsHidden(false))

describe('hidden amounts', () => {
  it('hides amounts and quantities but keeps percentages and the sign', () => {
    setAmountsHidden(true)
    expect(formatEur(12345.67)).toBe(`€${HIDDEN}`)
    expect(formatEur(12345.67, true)).toBe(`€${HIDDEN}`)
    expect(formatSignedEur(250)).toBe(`+€${HIDDEN}`)
    expect(formatSignedEur(-250)).toBe(`−€${HIDDEN}`)
    expect(formatQuantity(12.5)).toBe(HIDDEN)
    expect(formatPercent(0.1234)).toBe('+12.34%')
  })

  it('keeps the exact amount for files the user downloads', () => {
    setAmountsHidden(true)
    expect(formatEurExact(12.5)).toBe('€12.50')
  })

  it('shows everything again when switched back', () => {
    setAmountsHidden(true)
    setAmountsHidden(false)
    expect(formatEur(12.5)).toBe('€12.50')
    expect(formatQuantity(1.5)).toBe('1.5')
  })
})
