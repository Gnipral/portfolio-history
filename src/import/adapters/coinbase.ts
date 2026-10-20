import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { parseNumber } from '../parse.ts'
import { Collector, currencyOf, dataRows, detectByHeaders, findHeader, parseDateTime, result, type ColumnSpec } from './kit.ts'
import { coin, isFiat } from './crypto.ts'

/**
 * Coinbase transaction history CSV, in its several generations: with or without an ID column,
 * `Price Currency` or `Spot Price Currency`, amounts with or without a € sign, and a preamble.
 */
const COLUMNS = {
  timestamp: ['timestamp'],
  type: ['transaction type'],
  asset: ['asset'],
  quantity: ['quantity transacted'],
  priceCurrency: ['price currency', 'spot price currency'],
  price: ['price at transaction', 'spot price at transaction'],
  subtotal: ['subtotal'],
  total: ['total (inclusive of fees and/or spread)', 'total (inclusive of fees)'],
  fees: ['fees and/or spread', 'fees'],
  notes: ['notes'],
  id: ['id'],
} satisfies ColumnSpec<string>

const REWARDS = /reward|staking income|income|inflation|eth2 deprecation|airdrop/
const INTERNAL = /staking transfer|unstaking transfer/
const CONVERTED = /Converted ([\d.,]+) (\S+) to ([\d.,]+) (\S+)/

function detect(table: RawTable): number {
  return detectByHeaders(table, ['timestamp', 'transaction type', 'asset', 'quantity transacted'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('coinbase', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['timestamp', 'type', 'asset', 'quantity'])
  if (!header) {
    out.issue('error', 'Missing Coinbase columns.')
    return out
  }
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('timestamp'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('timestamp')}"`, row.number)
      continue
    }
    const type = row.text('type').toLowerCase()
    const symbol = row.text('asset').toUpperCase()
    const quantity = Math.abs(row.money('quantity') ?? 0)
    const currency = row.text('priceCurrency') || currencyOf(row.get('subtotal')) || 'EUR'
    const subtotal = Math.abs(row.money('subtotal') ?? 0)
    const total = Math.abs(row.money('total') ?? 0)
    const fees = Math.abs(row.money('fees') ?? 0)
    const price = row.money('price') ?? 0
    const base = { ...coin(symbol, at, row.number), cashCurrency: currency, currency, price, orderId: row.text('id') }

    if (isFiat(symbol)) {
      if (type === 'deposit') out.add({ ...base, product: 'Cash', ticker: '', assetClass: 'cash', type: 'deposit', cashCurrency: symbol, amount: quantity })
      else if (type === 'withdrawal') out.add({ ...base, product: 'Cash', ticker: '', assetClass: 'cash', type: 'withdrawal', cashCurrency: symbol, amount: quantity })
      else out.issue('info', `${row.text('type')} of ${symbol} does not change the portfolio.`, row.number)
      continue
    }
    if (quantity === 0) continue

    if (/buy/.test(type)) {
      out.add({ ...base, type: 'buy', quantity, amount: subtotal || quantity * price, costs: fees || Math.max(0, total - subtotal) })
    } else if (/sell/.test(type)) {
      out.add({ ...base, type: 'sell', quantity, amount: subtotal || quantity * price, costs: fees || Math.max(0, subtotal - total) })
    } else if (type === 'convert') {
      const converted = CONVERTED.exec(row.text('notes'))
      const value = subtotal || quantity * price
      out.add({ ...base, type: 'sell', quantity, amount: value, costs: fees })
      if (converted) {
        const toQuantity = parseNumber(converted[3] as string) ?? 0
        if (toQuantity > 0) out.add({ ...base, ...coin(converted[4] as string, at, row.number), type: 'buy', quantity: toQuantity, price: value / toQuantity, amount: value })
      } else {
        out.issue('warning', 'Convert without the received coin in the notes; only the sale is booked.', row.number)
      }
    } else if (type === 'send' || type === 'withdrawal') {
      out.add({ ...base, type: 'transferOut', quantity, amount: 0, costs: fees })
    } else if (type === 'receive' || type === 'deposit') {
      out.add({ ...base, type: 'transferIn', quantity, amount: subtotal || quantity * price })
    } else if (INTERNAL.test(type)) {
      out.issue('info', `${row.text('type')} moves ${symbol} within Coinbase; skipped.`, row.number)
    } else if (REWARDS.test(type)) {
      out.add({ ...base, type: 'buy', quantity, amount: 0 })
    } else {
      out.issue('warning', `Unknown Coinbase type "${row.text('type')}" skipped.`, row.number)
    }
  }
  return out
}

export const coinbaseAdapter: BrokerAdapter = {
  id: 'coinbase',
  label: 'Coinbase',
  detect,
  parse(tables, context) {
    return result(
      'Coinbase',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: false, dividends: false, deposits: true },
      {
        fxCosts: 'Crypto exchanges have no currency conversion costs.',
        taxes: 'Coinbase exports contain no taxes.',
        dividends: 'Rewards and staking income are added as free coins, not as dividends.',
      },
    )
  },
}
