import { keytradePdf } from '../pdf/keytrade.ts'
import { withPdf } from '../pdf/kit.ts'
import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, guessAssetClass, parseDateTime, result, type ColumnSpec } from './kit.ts'

/**
 * Keytrade Bank transactions (CSV/Excel). The column names are not yet confirmed with a real
 * export. Broker fee (makelaarsloon), stock exchange tax (beurstaks) and withholding tax
 * (roerende voorheffing) are in EUR; `Nettobedrag EUR` is what was booked.
 */
const COLUMNS = {
  date: ['datum'],
  type: ['type'],
  description: ['omschrijving'],
  isin: ['isin'],
  quantity: ['aantal'],
  price: ['koers'],
  currency: ['munt'],
  fee: ['makelaarsloon'],
  tob: ['beurstaks'],
  withholding: ['roerende voorheffing'],
  net: ['nettobedrag eur', 'nettobedrag'],
  reference: ['ref. nummer', 'referentie'],
} satisfies ColumnSpec<string>

function detect(table: RawTable): number {
  return detectByHeaders(table, ['datum', 'type', 'isin', 'makelaarsloon', 'beurstaks', 'nettobedrag eur'], 0.9)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('keytrade', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['date', 'type', 'net'])
  if (!header) {
    out.issue('error', 'Missing Keytrade columns.')
    return out
  }
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('date'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('date')}"`, row.number)
      continue
    }
    const type = row.text('type').toLowerCase()
    const net = row.money('net') ?? 0
    const fee = Math.abs(row.money('fee') ?? 0)
    const tob = Math.abs(row.money('tob') ?? 0)
    const withholding = Math.abs(row.money('withholding') ?? 0)
    const isin = row.text('isin')
    const product = row.text('description') || isin || 'Cash'
    const base = {
      at,
      row: row.number,
      product,
      ...(isin ? { isin } : {}),
      assetClass: guessAssetClass(product),
      currency: row.text('currency') || 'EUR',
      cashCurrency: 'EUR',
      orderId: row.text('reference'),
    }
    const quantity = Math.abs(row.money('quantity') ?? 0)
    const price = row.money('price') ?? 0

    if (/aankoop|achat|kauf/.test(type) && quantity > 0) {
      out.add({ ...base, type: 'buy', quantity, price, amount: Math.abs(net) - fee - tob, costs: fee, taxes: tob })
    } else if (/verkoop|vente|verkauf/.test(type) && quantity > 0) {
      out.add({ ...base, type: 'sell', quantity, price, amount: Math.abs(net) + fee + tob, costs: fee, taxes: tob })
    } else if (/dividend|coupon/.test(type)) {
      out.add({ ...base, type: 'dividend', amount: net + withholding, taxes: withholding })
    } else if (/storting|versement|einzahlung/.test(type)) {
      out.add({ ...base, product: 'Cash', type: 'deposit', amount: net })
    } else if (/opname|retrait|auszahlung/.test(type)) {
      out.add({ ...base, product: 'Cash', type: 'withdrawal', amount: net })
    } else if (/kosten|frais|geb/.test(type)) {
      out.add({ ...base, product: 'Fees', type: 'fee', amount: net })
    } else if (/rente|intérêt|interest|zins/.test(type)) {
      out.add({ ...base, product: 'Interest', type: net >= 0 ? 'dividend' : 'fee', amount: net })
    } else {
      out.issue('warning', `Unknown Keytrade type "${row.text('type')}" skipped.`, row.number)
    }
  }
  return out
}

export const keytradeAdapter: BrokerAdapter = withPdf({
  id: 'keytrade',
  label: 'Keytrade Bank',
  detect,
  parse(tables, context) {
    return result(
      'Keytrade Bank',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: true },
      { fxCosts: 'Keytrade includes currency conversion in the net amount.' },
    )
  },
}, keytradePdf)
