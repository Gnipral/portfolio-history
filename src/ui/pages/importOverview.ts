import { chargesByYear, type ChargesYear } from '../../engine/analysis/charges.ts'
import type { ImportResult } from '../../import/types.ts'
import { msg } from '../../i18n/i18n.ts'
import type { Transaction } from '../../model/transaction.ts'

/** One file of a draft import, as the parser read it. */
export interface FileRow {
  name: string
  /** What the file holds, judged from its type and its rows: trades, cash movements, or both. */
  kind: string
  /** Transactions read from it. */
  rows: number
  /** Rows that could not be read. */
  unread: number
  first: string | null
  last: string | null
}

/** Figures of a draft import, straight from the parser result. */
export interface ImportCheck {
  transactions: number
  /** Sum of every net amount: what the export says went into and out of the account. */
  netCashFlow: number
  /** Deposits minus withdrawals, when the export has them. */
  netDeposits: number
  /** Broker fees and currency conversion costs. */
  fees: number
  /** Taxes on trades, such as the Belgian stock exchange tax (TOB). */
  tradeTaxes: number
  /** Withholding tax on income and other taxes. */
  otherTaxes: number
  /** How many transactions carry a fee or a tax. */
  charged: number
  unread: number
  warnings: number
}

const TRADES = new Set<Transaction['type']>(['buy', 'sell', 'split', 'transferIn', 'transferOut'])
const CASH = new Set<Transaction['type']>(['deposit', 'withdrawal', 'dividend', 'fee', 'tax', 'fx', 'other'])

function kindOf(name: string, transactions: Transaction[]): string {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return msg('PDF')
  if (extension === 'xml') return msg('Flex query (XML)')
  const trades = transactions.some((t) => TRADES.has(t.type))
  const cash = transactions.some((t) => CASH.has(t.type))
  if (trades && cash) return msg('Transactions and cash')
  if (trades) return msg('Transactions')
  if (cash) return msg('Account statement')
  return msg('No transactions')
}

/** One row per file chosen, in the order chosen, with what the parser took from it. */
export function fileRows(result: ImportResult, files: string[]): FileRow[] {
  return files.map((name) => {
    const own = result.transactions.filter((t) => t.source.file === name)
    const dates = own.map((t) => t.date).sort()
    return {
      name,
      kind: kindOf(name, own),
      rows: own.length,
      unread: result.issues.filter((issue) => issue.severity === 'error' && issue.file === name).length,
      first: dates[0] ?? null,
      last: dates.at(-1) ?? null,
    }
  })
}

export function importCheck(result: ImportResult): ImportCheck {
  let netCashFlow = 0
  let netDeposits = 0
  let charged = 0
  for (const t of result.transactions) {
    netCashFlow += t.totalEur
    if (t.type === 'deposit' || t.type === 'withdrawal') netDeposits += t.totalEur
    if (t.costsEur || t.fxCostsEur || t.taxesEur || t.type === 'fee' || t.type === 'tax') charged++
  }
  const charges = chargesByYear(result.transactions)
  const sum = (pick: (year: ChargesYear) => number) => charges.reduce((total, year) => total + pick(year), 0)
  return {
    transactions: result.transactions.length,
    netCashFlow,
    netDeposits,
    fees: sum((y) => y.transactionCosts + y.fxCosts),
    tradeTaxes: sum((y) => y.tradeTaxes),
    otherTaxes: sum((y) => y.incomeTaxes + y.otherTaxes),
    charged,
    unread: result.issues.filter((issue) => issue.severity === 'error').length,
    warnings: result.issues.filter((issue) => issue.severity === 'warning').length,
  }
}
