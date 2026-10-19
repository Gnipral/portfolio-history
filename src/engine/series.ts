import { addDays } from '../market/dates.ts'
import type { Transaction } from '../model/transaction.ts'
import { Ledger, hasDeposits, sortTransactions, type LedgerIssue } from './ledger.ts'
import type { EngineOptions } from './options.ts'
import type { Price, PriceBook } from './priceBook.ts'

/** Everything the dashboard shows for one day, in EUR. */
export interface DailyPoint {
  date: string
  /** Market value of the portfolio (plus cash in cash mode). */
  value: number
  /** Net invested capital: buys minus sells, or deposits minus withdrawals in cash mode. */
  invested: number
  /** Highest net invested capital so far: the base of the simple return. */
  capitalBase: number
  /** realized + unrealized */
  pnl: number
  realized: number
  /** Market value minus cost basis of the open positions. */
  unrealized: number
  /** pnl / capitalBase */
  simpleReturn: number
  /** Money into the portfolio this day (see Ledger flows). */
  inflow: number
  /** Money out of the portfolio this day. */
  outflow: number
  /** Positions valued with a trade price or a stale market price. */
  estimated: number
}

export interface SeriesResult {
  points: DailyPoint[]
  cashMode: boolean
  issues: LedgerIssue[]
}

/** Values the open positions of a ledger on a date. */
export function valueHoldings(ledger: Ledger, prices: PriceBook, date: string) {
  let value = 0
  let cost = 0
  let estimated = 0
  const priced = ledger.openHoldings().map((holding) => {
    const price: Price | undefined = prices.price(holding, date)
    const holdingValue = price ? holding.quantity * price.eur : 0
    if (!price || price.source === 'trade' || price.stale) estimated++
    value += holdingValue
    cost += holding.cost
    return { holding, price, value: holdingValue }
  })
  return { value, cost, estimated, priced }
}

/**
 * Replays the transactions and values the portfolio on every calendar day from the first
 * transaction until `today`. Calculation only: no I/O, no UI.
 */
export function computeDailySeries(
  transactions: Transaction[],
  prices: PriceBook,
  options: EngineOptions,
  today: string,
): SeriesResult {
  const ordered = sortTransactions(transactions)
  const cashMode = options.includeDeposits && hasDeposits(ordered)
  const ledger = new Ledger(options, cashMode)
  const points: DailyPoint[] = []
  const first = ordered[0]?.date
  if (!first) return { points, cashMode, issues: [] }

  let index = 0
  let capitalBase = 0
  for (let date = first; date <= today; date = addDays(date, 1)) {
    let inflow = 0
    let outflow = 0
    while (index < ordered.length && (ordered[index] as Transaction).date === date) {
      const flows = ledger.apply(ordered[index] as Transaction)
      inflow += flows.inflow
      outflow += flows.outflow
      index++
    }

    const holdings = valueHoldings(ledger, prices, date)
    const unrealized = holdings.value - holdings.cost
    const pnl = ledger.realized + unrealized
    const invested = cashMode ? ledger.netDeposits : ledger.netInvestedInSecurities
    capitalBase = Math.max(capitalBase, invested)
    points.push({
      date,
      value: holdings.value + (cashMode ? ledger.cash : 0),
      invested,
      capitalBase,
      pnl,
      realized: ledger.realized,
      unrealized,
      simpleReturn: capitalBase > 0 ? pnl / capitalBase : 0,
      inflow,
      outflow,
      estimated: holdings.estimated,
    })
  }
  return { points, cashMode, issues: ledger.issues }
}
