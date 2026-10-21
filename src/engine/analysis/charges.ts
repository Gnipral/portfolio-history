import { instrumentKey } from '../../market/instruments.ts'
import type { Transaction } from '../../model/transaction.ts'

/** Everything paid besides the investments themselves in one year, in EUR. */
export interface ChargesYear {
  year: string
  /** Commissions and other broker fees, on trades and as their own rows (connection fees, custody fees). */
  transactionCosts: number
  /** Currency conversion costs. */
  fxCosts: number
  /** Taxes on buys and sells: the Belgian stock exchange tax (TOB) and similar taxes elsewhere. */
  tradeTaxes: number
  /** Withholding taxes on dividends and interest. */
  incomeTaxes: number
  /** Taxes booked on their own that belong to no dividend. */
  otherTaxes: number
  total: number
}

const empty = (year: string): ChargesYear => ({ year, transactionCosts: 0, fxCosts: 0, tradeTaxes: 0, incomeTaxes: 0, otherTaxes: 0, total: 0 })

/** Charges per calendar year, oldest first, independent of the dashboard toggles. */
export function chargesByYear(transactions: Transaction[]): ChargesYear[] {
  const dayKeys = (types: Transaction['type'][]) =>
    new Set(transactions.filter((t) => types.includes(t.type)).map((t) => `${instrumentKey(t)}|${t.date}`))
  const dividendDays = dayKeys(['dividend'])
  // A tax booked on its own on the day of a trade in the same product is its stock exchange tax (DEGIRO).
  const tradeDays = dayKeys(['buy', 'sell'])
  const years = new Map<string, ChargesYear>()
  for (const t of transactions) {
    const year = t.date.slice(0, 4)
    const row = years.get(year) ?? empty(year)
    row.transactionCosts += t.costsEur
    row.fxCosts += t.fxCostsEur
    if (t.type === 'buy' || t.type === 'sell') row.tradeTaxes += t.taxesEur
    else if (t.type === 'dividend') row.incomeTaxes += t.taxesEur
    else row.otherTaxes += t.taxesEur
    const amount = Math.abs(t.amountEur)
    if (t.type === 'fee') row.transactionCosts += amount
    if (t.type === 'tax') {
      const day = `${instrumentKey(t)}|${t.date}`
      if (dividendDays.has(day)) row.incomeTaxes += amount
      else if (tradeDays.has(day)) row.tradeTaxes += amount
      else row.otherTaxes += amount
    }
    years.set(year, row)
  }
  return [...years.values()]
    .map((row) => ({ ...row, total: row.transactionCosts + row.fxCosts + row.tradeTaxes + row.incomeTaxes + row.otherTaxes }))
    .sort((a, b) => a.year.localeCompare(b.year))
}
