import type { AssetClass } from '../../model/transaction.ts'
import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, Holdings, parseDateTime, result, type ColumnSpec, type DateTime, type Row } from './kit.ts'

/**
 * Trade Republic "Transaction export" (2025+), comma or semicolon separated. `amount` is the gross
 * amount in EUR; `fee` and `tax` are signed and add up with it to the cash effect. A SPLIT row holds
 * the number of shares added. The type mapping follows Portfolio Performance's TradeRepublicCSVExtractor.
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

/** Cash in; a fee on the row (card top-up) is booked as a separate fee. */
const DEPOSITS = new Set(['CUSTOMER_INPAYMENT', 'CUSTOMER_INBOUND', 'TRANSFER_INBOUND', 'TRANSFER_INSTANT_INBOUND'])
const INCOME = new Set(['DIVIDEND', 'DISTRIBUTION', 'DIVIDEND_EQUIVALENT_PAYMENT'])
/** Rewards paid in cash: income without an instrument. */
const BONUSES = new Set(['BONUS', 'STOCKPERK', 'BENEFITS_SAVEBACK', 'REFERRAL', 'KINDERGELD_BONUS', 'PEA_MARKETING', 'ADDITIONAL_INCOME', 'COMPENSATION'])
/** Rows that only carry a tax charge (negative `tax`) or refund (positive `tax`). */
const TAX_ONLY = new Set(['PRE_DETERMINED_TAX_BASE', 'SEC_ACCOUNT', 'TAX_OPTIMIZATION'])
/** Cash movements that are a deposit or a withdrawal depending on the sign of `amount`. */
const BY_SIGN = new Set([
  'CUSTOMER_OUTPAYMENT', 'CUSTOMER_OUTBOUND_REQUEST', 'CUSTOMER_INPAYMENT_REVERSAL', 'GIFT',
  'TRANSFER_IN', 'TRANSFER_OUT', 'TRANSFER_OUTBOUND', 'TRANSFER_INSTANT_OUTBOUND', 'TRANSFER_DIRECT_DEBIT_INBOUND',
  'VIBAN_TRANSFER_INBOUND', 'VIBAN_TRANSFER_OUTBOUND', 'GENERAL_INBOUND', 'MANUAL', 'MANUAL_CASH_TRANSFER', 'PAYMENT',
  'CARD_TRANSACTION', 'CARD_TRANSACTION_INTERNATIONAL', 'CARD_TRANSACTION_REFUND', 'CARD_TRANSACTION_REFUND_REVERSAL',
  'CARD_ORDERING_FEE', 'EXCHANGE', 'INSTRUCTION', 'OFFER', 'MERGER', 'LIQUIDATION_PROCEEDS', 'EARLY_REDEMPTION',
  'CAPITAL_INC_CASH', 'BOND_ACCRUED_INTEREST', 'CFD_ORDER', 'CITI_TRADING', 'TRADING_CITI', 'CRYPTO_TRADING',
  'OTHER_EXECUTION', 'TAX',
])
/** Corporate actions that only move the units: the matching CASH row (FINAL_MATURITY, TILG) books the money. */
const PAIRED_DELIVERIES = new Set(['REDEMPTION', 'FINAL_MATURITY', 'WARRANT_EXERCISE'])

function isDelivery(row: Row<Key>): boolean {
  const type = row.text('type').toUpperCase()
  if (!PAIRED_DELIVERIES.has(type)) return false
  // FINAL_MATURITY is also the CASH row that pays the money.
  return row.text('category').toUpperCase() === 'CORPORATE_ACTION' || type !== 'FINAL_MATURITY'
}

function assetClass(value: string): AssetClass {
  const map: Record<string, AssetClass> = { STOCK: 'stock', FUND: 'etf', BOND: 'bond', CRYPTO: 'crypto', PRIVATE_FUND: 'fund' }
  return map[value] ?? 'unknown'
}

function detect(table: RawTable): number {
  return detectByHeaders(table, ['datetime', 'category', 'type', 'asset_class', 'symbol', 'shares', 'transaction_id'], 0.95)
}

interface Dated {
  row: Row<Key>
  at: DateTime | null
}

function stamp(at: DateTime): string {
  return `${at.date}T${at.time}`
}

/**
 * Trade Republic corrects a dividend by reversing it (negative amount, tax and fee) and booking it
 * again. A reversal cancels the latest earlier dividend with exactly the inverse values; both rows are
 * dropped. Returns the rows to skip and the reversals without an original in the file.
 */
function matchDividendCorrections(rows: Dated[]): { cancelled: Set<Row<Key>>; unmatched: Set<Row<Key>> } {
  const key = (row: Row<Key>, sign: number) =>
    [row.text('symbol'), Math.abs(row.money('shares') ?? 0), sign * (row.money('amount') ?? 0), sign * (row.money('tax') ?? 0), sign * (row.money('fee') ?? 0)]
      .map((v) => (typeof v === 'number' ? v.toFixed(6) : v))
      .join('|')
  const dividends = rows.filter((r) => r.at && INCOME.has(r.row.text('type').toUpperCase()))
  const originals = dividends.filter((r) => (r.row.money('amount') ?? 0) >= 0)
  const cancelled = new Set<Row<Key>>()
  const unmatched = new Set<Row<Key>>()
  for (const correction of dividends.filter((r) => (r.row.money('amount') ?? 0) < 0)) {
    const wanted = key(correction.row, -1)
    const match = originals
      .filter((o) => !cancelled.has(o.row) && key(o.row, 1) === wanted && stamp(o.at as DateTime) <= stamp(correction.at as DateTime))
      .at(-1)
    if (match) cancelled.add(match.row).add(correction.row)
    else unmatched.add(correction.row)
  }
  return { cancelled, unmatched }
}

interface Prepared {
  table: RawTable
  /** Rows in date order; null when the header is missing. */
  rows: Dated[] | null
}

function prepare(table: RawTable): Prepared {
  const header = findHeader(table, COLUMNS, REQUIRED)
  if (!header) return { table, rows: null }
  const rows = dataRows(table, header)
    .map((row) => ({ row, at: row.has('date') && row.text('date') ? withDate(row) : parseDateTime(row.get('datetime')) }))
    .sort((a, b) => (a.at && b.at ? stamp(a.at).localeCompare(stamp(b.at)) : 0))
  return { table, rows }
}

function parseTable({ table, rows }: Prepared, corrections: ReturnType<typeof matchDividendCorrections>, context?: ImportContext) {
  const out = new Collector('trade-republic', table.fileName, context)
  if (!rows) {
    out.issue('error', 'Missing Trade Republic columns.')
    return out
  }
  const held = new Holdings()
  // Quantities of delivery rows, for the cash row of the same instrument and day.
  const delivered = new Map<string, number>()
  for (const { row, at } of rows) {
    if (at && isDelivery(row)) {
      delivered.set(`${row.text('symbol')}|${at.date}`, Math.abs(row.money('shares') ?? 0))
    }
  }

  for (const { row, at } of rows) {
    if (!at) {
      out.issue('error', `Invalid date "${row.text('datetime')}"`, row.number)
      continue
    }
    if (corrections.cancelled.has(row)) continue
    const type = row.text('type').toUpperCase()
    const isin = row.text('symbol')
    const shares = row.money('shares') ?? 0
    const amount = row.money('amount') ?? 0
    const fee = Math.abs(row.money('fee') ?? 0)
    const tax = row.money('tax') ?? 0
    const crypto = row.text('assetClass').toUpperCase() === 'CRYPTO'
    const base = {
      at,
      row: row.number,
      product: row.text('name') || isin || type,
      // Crypto rows carry a ticker in `symbol` instead of an ISIN.
      ...(isin ? (crypto ? { ticker: isin } : { isin }) : {}),
      assetClass: assetClass(row.text('assetClass').toUpperCase()),
      cashCurrency: row.text('currency') || 'EUR',
      orderId: row.text('id'),
    }
    const cash = { ...base, product: 'Cash', isin: '', ticker: '' }

    if (type === 'BUY' || type === 'SELL' || type === 'PRIVATE_MARKET_BUY' || type === 'PRIVATE_MARKET_SELL') {
      const buy = type.endsWith('BUY')
      const quantity = Math.abs(shares)
      if (quantity === 0) {
        out.issue('warning', `${type} of ${base.product} without shares skipped.`, row.number)
        continue
      }
      held.change(isin, buy ? quantity : -quantity)
      out.add({ ...base, type: buy ? 'buy' : 'sell', quantity, price: row.money('price') ?? Math.abs(amount) / quantity, amount, costs: fee, taxes: Math.abs(tax) })
    } else if (INCOME.has(type)) {
      if (corrections.unmatched.has(row)) {
        out.issue('warning', `Reversal of a ${base.product} dividend that is not in this file skipped.`, row.number)
        continue
      }
      out.add({ ...base, type: 'dividend', amount, costs: fee, taxes: Math.abs(tax) })
    } else if (type === 'INTEREST_PAYMENT') {
      // Bond coupons name the bond; interest on cash has no instrument.
      const product = row.text('name') ? base : { ...cash, product: 'Interest' }
      out.add({ ...product, type: 'dividend', amount, taxes: Math.abs(tax) })
    } else if (type === 'EARNINGS') {
      // A negative total is the German Vorabpauschale: a tax charge without income.
      const total = amount + tax
      if (Math.abs(total) < 1e-9) continue
      if (total < 0) out.add({ ...base, type: 'tax', amount: total })
      else out.add({ ...base, type: 'dividend', amount, taxes: Math.abs(tax) })
    } else if (type === 'SPLIT') {
      const split = held.splitAdding(isin, shares)
      if (!split) {
        out.issue('warning', `Split for ${base.product} while no shares are held; skipped.`, row.number)
        continue
      }
      held.change(isin, shares)
      out.add({ ...base, type: 'split', quantity: split.fromQuantity * split.ratio, amount: 0, split })
    } else if (isDelivery(row)) {
      out.issue('info', `${type} for ${base.product}: the money is booked by the matching cash row.`, row.number)
    } else if (type === 'FINAL_MATURITY' || type === 'TILG') {
      const quantity = Math.abs(shares) || delivered.get(`${isin}|${at.date}`) || held.get(isin)
      if (quantity <= 0) {
        out.issue('warning', `Redemption of ${base.product} without a quantity; skipped.`, row.number)
        continue
      }
      held.change(isin, -quantity)
      out.add({ ...base, type: 'sell', quantity, price: Math.abs(amount) / quantity, amount, taxes: Math.abs(tax) })
    } else if (type === 'MIGRATION') {
      const quantity = Math.abs(shares)
      held.change(isin, shares)
      out.add({ ...base, type: shares < 0 ? 'transferOut' : 'transferIn', quantity, price: row.money('price') ?? 0, amount: shares < 0 ? 0 : quantity * (row.money('price') ?? 0) })
    } else if (DEPOSITS.has(type)) {
      if (amount !== 0) out.add({ ...cash, type: amount > 0 ? 'deposit' : 'withdrawal', amount })
      if (fee > 0) out.add({ ...cash, product: 'Fees', type: 'fee', amount: fee })
    } else if (BY_SIGN.has(type) || type.startsWith('CARD_TRANSACTION')) {
      if (amount !== 0) out.add({ ...cash, type: amount > 0 ? 'deposit' : 'withdrawal', amount })
    } else if (type === 'FEE') {
      if (amount !== 0) out.add({ ...cash, product: 'Fees', type: amount < 0 ? 'fee' : 'deposit', amount })
    } else if (BONUSES.has(type)) {
      out.add({ ...cash, product: 'Bonus', type: 'dividend', amount, taxes: Math.abs(tax) })
    } else if (TAX_ONLY.has(type)) {
      if (tax === 0) continue
      // A positive tax is a refund: income rather than a charge.
      if (tax > 0) out.add({ ...cash, product: 'Tax refund', type: 'dividend', amount: tax })
      else out.add({ ...base, type: 'tax', amount: tax })
    } else {
      out.issue('warning', `Unknown Trade Republic type "${row.text('category')} / ${type}" skipped.`, row.number)
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
    const prepared = tables.map(prepare)
    // Across files: a reversal can be in a later export than the dividend it corrects.
    const corrections = matchDividendCorrections(prepared.flatMap((p) => p.rows ?? []))
    return result(
      'Trade Republic',
      prepared.map((p) => parseTable(p, corrections, context)),
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: true },
      { fxCosts: 'Trade Republic includes currency conversion in the price; there is no separate FX cost.' },
    )
  },
}
