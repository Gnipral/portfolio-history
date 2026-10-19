import { describe, expect, it } from 'vitest'
import { FxRates, parseFrankfurter, parseStaticFx } from './fx.ts'

const rates = new FxRates([
  { date: '2026-10-16', rates: { USD: 1.17, GBP: 0.86 } }, // Friday
  { date: '2026-10-14', rates: { USD: 1.16, GBP: 0.85, CHF: 0.93 } },
  { date: '2026-10-15', rates: { USD: 1.165 } },
])

describe('FxRates', () => {
  it('returns the rate of the day', () => {
    expect(rates.rate('USD', '2026-10-15')).toBe(1.165)
  })

  it('uses the last earlier rate on weekends and holidays', () => {
    expect(rates.rate('USD', '2026-10-18')).toBe(1.17)
  })

  it('skips days where a currency is missing', () => {
    expect(rates.rate('GBP', '2026-10-15')).toBe(0.85)
  })

  it('gives up after a gap of more than a week', () => {
    expect(rates.rate('USD', '2026-10-23')).toBe(1.17)
    expect(rates.rate('USD', '2026-10-24')).toBeUndefined()
    expect(rates.rate('USD', '2026-10-01')).toBeUndefined()
    expect(rates.rate('CHF', '2026-10-22')).toBeUndefined()
  })

  it('handles EUR and pence', () => {
    expect(rates.rate('EUR', '1990-01-01')).toBe(1)
    expect(rates.rate('GBX', '2026-10-16')).toBe(86)
    expect(rates.toEur(1365, 'GBX', '2026-10-16')).toBeCloseTo(15.872, 3)
  })

  it('converts to EUR and knows its last date', () => {
    expect(rates.toEur(117, 'USD', '2026-10-16')).toBeCloseTo(100, 10)
    expect(rates.toEur(1, 'XYZ', '2026-10-16')).toBeUndefined()
    expect(rates.lastDate).toBe('2026-10-16')
  })
})

describe('parsers', () => {
  it('reads the static snapshot and drops missing values', () => {
    const days = parseStaticFx({
      base: 'EUR',
      currencies: ['GBP', 'USD'],
      rates: { '2026-10-16': [0.86, 1.17], '2026-10-17': [null, 1.18] },
    })
    expect(days).toEqual([
      { date: '2026-10-16', rates: { GBP: 0.86, USD: 1.17 } },
      { date: '2026-10-17', rates: { USD: 1.18 } },
    ])
  })

  it('reads a Frankfurter time series', () => {
    expect(parseFrankfurter({ rates: { '2026-10-19': { USD: 1.17 } } })).toEqual([
      { date: '2026-10-19', rates: { USD: 1.17 } },
    ])
    expect(parseFrankfurter({})).toEqual([])
  })
})
