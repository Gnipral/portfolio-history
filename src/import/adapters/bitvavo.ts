import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, parseDateTime, result, type ColumnSpec } from './kit.ts'
import { coin, isFiat } from './crypto.ts'

/** Bitvavo transaction history CSV. Fees are in a separate column, usually in EUR. */
const COLUMNS = {
  date: ['date'],
  time: ['time'],
  type: ['type'],
  currency: ['currency'],
  amount: ['amount'],
  quoteCurrency: ['quote currency'],
  quotePrice: ['quote price'],
  paidCurrency: ['received / paid currency'],
  paid: ['received / paid amount'],
  feeCurrency: ['fee currency'],
  fee: ['fee amount'],
  status: ['status'],
  id: ['transaction id'],
} satisfies ColumnSpec<string>

const REWARDS = /staking|reward|airdrop/

function detect(table: RawTable): number {
  return detectByHeaders(table, ['timezone', 'type', 'currency', 'quote currency', 'received / paid amount', 'fee amount'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('bitvavo', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['date', 'type', 'currency', 'amount'])
  if (!header) {
    out.issue('error', 'Missing Bitvavo columns.')
    return out
  }
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('date'), row.get('time'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('date')}"`, row.number)
      continue
    }
    const status = row.text('status').toLowerCase()
    if (status && status !== 'completed' && status !== 'distributed') {
      out.issue('info', `Row with status "${row.text('status')}" skipped.`, row.number)
      continue
    }
    const type = row.text('type').toLowerCase()
    const symbol = row.text('currency').toUpperCase()
    const quantity = Math.abs(row.money('amount') ?? 0)
    const feeCurrency = row.text('feeCurrency').toUpperCase()
    const fee = Math.abs(row.money('fee') ?? 0)
    const quote = row.text('quoteCurrency').toUpperCase() || 'EUR'
    const paid = Math.abs(row.money('paid') ?? 0)
    // A fee in the coin itself reduces the units; a fee in money is a cost.
    const coinFee = feeCurrency === symbol ? fee : 0
    const moneyFee = feeCurrency && feeCurrency !== symbol ? out.convert(fee, feeCurrency, quote, at.date, row.number) : 0
    const fiat = isFiat(symbol)
    const base = { ...coin(symbol, at, row.number), cashCurrency: quote, orderId: row.text('id') }

    if (type === 'buy' || type === 'sell') {
      if (quantity === 0) continue
      const buy = type === 'buy'
      out.add({ ...base, type: buy ? 'buy' : 'sell', quantity: buy ? quantity - coinFee : quantity + coinFee, price: row.money('quotePrice') ?? paid / quantity, amount: paid, costs: moneyFee })
    } else if (type === 'deposit' || type === 'withdrawal') {
      const deposit = type === 'deposit'
      if (fiat) {
        out.add({ ...base, product: 'Cash', ticker: '', assetClass: 'cash', type: deposit ? 'deposit' : 'withdrawal', cashCurrency: symbol, amount: quantity, costs: moneyFee })
      } else if (quantity > 0) {
        out.add({ ...base, type: deposit ? 'transferIn' : 'transferOut', quantity: deposit ? quantity : quantity + coinFee, amount: 0, costs: moneyFee })
      }
    } else if (REWARDS.test(type) && !fiat) {
      if (quantity > 0) out.add({ ...base, type: 'buy', quantity, amount: 0 })
    } else if (fiat && quantity > 0 && /affiliate|rebate|campaign|reward|bonus/.test(type)) {
      out.add({ ...base, product: 'Bonus', ticker: '', assetClass: 'cash', type: 'dividend', cashCurrency: symbol, amount: quantity })
    } else if (type === 'invalid') {
      out.issue('info', 'Row of type "invalid" skipped.', row.number)
    } else {
      out.issue('warning', `Unknown Bitvavo type "${row.text('type')}" skipped.`, row.number)
    }
  }
  return out
}

export const bitvavoAdapter: BrokerAdapter = {
  id: 'bitvavo',
  label: 'Bitvavo',
  detect,
  parse(tables, context) {
    return result(
      'Bitvavo',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: false, dividends: true, deposits: true },
      { fxCosts: 'Crypto exchanges have no currency conversion costs.', taxes: 'Bitvavo exports contain no taxes.' },
    )
  },
}
