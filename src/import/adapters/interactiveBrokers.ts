import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { normalizeHeader } from '../parse.ts'
import { Collector, dataRows, findHeader, guessAssetClass, headerSet, parseDateTime, result, type ColumnSpec, type DateTime, type Row } from './kit.ts'

/**
 * Interactive Brokers (and Lynx) Flex Query, as CSV or as XML (read into the same tables by
 * `readFlexXml`): Trades, Cash Transactions and Corporate Actions. The user picks the columns, so
 * every lookup is by name and most columns are optional. The rules follow Portfolio Performance's
 * IBFlexStatementExtractor.
 */
const COLUMNS = {
  currency: ['currencyprimary', 'currency'],
  assetClass: ['assetclass', 'assetcategory'],
  symbol: ['symbol'],
  description: ['description'],
  isin: ['isin'],
  exchange: ['listingexchange'],
  tradeDate: ['tradedate'],
  tradeTime: ['tradetime'],
  dateTime: ['datetime', 'date/time'],
  settleDate: ['settledate'],
  reportDate: ['reportdate'],
  side: ['buy/sell', 'buysell'],
  quantity: ['quantity'],
  multiplier: ['multiplier'],
  tradePrice: ['tradeprice'],
  tradeMoney: ['trademoney'],
  proceeds: ['proceeds'],
  commission: ['ibcommission'],
  commissionCurrency: ['ibcommissioncurrency'],
  taxes: ['taxes'],
  type: ['type'],
  amount: ['amount'],
  value: ['value'],
  orderId: ['iborderid', 'tradeid'],
  transactionId: ['transactionid'],
  transactionType: ['transactiontype'],
  origTransactionId: ['origtransactionid'],
  levelOfDetail: ['levelofdetail'],
} satisfies ColumnSpec<string>
type Key = keyof typeof COLUMNS

type Kind = 'trades' | 'cash' | 'corporate'

const SHEETS: Record<string, Kind> = { Trades: 'trades', 'Cash Transactions': 'cash', 'Corporate Actions': 'corporate' }

function kindOf(table: RawTable): Kind | null {
  if (/\.xml$/i.test(table.fileName)) return SHEETS[table.sheetName ?? ''] ?? null
  for (const set of headerSet(table, 3)) {
    if ((set.has('buy/sell') || set.has('buysell')) && set.has('tradeprice')) return 'trades'
    if (set.has('type') && set.has('amount') && (set.has('settledate') || set.has('reportdate')) && !set.has('quantity')) return 'cash'
    if (set.has('type') && set.has('quantity') && set.has('description') && set.has('reportdate')) return 'corporate'
  }
  return null
}

function detect(table: RawTable): number {
  return kindOf(table) ? 0.9 : 0
}

/** Totals per order, symbol or asset class repeat the executions; only the executions are imported. */
function isSummary(row: Row<Key>): boolean {
  return /SUMMARY|ORDER/i.test(row.text('levelOfDetail'))
}

/** `AAPL(US0378331005) CASH DIVIDEND ...` → `US0378331005` */
function isinFrom(row: Row<Key>): string {
  return row.text('isin') || /\(([A-Z]{2}[A-Z0-9]{9}\d)\)/.exec(row.text('description'))?.[1] || ''
}

function productOf(row: Row<Key>): string {
  return row.text('symbol').replace(/\.OLD$/, '') || /^([^(\s]+)\(/.exec(row.text('description'))?.[1] || isinFrom(row)
}

/** Dates as `20250515`, `20250515;153100`, `2025-05-15` or `2025-05-15, 15:31:00`. */
function dateOf(row: Row<Key>, key: Key): DateTime | null {
  const text = row.text(key)
  return text ? parseDateTime(text.replace(/,\s*/, ' ')) : null
}

/** Trade date with trade time when both are there, else the combined date-time column. */
function tradeDateTime(row: Row<Key>): DateTime | null {
  const date = row.text('tradeDate')
  const time = row.text('tradeTime')
  if (date && time) return parseDateTime(`${date};${time.replace(/:/g, '')}`)
  return dateOf(row, 'dateTime') ?? dateOf(row, 'tradeDate')
}

function parseTrades(out: Collector, table: RawTable) {
  const header = findHeader(table, COLUMNS, ['side', 'quantity', 'tradePrice'], 3)
  if (!header) return
  const rows = dataRows(table, header)
  // A TradeCancel row cancels the execution it names; both are left out.
  const cancelled = new Set(
    rows
      .filter((r) => r.text('transactionType') === 'TradeCancel')
      .map((r) => r.text('origTransactionId'))
      .filter((id) => id && id !== '0' && id !== 'N/A'),
  )
  for (const row of rows) {
    if (isSummary(row)) continue
    const side = row.text('side').toUpperCase()
    if (side.includes('(CA.)') || row.text('transactionType') === 'TradeCancel' || cancelled.has(row.text('transactionId'))) {
      out.issue('info', 'Cancelled trade skipped.', row.number)
      continue
    }
    const at = tradeDateTime(row)
    if (!at) {
      out.issue('error', 'Invalid trade date.', row.number)
      continue
    }
    const isin = isinFrom(row)
    const assetClass = row.text('assetClass').toUpperCase()
    // Currency conversions are trades without an ISIN (asset class CASH, symbol EUR.USD).
    if (assetClass === 'CASH' || (!isin && !row.text('symbol')) || /^[A-Z]{3}\.[A-Z]{3}$/.test(row.text('symbol'))) {
      out.issue('info', 'Currency conversion skipped.', row.number)
      continue
    }
    // Options and futures are priced per unit of the underlying; the multiplier gives the units per contract.
    const multiplier = row.money('multiplier') || 1
    const quantity = Math.abs(row.money('quantity') ?? 0) * multiplier
    if (quantity === 0) continue
    const price = row.money('tradePrice') ?? 0
    const currency = row.text('currency') || 'USD'
    const commission = Math.abs(row.money('commission') ?? 0)
    const costs = out.convert(commission, row.text('commissionCurrency') || currency, currency, at.date, row.number)
    out.add({
      type: side.startsWith('BUY') ? 'buy' : 'sell',
      at,
      row: row.number,
      product: row.text('description') || productOf(row),
      ...(isin ? { isin } : {}),
      ...(row.text('symbol') ? { ticker: row.text('symbol') } : {}),
      ...(row.text('exchange') ? { exchange: row.text('exchange') } : {}),
      assetClass: assetClass === 'BOND' ? 'bond' : assetClass === 'FUND' ? 'fund' : guessAssetClass(row.text('description')),
      quantity,
      price,
      amount: Math.abs(row.money('tradeMoney') ?? quantity * price),
      cashCurrency: currency,
      costs,
      taxes: Math.abs(row.money('taxes') ?? 0),
      orderId: row.text('orderId'),
    })
  }
}

const DIVIDENDS = new Set(['dividends', 'payment in lieu of dividends'])

function parseCash(out: Collector, table: RawTable) {
  const header = findHeader(table, COLUMNS, ['type', 'amount'], 3)
  if (!header) return
  const rows = dataRows(table, header).filter((row) => !isSummary(row))
  const dateOfRow = (row: Row<Key>) => dateOf(row, 'settleDate') ?? dateOf(row, 'dateTime') ?? dateOf(row, 'reportDate')

  // A dividend reversal (negative amount) cancels the latest earlier dividend of the same amount.
  const reversed = new Set<Row<Key>>()
  const unmatched = new Set<Row<Key>>()
  const dividends = rows.filter((r) => DIVIDENDS.has(normalizeHeader(r.get('type'))))
  for (const reversal of dividends.filter((r) => (r.money('amount') ?? 0) < 0)) {
    const date = dateOfRow(reversal)?.date ?? ''
    const original = dividends
      .filter(
        (d) =>
          !reversed.has(d) &&
          isinFrom(d) === isinFrom(reversal) &&
          Math.abs((d.money('amount') ?? 0) + (reversal.money('amount') ?? 0)) < 1e-9 &&
          (dateOfRow(d)?.date ?? '') <= date,
      )
      .at(-1)
    if (original) reversed.add(original).add(reversal)
    else unmatched.add(reversal)
  }

  for (const row of rows) {
    if (reversed.has(row)) continue
    const at = dateOfRow(row)
    if (!at) {
      out.issue('error', 'Invalid date.', row.number)
      continue
    }
    const type = normalizeHeader(row.get('type'))
    const amount = row.money('amount') ?? 0
    const isin = isinFrom(row)
    const base = { at, row: row.number, product: productOf(row) || 'Cash', ...(isin ? { isin } : {}), cashCurrency: row.text('currency') || 'USD', amount }
    if (type === 'deposits/withdrawals' || type === 'deposits & withdrawals' || type === 'deposits') {
      out.add({ ...base, product: 'Cash', type: amount >= 0 ? 'deposit' : 'withdrawal' })
    } else if (DIVIDENDS.has(type)) {
      if (unmatched.has(row)) out.issue('warning', `Reversal of a ${base.product} dividend that is not in this file skipped.`, row.number)
      else out.add({ ...base, type: 'dividend' })
    } else if (type === 'withholding tax') {
      if (amount <= 0) out.add({ ...base, type: 'tax' })
      else out.add({ ...base, product: 'Tax refund', isin: '', type: 'dividend' })
    } else if (type === 'broker interest received' || type === 'bond interest received') {
      out.add({ ...base, product: 'Interest', isin: '', type: 'dividend' })
    } else if (type.includes('fee') || type.includes('interest paid') || type.includes('commission')) {
      // Positive amounts are fee refunds.
      out.add({ ...base, product: 'Fees', isin: '', type: amount <= 0 ? 'fee' : 'dividend' })
    } else out.issue('warning', `Unknown cash transaction type "${row.text('type')}" skipped.`, row.number)
  }
}

/**
 * Splits: a forward split is one row with the units added; a reverse split or ISIN change is a
 * pair (old ISIN negative, new ISIN positive). The ratio is in the description: `SPLIT 1 FOR 8`.
 */
function parseCorporate(out: Collector, table: RawTable) {
  const header = findHeader(table, COLUMNS, ['type', 'quantity', 'description'], 3)
  if (!header) return
  let pendingOld: { isin: string; quantity: number; date: string } | null = null
  for (const row of dataRows(table, header)) {
    if (isSummary(row)) continue
    const at = dateOf(row, 'dateTime') ?? dateOf(row, 'reportDate')
    if (!at) {
      out.issue('error', 'Invalid date.', row.number)
      continue
    }
    const quantity = row.money('quantity') ?? 0
    const isin = isinFrom(row)
    const description = row.text('description')
    const ratioMatch = /SPLIT (\d+(?:\.\d+)?) FOR (\d+(?:\.\d+)?)/i.exec(description)
    // `... (GE, GENERAL ELECTRIC CO, US3696043013)` names the product at the end.
    const name = /\([^,()]+, ([^()]+), [A-Z]{2}[A-Z0-9]{9}\d\)$/.exec(description)?.[1]
    const base = { at, row: row.number, product: name ?? productOf(row), ...(isin ? { isin } : {}), cashCurrency: row.text('currency') || 'USD', amount: 0 }
    if (quantity < 0 && ratioMatch) {
      pendingOld = { isin, quantity: -quantity, date: at.date }
    } else if (quantity > 0 && pendingOld && pendingOld.date === at.date) {
      const split = { ratio: quantity / pendingOld.quantity, fromQuantity: pendingOld.quantity, ...(pendingOld.isin !== isin ? { fromIsin: pendingOld.isin } : {}) }
      out.add({ ...base, type: 'split', quantity, split })
      pendingOld = null
    } else if (quantity > 0 && ratioMatch) {
      const ratio = Number(ratioMatch[1]) / Number(ratioMatch[2])
      if (ratio <= 1) {
        out.issue('warning', `Split "${description}" without the matching removal row; skipped.`, row.number)
        continue
      }
      const before = quantity / (ratio - 1)
      out.add({ ...base, type: 'split', quantity: before * ratio, split: { ratio, fromQuantity: before } })
    } else if (quantity > 0) {
      // Spin-offs and stock dividends: free units, unless the action is paid for.
      const paid = Math.abs(row.money('proceeds') ?? 0)
      out.add({ ...base, type: 'buy', quantity, price: paid / quantity, amount: paid })
    } else if (quantity < 0) {
      // Cash mergers and liquidations: the units leave for the proceeds.
      const proceeds = Math.abs(row.money('proceeds') ?? row.money('amount') ?? 0)
      out.add({ ...base, type: 'sell', quantity: -quantity, price: proceeds / -quantity, amount: proceeds })
    }
  }
}

export const interactiveBrokersAdapter: BrokerAdapter = {
  id: 'interactive-brokers',
  label: 'Interactive Brokers',
  detect,
  parse(tables, context?: ImportContext) {
    const outputs = tables.map((table) => {
      const out = new Collector('ibkr', table.fileName, context)
      const kind = kindOf(table)
      if (kind === 'trades') parseTrades(out, table)
      else if (kind === 'cash') parseCash(out, table)
      else if (kind === 'corporate') parseCorporate(out, table)
      return out
    })
    const kinds = new Set(tables.map(kindOf))
    return result(
      'Interactive Brokers',
      outputs,
      { transactionCosts: true, fxCosts: false, taxes: kinds.has('cash'), dividends: kinds.has('cash'), deposits: kinds.has('cash') },
      {
        fxCosts: 'Interactive Brokers books currency conversions as separate trades; their cost is in the commission.',
        ...(kinds.has('cash')
          ? {}
          : {
              taxes: 'Add the Cash Transactions Flex Query to include withholding taxes.',
              dividends: 'Add the Cash Transactions Flex Query to include dividends.',
              deposits: 'Add the Cash Transactions Flex Query to include deposits and withdrawals.',
            }),
      },
    )
  },
}
