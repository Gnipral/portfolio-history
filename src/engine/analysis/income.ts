import { instrumentKey } from '../../market/instruments.ts'
import type { Transaction } from '../../model/transaction.ts'

export type IncomeKind = 'dividend' | 'interest' | 'bonus'

/** One payment of income, in EUR, independent of the dashboard toggles. */
export interface IncomeRow {
  date: string
  key: string
  product: string
  isin?: string
  kind: IncomeKind
  gross: number
  /** Withholding taxes, including a tax booked as its own row on the same day. */
  taxes: number
  /** Collection and conversion costs. */
  costs: number
  net: number
}

function kindOf(t: Transaction): IncomeKind {
  if (t.isin) return 'dividend'
  if (/interest|rente|zins/i.test(t.product)) return 'interest'
  return /bonus|reward|saveback|cashback/i.test(t.product) ? 'bonus' : 'dividend'
}

/** Every dividend, interest and bonus payment, oldest first, with the withholding tax booked apart added. */
export function incomeRows(transactions: Transaction[]): IncomeRow[] {
  // Withholding taxes on their own row (DEGIRO, IBKR, XTB), per instrument and day.
  const separateTax = new Map<string, number>()
  const dividendDays = new Set(transactions.filter((t) => t.type === 'dividend').map((t) => `${instrumentKey(t)}|${t.date}`))
  for (const t of transactions) {
    const day = `${instrumentKey(t)}|${t.date}`
    if (t.type === 'tax' && dividendDays.has(day)) separateTax.set(day, (separateTax.get(day) ?? 0) + Math.abs(t.amountEur))
  }
  const rows: IncomeRow[] = []
  for (const t of [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))) {
    if (t.type !== 'dividend') continue
    const day = `${instrumentKey(t)}|${t.date}`
    // The separate tax of a day goes with the first payment of that day only.
    const taxes = t.taxesEur + (separateTax.get(day) ?? 0)
    separateTax.delete(day)
    const gross = Math.abs(t.amountEur)
    const costs = t.costsEur + t.fxCostsEur
    rows.push({
      date: t.date,
      key: instrumentKey(t),
      product: t.product,
      ...(t.isin ? { isin: t.isin } : {}),
      kind: kindOf(t),
      gross,
      taxes,
      costs,
      net: gross - taxes - costs,
    })
  }
  return rows
}

export interface IncomeTotal {
  label: string
  gross: number
  taxes: number
  costs: number
  net: number
  count: number
}

/** Sums income rows per group, in the order the groups first appear. */
export function incomeTotals(rows: IncomeRow[], groupOf: (row: IncomeRow) => string): IncomeTotal[] {
  const totals = new Map<string, IncomeTotal>()
  for (const row of rows) {
    const label = groupOf(row)
    const total = totals.get(label) ?? { label, gross: 0, taxes: 0, costs: 0, net: 0, count: 0 }
    total.gross += row.gross
    total.taxes += row.taxes
    total.costs += row.costs
    total.net += row.net
    total.count++
    totals.set(label, total)
  }
  return [...totals.values()]
}
