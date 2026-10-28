import { describe, expect, it } from 'vitest'
import { FxRates } from '../market/fx.ts'
import { PriceSeries } from '../market/priceCache.ts'
import { DEFAULT_OPTIONS } from './options.ts'
import { positionsOn } from './positions.ts'
import { PriceBook, type PriceBookInputs } from './priceBook.ts'
import { computeDailySeries } from './series.ts'
import { tx } from './testing.ts'

const A = 'XA0000000001'

function book(closes: [string, number][], extra: Partial<PriceBookInputs> = {}, transactions: ReturnType<typeof tx>[] = []) {
  return new PriceBook(
    {
      symbols: new Map([[A, 'AAA']]),
      series: new Map([['AAA', PriceSeries.fromPoints('AAA', closes.map(([date, close]) => ({ symbol: 'AAA', date, close })))]]),
      currencies: new Map([['AAA', 'EUR']]),
      splits: new Map(),
      fx: new FxRates([]),
      ...extra,
    },
    transactions,
  )
}

const byDate = <T extends { date: string }>(points: T[]): Record<string, T> => Object.fromEntries(points.map((p) => [p.date, p]))

describe('daily series: buy only', () => {
  // Buy 10 for 1000 + 2 costs on Friday; closes 100 (Fri), 110 (Mon); weekend carries Friday's close.
  const trades = [tx('buy', '2026-10-16', { isin: A, quantity: 10, amount: 1000, costsEur: 2 })]
  const { points } = computeDailySeries(trades, book([['2026-10-16', 100], ['2026-10-19', 110]]), DEFAULT_OPTIONS, '2026-10-19')
  const day = byDate(points)

  it('has one point per calendar day', () => {
    expect(points.map((p) => p.date)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'])
  })

  it('values the position at the close and carries it over the weekend', () => {
    expect(day['2026-10-16']).toMatchObject({ value: 1000, invested: 1002, pnl: -2, unrealized: -2, realized: 0, inflow: 1002 })
    expect(day['2026-10-18']).toMatchObject({ value: 1000, inflow: 0, estimated: 0 })
  })

  it('computes profit and simple return', () => {
    // 1100 - 1002 = 98; 98 / 1002
    expect(day['2026-10-19']?.pnl).toBeCloseTo(98, 10)
    expect(day['2026-10-19']?.simpleReturn).toBeCloseTo(98 / 1002, 12)
  })
})

describe('daily series: partial and full sell', () => {
  const trades = [
    tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 }),
    tx('sell', '2026-01-07', { isin: A, quantity: 4, amount: 480 }),
    tx('sell', '2026-01-09', { isin: A, quantity: 6, amount: 660 }),
  ]
  const prices = book([['2026-01-05', 100], ['2026-01-06', 115], ['2026-01-07', 120], ['2026-01-08', 105], ['2026-01-09', 110]])
  const day = byDate(computeDailySeries(trades, prices, DEFAULT_OPTIONS, '2026-01-10').points)

  it('splits profit into realized and unrealized', () => {
    // After selling 4 at 120: realized 480 - 400 = 80; 6 left at cost 600, worth 6 * 120 = 720
    expect(day['2026-01-07']).toMatchObject({ realized: 80, unrealized: 120, pnl: 200, value: 720, invested: 520 })
    // Next day the price drops to 105: unrealized 30
    expect(day['2026-01-08']).toMatchObject({ realized: 80, unrealized: 30, pnl: 110 })
  })

  it('keeps the realized profit after the full sale', () => {
    // 80 + (660 - 600) = 140; invested = 1000 - 480 - 660 = -140
    expect(day['2026-01-10']).toMatchObject({ value: 0, realized: 140, unrealized: 0, pnl: 140, invested: -140 })
    // The base of the simple return stays at the peak capital of 1000
    expect(day['2026-01-10']?.capitalBase).toBe(1000)
    expect(day['2026-01-10']?.simpleReturn).toBeCloseTo(0.14, 12)
  })
})

describe('daily series: dividend', () => {
  it('adds the net dividend to realized profit', () => {
    const trades = [
      tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 }),
      tx('dividend', '2026-01-06', { isin: A, amount: 30, taxesEur: 9 }),
    ]
    const day = byDate(computeDailySeries(trades, book([['2026-01-05', 100]]), DEFAULT_OPTIONS, '2026-01-06').points)
    expect(day['2026-01-06']).toMatchObject({ realized: 21, pnl: 21, value: 1000, outflow: 21 })
  })
})

describe('daily series: foreign currency', () => {
  it('converts closes with the rate of the day', () => {
    const trades = [tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000, currency: 'USD' })]
    const prices = book([['2026-01-05', 120], ['2026-01-06', 120]], {
      currencies: new Map([['AAA', 'USD']]),
      fx: new FxRates([
        { date: '2026-01-05', rates: { USD: 1.2 } },
        { date: '2026-01-06', rates: { USD: 1.25 } },
      ]),
    })
    const day = byDate(computeDailySeries(trades, prices, DEFAULT_OPTIONS, '2026-01-06').points)
    // 10 * 120 / 1.2 = 1000; then the dollar weakens: 10 * 120 / 1.25 = 960
    expect(day['2026-01-05']?.value).toBeCloseTo(1000, 10)
    expect(day['2026-01-06']?.value).toBeCloseTo(960, 10)
    expect(day['2026-01-06']?.pnl).toBeCloseTo(-40, 10)
  })
})

describe('daily series: split', () => {
  // 5 shares bought at 200; 4:1 split on 2026-07-02. The source's closes are split-adjusted: 50 before.
  const trades = [
    tx('buy', '2026-06-30', { isin: A, quantity: 5, amount: 1000 }),
    tx('split', '2026-07-02', { isin: A, quantity: 20, split: { ratio: 4, fromQuantity: 5 } }),
  ]
  const closes: [string, number][] = [['2026-06-30', 50], ['2026-07-01', 50.5], ['2026-07-02', 51]]

  it('multiplies adjusted closes back before the split', () => {
    const prices = book(closes, { splits: new Map([['AAA', [{ date: '2026-07-02', ratio: 4 }]]]) }, trades)
    const day = byDate(computeDailySeries(trades, prices, DEFAULT_OPTIONS, '2026-07-03').points)
    expect(day['2026-06-30']?.value).toBe(1000) // 5 * 50 * 4
    expect(day['2026-07-01']?.value).toBe(1010) // 5 * 50.5 * 4
    expect(day['2026-07-02']?.value).toBe(1020) // 20 * 51
    expect(day['2026-07-03']?.value).toBe(1020)
  })

  it('uses the split from the export when the price source has none, without double counting', () => {
    const fromExport = byDate(computeDailySeries(trades, book(closes, {}, trades), DEFAULT_OPTIONS, '2026-07-01').points)
    expect(fromExport['2026-07-01']?.value).toBe(1010)
    const both = book(closes, { splits: new Map([['AAA', [{ date: '2026-07-01', ratio: 4 }]]]) }, trades)
    // Provider reports the split a day earlier: still one event. Before 07-01 the factor is 4.
    expect(byDate(computeDailySeries(trades, both, DEFAULT_OPTIONS, '2026-07-01').points)['2026-06-30']?.value).toBe(1000)
  })
})

describe('daily series: missing prices', () => {
  it('falls back to the last trade price and marks the value as estimated', () => {
    const trades = [tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 })]
    const day = byDate(computeDailySeries(trades, book([]), DEFAULT_OPTIONS, '2026-01-06').points)
    expect(day['2026-01-06']).toMatchObject({ value: 1000, estimated: 1 })
  })
})

describe('daily series: deposits and withdrawals', () => {
  const trades = [
    tx('deposit', '2026-01-05', { amount: 1000 }),
    tx('buy', '2026-01-06', { isin: A, quantity: 6, amount: 600 }),
    tx('withdrawal', '2026-01-08', { amount: 100 }),
  ]
  const prices = book([['2026-01-06', 100], ['2026-01-07', 110]])

  it('includes cash and uses deposits as invested capital', () => {
    const { points, cashMode } = computeDailySeries(trades, prices, DEFAULT_OPTIONS, '2026-01-08')
    const day = byDate(points)
    expect(cashMode).toBe(true)
    expect(day['2026-01-05']).toMatchObject({ value: 1000, invested: 1000, pnl: 0, inflow: 1000 })
    expect(day['2026-01-06']).toMatchObject({ value: 1000, inflow: 0 })
    // 6 * 110 + 400 cash
    expect(day['2026-01-07']).toMatchObject({ value: 1060, pnl: 60, simpleReturn: 0.06 })
    expect(day['2026-01-08']).toMatchObject({ value: 960, invested: 900, pnl: 60, outflow: 100 })
  })

  it('values securities only when deposits are excluded', () => {
    const { points, cashMode } = computeDailySeries(trades, prices, { ...DEFAULT_OPTIONS, includeDeposits: false }, '2026-01-07')
    expect(cashMode).toBe(false)
    expect(byDate(points)['2026-01-07']).toMatchObject({ value: 660, invested: 600, pnl: 60 })
  })
})

describe('positionsOn', () => {
  it('lists open positions with average cost, price and profit', () => {
    const trades = [
      tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 }),
      tx('buy', '2026-01-06', { isin: A, quantity: 10, amount: 1200 }),
    ]
    const [position] = positionsOn(trades, book([['2026-01-06', 121]]), DEFAULT_OPTIONS, '2026-01-06')
    expect(position).toMatchObject({
      key: A,
      symbol: 'AAA',
      quantity: 20,
      averageCost: 110,
      costBasis: 2200,
      price: 121,
      priceSource: 'market',
      value: 2420,
      pnl: 220,
      pnlPercent: 0.1,
      stale: false,
    })
  })
})

describe('daily series: a broker with deposits and one without', () => {
  // Broker K has deposits and keeps 500 in cash; broker T only buys and sells, with money from outside.
  const other = (t: ReturnType<typeof tx>) => ({ ...t, source: { ...t.source, broker: 'T' } })
  const trades = [
    tx('deposit', '2026-01-05', { amount: 500 }),
    other(tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 })),
    other(tx('sell', '2026-01-07', { isin: A, quantity: 5, amount: 600 })),
  ]
  const prices = book([['2026-01-05', 100], ['2026-01-07', 120]])
  const { points, cashMode } = computeDailySeries(trades, prices, DEFAULT_OPTIONS, '2026-01-07')
  const day = byDate(points)

  it('pays the trades of the broker without deposits from outside, not from the other cash', () => {
    expect(cashMode).toBe(true)
    // 500 cash + 10 units at 100; invested: the deposit and the 1000 brought in for the buy.
    expect(day['2026-01-05']).toMatchObject({ value: 1500, invested: 1500, pnl: 0 })
    // The 600 of the sale goes out again: 500 cash + 5 units at 120; invested 1500 - 600.
    expect(day['2026-01-07']).toMatchObject({ value: 1100, invested: 900, pnl: 200 })
  })
})

describe('daily series: a deposit that waits as cash', () => {
  const trades = [
    tx('deposit', '2026-01-05', { amount: 1000 }),
    tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 }),
    tx('deposit', '2026-01-07', { amount: 5000 }),
  ]
  const prices = book([['2026-01-05', 100], ['2026-01-06', 110], ['2026-01-08', 121]])
  const day = byDate(computeDailySeries(trades, prices, DEFAULT_OPTIONS, '2026-01-08').points)

  it('leaves the percentage to the securities: +10% and +10% make +21%, whatever was deposited', () => {
    expect(day['2026-01-06']?.twr).toBeCloseTo(0.1, 10)
    expect(day['2026-01-08']?.twr).toBeCloseTo(0.21, 10)
    // The value still includes the cash.
    expect(day['2026-01-08']?.value).toBeCloseTo(6210, 6)
  })
})

describe('daily series: an export that starts after the first buys', () => {
  // 10 bought in the export; 15 sold later, 5 of them bought before the export starts.
  const trades = [tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 }), tx('sell', '2026-01-07', { isin: A, quantity: 15, amount: 1650 })]
  const prices = book([['2026-01-05', 100], ['2026-01-06', 105], ['2026-01-07', 110]])
  const day = byDate(computeDailySeries(trades, prices, DEFAULT_OPTIONS, '2026-01-08').points)

  it('makes no jump in profit or percentage on the sale', () => {
    // The 10 known units gain 10 each; the 5 others came in and left at the sale price.
    expect(day['2026-01-07']?.pnl).toBeCloseTo(100, 6)
    expect(day['2026-01-07']?.twr).toBeCloseTo(0.1, 6)
  })
})
