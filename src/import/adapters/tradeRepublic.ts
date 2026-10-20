import type { AssetClass } from '../../model/transaction.ts'
import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, Holdings, parseDateTime, result, type ColumnSpec, type Row } from './kit.ts'

/**
 * Trade Republic "Transaction export" (2025+), comma or semicolon separated. Amounts are in EUR;
 * fee and tax are separate columns. A SPLIT row holds the number of shares added.
 */
const COLUMNS = {
  datetime: ['datetime'],
  date: ['date'],
  category: ['category'],
  type: ['type'],
  assetClass: ['asset_class'],
  name: ['name'],
  symbol: ['symbol'],
  shares: ['shares'],
  price: ['price'],
  amount: ['amount'],
  fee: ['fee'],
  tax: ['tax'],
  currency: ['currency'],
  fxRate: ['fx_rate'],
  id: ['transaction_id'],
} satisfies ColumnSpec<string>
type Key = keyof typeof COLUMNS

const REQUIRED: Key[] = ['datetime', 'type', 'name', 'symbol', 'shares', 'amount']

const DEPOSITS = new Set(['CUSTOMER_INPAYMENT', 'CUSTOMER_INBOUND', 'TRANSFER_INBOUND', 'TRANSFER_INSTANT_INBOUND', 'TRANSFER_IN'])
const WITHDRAWALS = new Set([
  'CUSTOMER_OUTPAYMENT',
  'CUSTOMER_OUTBOUND_REQUEST',
  'TRANSFER_INSTANT_OUTBOUND',
  'TRANSFER_OUT',
  'GIFT',
])
const INCOME = new Set(['DIVIDEND', 'DISTRIBUTION', 'DIVIDEND_EQUIVALENT_PAYMENT'])
const BONUSES = new Set(['BONUS', 'STOCKPERK', 'BENEFITS_SAVEBACK', 'INTEREST_PAYMENT'])
const TAX_ONLY = new Set(['PRE_DETERMINED_TAX_BASE', 'EARNINGS', 'SEC_ACCOUNT', 'TAX_OPTIMIZATION'])
/** Redemptions where the matching cash row (FINAL_MATURITY, TILG) books the money. */
const PAIRED_DELIVERIES = new Set(['REDEMPTION', 'WARRANT_EXERCISE'])

function assetClass(value: string): AssetClass {
  const map: Record<string, AssetClass> = { STOCK: 'stock', FUND: 'etf', BOND: 'bond', CRYPTO: 'crypto', PRIVATE_FUND: 'fund' }
  return map[value] ?? 'unknown'
}

function detect(table: RawTable): number {
  return detectByHeaders(table, ['datetime', 'category', 'type', 'asset_class', 'symbol', 'shares', 'transaction_id'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('trade-republic', table.fileName, context)
  const header = findHeader(table, COLUMNS, REQUIRED)
  if (!header) {
    out.issue('error', 'Missing Trade Republic columns.')
    return out
  }
  const rows = dataRows(table, header)
    .map((row) => ({ row, at: row.has('date') && row.text('date') ? withDate(row) : parseDateTime(row.get('datetime')) }))
    .sort((a, b) => (a.at && b.at ? `${a.at.date}T${a.at.time}`.localeCompare(`${b.at.date}T${b.at.time}`) : 0))
  const held = new Holdings()
  // Quantities of REDEMPTION/WARRANT_EXERCISE rows, for the cash row of the same instrument and day.
  const delivered = new Map<string, number>()
  for (const { row, at } of rows) {
    if (at && PAIRED_DELIVERIES.has(row.text('type').toUpperCase())) {
      delivered.set(`${row.text('symbol')}|${at.date}`, Math.abs(row.money('shares') ?? 0))
    }
  }

  for (const { row, at } of rows) {
    if (!at) {
      out.issue('error', `Invalid date "${row.text('datetime')}"`, row.number)
      continue
    }
    const type = row.text('type').toUpperCase()
    const isin = row.text('symbol')
    const shares = row.money('shares') ?? 0
    const amount = row.money('amount') ?? 0
    const fee = Math.abs(row.money('fee') ?? 0)
    const tax = row.money('tax') ?? 0
    const base = {
      at,
      row: row.number,
      product: row.text('name') || isin || type,
      ...(isin ? { isin } : {}),
      assetClass: assetClass(row.text('assetClass').toUpperCase()),
      cashCurrency: row.text('currency') || 'EUR',
      orderId: row.text('id'),
    }

    if (type === 'BUY' || type === 'SELL') {
      const quantity = Math.abs(shares)
      if (quantity === 0) {
        out.issue('warning', `${type} without shares skipped.`, row.number)
        continue
      }
      held.change(isin, type === 'BUY' ? quantity : -quantity)
      out.add({ ...base, type: type === 'BUY' ? 'buy' : 'sell', quantity, price: row.money('price') ?? Math.abs(amount) / quantity, amount, costs: fee, taxes: Math.abs(tax) })
    } else if (INCOME.has(type)) {
      out.add({ ...base, type: 'dividend', amount, taxes: Math.abs(tax) })
    } else if (type === 'SPLIT') {
      const split = held.splitAdding(isin, shares)
      if (!split) {
        out.issue('warning', `Split for ${base.product} while no shares are held; skipped.`, row.number)
        continue
      }
      held.change(isin, shares)
      out.add({ ...base, type: 'split', quantity: split.fromQuantity * split.ratio, amount: 0, split })
    } else if (type === 'FINAL_MATURITY' || type === 'TILG') {
      const quantity = Math.abs(shares) || delivered.get(`${isin}|${at.date}`) || held.get(isin)
      if (quantity <= 0) {
        out.issue('warning', `Redemption of ${base.product} without a quantity; skipped.`, row.number)
        continue
      }
      held.change(isin, -quantity)
      out.add({ ...base, type: 'sell', quantity, price: Math.abs(amount) / quantity, amount, taxes: Math.abs(tax) })
    } else if (PAIRED_DELIVERIES.has(type)) {
      out.issue('info', `${type} for ${base.product}: the money is booked by the matching redemption row.`, row.number)
    } else if (type === 'MIGRATION') {
      const quantity = Math.abs(shares)
      held.change(isin, shares)
      out.add({ ...base, type: shares < 0 ? 'transferOut' : 'transferIn', quantity, price: row.money('price') ?? 0, amount: shares < 0 ? 0 : quantity * (row.money('price') ?? 0) })
    } else if (DEPOSITS.has(type) || WITHDRAWALS.has(type) || type.startsWith('CARD_TRANSACTION')) {
      if (amount === 0) continue
      out.add({ ...base, product: 'Cash', type: amount > 0 ? 'deposit' : 'withdrawal', amount })
    } else if (type === 'FEE') {
      out.add({ ...base, product: 'Fees', type: 'fee', amount })
    } else if (BONUSES.has(type)) {
      out.add({ ...base, product: type === 'INTEREST_PAYMENT' ? 'Interest' : 'Bonus', isin: '', type: 'dividend', amount, taxes: Math.abs(tax) })
    } else if (TAX_ONLY.has(type)) {
      if (tax === 0) continue
      // A positive tax is a refund: income rather than a charge.
      if (tax > 0) out.add({ ...base, product: 'Tax refund', isin: '', type: 'dividend', amount: tax })
      else out.add({ ...base, type: 'tax', amount: tax })
    } else if (type === 'PRIVATE_MARKET_BUY') {
      out.issue('warning', `Private Markets pre-payment of ${base.product} skipped: the export has no units for it.`, row.number)
    } else {
      out.issue('warning', `Unknown Trade Republic type "${type}" skipped.`, row.number)
    }
  }
  return out
}

function withDate(row: Row<Key>) {
  const at = parseDateTime(row.get('datetime'))
  const date = parseDateTime(row.get('date'))?.date
  return date ? { date, time: at?.time ?? '00:00' } : at
}

export const tradeRepublicAdapter: BrokerAdapter = {
  id: 'trade-republic',
  label: 'Trade Republic',
  detect,
  parse(tables, context) {
    return result(
      'Trade Republic',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: true },
      { fxCosts: 'Trade Republic includes currency conversion in the price; there is no separate FX cost.' },
    )
  },
}
