import { describe, expect, it } from 'vitest'
import { FxRates } from '../../market/fx.ts'
import { PriceSeries } from '../../market/priceCache.ts'
import { simulateMix } from '../benchmark.ts'
import { DEFAULT_OPTIONS } from '../options.ts'
import { PriceBook } from '../priceBook.ts'
import { tx } from '../testing.ts'
import { capitalGainsTax, isAdjusted, presetOf, TAX_PRESETS, type CapitalGainsRules, type TaxPreset } from './capitalGains.ts'
import { chargesByYear } from './charges.ts'
import { incomeRows, incomeTotals } from './income.ts'
import { positionSeries } from './positionSeries.ts'
import { realizedByYear, realizedSales } from './realized.ts'
import { riskSummary } from './risk.ts'

const A = 'XA0000000001'
const B = 'XB0000000002'

const series = (symbol: string, closes: [string, number][]) =>
  PriceSeries.fromPoints(symbol, closes.map(([date, close]) => ({ symbol, date, close })))

function book(closes: [string, number][]) {
  return new PriceBook({
    symbols: new Map([[A, 'AAA']]),
    series: new Map([['AAA', series('AAA', closes)]]),
    currencies: new Map([['AAA', 'EUR']]),
    splits: new Map(),
    fx: new FxRates([]),
  })
}

describe('income', () => {
  const transactions = [
    tx('dividend', '2025-03-01', { isin: A, product: 'Alpha', amount: 30, taxesEur: 9, costsEur: 1 }),
    tx('dividend', '2025-06-01', { isin: B, product: 'Beta', amount: 10 }),
    // DEGIRO books the withholding tax as its own row.
    tx('tax', '2025-06-01', { isin: B, product: 'Beta', amount: 1.5 }),
    tx('dividend', '2026-01-02', { product: 'Interest', amount: 2 }),
  ]

  it('nets every payment, with the separate withholding tax of the same day', () => {
    const rows = incomeRows(transactions)
    expect(rows.map((r) => [r.product, r.kind, r.gross, r.taxes, r.costs, r.net])).toEqual([
      ['Alpha', 'dividend', 30, 9, 1, 20],
      ['Beta', 'dividend', 10, 1.5, 0, 8.5],
      ['Interest', 'interest', 2, 0, 0, 2],
    ])
  })

  it('sums per year', () => {
    const totals = incomeTotals(incomeRows(transactions), (r) => r.date.slice(0, 4))
    expect(totals.map((t) => [t.label, t.gross, t.net, t.count])).toEqual([
      ['2025', 40, 28.5, 2],
      ['2026', 2, 2, 1],
    ])
  })
})

describe('chargesByYear', () => {
  it('splits costs, FX costs, taxes on trades and taxes on income', () => {
    const years = chargesByYear([
      tx('buy', '2025-01-02', { isin: A, quantity: 10, amount: 1000, costsEur: 2, taxesEur: 3.5, fxCostsEur: 1 }),
      tx('fee', '2025-02-01', { amount: 2.5 }),
      tx('dividend', '2025-03-01', { isin: A, amount: 30, taxesEur: 9 }),
      tx('tax', '2025-03-01', { isin: A, amount: 1 }),
      tx('tax', '2025-04-01', { amount: 4 }),
      // DEGIRO books the TOB of a trade as its own row.
      tx('buy', '2025-05-02', { isin: B, quantity: 1, amount: 100 }),
      tx('tax', '2025-05-02', { isin: B, amount: 0.35 }),
      tx('sell', '2026-01-02', { isin: A, quantity: 10, amount: 1200, costsEur: 2, taxesEur: 4.2 }),
    ])
    expect(years).toEqual([
      { year: '2025', transactionCosts: 4.5, fxCosts: 1, tradeTaxes: 3.85, incomeTaxes: 10, otherTaxes: 4, total: 23.35 },
      { year: '2026', transactionCosts: 2, fxCosts: 0, tradeTaxes: 4.2, incomeTaxes: 0, otherTaxes: 0, total: 6.2 },
    ])
  })
})

describe('realized sales', () => {
  it('lists every sale with its cost basis and sums gains and losses per year', () => {
    const sales = realizedSales(
      [
        tx('buy', '2025-01-02', { isin: A, quantity: 10, amount: 1000 }),
        tx('buy', '2025-01-02', { isin: B, quantity: 10, amount: 1000 }),
        tx('sell', '2025-06-01', { isin: A, quantity: 5, amount: 600, costsEur: 2 }),
        tx('sell', '2025-07-01', { isin: B, quantity: 10, amount: 900 }),
      ],
      DEFAULT_OPTIONS,
    )
    expect(sales.map((s) => [s.key, s.quantity, s.proceeds, s.cost, s.gain])).toEqual([
      [A, 5, 598, 500, 98],
      [B, 10, 900, 1000, -100],
    ])
    expect(realizedByYear(sales)).toEqual([{ year: '2025', proceeds: 1498, cost: 1500, gains: 98, losses: 100, net: -2, count: 2 }])
  })
})

describe('capital gains tax', () => {
  const rulesOf = (id: string, changes: Partial<CapitalGainsRules> = {}): CapitalGainsRules => ({
    ...(TAX_PRESETS.find((p) => p.id === id) as TaxPreset).rules,
    ...changes,
  })
  const priceOn = (date: string, prices: Record<string, number>) => (holding: { key: string }, day: string) =>
    day === date ? prices[holding.key] : undefined

  describe('Belgium', () => {
    const BE = rulesOf('BE')

    it('taxes only the gain made from 2026 on, above the exemption', () => {
      const result = capitalGainsTax(
        [
          tx('buy', '2020-01-02', { isin: A, quantity: 1000, amount: 50_000 }),
          // Worth 80,000 on 31 December 2025: the 30,000 gain before 2026 is not taxed.
          tx('sell', '2026-06-01', { isin: A, quantity: 1000, amount: 100_000 }),
        ],
        BE,
        priceOn('2025-12-31', { [A]: 80 }),
        '2026-10-21',
      )
      expect(result.sales[0]).toMatchObject({ cost: 80_000, gain: 20_000 })
      expect(result.years).toEqual([
        { year: '2026', gains: 20_000, losses: 0, net: 20_000, lossesCarriedIn: 0, exemption: 10_000, taxable: 10_000, tax: 1000 },
      ])
    })

    it('keeps the historical cost when it is higher, and nets losses within the year', () => {
      const result = capitalGainsTax(
        [
          tx('buy', '2024-01-02', { isin: A, quantity: 100, amount: 10_000 }),
          tx('buy', '2024-01-02', { isin: B, quantity: 100, amount: 10_000 }),
          // A is worth 50 on the reference date (cost 100 kept); B is worth 150.
          tx('sell', '2026-03-01', { isin: A, quantity: 100, amount: 9_000 }),
          tx('sell', '2026-04-01', { isin: B, quantity: 100, amount: 40_000 }),
        ],
        BE,
        priceOn('2025-12-31', { [A]: 50, [B]: 150 }),
        '2026-12-31',
      )
      expect(result.sales.map((s) => s.gain)).toEqual([-1000, 25_000])
      expect(result.years[0]).toMatchObject({ gains: 25_000, losses: 1000, net: 24_000, taxable: 14_000 })
      expect(result.years[0]?.tax).toBeCloseTo(1400, 9)
    })

    it('carries an unused exemption over, up to 1,000 per year, and does not carry losses', () => {
      const result = capitalGainsTax(
        [
          tx('buy', '2026-01-05', { isin: A, quantity: 100, amount: 10_000 }),
          tx('buy', '2026-01-05', { isin: B, quantity: 100, amount: 10_000 }),
          tx('sell', '2026-06-01', { isin: B, quantity: 100, amount: 5_000 }),
          tx('sell', '2027-06-01', { isin: A, quantity: 100, amount: 22_000 }),
        ],
        BE,
        () => undefined,
        '2027-12-31',
      )
      expect(result.years.map((y) => [y.year, y.net, y.lossesCarriedIn, y.exemption, y.taxable])).toEqual([
        ['2026', -5_000, 0, 10_000, 0],
        ['2027', 12_000, 0, 11_000, 1000],
      ])
    })
  })

  it('Germany: FIFO, a small exemption and losses that carry forward without limit', () => {
    const result = capitalGainsTax(
      [
        tx('buy', '2024-01-02', { isin: A, quantity: 10, amount: 1_000 }),
        tx('buy', '2024-06-03', { isin: A, quantity: 10, amount: 2_000 }),
        // FIFO: the 10 units of 100 are sold.
        tx('sell', '2024-09-02', { isin: A, quantity: 10, amount: 600 }),
        tx('sell', '2026-03-02', { isin: A, quantity: 10, amount: 5_000 }),
      ],
      rulesOf('DE'),
      () => undefined,
      '2026-12-31',
    )
    expect(result.sales.map((s) => s.gain)).toEqual([-400, 3_000])
    const last = result.years.at(-1)
    expect(last).toMatchObject({ year: '2026', net: 3_000, lossesCarriedIn: 400, exemption: 1_000, taxable: 1_600 })
    expect(last?.tax).toBeCloseTo(1_600 * 0.26375, 9)
  })

  it('France: a loss expires after ten years', () => {
    const trades = [
      tx('buy', '2010-01-04', { isin: A, quantity: 10, amount: 1_000 }),
      tx('sell', '2010-06-01', { isin: A, quantity: 10, amount: 500 }),
      tx('buy', '2021-01-04', { isin: B, quantity: 10, amount: 1_000 }),
      tx('sell', '2021-06-01', { isin: B, quantity: 10, amount: 2_000 }),
    ]
    const year2021 = (rules: CapitalGainsRules) => capitalGainsTax(trades, rules, () => undefined, '2021-12-31').years.at(-1)
    expect(year2021(rulesOf('FR'))).toMatchObject({ lossesCarriedIn: 0, taxable: 1_000, tax: 300 })
    // With an unlimited carry-forward the 2010 loss would still count.
    expect(year2021(rulesOf('FR', { lossCarryForwardYears: 99 }))).toMatchObject({ lossesCarriedIn: 500, taxable: 500 })
  })

  it('applies own rules: rate, exemption and a step-up to the value of a date', () => {
    const result = capitalGainsTax(
      [
        tx('buy', '2020-01-02', { isin: A, quantity: 10, amount: 2_000 }),
        // Worth less than its cost on the reference date: with "value" that lower value counts.
        tx('sell', '2025-06-01', { isin: A, quantity: 10, amount: 2_500 }),
      ],
      rulesOf('custom', { rate: 0.2, yearlyExemption: 100, maxExemption: 100, referenceDate: '2023-12-31', stepUp: 'value' }),
      priceOn('2023-12-31', { [A]: 150 }),
      '2025-12-31',
    )
    expect(result.sales[0]).toMatchObject({ cost: 1_500, gain: 1_000 })
    expect(result.years.at(-1)).toMatchObject({ taxable: 900, tax: 180 })
  })

  it('names the preset and sees when the rules were changed', () => {
    expect(presetOf(rulesOf('DE')).label).toBe('Germany')
    expect(isAdjusted(rulesOf('DE'))).toBe(false)
    expect(isAdjusted(rulesOf('DE', { rate: 0.28 }))).toBe(true)
  })
})

describe('riskSummary', () => {
  // TWR levels: up 10%, down to 0.88 (-20% from the peak), back above the peak.
  const points = [
    { date: '2026-01-30', twr: 0 },
    { date: '2026-02-27', twr: 0.1 },
    { date: '2026-03-31', twr: -0.12 },
    { date: '2026-04-30', twr: 0.05 },
    { date: '2026-05-29', twr: 0.12 },
  ]

  it('finds the deepest fall from a peak and when it was recovered', () => {
    const risk = riskSummary(points)
    expect(risk.maxDrawdown).toMatchObject({ peak: '2026-02-27', trough: '2026-03-31', recovered: '2026-05-29' })
    expect(risk.maxDrawdown?.depth).toBeCloseTo(0.88 / 1.1 - 1, 12)
    expect(risk.currentDrawdown).toBe(0)
  })

  it('chain-links month returns and names the best and worst month', () => {
    const risk = riskSummary(points)
    expect(risk.months.map((m) => m.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'])
    expect(risk.months[2]?.return).toBeCloseTo(0.88 / 1.1 - 1, 12)
    expect(risk.worstMonth?.period).toBe('2026-03')
    expect(risk.bestMonth?.period).toBe('2026-04')
    expect(risk.positiveMonths).toBeCloseTo(3 / 5, 12)
    expect(risk.years).toEqual([{ period: '2026', return: expect.closeTo(0.12, 12) }])
  })

  it('gives no volatility for too few days', () => {
    expect(riskSummary(points).volatility).toBeUndefined()
  })
})

describe('positionSeries', () => {
  it('values one position on every day, with its trades', () => {
    const { points, trades } = positionSeries(
      [
        tx('buy', '2026-01-05', { isin: A, quantity: 10, amount: 1000 }),
        tx('buy', '2026-01-05', { isin: B, quantity: 1, amount: 50 }),
        tx('sell', '2026-01-07', { isin: A, quantity: 4, amount: 480 }),
      ],
      book([
        ['2026-01-05', 100],
        ['2026-01-06', 110],
        ['2026-01-07', 120],
      ]),
      DEFAULT_OPTIONS,
      A,
      '2026-01-07',
    )
    expect(points.map((p) => [p.date, p.quantity, p.value, p.cost])).toEqual([
      ['2026-01-05', 10, 1000, 1000],
      ['2026-01-06', 10, 1100, 1000],
      ['2026-01-07', 6, 720, 600],
    ])
    expect(trades.map((t) => t.type)).toEqual(['buy', 'sell'])
  })
})

describe('simulateMix', () => {
  it('splits every euro over the components by weight', () => {
    const up = series('UP', [
      ['2026-01-05', 100],
      ['2026-01-06', 120],
    ])
    const flat = series('FLAT', [
      ['2026-01-05', 50],
      ['2026-01-06', 50],
    ])
    const points = simulateMix(
      [
        { date: '2026-01-05', inflow: 1000, outflow: 0 },
        { date: '2026-01-06', inflow: 0, outflow: 0 },
      ],
      [
        { prices: up, weight: 0.8 },
        { prices: flat, weight: 0.2 },
      ],
    )
    // 800 grows 20% to 960, 200 stays: 1160.
    expect(points.at(-1)?.value).toBeCloseTo(1160, 9)
    expect(points.at(-1)?.pnl).toBeCloseTo(160, 9)
    expect(points.at(-1)?.twr).toBeCloseTo(0.16, 12)
  })
})
