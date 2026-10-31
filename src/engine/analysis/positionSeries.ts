import { addDays } from '../../market/dates.ts'
import { instrumentKey } from '../../market/instruments.ts'
import type { Transaction } from '../../model/transaction.ts'
import { Ledger, sortTransactions } from '../ledger.ts'
import type { EngineOptions } from '../options.ts'
import type { PriceBook } from '../priceBook.ts'

export interface PositionPoint {
  date: string
  quantity: number
  /** Market value in EUR (0 without any price). */
  value: number
  /** Cost basis of the units held, in EUR. */
  cost: number
  /**
   * Result of the position so far: realized (sales, dividends, its own fees and taxes, as the toggles
   * say) plus the value above the cost basis of the units held.
   */
  pnl: number
  /** Money put into the position this day (buys, units transferred in), as the ledger counts it. */
  inflow: number
  /** Money taken out of the position this day (sales, dividends, units transferred out). */
  outflow: number
}

export interface PositionTrade {
  date: string
  type: Transaction['type']
  quantity: number
  amountEur: number
}

/**
 * Value, quantity and cost basis of one instrument on every day from its first transaction, and
 * its trades, for the chart of a single position. An earlier ISIN that a corporate action turned
 * into this one counts as the same position.
 */
export function positionSeries(
  transactions: Transaction[],
  prices: PriceBook,
  options: EngineOptions,
  key: string,
  today: string,
): { points: PositionPoint[]; trades: PositionTrade[] } {
  const keys = new Set([key])
  for (const t of transactions) if (t.type === 'split' && t.split?.fromIsin && instrumentKey(t) === key) keys.add(t.split.fromIsin)
  const own = sortTransactions(transactions.filter((t) => keys.has(instrumentKey(t))))
  const ledger = new Ledger(options, false, { transactions: own, priceOf: (holding, date) => prices.price(holding, date)?.eur })
  const points: PositionPoint[] = []
  const first = own[0]?.date
  if (!first) return { points, trades: [] }

  let index = 0
  for (let date = first; date <= today; date = addDays(date, 1)) {
    let inflow = 0
    let outflow = 0
    while (index < own.length && (own[index] as Transaction).date === date) {
      const flows = ledger.apply(own[index++] as Transaction)
      inflow += flows.inflow
      outflow += flows.outflow
    }
    let quantity = 0
    let value = 0
    let cost = 0
    for (const holding of ledger.openHoldings()) {
      quantity += holding.quantity
      value += holding.quantity * (prices.price(holding, date)?.eur ?? 0)
      cost += holding.cost
    }
    points.push({ date, quantity, value, cost, pnl: ledger.realized + value - cost, inflow, outflow })
  }
  const trades = own
    .filter((t) => ['buy', 'sell', 'transferIn', 'transferOut', 'dividend', 'split'].includes(t.type))
    .map((t) => ({ date: t.date, type: t.type, quantity: t.quantity, amountEur: t.amountEur }))
  return { points, trades }
}
