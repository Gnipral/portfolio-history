import { describe, expect, it } from 'vitest'
import { FxRates } from '../market/fx.ts'
import { PriceSeries } from '../market/priceCache.ts'
import { DEFAULT_OPTIONS } from './options.ts'
import { PriceBook } from './priceBook.ts'
import { irrBetween, irrSeries, twrBetween, twrIndex, xirr } from './returns.ts'
import { computeDailySeries } from './series.ts'
import { tx } from './testing.ts'

describe('twrIndex', () => {
  // Day 0: invest 1000, worth 1000. Day 1: worth 1100 (+10%).
  // Day 2: invest another 1000 at the start, worth 2100 at the end (0%).
  // Day 3: worth 2310 (+10%). TWR = 1.1 * 1.0 * 1.1 - 1 = 21%.
  const days = [
    { value: 1000, inflow: 1000, outflow: 0 },
    { value: 1100, inflow: 0, outflow: 0 },
    { value: 2100, inflow: 1000, outflow: 0 },
    { value: 2310, inflow: 0, outflow: 0 },
  ]

  it('chain-links daily returns, unaffected by the size of flows', () => {
    const index = twrIndex(days)
    expect(index.map((v) => Number(v.toFixed(10)))).toEqual([1, 1.1, 1.1, 1.21])
  })

  it('treats outflows as paid at the end of the day', () => {
    // Day 1: worth 1100, then 600 is taken out: value 500, outflow 600 -> still +10%
    const index = twrIndex([
      { value: 1000, inflow: 1000, outflow: 0 },
      { value: 500, inflow: 0, outflow: 600 },
    ])
    expect(index[1]).toBeCloseTo(1.1, 12)
  })

  it('stays flat while nothing is invested', () => {
    const index = twrIndex([
      { value: 1000, inflow: 1000, outflow: 0 },
      { value: 0, inflow: 0, outflow: 1050 },
      { value: 0, inflow: 0, outflow: 0 },
      { value: 500, inflow: 500, outflow: 0 },
    ])
    expect(index.map((v) => Number(v.toFixed(10)))).toEqual([1, 1.05, 1.05, 1.05])
  })

  it('computes the return of a sub-range', () => {
    const index = twrIndex(days)
    expect(twrBetween(index, 2, 3)).toBeCloseTo(0.1, 12)
    expect(twrBetween(index, 0, 3)).toBeCloseTo(0.21, 12)
  })
})

describe('xirr', () => {
  it('is 10% for 1000 growing to 1100 in a year', () => {
    expect(xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1100 },
    ])).toBeCloseTo(0.1, 9)
  })

  it('matches the reference example of spreadsheet XIRR', () => {
    const flows = [
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]
    expect(xirr(flows)).toBeCloseTo(0.373362535, 8)
  })

  it('handles near-total losses via bisection', () => {
    const rate = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 1 },
    ])
    expect(rate).toBeCloseTo(-0.999, 6)
  })

  it('has no answer without a sign change or time span', () => {
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: -5 }])).toBeUndefined()
    expect(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2025-01-01', amount: 1010 }])).toBeUndefined()
    expect(xirr([])).toBeUndefined()
  })

  it('weights money by time: a late deposit counts less', () => {
    // 1000 in for a year and 1000 in for half a year; 2150 back -> between the two simple rates
    const rate = xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2025-07-02', amount: -1000 },
      { date: '2026-01-01', amount: 2150 },
    ]) as number
    expect(rate).toBeGreaterThan(0.09)
    expect(rate).toBeLessThan(0.11)
    // Check: the net present value at that rate is zero
    const npv = -1000 - 1000 / (1 + rate) ** (182 / 365) + 2150 / (1 + rate)
    expect(npv).toBeCloseTo(0, 6)
  })
})

describe('irrSeries and irrBetween', () => {
  const days = [
    { date: '2025-01-01', value: 1000, inflow: 1000, outflow: 0 },
    { date: '2025-07-02', value: 1050, inflow: 0, outflow: 0 },
    { date: '2026-01-01', value: 1100, inflow: 0, outflow: 0 },
  ]

  it('gives the return to date for every day', () => {
    const irr = irrSeries(days)
    expect(irr[0]).toBeUndefined() // nothing has happened yet
    expect(irr[2]).toBeCloseTo(0.1, 9)
  })

  it('computes the return of a range, starting from the value before it', () => {
    // From 1050 on 2025-07-02 to 1100 on 2026-01-01
    const expected = (1100 / 1050) ** (365 / 183) - 1
    expect(irrBetween(days, 2, 2)).toBeUndefined() // a single day has no time span
    const range = irrBetween(
      [
        { date: '2025-07-01', value: 1050, inflow: 0, outflow: 0 },
        { date: '2025-07-02', value: 1050, inflow: 0, outflow: 0 },
        { date: '2026-01-01', value: 1100, inflow: 0, outflow: 0 },
      ],
      1,
      2,
    )
    expect(range).toBeCloseTo(expected, 9)
  })
})

describe('daily series with returns', () => {
  it('fills TWR and IRR on every point', () => {
    const A = 'XA0000000001'
    const prices = new PriceBook({
      symbols: new Map([[A, 'AAA']]),
      series: new Map([
        ['AAA', PriceSeries.fromPoints('AAA', [
          { symbol: 'AAA', date: '2025-01-01', close: 100 },
          { symbol: 'AAA', date: '2026-01-01', close: 110 },
        ])],
      ]),
      currencies: new Map([['AAA', 'EUR']]),
      splits: new Map(),
      fx: new FxRates([]),
    })
    const { points } = computeDailySeries(
      [tx('buy', '2025-01-01', { isin: A, quantity: 10, amount: 1000 })],
      prices,
      DEFAULT_OPTIONS,
      '2026-01-01',
    )
    const last = points.at(-1)
    expect(points).toHaveLength(366)
    expect(last?.twr).toBeCloseTo(0.1, 12)
    expect(last?.irr).toBeCloseTo(0.1, 9)
    expect(last?.simpleReturn).toBeCloseTo(0.1, 12)
  })
})

describe('twrIndex: data gaps', () => {
  it('ignores a day with a negative value or a rounding residue as base', () => {
    const index = twrIndex([
      { value: 1000, inflow: 1000, outflow: 0 },
      // Cash below zero because the export misses a deposit.
      { value: -50, inflow: 0, outflow: 0 },
      { value: 1100, inflow: 0, outflow: 0 },
      // Everything sold except a residue of a thousandth of a cent.
      { value: 0.00001, inflow: 0, outflow: 1100 },
      { value: 0.5, inflow: 0, outflow: 0 },
    ])
    expect(index.every((level) => level > 0 && level < 10)).toBe(true)
    expect(index.at(-1)).toBe(index.at(-2))
  })
})

describe('money-weighted return in the first year', () => {
  it('is given over the period, next to the annual rate', () => {
    const A = 'XA0000000001'
    const prices = new PriceBook({
      symbols: new Map([[A, 'AAA']]),
      series: new Map([
        ['AAA', PriceSeries.fromPoints('AAA', [
          { symbol: 'AAA', date: '2026-01-01', close: 100 },
          { symbol: 'AAA', date: '2026-01-31', close: 105 },
        ])],
      ]),
      currencies: new Map([['AAA', 'EUR']]),
      splits: new Map(),
      fx: new FxRates([]),
    })
    const { points } = computeDailySeries([tx('buy', '2026-01-01', { isin: A, quantity: 10, amount: 1000 })], prices, DEFAULT_OPTIONS, '2026-01-31')
    const last = points.at(-1)
    expect(last?.days).toBe(30)
    expect(last?.irrPeriod).toBeCloseTo(0.05, 9)
    expect(last?.irr).toBeGreaterThan(0.7)
  })
})
