import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { parseNumber } from '../parse.ts'
import { Collector, dataRows, detectByHeaders, findHeader, guessAssetClass, parseDateTime, result, type ColumnSpec, type Row } from './kit.ts'

/**
 * XTB account history, "Cash Operations" (xStation CSV or Excel sheet), in the current layout
 * (Type;Ticker;Instrument;Time;Amount;ID;Comment) and the older one (ID;Type;Time;Symbol;Comment;Amount).
 * Quantity and price are in the comment: `OPEN BUY 34/42.5658 @ 11.7480`. Amounts are in the account currency.
 */
const COLUMNS = {
  type: ['type'],
  ticker: ['ticker', 'symbol'],
  instrument: ['instrument'],
  time: ['time'],
  amount: ['amount'],
  id: ['id'],
  comment: ['comment'],
} satisfies ColumnSpec<string>
type Key = keyof typeof COLUMNS

const TRADE = /(OPEN|CLOSE) (BUY|SELL) ([\d.]+)(?:\/[\d.]+)? @ ([\d.]+)/i

/** XTB symbol suffix → Yahoo Finance suffix. */
const YAHOO_SUFFIX: Record<string, string> = {
  US: '', UK: '.L', DE: '.DE', NL: '.AS', BE: '.BR', FR: '.PA', ES: '.MC', IT: '.MI', PT: '.LS', CH: '.SW',
  PL: '.WA', DK: '.CO', SE: '.ST', NO: '.OL', FI: '.HE', AT: '.VI', IE: '.IR', CZ: '.PR',
}

export function yahooTicker(symbol: string): string | undefined {
  const match = /^(.+)\.([A-Z]{2})(?:_\d+)?$/.exec(symbol)
  if (!match) return undefined
  const suffix = YAHOO_SUFFIX[match[2] as string]
  return suffix === undefined ? undefined : `${match[1]}${suffix}`
}

function detect(table: RawTable): number {
  if (detectByHeaders(table, ['type', 'ticker', 'instrument', 'time', 'amount', 'id', 'comment'])) return 0.9
  if (detectByHeaders(table, ['id', 'type', 'time', 'symbol', 'comment', 'amount'])) return 0.85
  return 0
}

/**
 * A transfer between two XTB sub-accounts (My Trades ↔ Investment Plans) is a pair of rows with the
 * same time and comment and opposite amounts. No money enters or leaves, so both rows are skipped.
 */
function internalTransfers(rows: Row<Key>[]): Set<Row<Key>> {
  const paired = new Set<Row<Key>>()
  const isTransfer = (row: Row<Key>) => /^(subaccount )?transfer$/i.test(row.text('type'))
  for (const outgoing of rows) {
    const amount = outgoing.money('amount') ?? 0
    if (!isTransfer(outgoing) || amount >= 0 || paired.has(outgoing)) continue
    const incoming = rows.find(
      (r) =>
        !paired.has(r) &&
        r.text('type') === outgoing.text('type') &&
        r.text('time') === outgoing.text('time') &&
        r.text('comment') === outgoing.text('comment') &&
        Math.abs((r.money('amount') ?? 0) + amount) < 1e-9,
    )
    if (incoming) paired.add(outgoing).add(incoming)
  }
  return paired
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('xtb', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['type', 'time', 'amount', 'comment'])
  if (!header) {
    out.issue('error', 'Missing XTB columns.')
    return out
  }
  // XTB names the export after the account currency (`EUR_account_123.csv`); amounts are in it.
  const currency = /(?:^|[\\/])([A-Z]{3})_[^\\/]*$/i.exec(table.fileName)?.[1]?.toUpperCase() ?? 'EUR'
  const rows = dataRows(table, header)
  const internal = internalTransfers(rows)
  for (const row of rows) {
    if (row.text('type').toLowerCase() === 'total' || internal.has(row)) continue
    // Some exports write a three-digit day ("010.09.2024").
    const at = parseDateTime(row.text('time').replace(/^0(\d{2}\.)/, '$1'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('time')}"`, row.number)
      continue
    }
    const type = row.text('type').toLowerCase()
    const symbol = row.text('ticker')
    const ticker = yahooTicker(symbol)
    const amount = row.money('amount') ?? 0
    const comment = row.text('comment')
    const base = {
      at,
      row: row.number,
      product: row.text('instrument') || symbol || 'Cash',
      ...(ticker ? { ticker } : {}),
      assetClass: guessAssetClass(row.text('instrument')),
      cashCurrency: currency,
      amount,
      orderId: row.text('id'),
    }
    const trade = TRADE.exec(comment)

    if (/purchase|compra|kauf|zakup/.test(type) && trade) {
      const quantity = parseNumber(trade[3] as string) ?? 0
      if (quantity > 0) out.add({ ...base, type: 'buy', quantity, price: parseNumber(trade[4] as string) ?? 0 })
    } else if (/sell|sale|vende|verkauf|sprzeda/.test(type) && trade) {
      const quantity = parseNumber(trade[3] as string) ?? 0
      if (quantity > 0) out.add({ ...base, type: 'sell', quantity, price: parseNumber(trade[4] as string) ?? 0 })
    } else if (/divident|dividend/.test(type)) {
      out.add({ ...base, type: amount >= 0 ? 'dividend' : 'tax' })
    } else if (/spin ?off/.test(type)) {
      // XTB pays a spin-off out in cash.
      out.add({ ...base, type: 'dividend' })
    } else if (/withholding|tax/.test(type)) {
      out.add({ ...base, ...(/interest/.test(type) ? { product: 'Interest' } : {}), type: amount <= 0 ? 'tax' : 'dividend' })
    } else if (/interest/.test(type)) {
      out.add({ ...base, product: 'Interest', type: amount >= 0 ? 'dividend' : 'fee' })
    } else if (/deposit/.test(type) || (/transfer/.test(type) && amount > 0)) {
      out.add({ ...base, product: 'Cash', type: 'deposit' })
    } else if (/withdrawal/.test(type) || (/transfer/.test(type) && amount < 0)) {
      out.add({ ...base, product: 'Cash', type: 'withdrawal' })
    } else if (/swap|close trade|profit|loss|commission|fee/.test(type)) {
      if (amount !== 0) out.add({ ...base, type: amount > 0 ? 'dividend' : 'fee' })
    } else {
      out.issue('warning', `Unknown XTB type "${row.text('type')}" skipped.`, row.number)
    }
  }
  return out
}

export const xtbAdapter: BrokerAdapter = {
  id: 'xtb',
  label: 'XTB',
  detect,
  parse(tables, context) {
    return result(
      'XTB',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: false, fxCosts: false, taxes: true, dividends: true, deposits: true },
      {
        transactionCosts: 'XTB books commissions inside the trade amount.',
        fxCosts: 'XTB books currency conversion inside the trade amount.',
      },
    )
  },
}
