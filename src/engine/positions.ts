import type { Transaction } from '../model/transaction.ts'
import { hasDeposits, ledgerOn } from './ledger.ts'
import type { EngineOptions } from './options.ts'
import type { PriceBook } from './priceBook.ts'
import { valueHoldings } from './series.ts'

export interface Position {
  key: string
  product: string
  isin?: string
  symbol?: string
  quantity: number
  /** Cost basis per unit in EUR. */
  averageCost: number
  costBasis: number
  /** EUR price per unit, undefined when no price at all is known. */
  price?: number
  priceSource?: 'market' | 'trade'
  priceDate?: string
  stale: boolean
  value: number
  /** value - costBasis */
  pnl: number
  /** pnl / costBasis */
  pnlPercent: number
}

/** Open positions on `date`, valued at that day's prices. */
export function positionsOn(
  transactions: Transaction[],
  prices: PriceBook,
  options: EngineOptions,
  date: string,
): Position[] {
  const ledger = ledgerOn(transactions, date, options, options.includeDeposits && hasDeposits(transactions))
  return valueHoldings(ledger, prices, date).priced.map(({ holding, price, value }) => {
    const symbol = prices.symbolOf(holding.key)
    return {
      key: holding.key,
      product: holding.product,
      ...(holding.isin ? { isin: holding.isin } : {}),
      ...(symbol ? { symbol } : {}),
      quantity: holding.quantity,
      averageCost: holding.cost / holding.quantity,
      costBasis: holding.cost,
      ...(price ? { price: price.eur, priceSource: price.source, priceDate: price.date } : {}),
      stale: price ? price.stale : true,
      value,
      pnl: value - holding.cost,
      pnlPercent: holding.cost > 0 ? (value - holding.cost) / holding.cost : 0,
    }
  })
}
