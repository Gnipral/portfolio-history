import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, guessAssetClass, parseDateTime, result, type ColumnSpec } from './kit.ts'
import { coin } from './crypto.ts'

/**
 * Bitpanda transaction history CSV (v2), after a few preamble lines. Besides crypto it contains
 * stocks and ETFs (asset class "Stock (derivative)" or "ETF"), also identified by ticker.
 */
const COLUMNS = {
  id: ['transaction id'],
  timestamp: ['timestamp'],
  type: ['transaction type'],
  direction: ['in/out'],
  fiatAmount: ['amount fiat'],
  fiat: ['fiat'],
  assetAmount: ['amount asset'],
  asset: ['asset'],
  price: ['asset market price'],
  assetClass: ['asset class'],
  fee: ['fee'],
  feeAsset: ['fee asset'],
  spread: ['spread'],
  spreadCurrency: ['spread currency'],
  tax: ['tax fiat'],
} satisfies ColumnSpec<string>

function detect(table: RawTable): number {
  return detectByHeaders(table, ['transaction id', 'timestamp', 'transaction type', 'in/out', 'amount fiat', 'amount asset'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('bitpanda', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['timestamp', 'type', 'direction', 'fiatAmount', 'asset'])
  if (!header) {
    out.issue('error', 'Missing Bitpanda columns.')
    return out
  }
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('timestamp'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('timestamp')}"`, row.number)
      continue
    }
    const type = row.text('type').toLowerCase()
    const incoming = row.text('direction').toLowerCase() === 'incoming'
    const assetClassText = row.text('assetClass')
    const symbol = row.text('asset').toUpperCase()
    const fiat = row.text('fiat') || 'EUR'
    const fiatAmount = Math.abs(row.money('fiatAmount') ?? 0)
    const quantity = Math.abs(row.money('assetAmount') ?? 0)
    const fee = Math.abs(row.money('fee') ?? 0)
    const feeAsset = row.text('feeAsset').toUpperCase()
    const coinFee = feeAsset === symbol ? fee : 0
    const moneyFee = feeAsset && feeAsset !== symbol ? out.convert(fee, feeAsset, fiat, at.date, row.number) : 0
    const tax = Math.abs(row.money('tax') ?? 0)
    const isMoney = /^fiat$/i.test(assetClassText)
    const base = {
      ...coin(symbol, at, row.number),
      ...(/crypto/i.test(assetClassText) ? {} : { assetClass: guessAssetClass(symbol, assetClassText) }),
      cashCurrency: fiat,
      price: row.money('price') ?? 0,
      orderId: row.text('id'),
    }

    if (isMoney) {
      if (type === 'deposit' || type === 'withdrawal' || type === 'transfer') {
        out.add({ ...base, product: 'Cash', ticker: '', assetClass: 'cash', type: incoming ? 'deposit' : 'withdrawal', cashCurrency: symbol || fiat, amount: fiatAmount, costs: moneyFee })
      }
      continue
    }
    if (quantity === 0) continue
    if (type === 'buy' || type === 'sell') {
      const buy = type === 'buy'
      out.add({ ...base, type: buy ? 'buy' : 'sell', quantity: buy ? quantity - coinFee : quantity + coinFee, amount: fiatAmount, costs: moneyFee, taxes: tax })
    } else if (type === 'deposit' || type === 'withdrawal') {
      out.add({ ...base, type: incoming ? 'transferIn' : 'transferOut', quantity: incoming ? quantity : quantity + coinFee, amount: incoming ? fiatAmount : 0, costs: moneyFee })
    } else if (/stake|reward|airdrop|bonus/.test(type) && incoming) {
      out.add({ ...base, type: 'buy', quantity, amount: 0 })
    } else if (/stake|transfer/.test(type)) {
      out.issue('info', `${row.text('type')} moves ${symbol} within Bitpanda; skipped.`, row.number)
    } else {
      out.issue('warning', `Unknown Bitpanda type "${row.text('type')}" skipped.`, row.number)
    }
  }
  return out
}

export const bitpandaAdapter: BrokerAdapter = {
  id: 'bitpanda',
  label: 'Bitpanda',
  detect,
  parse(tables, context) {
    return result(
      'Bitpanda',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: false, deposits: true },
      {
        fxCosts: 'Bitpanda includes currency conversion in the price.',
        dividends: 'Staking rewards are added as free coins, not as dividends.',
      },
    )
  },
}
