import { describe, expect, it } from 'vitest'
import { FxRates } from '../../market/fx.ts'
import { PriceSeries } from '../../market/priceCache.ts'
import { DEFAULT_OPTIONS } from '../options.ts'
import { PriceBook } from '../priceBook.ts'
import { computeDailySeries } from '../series.ts'
import { tx } from '../testing.ts'
import { contributions, topAndBottom, type Contribution } from './contribution.ts'

const A = 'XA0000000001'
const B = 'XB0000000002'

function book(closes: Record<string, [string, number][]>) {
  const entries = Object.entries(closes)
  return new PriceBook({
    symbols: new Map(entries.map(([isin]) => [isin, `S${isin}`])),
    series: new Map(entries.map(([isin, points]) => [`S${isin}`, PriceSeries.fromPoints(`S${isin}`, points.map(([date, close]) => ({ symbol: `S${isin}`, date, close })))])),
    currencies: new Map(entries.map(([isin]) => [`S${isin}`, 'EUR'])),
    splits: new Map(),
    fx: new FxRates([]),
  })
}

// A rises 10% on the second day, B falls 20% on the third: €1,000 in each on the first day.
const transactions = [
  tx('buy', '2026-03-02', { isin: A, quantity: 10, amount: 1000, assetClass: 'etf' }),
  tx('buy', '2026-03-02', { isin: B, quantity: 20, amount: 1000 }),
]
const prices = book({
  [A]: [
    ['2026-03-02', 100],
    ['2026-03-03', 110],
  ],
  [B]: [
    ['2026-03-02', 50],
    ['2026-03-04', 40],
  ],
})
const today = '2026-03-04'
const days = computeDailySeries(transactions, prices, DEFAULT_OPTIONS, today).points

describe('contributions', () => {
  it('splits the result and the return over the positions', () => {
    const result = contributions(transactions, prices, DEFAULT_OPTIONS, days, { from: 0, to: 2 }, today)
    const [a, b] = result.positions
    expect(a).toEqual({ key: A, product: A, isin: A, assetClass: 'etf', pnl: expect.closeTo(100), weight: expect.closeTo(1100 / 1900), return: expect.closeTo(0.1), contributionBps: expect.closeTo(500) })
    // −€200 on a base of €2,100 (the evening before).
    expect(b?.contributionBps).toBeCloseTo((-200 / 2100) * 10_000)
    expect(b?.return).toBeCloseTo(-0.2)
    expect(result.totalBps).toBeCloseTo(500 - (200 / 2100) * 10_000)
    // €2,000 became €1,900: −5%, a little apart from the sum of the parts.
    expect(result.twrBps).toBeCloseTo(-500)
  })

  it('measures a later period from the value the positions had when it started', () => {
    const result = contributions(transactions, prices, DEFAULT_OPTIONS, days, { from: 1, to: 2 }, today)
    const a = result.positions.find((p) => p.key === A)
    expect(a?.pnl).toBeCloseTo(100)
    // €1,000 at stake when the period starts, nothing put in during it.
    expect(a?.return).toBeCloseTo(0.1)
    expect(result.positions.find((p) => p.key === B)?.pnl).toBeCloseTo(-200)
  })
})

describe('topAndBottom', () => {
  const position = (key: string, pnl: number): Contribution => ({ key, product: key, assetClass: 'stock', pnl, weight: 0, contributionBps: 0 })

  it('takes the three best and the three worst, without repeating one', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) => position(`P${n}`, n * 10 - 40))
    const { top, bottom } = topAndBottom(list)
    expect(top.map((p) => p.key)).toEqual(['P7', 'P6', 'P5'])
    expect(bottom.map((p) => p.key)).toEqual(['P1', 'P2', 'P3'])
    expect(topAndBottom(list.slice(0, 2)).bottom).toEqual([])
  })
})
