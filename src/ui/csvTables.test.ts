import { afterEach, describe, expect, it } from 'vitest'
import type { Position } from '../engine/positions.ts'
import { tx } from '../engine/testing.ts'
import { setAmountsHidden } from './format.ts'
import { chargesRows, incomeCsvRows, positionsRows, salesRows, transactionRows } from './csvTables.ts'

afterEach(() => setAmountsHidden(false))

const position = (key: string, value: number, cost: number): Position => ({
  key,
  product: `Product ${key}`,
  isin: key,
  symbol: `${key}.AS`,
  quantity: 2,
  averageCost: cost / 2,
  costBasis: cost,
  price: value / 2,
  priceSource: 'market',
  priceDate: '2026-03-10',
  stale: false,
  value,
  pnl: value - cost,
  pnlPercent: (value - cost) / cost,
})

describe('CSV rows of the tables', () => {
  it('positions: exact amounts in the base currency, return and weight in percent, also with amounts hidden', () => {
    setAmountsHidden(true)
    const rows = positionsRows([position('A', 750, 500), position('B', 250, 200)], 'USD')
    expect(rows[0]).toContain('Value (USD)')
    expect(rows[0]).toContain('Weight (%)')
    expect(rows[1]).toEqual(['Product A', 'A', 'A.AS', 2, '250.00', '375.00', '2026-03-10', 'market', '500.00', '750.00', '250.00', '50.00', '75.00'])
    expect(rows[2]?.at(-1)).toBe('25.00')
  })

  it('transactions: as stored, in EUR, with their source', () => {
    const rows = transactionRows([tx('buy', '2026-03-02', { isin: 'IE00B4L5Y983', quantity: 3, price: 100, amount: 300, costsEur: 2 })])
    expect(rows[0]).toContain('Net (EUR)')
    expect(rows[1]).toEqual(['2026-03-02', 'buy', 'IE00B4L5Y983', 'IE00B4L5Y983', undefined, 'stock', 3, 100, 'EUR', '-300.00', '2.00', '0.00', '0.00', '-302.00', 'test', 'test'])
  })

  it('sales, income and costs per year', () => {
    const sale = { date: '2026-02-01', key: 'A', product: 'Apple', isin: 'US0378331005', quantity: 1, proceeds: 190, cost: 150, gain: 40, charges: 1 }
    expect(salesRows([sale], 'EUR')[1]).toEqual(['2026-02-01', 'Apple', 'US0378331005', 1, '190.00', '150.00', '1.00', '40.00'])

    const income = { date: '2026-02-15', key: 'A', product: 'Apple', kind: 'dividend' as const, gross: 10, taxes: 3, costs: 0.5, net: 6.5 }
    const incomeRows = incomeCsvRows([income], 'EUR')
    expect(incomeRows[0]).toContain('Withheld tax (EUR)')
    expect(incomeRows[1]).toEqual(['2026-02-15', 'Apple', undefined, 'dividend', '10.00', '3.00', '0.50', '6.50'])

    const year = { year: '2025', transactionCosts: 12, fxCosts: 1.25, tradeTaxes: 3.5, incomeTaxes: 4, otherTaxes: 0, total: 20.75 }
    expect(chargesRows([year], 'EUR')[1]).toEqual(['2025', '12.00', '1.25', '3.50', '4.00', '0.00', '20.75'])
  })
})
