import type { Transaction } from '../model/transaction.ts'

export interface Holding {
  isin: string
  product: string
  quantity: number
}

export interface ImportSummary {
  transactionCount: number
  firstDate: string | null
  lastDate: string | null
  /** Distinct products traded at any time. */
  productCount: number
  /** Positions still open after the last transaction. */
  openPositions: Holding[]
}

const EPSILON = 1e-9

function keyOf(t: Transaction): string {
  return t.isin ?? t.product
}

/** Quantity per product after replaying buys, sells and splits in date order. */
export function finalHoldings(transactions: Transaction[]): Holding[] {
  const holdings = new Map<string, Holding>()
  const ordered = [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))
  const holding = (key: string, t: Transaction): Holding => {
    const existing = holdings.get(key)
    if (existing) return existing
    const created = { isin: t.isin ?? '', product: t.product, quantity: 0 }
    holdings.set(key, created)
    return created
  }
  for (const t of ordered) {
    const key = keyOf(t)
    if (t.type === 'buy') holding(key, t).quantity += t.quantity
    else if (t.type === 'sell') holding(key, t).quantity -= t.quantity
    else if (t.type === 'split' && t.split) {
      // The split replaces fromQuantity old units (possibly under the old ISIN) with t.quantity new units.
      const from = holdings.get(t.split.fromIsin ?? key)
      if (from) from.quantity -= t.split.fromQuantity
      holding(key, t).quantity += t.quantity
    } else continue
    holding(key, t).product = t.product
  }
  return [...holdings.values()]
    .map((h) => ({ ...h, quantity: Math.abs(h.quantity) < EPSILON ? 0 : h.quantity }))
    .filter((h) => h.quantity !== 0)
    .sort((a, b) => a.product.localeCompare(b.product))
}

export function summarize(transactions: Transaction[]): ImportSummary {
  const dates = transactions.map((t) => t.date).sort()
  return {
    transactionCount: transactions.length,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    productCount: new Set(transactions.filter((t) => t.isin || t.product).map(keyOf)).size,
    openPositions: finalHoldings(transactions),
  }
}
