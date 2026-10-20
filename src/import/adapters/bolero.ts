import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, guessAssetClass, parseDateTime, result, type ColumnSpec } from './kit.ts'

/**
 * Bolero "Transactiehistoriek" (Excel). The column names are not yet confirmed with a real
 * export. There is no ISIN: products are known by name and need a symbol on the Prices page.
 * `Bedrag` is the net amount in EUR, with costs and taxes included.
 */
const COLUMNS = {
  date: ['datum transactie', 'datum'],
  description: ['omschrijving'],
  quantity: ['aantal'],
  price: ['prijs', 'koers'],
  amount: ['bedrag'],
  currency: ['munt'],
} satisfies ColumnSpec<string>

const TRADE = /^(aankoop|verkoop|inschrijving)\s+([\d.,]+)\s+(.+)$/i
const DIVIDEND = /^(uitbetaling dividenden?|dividend|coupon)\s+(?:[\d.,]+\s+)?(.+)$/i

function detect(table: RawTable): number {
  return detectByHeaders(table, ['datum transactie', 'valutadatum', 'omschrijving', 'aantal', 'prijs', 'bedrag', 'munt'], 0.9)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('bolero', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['date', 'description', 'amount'])
  if (!header) {
    out.issue('error', 'Missing Bolero columns.')
    return out
  }
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('date'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('date')}"`, row.number)
      continue
    }
    const description = row.text('description')
    const amount = row.money('amount') ?? 0
    const base = { at, row: row.number, cashCurrency: row.text('currency') || 'EUR', amount }
    const trade = TRADE.exec(description)
    const dividend = DIVIDEND.exec(description)
    if (trade) {
      const product = (trade[3] as string).trim()
      const quantity = row.money('quantity') ?? 0
      if (quantity <= 0) continue
      const sell = /^verkoop/i.test(trade[1] as string)
      out.add({ ...base, type: sell ? 'sell' : 'buy', product, assetClass: guessAssetClass(product), quantity, price: Math.abs(amount) / quantity })
    } else if (dividend) {
      out.add({ ...base, product: (dividend[2] as string).trim(), type: 'dividend' })
    } else if (/^storting|overschrijving van/i.test(description) || (/overschrijving/i.test(description) && amount > 0)) {
      out.add({ ...base, product: 'Cash', type: 'deposit' })
    } else if (/^opname|overschrijving naar|overschrijving/i.test(description)) {
      out.add({ ...base, product: 'Cash', type: 'withdrawal' })
    } else if (/kosten|bewaarloon|taks|belasting/i.test(description)) {
      out.add({ ...base, product: 'Fees', type: /taks|belasting/i.test(description) ? 'tax' : 'fee' })
    } else if (/rente|intrest/i.test(description)) {
      out.add({ ...base, product: 'Interest', type: amount >= 0 ? 'dividend' : 'fee' })
    } else {
      out.issue('warning', `Unknown Bolero description "${description}" skipped.`, row.number)
    }
  }
  return out
}

export const boleroAdapter: BrokerAdapter = {
  id: 'bolero',
  label: 'Bolero',
  detect,
  parse(tables, context) {
    const reason = 'The Bolero transaction history only has net amounts, with costs and taxes included.'
    return result(
      'Bolero',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: false, fxCosts: false, taxes: false, dividends: true, deposits: true },
      { transactionCosts: reason, fxCosts: reason, taxes: reason },
    )
  },
}
