import { trading212Pdf } from '../pdf/trading212.ts'
import { withPdf } from '../pdf/kit.ts'
import { normalizeHeader } from '../parse.ts'
import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, parseDateTime, result, type ColumnSpec, type DateTime, type Row } from './kit.ts'

/**
 * Trading 212 CSV (History → Export). Columns come and go depending on what happened in the
 * account, so everything is looked up by name. `Total` is in the account currency and includes fees.
 */
const COLUMNS = {
  action: ['action'],
  time: ['time', 'time (utc)'],
  isin: ['isin'],
  ticker: ['ticker'],
  name: ['name'],
  notes: ['notes'],
  id: ['id'],
  shares: ['no. of shares'],
  price: ['price / share'],
  priceCurrency: ['currency (price / share)'],
  fxRate: ['exchange rate'],
  total: ['total'],
  totalCurrency: ['currency (total)'],
  withholding: ['withholding tax'],
  withholdingCurrency: ['currency (withholding tax)'],
  stampDuty: ['stamp duty'],
  sdrt: ['stamp duty reserve tax'],
  sdrtCurrency: ['currency (stamp duty reserve tax)'],
  frenchTax: ['french transaction tax'],
  frenchTaxCurrency: ['currency (french transaction tax)'],
  conversionFee: ['currency conversion fee'],
  conversionFeeCurrency: ['currency (currency conversion fee)'],
  finraFee: ['finra fee'],
  finraFeeCurrency: ['currency (finra fee)'],
  charge: ['charge amount'],
  chargeCurrency: ['currency (charge amount)'],
} satisfies ColumnSpec<string>
type Key = keyof typeof COLUMNS

function detect(table: RawTable): number {
  return detectByHeaders(table, ['action', 'isin', 'ticker', 'no. of shares', 'price / share', 'total'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('trading212', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['action', 'time', 'total'])
  if (!header) {
    out.issue('error', 'Missing Trading 212 columns.')
    return out
  }
  const splitClose = new Map<string, { quantity: number }>()
  const timeUtcIndex = (table.rows[header.index] ?? []).findIndex((h) => normalizeHeader(h) === 'time (utc)')

  for (const row of dataRows(table, header)) {
    // "Time (UTC)" carries a zone; plain "Time" is already local.
    const at = parseDateTime(`${row.text('time')}${header.columns.time === timeUtcIndex ? 'Z' : ''}`.replace(' ', 'T'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('time')}"`, row.number)
      continue
    }
    const action = row.text('action').toLowerCase()
    const isin = row.text('isin')
    const quantity = Math.abs(row.money('shares') ?? 0)
    const price = row.money('price') ?? 0
    const total = Math.abs(row.money('total') ?? 0)
    const cashCurrency = row.text('totalCurrency') || 'EUR'
    const base = {
      at,
      row: row.number,
      product: row.text('name') || row.text('ticker') || isin,
      ...(isin ? { isin } : {}),
      ...(row.text('ticker') ? { ticker: row.text('ticker') } : {}),
      currency: row.text('priceCurrency') || cashCurrency,
      cashCurrency,
      orderId: row.text('id'),
    }
    const charges = {
      costs: charge(out, row, at, cashCurrency, ['finraFee', 'finraFeeCurrency'], ['charge', 'chargeCurrency']),
      taxes: charge(out, row, at, cashCurrency, ['sdrt', 'sdrtCurrency'], ['frenchTax', 'frenchTaxCurrency'], ['stampDuty', 'totalCurrency']),
      fxCosts: charge(out, row, at, cashCurrency, ['conversionFee', 'conversionFeeCurrency']),
    }
    const allCharges = charges.costs + charges.taxes + charges.fxCosts

    if (/^(market|limit|stop|stop limit) (buy|sell)$/.test(action)) {
      if (quantity === 0) continue
      const buy = action.endsWith('buy')
      // Total includes the charges: a buy costs gross + charges, a sell pays gross - charges.
      const gross = buy ? total - allCharges : total + allCharges
      out.add({ ...base, type: buy ? 'buy' : 'sell', quantity, price, amount: gross, ...charges })
    } else if (action.startsWith('dividend (')) {
      const tax = withholding(out, row, at, cashCurrency)
      out.add({ ...base, type: 'dividend', amount: total + tax, taxes: tax })
    } else if (action === 'dividend adjustment') {
      const amount = row.money('total') ?? 0
      out.add({ ...base, product: 'Dividend adjustment', type: amount >= 0 ? 'dividend' : 'fee', amount })
    } else if (action === 'stock split close') {
      splitClose.set(isin, { quantity })
    } else if (action === 'stock split open') {
      const closed = splitClose.get(isin)
      if (!closed || closed.quantity === 0) {
        out.issue('warning', `Stock split for ${base.product} without the matching close row; skipped.`, row.number)
        continue
      }
      splitClose.delete(isin)
      out.add({ ...base, type: 'split', quantity, amount: 0, split: { ratio: quantity / closed.quantity, fromQuantity: closed.quantity } })
    } else if (action === 'scrip stock dividends' || action === 'stock distribution') {
      if (quantity > 0) out.add({ ...base, type: 'buy', quantity, price: 0, amount: 0 })
    } else if (action === 'equity rights' || action === 'transfer in') {
      if (quantity > 0) out.add({ ...base, type: 'transferIn', quantity, price, amount: total })
    } else if (action === 'transfer out') {
      if (quantity > 0) out.add({ ...base, type: 'transferOut', quantity, price, amount: 0 })
    } else if (action === 'deposit' || action === 'card credit') {
      out.add({ ...base, product: 'Cash', type: 'deposit', amount: total })
    } else if (action === 'withdrawal' || action === 'card debit') {
      out.add({ ...base, product: 'Cash', type: 'withdrawal', amount: total })
    } else if (action === 'interest on cash' || action === 'lending interest' || action === 'spending cashback') {
      out.add({ ...base, product: action === 'spending cashback' ? 'Cashback' : 'Interest', type: 'dividend', amount: total })
    } else if (action === 'currency conversion') {
      out.issue('info', `Currency conversion (${row.text('notes')}) does not change the portfolio.`, row.number)
    } else {
      out.issue('warning', `Unknown Trading 212 action "${row.text('action')}" skipped.`, row.number)
    }
  }
  for (const isin of splitClose.keys()) out.issue('warning', `Stock split close for ${isin} without the matching open row.`)
  return out
}

/** Sum of charge columns, each converted to the cash currency. */
function charge(out: Collector, row: Row<Key>, at: DateTime, cashCurrency: string, ...pairs: [Key, Key][]): number {
  let sum = 0
  for (const [amountKey, currencyKey] of pairs) {
    const amount = Math.abs(row.money(amountKey) ?? 0)
    if (amount === 0) continue
    const currency = row.text(currencyKey) || cashCurrency
    sum += out.convert(amount, currency, cashCurrency, at.date, row.number)
  }
  return sum
}

/** Withholding tax is reported in the instrument's currency; express it in the cash currency. */
function withholding(out: Collector, row: Row<Key>, at: DateTime, cashCurrency: string): number {
  const amount = Math.abs(row.money('withholding') ?? 0)
  if (amount === 0) return 0
  const currency = row.text('withholdingCurrency') || cashCurrency
  if (currency === cashCurrency) return amount
  // The row's exchange rate converts the instrument currency to the account currency.
  const rate = row.money('fxRate')
  if (rate && Number.isFinite(rate) && currency === row.text('priceCurrency')) return amount / rate
  return out.convert(amount, currency, cashCurrency, at.date, row.number)
}

export const trading212Adapter: BrokerAdapter = withPdf({
  id: 'trading212',
  label: 'Trading 212',
  detect,
  parse(tables, context) {
    return result(
      'Trading 212',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: true, taxes: true, dividends: true, deposits: true },
      {},
    )
  },
}, trading212Pdf)
