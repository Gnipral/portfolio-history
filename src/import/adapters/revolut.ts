import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, currencyOf, dataRows, detectByHeaders, findHeader, Holdings, parseDateTime, result, type ColumnSpec } from './kit.ts'

/**
 * Revolut trading account statement (CSV). Products are identified by ticker only; amounts carry
 * a currency sign (`$1,760.00`, `EUR 1,285.00`, `€50`). A STOCK SPLIT row holds the units added.
 */
const COLUMNS = {
  date: ['date'],
  ticker: ['ticker'],
  type: ['type'],
  quantity: ['quantity'],
  price: ['price per share'],
  total: ['total amount'],
  currency: ['currency'],
} satisfies ColumnSpec<string>

function detect(table: RawTable): number {
  return detectByHeaders(table, ['date', 'ticker', 'type', 'quantity', 'price per share', 'total amount', 'currency'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('revolut', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['date', 'ticker', 'type', 'total'])
  if (!header) {
    out.issue('error', 'Missing Revolut columns.')
    return out
  }
  const rows = dataRows(table, header)
    .map((row) => ({ row, at: parseDateTime(row.get('date')) }))
    .sort((a, b) => (a.at && b.at ? `${a.at.date}T${a.at.time}`.localeCompare(`${b.at.date}T${b.at.time}`) : 0))
  const held = new Holdings()

  for (const { row, at } of rows) {
    if (!at) {
      out.issue('error', `Invalid date "${row.text('date')}"`, row.number)
      continue
    }
    const type = row.text('type').toUpperCase()
    const ticker = row.text('ticker')
    const quantity = Math.abs(row.money('quantity') ?? 0)
    const total = row.money('total') ?? 0
    const cashCurrency = currencyOf(row.get('total')) ?? (row.text('currency') || 'USD')
    const base = {
      at,
      row: row.number,
      product: ticker || 'Cash',
      ...(ticker ? { ticker } : {}),
      currency: currencyOf(row.get('price')) ?? cashCurrency,
      cashCurrency,
      amount: Math.abs(total),
    }

    if (type.startsWith('BUY') || type.startsWith('SELL')) {
      if (quantity === 0) continue
      const buy = type.startsWith('BUY')
      held.change(ticker, buy ? quantity : -quantity)
      out.add({ ...base, type: buy ? 'buy' : 'sell', quantity, price: row.money('price') ?? Math.abs(total) / quantity })
    } else if (type === 'DIVIDEND') {
      out.add({ ...base, type: 'dividend' })
    } else if (type.startsWith('DIVIDEND TAX')) {
      out.add({ ...base, type: total < 0 ? 'tax' : 'dividend' })
    } else if (type === 'STOCK SPLIT') {
      const split = held.splitAdding(ticker, quantity)
      if (!split) {
        out.issue('warning', `Stock split for ${ticker} while no shares are held; skipped.`, row.number)
        continue
      }
      held.change(ticker, quantity)
      out.add({ ...base, type: 'split', quantity: split.fromQuantity * split.ratio, amount: 0, split })
    } else if (type.startsWith('CASH TOP-UP')) {
      out.add({ ...base, product: 'Cash', type: 'deposit' })
    } else if (type.startsWith('CASH WITHDRAWAL')) {
      out.add({ ...base, product: 'Cash', type: 'withdrawal' })
    } else if (type.includes('FEE')) {
      out.add({ ...base, product: 'Fees', type: 'fee' })
    } else if (type.startsWith('TRANSFER FROM')) {
      // Moving the account between Revolut entities changes nothing for the investor.
      out.issue('info', `${type.toLowerCase()}: internal transfer between Revolut entities skipped.`, row.number)
    } else if (type.startsWith('SPINOFF') || type.startsWith('STOCK DIVIDEND')) {
      if (quantity > 0) {
        held.change(ticker, quantity)
        out.add({ ...base, type: 'buy', quantity, amount: 0 })
      }
    } else {
      out.issue('warning', `Unknown Revolut type "${row.text('type')}" skipped.`, row.number)
    }
  }
  return out
}

export const revolutAdapter: BrokerAdapter = {
  id: 'revolut',
  label: 'Revolut',
  detect,
  parse(tables, context) {
    return result(
      'Revolut',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: false, fxCosts: false, taxes: false, dividends: true, deposits: true },
      {
        transactionCosts: 'The Revolut statement has no separate trading fees.',
        fxCosts: 'The Revolut statement has no separate currency conversion costs.',
        taxes: 'Revolut reports dividends after withholding tax, without the tax itself.',
      },
    )
  },
}
