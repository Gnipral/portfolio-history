import { addDays } from '../../market/dates.ts'
import { instrumentKey } from '../../market/instruments.ts'
import type { Transaction } from '../../model/transaction.ts'
import { Ledger, sortTransactions } from '../ledger.ts'
import { DEFAULT_OPTIONS } from '../options.ts'
import { incomeRows } from './income.ts'

/** One dividend expected in the next 12 months. */
export interface ExpectedDividend {
  /** The same day as last year's payment, one year later. */
  date: string
  key: string
  product: string
  /** Gross dividend per share last year, in EUR. */
  perShare: number
  gross: number
  /** After the withholding tax and costs of last year's payment. */
  net: number
}

export interface PositionForecast {
  key: string
  product: string
  isin?: string
  /** Payments expected in a year. */
  payments: number
  gross: number
  net: number
  /** The first expected payment. */
  next: string
}

export interface DividendForecast {
  /** Every expected payment, in date order. */
  payments: ExpectedDividend[]
  /** From the current month up to the month a year from today, as `YYYY-MM`. */
  months: { month: string; gross: number; net: number }[]
  positions: PositionForecast[]
  gross: number
  net: number
}

/** The same calendar day a year later; 29 February becomes 28 February. */
function nextYear(date: string): string {
  const year = Number(date.slice(0, 4)) + 1
  const day = date.slice(5) === '02-29' ? '02-28' : date.slice(5)
  return `${year}-${day}`
}

function monthsFrom(first: string, last: string): string[] {
  const months: string[] = []
  const date = new Date(`${first}-01T00:00:00Z`)
  while (date.toISOString().slice(0, 7) <= last) {
    months.push(date.toISOString().slice(0, 7))
    date.setUTCMonth(date.getUTCMonth() + 1)
  }
  return months
}

/**
 * An estimate of the dividends of the next 12 months: every dividend of the last 12 months, per
 * share, paid again a year later on the shares held today, with the same withholding tax. Positions
 * sold since pay nothing; accumulating funds and positions that paid nothing last year count as zero.
 */
export function dividendForecast(transactions: Transaction[], today: string): DividendForecast {
  // Shares held when each dividend was paid, and today: one pass through the ledger, which knows
  // splits and ISIN changes.
  const ledger = new Ledger(DEFAULT_OPTIONS, false, { transactions })
  const heldAtPayment = new Map<string, number>()
  for (const t of sortTransactions(transactions)) {
    if (t.date > today) break
    if (t.type === 'dividend') {
      const key = instrumentKey(t)
      const day = `${key}|${t.date}`
      if (!heldAtPayment.has(day)) heldAtPayment.set(day, ledger.holdings.get(key)?.quantity ?? 0)
    }
    ledger.apply(t)
  }
  const heldToday = new Map(ledger.openHoldings().map((h) => [h.key, h.quantity]))

  const yearAgo = addDays(today, -365)
  const payments: ExpectedDividend[] = []
  for (const row of incomeRows(transactions)) {
    if (row.kind !== 'dividend' || row.date <= yearAgo || row.date > today || row.gross <= 0) continue
    const held = heldAtPayment.get(`${row.key}|${row.date}`) ?? 0
    const shares = heldToday.get(row.key) ?? 0
    if (held <= 0 || shares <= 0) continue
    const perShare = row.gross / held
    const gross = perShare * shares
    payments.push({ date: nextYear(row.date), key: row.key, product: row.product, perShare, gross, net: gross * (row.net / row.gross) })
  }
  payments.sort((a, b) => a.date.localeCompare(b.date))

  const months = monthsFrom(today.slice(0, 7), addDays(today, 365).slice(0, 7)).map((month) => {
    const inMonth = payments.filter((p) => p.date.startsWith(month))
    return { month, gross: inMonth.reduce((s, p) => s + p.gross, 0), net: inMonth.reduce((s, p) => s + p.net, 0) }
  })

  const byKey = new Map<string, PositionForecast>()
  for (const p of payments) {
    const isin = transactions.find((t) => instrumentKey(t) === p.key)?.isin
    const position = byKey.get(p.key) ?? { key: p.key, product: p.product, ...(isin ? { isin } : {}), payments: 0, gross: 0, net: 0, next: p.date }
    position.payments++
    position.gross += p.gross
    position.net += p.net
    byKey.set(p.key, position)
  }

  return {
    payments,
    months,
    positions: [...byKey.values()].sort((a, b) => b.net - a.net),
    gross: payments.reduce((s, p) => s + p.gross, 0),
    net: payments.reduce((s, p) => s + p.net, 0),
  }
}
