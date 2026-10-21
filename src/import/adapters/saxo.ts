import { saxoPdf } from '../pdf/saxo.ts'
import { withPdf } from '../pdf/kit.ts'
import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { parseNumber } from '../parse.ts'
import { Collector, dataRows, detectByHeaders, findHeader, guessAssetClass, parseDateTime, result, type ColumnSpec } from './kit.ts'

/**
 * Saxo "Transactions" export. Quantity and price are in the text of `Event` (`Buy 4 @ 165.00 USD`,
 * in the account's language: `Koop 1.5 @ 110.01 EUR`). `Amount` is the net booking in the account
 * currency; `Conversion Rate` converts the instrument currency to it.
 */
const COLUMNS = {
  tradeDate: ['trade date'],
  type: ['type'],
  instrument: ['instrument'],
  isin: ['instrument isin'],
  instrumentCurrency: ['instrument currency'],
  exchange: ['exchange description'],
  symbol: ['instrument symbol'],
  event: ['event'],
  amount: ['amount'],
  orderId: ['order id'],
  rate: ['conversion rate'],
} satisfies ColumnSpec<string>

const TRADE = /^(buy|koop|achat|kauf|sell|verkoop|vente|verkauf)\s+(-?[\d.,]+)\s*@\s*([\d.,]+)\s*([A-Z]{3})?/i
const SELL_WORDS = /^(sell|verkoop|vente|verkauf)$/i

function detect(table: RawTable): number {
  return detectByHeaders(table, ['trade date', 'value date', 'instrument isin', 'event', 'conversion rate'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('saxo', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['tradeDate', 'event', 'amount'])
  if (!header) {
    out.issue('error', 'Missing Saxo columns.')
    return out
  }
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('tradeDate'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('tradeDate')}"`, row.number)
      continue
    }
    const event = row.text('event')
    const amount = row.money('amount') ?? 0
    const rate = row.money('rate') ?? 1
    const instrumentCurrency = row.text('instrumentCurrency').toUpperCase()
    // A rate of 1 means the booking is in the instrument currency (or both are EUR).
    const cashCurrency = rate === 1 && instrumentCurrency ? instrumentCurrency : 'EUR'
    const isin = row.text('isin')
    const symbol = row.text('symbol').split(':')[0] ?? ''
    const base = {
      at,
      row: row.number,
      product: row.text('instrument') || 'Cash',
      ...(isin ? { isin } : {}),
      ...(symbol ? { ticker: symbol } : {}),
      ...(row.text('exchange') ? { exchange: row.text('exchange') } : {}),
      assetClass: guessAssetClass(row.text('instrument')),
      cashCurrency,
      orderId: row.text('orderId'),
    }

    const trade = TRADE.exec(event)
    if (trade) {
      const quantity = Math.abs(parseNumber(trade[2] as string) ?? 0)
      const price = parseNumber(trade[3] as string) ?? 0
      if (quantity === 0) continue
      const sell = SELL_WORDS.test(trade[1] as string)
      const gross = quantity * price * (cashCurrency === instrumentCurrency ? 1 : rate)
      const costs = Math.max(0, sell ? gross - Math.abs(amount) : Math.abs(amount) - gross)
      out.add({ ...base, type: sell ? 'sell' : 'buy', quantity, price, currency: trade[4] ?? instrumentCurrency, amount: gross, costs })
      continue
    }
    const what = event.toLowerCase()
    if (/dividend/.test(what)) out.add({ ...base, type: amount >= 0 ? 'dividend' : 'tax', amount })
    else if (/deposit|storting|cash transfer|einzahlung/.test(what)) out.add({ ...base, product: 'Cash', type: amount >= 0 ? 'deposit' : 'withdrawal', amount })
    else if (/withdrawal|opname|auszahlung/.test(what)) out.add({ ...base, product: 'Cash', type: 'withdrawal', amount })
    else if (/fee|kosten|bewaarloon|commission/.test(what)) out.add({ ...base, product: 'Fees', type: amount <= 0 ? 'fee' : 'dividend', amount })
    else if (/interest|rente/.test(what)) out.add({ ...base, product: 'Interest', type: amount >= 0 ? 'dividend' : 'fee', amount })
    else if (/tax|belasting|taks/.test(what)) out.add({ ...base, type: 'tax', amount })
    else out.issue('warning', `Unknown Saxo event "${event}" skipped.`, row.number)
  }
  return out
}

export const saxoAdapter: BrokerAdapter = withPdf({
  id: 'saxo',
  label: 'Saxo',
  detect,
  parse(tables, context) {
    return result(
      'Saxo',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: false, dividends: true, deposits: true },
      {
        fxCosts: 'Saxo includes currency conversion in the booked amount.',
        taxes: 'Saxo books dividends after withholding tax and the stock exchange tax inside the trade amount.',
      },
    )
  },
}, saxoPdf)
