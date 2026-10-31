import { describe, expect, it } from 'vitest'
import type { AssetClass } from '../../model/transaction.ts'
import type { Position } from '../positions.ts'
import { tx } from '../testing.ts'
import { riskChecks, type RiskCheckInputs } from './riskChecks.ts'

const DATE = '2026-03-10'

function position(key: string, value: number): Position {
  return { key, product: key, quantity: 1, averageCost: value, costBasis: value, value, pnl: 0, pnlPercent: 0, stale: false }
}

/** A buy per holding, so the checks know its asset class and currency. */
function holdings(list: [key: string, value: number, assetClass: AssetClass, currency?: string][]): Pick<RiskCheckInputs, 'transactions' | 'positions'> {
  return {
    transactions: list.map(([key, value, assetClass, currency = 'EUR']) => tx('buy', '2026-01-02', { isin: key, assetClass, currency, quantity: 1, amount: value })),
    positions: list.map(([key, value]) => position(key, value)),
  }
}

function run(inputs: Partial<RiskCheckInputs> & Pick<RiskCheckInputs, 'transactions' | 'positions'>) {
  const securities = inputs.positions.reduce((sum, p) => sum + p.value, 0)
  return riskChecks({ portfolioValue: securities, cashMode: false, baseCurrency: 'EUR', otherAssets: [], yearlySpending: 0, date: DATE, ...inputs })
}

describe('riskChecks', () => {
  it('passes a portfolio of one world ETF', () => {
    const result = run(holdings([['IE00WORLD0001', 10_000, 'etf']]))
    expect(result.singleStock.status).toBe('pass')
    expect(result.spread.status).toBe('pass')
    expect(result.crypto.status).toBe('pass')
    expect(result.currency.status).toBe('pass')
    expect(result.fees.status).toBe('pass')
  })

  it('names stocks above a tenth of the portfolio, largest first', () => {
    const result = run(
      holdings([
        ['ETF', 7_000, 'etf'],
        ['SMALL', 500, 'stock'],
        ['BIG', 2_000, 'stock'],
        ['MID', 500, 'stock'],
      ]),
    )
    expect(result.singleStock).toEqual({ status: 'warn', heavy: [{ label: 'BIG', share: 0.2 }] })
  })

  it('warns about a few stocks without any fund', () => {
    const result = run(holdings([['A', 100, 'stock'], ['B', 100, 'stock'], ['C', 100, 'stock']]))
    expect(result.spread).toEqual({ status: 'warn', stocks: 3, funds: 0 })
  })

  it('adds up crypto and other currencies as shares of the securities', () => {
    const result = run(
      holdings([
        ['ETF', 4_000, 'etf'],
        ['BTC', 2_000, 'crypto', 'USD'],
        ['AAPL', 3_000, 'stock', 'USD'],
        ['VOD', 1_000, 'stock', 'GBX'],
      ]),
    )
    expect(result.crypto).toEqual({ status: 'warn', share: 0.2 })
    expect(result.currency.status).toBe('warn')
    expect(result.currency.share).toBeCloseTo(0.6)
    expect(result.currency.currencies).toEqual([
      { label: 'USD', share: 0.5 },
      { label: 'GBP', share: 0.1 },
    ])
  })

  it('compares costs with everything bought and sold', () => {
    const transactions = [
      tx('buy', '2026-01-02', { isin: 'A', assetClass: 'etf', quantity: 1, amount: 1_000, costsEur: 20 }),
      tx('sell', '2026-02-02', { isin: 'A', assetClass: 'etf', quantity: 1, amount: 1_000, fxCostsEur: 5 }),
    ]
    const result = run({ transactions, positions: [] })
    expect(result.fees).toEqual({ status: 'warn', ratio: 0.0125, fees: 25, volume: 2_000 })
  })

  it('looks at cash only when the portfolio holds it', () => {
    const base = holdings([['ETF', 7_000, 'etf']])
    expect(run(base).cash.status).toBe('unknown')
    const result = run({ ...base, cashMode: true, portfolioValue: 10_000 })
    expect(result.cash).toEqual({ status: 'warn', share: 0.3, cash: 3_000, held: true })
  })

  it('needs spending and savings for the emergency fund', () => {
    const base = holdings([['ETF', 7_000, 'etf']])
    const savings = [{ id: 's', name: 'Savings', kind: 'savings' as const, values: [{ date: '2026-01-01', value: 5_000 }] }]
    expect(run(base).emergency.status).toBe('unknown')
    expect(run({ ...base, otherAssets: savings }).emergency.status).toBe('unknown')
    // 24,000 a year is 2,000 a month: 5,000 covers two and a half months.
    expect(run({ ...base, otherAssets: savings, yearlySpending: 24_000 }).emergency).toEqual({
      status: 'warn',
      savings: 5_000,
      months: 2.5,
      hasSavings: true,
      hasSpending: true,
    })
    expect(run({ ...base, otherAssets: savings, yearlySpending: 12_000 }).emergency.status).toBe('pass')
  })
})
