import type { Transaction } from '../../model/transaction.ts'
import { Ledger, sortTransactions, type Sale } from '../ledger.ts'
import type { EngineOptions } from '../options.ts'

/** Every sale with its cost basis and result, as the dashboard counts them (cost basis method and toggles). */
export function realizedSales(transactions: Transaction[], options: EngineOptions): Sale[] {
  const ordered = sortTransactions(transactions)
  const ledger = new Ledger(options, false, { transactions: ordered })
  for (const t of ordered) ledger.apply(t)
  return ledger.sales
}

export interface RealizedYear {
  year: string
  proceeds: number
  cost: number
  gains: number
  losses: number
  net: number
  count: number
}

export function realizedByYear(sales: Sale[]): RealizedYear[] {
  const years = new Map<string, RealizedYear>()
  for (const sale of sales) {
    const year = sale.date.slice(0, 4)
    const row = years.get(year) ?? { year, proceeds: 0, cost: 0, gains: 0, losses: 0, net: 0, count: 0 }
    row.proceeds += sale.proceeds
    row.cost += sale.cost
    if (sale.gain >= 0) row.gains += sale.gain
    else row.losses -= sale.gain
    row.net += sale.gain
    row.count++
    years.set(year, row)
  }
  return [...years.values()].sort((a, b) => a.year.localeCompare(b.year))
}
