import type { AssetClass, Transaction } from '../../../model/transaction.ts'
import { cellText, isBlank, normalizeHeader, parseDate, parseNumber, parseTime } from '../../parse.ts'
import type { Cell, ImportIssue, RawTable } from '../../types.ts'

/**
 * DEGIRO "Transactions" export (Transacties).
 * Dutch headers are verified against a real export. English headers follow DEGIRO's English UI
 * and still need confirmation with a real English export.
 */
const COLUMNS = {
  date: ['datum', 'date'],
  time: ['tijd', 'time'],
  product: ['product'],
  isin: ['isin'],
  exchange: ['beurs', 'reference exchange', 'exchange'],
  venue: ['uitvoeringsplaats', 'venue', 'execution venue'],
  quantity: ['aantal', 'quantity', 'number'],
  price: ['koers', 'price'],
  localValue: ['lokale waarde', 'local value'],
  valueEur: ['waarde eur', 'value eur', 'waarde', 'value'],
  fxRate: ['wisselkoers', 'exchange rate'],
  autoFx: ['autofx kosten', 'autofx fee', 'autofx fees'],
  costs: [
    'transactiekosten en/of kosten van derden eur',
    'transaction and/or third party fees eur',
    'transactiekosten',
    'transaction costs',
    'transaction fees',
  ],
  totalEur: ['totaal eur', 'total eur', 'totaal', 'total'],
  orderId: ['order id', 'order-id'],
} as const

type ColumnKey = keyof typeof COLUMNS
type ColumnMap = Partial<Record<ColumnKey, number>>

const REQUIRED: ColumnKey[] = ['date', 'product', 'isin', 'quantity', 'price', 'localValue', 'valueEur', 'totalEur']

export function mapColumns(header: Cell[]): ColumnMap {
  const normalized = header.map(normalizeHeader)
  const map: ColumnMap = {}
  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const index = normalized.findIndex((h) => (COLUMNS[key] as readonly string[]).includes(h))
    if (index >= 0) map[key] = index
  }
  return map
}

export function missingColumns(map: ColumnMap): ColumnKey[] {
  return REQUIRED.filter((key) => map[key] === undefined)
}

export function detectTransactions(table: RawTable): number {
  const header = table.rows[0]
  if (!header) return 0
  const map = mapColumns(header)
  if (missingColumns(map).length > 0) return 0
  // Order ID and the unnamed currency columns are DEGIRO-specific.
  return map.orderId !== undefined ? 0.95 : 0.8
}

function guessAssetClass(product: string): AssetClass {
  return /\bUCITS\b|\bETF\b|\bETC\b/i.test(product) ? 'etf' : 'stock'
}

/** A parsed row before corporate actions are recognized. */
interface ParsedRow {
  row: number
  date: string
  time: string
  product: string
  isin: string
  exchange: string
  venue: string
  quantity: number
  price: number
  currency: string
  localAmount: number
  amountEur: number
  fxRate: number | null
  fxCostsEur: number
  costsEur: number
  totalEur: number
  orderId: string
}

const CURRENCY = /^[A-Z]{3}$/

export function parseTransactions(table: RawTable): { transactions: Transaction[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  const file = table.fileName
  const header = table.rows[0] ?? []
  const map = mapColumns(header)
  const missing = missingColumns(map)
  if (missing.length > 0) {
    issues.push({ severity: 'error', file, message: `Missing DEGIRO columns: ${missing.join(', ')}` })
    return { transactions: [], issues }
  }

  const get = (row: Cell[], key: ColumnKey): Cell => {
    const index = map[key]
    return index === undefined ? null : (row[index] ?? null)
  }
  // The currency of the price and the local value sits in the unnamed column right after each.
  const currencyAfter = (row: Cell[], key: 'price' | 'localValue'): string => {
    const index = map[key]
    return index === undefined ? '' : cellText(row[index + 1] ?? null).toUpperCase()
  }

  const parsed: ParsedRow[] = []
  table.rows.slice(1).forEach((cells, i) => {
    const row = i + 2
    if (cells.every(isBlank)) return
    const fail = (message: string) => issues.push({ severity: 'error', file, row, message })

    const date = parseDate(get(cells, 'date'))
    if (!date) return fail(`Invalid date "${cellText(get(cells, 'date'))}"`)
    const time = parseTime(get(cells, 'time'))
    if (!time) return fail(`Invalid time "${cellText(get(cells, 'time'))}"`)

    const numbers = {
      quantity: parseNumber(get(cells, 'quantity')),
      price: parseNumber(get(cells, 'price')),
      localAmount: parseNumber(get(cells, 'localValue')),
      amountEur: parseNumber(get(cells, 'valueEur')),
      totalEur: parseNumber(get(cells, 'totalEur')),
    }
    for (const [name, value] of Object.entries(numbers)) {
      if (value === null || Number.isNaN(value)) return fail(`Invalid or missing number in column "${name}"`)
    }
    const optional = {
      fxRate: parseNumber(get(cells, 'fxRate')),
      autoFx: parseNumber(get(cells, 'autoFx')),
      costs: parseNumber(get(cells, 'costs')),
    }
    for (const [name, value] of Object.entries(optional)) {
      if (Number.isNaN(value)) return fail(`Invalid number in column "${name}"`)
    }

    const currency = currencyAfter(cells, 'price') || currencyAfter(cells, 'localValue')
    if (!CURRENCY.test(currency)) return fail(`Missing or invalid currency "${currency}"`)

    parsed.push({
      row,
      date,
      time,
      product: cellText(get(cells, 'product')),
      isin: cellText(get(cells, 'isin')).toUpperCase(),
      exchange: cellText(get(cells, 'exchange')),
      venue: cellText(get(cells, 'venue')),
      quantity: numbers.quantity as number,
      price: numbers.price as number,
      currency,
      localAmount: numbers.localAmount as number,
      amountEur: numbers.amountEur as number,
      fxRate: optional.fxRate ? optional.fxRate : null,
      fxCostsEur: Math.abs(optional.autoFx ?? 0),
      costsEur: Math.abs(optional.costs ?? 0),
      totalEur: numbers.totalEur as number,
      orderId: cellText(get(cells, 'orderId')),
    })
  })

  const transactions = buildTransactions(parsed, file, issues)
  transactions.sort((a, b) => a.dateTime.localeCompare(b.dateTime) || b.source.row - a.source.row)
  return { transactions, issues }
}

function baseTransaction(p: ParsedRow, file: string): Omit<Transaction, 'type' | 'quantity'> {
  return {
    id: `degiro:${file}:${p.row}`,
    dateTime: `${p.date}T${p.time}`,
    date: p.date,
    product: p.product,
    ...(p.isin ? { isin: p.isin } : {}),
    ...(p.exchange ? { exchange: p.exchange } : {}),
    ...(p.venue ? { venue: p.venue } : {}),
    assetClass: guessAssetClass(p.product),
    price: p.price,
    currency: p.currency,
    ...(p.fxRate !== null ? { fxRate: p.fxRate } : {}),
    localAmount: p.localAmount,
    amountEur: p.amountEur,
    costsEur: p.costsEur,
    taxesEur: 0,
    fxCostsEur: p.fxCostsEur,
    totalEur: p.totalEur,
    ...(p.orderId ? { orderId: p.orderId } : {}),
    source: { broker: 'degiro', file, row: p.row },
  }
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= Math.max(0.01, Math.abs(a) * 0.001)
}

/**
 * DEGIRO books splits, reverse splits and ISIN changes as a sell/buy pair on the same day,
 * without order ID or costs and with equal value. Those pairs become one `split` transaction.
 */
function buildTransactions(rows: ParsedRow[], file: string, issues: ImportIssue[]): Transaction[] {
  const transactions: Transaction[] = []
  const corporate = rows.filter((r) => !r.orderId && r.costsEur === 0)
  const paired = new Set<ParsedRow>()

  for (const outgoing of corporate) {
    if (outgoing.quantity >= 0 || paired.has(outgoing)) continue
    const incoming = corporate.find(
      (r) =>
        !paired.has(r) &&
        r.quantity > 0 &&
        r.date === outgoing.date &&
        sameValue(r.amountEur, outgoing.amountEur) &&
        (r.isin === outgoing.isin || r.currency === outgoing.currency),
    )
    if (!incoming) continue
    paired.add(outgoing).add(incoming)
    const fromQuantity = Math.abs(outgoing.quantity)
    transactions.push({
      ...baseTransaction(incoming, file),
      type: 'split',
      quantity: incoming.quantity,
      localAmount: 0,
      amountEur: 0,
      totalEur: 0,
      split: {
        ratio: incoming.quantity / fromQuantity,
        fromQuantity,
        ...(incoming.isin !== outgoing.isin ? { fromIsin: outgoing.isin } : {}),
      },
    })
  }

  for (const p of rows) {
    if (paired.has(p)) continue
    if (p.quantity === 0) {
      issues.push({
        severity: 'info',
        file,
        row: p.row,
        message: `Skipped row with quantity 0 for ${p.product} (corporate action placeholder).`,
      })
      continue
    }
    if (!p.orderId) {
      issues.push({
        severity: 'info',
        file,
        row: p.row,
        message: `${p.product}: row without order ID treated as a regular ${p.quantity > 0 ? 'buy' : 'sell'} (e.g. cash for fractional shares after a corporate action).`,
      })
    }
    transactions.push({
      ...baseTransaction(p, file),
      type: p.quantity > 0 ? 'buy' : 'sell',
      quantity: Math.abs(p.quantity),
    })
  }
  return transactions
}
