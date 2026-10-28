import { instrumentKey } from '../../market/instruments.ts'
import type { Transaction } from '../../model/transaction.ts'
import { instrumentFacts } from './allocation.ts'

/** The types of asset held at some point, e.g. ETFs and Stocks, in a fixed order. */
export function assetClassesOf(transactions: Transaction[]): string[] {
  const order = ['ETFs', 'Stocks', 'Funds', 'Bonds', 'Crypto', 'Cash', 'Other']
  const found = new Set([...instrumentFacts(transactions).values()].map((f) => f.assetClass))
  return [...found].sort((a, b) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b))
}

/**
 * Only the transactions of instruments of the chosen types: their trades, dividends, taxes and
 * corporate actions. Deposits, withdrawals and other cash rows belong to no type and are left out,
 * so a filtered view is always securities only.
 */
export function filterByAssetClass(transactions: Transaction[], classes: readonly string[]): Transaction[] {
  if (classes.length === 0) return transactions
  const facts = instrumentFacts(transactions)
  const keep = new Set([...facts].filter(([, f]) => classes.includes(f.assetClass)).map(([key]) => key))
  return transactions.filter((t) => keep.has(instrumentKey(t)))
}
