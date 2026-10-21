import type { AssetClass, Transaction, TransactionType } from '../../model/transaction.ts'
import { cellText, isBlank, normalizeHeader, parseDate, parseNumber, parseTime } from '../parse.ts'
import type { Capabilities, CapabilityReasons, Cell, ImportContext, ImportIssue, ImportResult, RawTable } from '../types.ts'

/** Shared building blocks for the broker adapters. */

/** Context without exchange rates: only EUR amounts can be converted. */
export const EUR_ONLY: ImportContext = {
  toEur: (amount, currency) => (currency === 'EUR' ? amount : undefined),
}

/** Fixed rates in units per 1 EUR, for tests. */
export function fixedRates(rates: Record<string, number>): ImportContext {
  return {
    toEur(amount, currency) {
      if (currency === 'EUR') return amount
      const rate = rates[currency]
      return rate === undefined ? undefined : amount / rate
    },
  }
}

// ---------------------------------------------------------------- columns

export type ColumnSpec<K extends string> = Record<K, readonly string[]>
export type ColumnMap<K extends string> = Partial<Record<K, number>>

export function mapHeader<K extends string>(header: Cell[], spec: ColumnSpec<K>): ColumnMap<K> {
  const normalized = header.map(normalizeHeader)
  const map: ColumnMap<K> = {}
  for (const key of Object.keys(spec) as K[]) {
    const index = normalized.findIndex((h) => spec[key].includes(h))
    if (index >= 0) map[key] = index
  }
  return map
}

export interface Header<K extends string> {
  /** Index of the header row in `table.rows`; data starts on the next row. */
  index: number
  columns: ColumnMap<K>
}

/** Finds the header row, also after a preamble of a few lines, that has all required columns. */
export function findHeader<K extends string>(
  table: RawTable,
  spec: ColumnSpec<K>,
  required: NoInfer<K>[],
  maxScan = 12,
): Header<K> | null {
  const limit = Math.min(table.rows.length, maxScan)
  for (let index = 0; index < limit; index++) {
    const columns = mapHeader(table.rows[index] ?? [], spec)
    if (required.every((key) => columns[key] !== undefined)) return { index, columns }
  }
  return null
}

/** One data row with lookups by column key. */
export class Row<K extends string> {
  constructor(
    readonly cells: Cell[],
    private readonly columns: ColumnMap<K>,
    /** 1-based row number as a spreadsheet shows it. */
    readonly number: number,
  ) {}

  has(key: K): boolean {
    return this.columns[key] !== undefined
  }

  get(key: K): Cell {
    const index = this.columns[key]
    return index === undefined ? null : (this.cells[index] ?? null)
  }

  text(key: K): string {
    return cellText(this.get(key))
  }

  /** Amount with currency signs, parentheses or '-' placeholders; null when blank. */
  money(key: K): number | null {
    return parseMoney(this.get(key))
  }
}

export function dataRows<K extends string>(table: RawTable, header: Header<K>): Row<K>[] {
  return table.rows
    .slice(header.index + 1)
    .map((cells, i) => new Row(cells, header.columns, header.index + i + 2))
    .filter((row) => !row.cells.every(isBlank))
}

// ---------------------------------------------------------------- values

// U+FFFD: a € sign from a Windows-1252 file read as UTF-8.
const CURRENCY_SIGNS = /[€$£¥�]|\b[A-Z]{3}\b/g

/**
 * Parses amounts as brokers write them: `€1,234.56`, `-EUR 2.50`, `$0`, `(6.97)`, `1 791,84`, `0,76672417`.
 * Returns null for blank cells and placeholders such as `-`, NaN for other text.
 */
export function parseMoney(value: Cell): number | null {
  if (typeof value === 'number') return value
  if (value === null || typeof value === 'boolean') return value === null ? null : Number.NaN
  let text = value.trim()
  if (text === '' || text === '-' || /^n\/?a$|^not available$/i.test(text)) return null
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  text = text.replace(CURRENCY_SIGNS, '').trim()
  if (text.startsWith('-')) {
    negative = !negative
    text = text.slice(1)
  }
  const number = parseNumber(text)
  if (number === null) return null
  return negative ? -number : number
}

/** The 3-letter currency code inside an amount such as `EUR 1.00` or `$5`, if any. */
export function currencyOf(value: Cell): string | undefined {
  const text = cellText(value)
  const code = /\b([A-Z]{3})\b/.exec(text)?.[1]
  if (code) return code
  if (text.includes('€')) return 'EUR'
  if (text.includes('$')) return 'USD'
  if (text.includes('£')) return 'GBP'
  return undefined
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, mrt: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export interface DateTime {
  date: string
  time: string
}

function local(date: Date): DateTime {
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` }
}

/**
 * Dates as brokers write them, with or without a time: ISO with a zone (converted to local time),
 * `2025-01-10 09:12:04 UTC`, `20210601;153100`, `20250515`, `15-Apr-2026`, `16-jan-2025`,
 * `06/01/2025 10:02:00` and `12.04.2024 13:01:45` (day first).
 */
export function parseDateTime(value: Cell, timeValue: Cell = null): DateTime | null {
  const text = cellText(value)
  if (!text) return null

  // An explicit zone: convert to the local time of the user.
  if (/(Z|[+-]\d{2}:?\d{2}| UTC)$/.test(text) && /^\d{4}-\d{2}-\d{2}[T ]\d/.test(text)) {
    const date = new Date(text.replace(' UTC', 'Z').replace(' ', 'T'))
    if (!Number.isNaN(date.getTime())) return local(date)
  }

  let match = /^(\d{4})(\d{2})(\d{2})(?:[;, ](\d{2})(\d{2})(\d{2})?)?$/.exec(text)
  if (match) {
    const date = parseDate(`${match[1]}-${match[2]}-${match[3]}`)
    return date ? { date, time: match[4] ? `${match[4]}:${match[5]}` : '00:00' } : null
  }

  match = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{4})$/.exec(text)
  if (match) {
    const month = MONTHS[(match[2] as string).toLowerCase()]
    const date = month ? parseDate(`${match[3]}-${pad(month)}-${pad(Number(match[1]))}`) : null
    return date ? { date, time: parseTime(timeValue) ?? '00:00' } : null
  }

  const [datePart = '', timePart = ''] = text.split(/[T ]/, 2)
  const date = parseDate(datePart)
  if (!date) return null
  const time = parseTime((timePart || cellText(timeValue)).replace(/\.\d+$/, ''))
  return { date, time: time ?? '00:00' }
}

export function guessAssetClass(name: string, hint = ''): AssetClass {
  const text = `${hint} ${name}`
  if (/crypto/i.test(hint)) return 'crypto'
  if (/\bbond\b|obligati/i.test(hint)) return 'bond'
  if (/\bfund\b|\bETF\b|\bETC\b|\bUCITS\b|tracker/i.test(text)) return 'etf'
  return 'stock'
}

// ---------------------------------------------------------------- building transactions

/** Types where money leaves the account. */
const OUTGOING: TransactionType[] = ['buy', 'fee', 'tax', 'withdrawal']

export interface Draft {
  type: TransactionType
  at: DateTime
  row: number
  product: string
  isin?: string
  ticker?: string
  exchange?: string
  assetClass?: AssetClass
  quantity?: number
  price?: number
  /** Currency of `price`; defaults to the cash currency. */
  currency?: string
  /** Size of the gross amount in `cashCurrency`; the sign follows from the type. */
  amount: number
  /** Currency of `amount`, `costs` and `taxes`. */
  cashCurrency: string
  costs?: number
  taxes?: number
  fxCosts?: number
  /** Units of the price currency per EUR when the export states it. */
  fxRate?: number
  orderId?: string
  split?: Transaction['split']
}

/** Collects transactions and issues for one file, converting amounts to EUR at the date's rate. */
export class Collector {
  readonly transactions: Transaction[] = []
  readonly issues: ImportIssue[] = []
  private readonly perRow = new Map<number, number>()

  constructor(
    private readonly broker: string,
    readonly file: string,
    private readonly context: ImportContext = EUR_ONLY,
  ) {}

  issue(severity: ImportIssue['severity'], message: string, row?: number): void {
    this.issues.push({ severity, file: this.file, message, ...(row === undefined ? {} : { row }) })
  }

  /** Converts to EUR, or records an error and returns undefined when no rate is known. */
  toEur(amount: number, currency: string, date: string, row: number): number | undefined {
    if (amount === 0) return 0
    // GBp (pence) must not become GBP (pounds).
    const eur = this.context.toEur(amount, currency === 'GBp' ? 'GBX' : currency.toUpperCase(), date)
    if (eur === undefined) this.issue('error', `No EUR exchange rate for ${currency} on ${date}; row skipped.`, row)
    return eur
  }

  /** Converts between two currencies via EUR; 0 (with an error recorded) when a rate is missing. */
  convert(amount: number, from: string, to: string, date: string, row: number): number {
    if (amount === 0 || from.toUpperCase() === to.toUpperCase()) return amount
    const eur = this.toEur(amount, from, date, row)
    if (eur === undefined) return 0
    if (to.toUpperCase() === 'EUR') return eur
    const eurPerUnit = this.toEur(1, to, date, row)
    return eurPerUnit ? eur / eurPerUnit : 0
  }

  add(draft: Draft): Transaction | undefined {
    const { at, row } = draft
    const date = at.date
    const convert = (value: number | undefined) => this.toEur(Math.abs(value ?? 0), draft.cashCurrency, date, row)
    const gross = convert(draft.amount)
    const costs = convert(draft.costs)
    const taxes = convert(draft.taxes)
    const fxCosts = convert(draft.fxCosts)
    if (gross === undefined || costs === undefined || taxes === undefined || fxCosts === undefined) return undefined

    const sign = OUTGOING.includes(draft.type) ? -1 : 1
    // `|| 0` turns -0 into 0 for free units.
    const amountEur = round(sign * gross) || 0
    const n = (this.perRow.get(row) ?? 0) + 1
    this.perRow.set(row, n)
    const transaction: Transaction = {
      id: `${this.broker}:${this.file}:${row}${n > 1 ? `:${n}` : ''}`,
      dateTime: `${date}T${at.time}`,
      date,
      type: draft.type,
      product: draft.product,
      ...(draft.isin ? { isin: draft.isin.toUpperCase() } : {}),
      ...(draft.ticker ? { ticker: draft.ticker } : {}),
      ...(draft.exchange ? { exchange: draft.exchange } : {}),
      assetClass: draft.assetClass ?? guessAssetClass(draft.product),
      quantity: Math.abs(draft.quantity ?? 0),
      price: Math.abs(draft.price ?? 0),
      currency: (draft.currency ?? draft.cashCurrency).toUpperCase(),
      ...(draft.fxRate ? { fxRate: draft.fxRate } : {}),
      localAmount: sign * Math.abs(draft.amount) || 0,
      amountEur,
      costsEur: round(costs),
      taxesEur: round(taxes),
      fxCostsEur: round(fxCosts),
      totalEur: round(amountEur - costs - taxes - fxCosts),
      ...(draft.orderId ? { orderId: draft.orderId } : {}),
      ...(draft.split ? { split: draft.split } : {}),
      source: { broker: this.broker, file: this.file, row },
    }
    this.transactions.push(transaction)
    return transaction
  }
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * Quantities held per instrument while replaying a file in date order, for exports that report a
 * split as the number of units added or a closing trade without its quantity.
 */
export class Holdings {
  private readonly quantities = new Map<string, number>()

  get(key: string): number {
    return this.quantities.get(key) ?? 0
  }

  change(key: string, delta: number): void {
    const next = this.get(key) + delta
    this.quantities.set(key, Math.abs(next) < 1e-9 ? 0 : next)
  }

  /** Split info for `added` units on top of what is held; undefined when nothing is held. */
  splitAdding(key: string, added: number): Transaction['split'] | undefined {
    const before = this.get(key)
    if (before <= 0) return undefined
    return { ratio: (before + added) / before, fromQuantity: before }
  }
}

export interface AdapterOutput {
  transactions: Transaction[]
  issues: ImportIssue[]
}

/** Combines the per-file results into the result of an adapter. */
export function result(
  broker: string,
  outputs: AdapterOutput[],
  capabilities: Capabilities,
  missingReasons: CapabilityReasons,
): ImportResult {
  const transactions = outputs.flatMap((o) => o.transactions)
  // Stable sort: rows with the same time keep the order the adapter produced.
  transactions.sort((a, b) => a.dateTime.localeCompare(b.dateTime))
  return { broker, transactions, issues: outputs.flatMap((o) => o.issues), capabilities, missingReasons }
}

/** Header columns of a table, for detection: normalized and without blanks. */
export function headerSet(table: RawTable, maxScan = 12): Set<string>[] {
  return table.rows.slice(0, maxScan).map((row) => new Set(row.map(normalizeHeader).filter(Boolean)))
}

/** Confidence that one of the first rows contains all `required` headers (normalized). */
export function detectByHeaders(table: RawTable, required: string[], confidence = 0.9): number {
  return headerSet(table).some((set) => required.every((h) => set.has(h))) ? confidence : 0
}
