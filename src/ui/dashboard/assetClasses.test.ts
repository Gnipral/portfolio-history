import { describe, expect, it } from 'vitest'
import { tx } from '../../engine/testing.ts'
import { assetClassesOf, filterByAssetClass } from './assetClasses.ts'

const ETF = 'IE00B4L5Y983'
const SHARE = 'US0378331005'
const transactions = [
  tx('deposit', '2026-01-02', { amount: 5000 }),
  tx('buy', '2026-01-05', { isin: ETF, assetClass: 'etf', quantity: 10, amount: 1000 }),
  tx('buy', '2026-01-06', { isin: SHARE, assetClass: 'stock', quantity: 5, amount: 900 }),
  // Dividend rows often come without the type of asset: they follow their instrument.
  tx('dividend', '2026-03-01', { isin: SHARE, assetClass: 'unknown', amount: 12 }),
  tx('tax', '2026-03-01', { isin: SHARE, assetClass: 'unknown', amount: 3 }),
  tx('buy', '2026-02-01', { product: 'Bitcoin', ticker: 'BTC', assetClass: 'crypto', quantity: 0.01, amount: 600 }),
]

describe('asset classes', () => {
  it('lists the types held, in a fixed order', () => {
    expect(assetClassesOf(transactions)).toEqual(['ETFs', 'Stocks', 'Crypto'])
  })

  it('keeps the trades, dividends and taxes of the chosen types, and no cash', () => {
    const stocks = filterByAssetClass(transactions, ['Stocks'])
    expect(stocks.map((t) => t.type)).toEqual(['buy', 'dividend', 'tax'])
    expect(filterByAssetClass(transactions, ['ETFs', 'Crypto']).map((t) => t.assetClass)).toEqual(['etf', 'crypto'])
  })

  it('keeps everything without a choice', () => {
    expect(filterByAssetClass(transactions, [])).toBe(transactions)
  })
})
