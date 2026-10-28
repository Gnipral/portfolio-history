import { describe, expect, it } from 'vitest'
import { FxRates } from '../market/fx.ts'
import { PriceSeries } from '../market/priceCache.ts'
import { BaseFxRates, BaseRate, rebaseSeries, rebaseTransaction } from './baseCurrency.ts'
import { tx } from './testing.ts'

const days = [
  { date: '2026-01-02', rates: { USD: 1.2, GBP: 0.8 } },
  { date: '2026-06-01', rates: { USD: 1.1, GBP: 0.85 } },
]
const fx = new FxRates(days)
const usd = new BaseRate(fx, days, 'USD')

describe('base currency', () => {
  it('uses the nearest known rate outside the data', () => {
    expect(usd.on('2026-01-05')).toBe(1.2)
    expect(usd.on('2020-01-01')).toBe(1.2)
    expect(usd.on('2027-01-01')).toBe(1.1)
    expect(new BaseRate(fx, days, 'EUR').on('2026-01-05')).toBe(1)
  })

  it('converts the EUR amounts of a transaction at the rate of its day', () => {
    const t = rebaseTransaction(tx('buy', '2026-06-01', { amount: 100, costsEur: 2 }), usd)
    expect(t.amountEur).toBeCloseTo(-110)
    expect(t.costsEur).toBeCloseTo(2.2)
    expect(t.totalEur).toBeCloseTo(-112.2)
  })

  it('prices in the base currency, directly when the price is in it', () => {
    const base = new BaseFxRates(days, usd)
    expect(base.toEur(50, 'USD', '2026-06-01')).toBe(50)
    expect(base.toEur(85, 'GBP', '2026-06-01')).toBeCloseTo(110)
    expect(base.toEur(10, 'EUR', '2026-01-02')).toBeCloseTo(12)
  })

  it('converts benchmark closes per day', () => {
    const series = rebaseSeries(new PriceSeries('X', ['2026-01-02', '2026-06-01'], [100, 100]), usd)
    expect(series.closes[0]).toBeCloseTo(120)
    expect(series.closes[1]).toBeCloseTo(110)
  })
})
