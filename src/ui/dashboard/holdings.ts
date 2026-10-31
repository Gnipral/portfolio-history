import { instrumentKey } from '../../market/instruments.ts'
import type { Transaction } from '../../model/transaction.ts'
import { instrumentFacts } from './allocation.ts'
import type { HoldingFacts } from './PositionsTable.tsx'

/** Per instrument: its type and currency as in the allocation, and the exchange of its latest trade. */
export function holdingFacts(transactions: readonly Transaction[]): Map<string, HoldingFacts> {
  const exchanges = new Map<string, string>()
  for (const t of [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))) {
    if (t.exchange) exchanges.set(instrumentKey(t), t.exchange)
  }
  const result = new Map<string, HoldingFacts>()
  for (const [key, facts] of instrumentFacts([...transactions])) {
    const exchange = exchanges.get(key)
    result.set(key, { type: facts.assetClass, currency: facts.currency, ...(exchange ? { exchange } : {}) })
  }
  return result
}
