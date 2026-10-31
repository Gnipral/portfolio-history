import { describe, expect, it } from 'vitest'
import { FxRates } from '../../market/fx.ts'
import { PriceSeries } from '../../market/priceCache.ts'
import { DEFAULT_OPTIONS } from '../options.ts'
import { PriceBook } from '../priceBook.ts'
import { computeDailySeries } from '../series.ts'
import { tx } from '../testing.ts'
import { chargesImpact, costWaterfall, seriesWithoutCharges } from './costWaterfall.ts'

const A = 'XA0000000001'
const prices = new PriceBook({
  symbols: new Map([[A, 'AAA']]),
  series: new Map([
    [
      'AAA',
      PriceSeries.fromPoints('AAA', [
        { symbol: 'AAA', date: '2026-03-02', close: 100 },
        { symbol: 'AAA', date: '2026-03-04', close: 110 },
      ]),
    ],
  ]),
  currencies: new Map([['AAA', 'EUR']]),
  splits: new Map(),
  fx: new FxRates([]),
})

// €1,000 of A with €2 commission, €3.50 TOB and €1 FX cost; a €20 dividend with €6 withheld; a €5 connection fee.
const transactions = [
  tx('buy', '2026-03-02', { isin: A, quantity: 10, amount: 1000, costsEur: 2, taxesEur: 3.5, fxCostsEur: 1 }),
  tx('dividend', '2026-03-03', { isin: A, amount: 20, taxesEur: 6 }),
  tx('fee', '2026-03-03', { amount: 5 }),
]
const today = '2026-03-04'
const window = { from: 0, to: 2 }

describe('costWaterfall', () => {
  it('goes from the gains of the price to the net profit of the dashboard', () => {
    const points = computeDailySeries(transactions, prices, DEFAULT_OPTIONS, today).points
    const { rows, net } = costWaterfall(transactions, points, window, DEFAULT_OPTIONS)
    // 1,100 − 1,006.50 + 14 net dividend − 5 fee.
    expect(net).toBeCloseTo(102.5)
    expect(rows.map((r) => [r.step, Number(r.amount.toFixed(2)), r.counted])).toEqual([
      ['priceGains', 100, true],
      ['dividends', 20, true],
      ['brokerFees', -7, true],
      ['tradeTaxes', -3.5, true],
      ['fxCosts', -1, true],
      ['withholdingTax', -6, true],
    ])
    const invested = points[2]?.invested as number
    expect(rows[0]?.ofInvested).toBeCloseTo(100 / invested)
  })

  it('lists what the toggles leave out, without letting it change the sum', () => {
    const options = { ...DEFAULT_OPTIONS, includeDividends: false }
    const points = computeDailySeries(transactions, prices, options, today).points
    const { rows, net } = costWaterfall(transactions, points, window, options)
    expect(net).toBeCloseTo(88.5)
    expect(rows.find((r) => r.step === 'priceGains')?.amount).toBeCloseTo(100)
    expect(rows.filter((r) => !r.counted).map((r) => r.step)).toEqual(['dividends', 'withholdingTax'])
  })
})

describe('chargesImpact', () => {
  it('is what the portfolio would have made without any charge', () => {
    const points = computeDailySeries(transactions, prices, DEFAULT_OPTIONS, today).points
    const without = seriesWithoutCharges(transactions, prices, DEFAULT_OPTIONS, today)
    const impact = chargesImpact(points, without, window)
    // 2 + 3.50 + 1 + 6 + 5.
    expect(impact?.profitLost).toBeCloseTo(17.5)
    expect(impact?.pnlWithout).toBeCloseTo(120)
    expect(impact?.twrLost).toBeGreaterThan(0)
  })
})
