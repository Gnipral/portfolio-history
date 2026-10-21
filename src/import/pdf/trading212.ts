import { Collector, guessAssetClass, result } from '../adapters/kit.ts'
import type { ImportContext, RawTable } from '../types.ts'
import { at, ISIN, num, textLines, type PdfReader } from './kit.ts'

/**
 * Trading 212 activity statement ("Aktivitätsauszug", monthly or for a chosen period), as in
 * Portfolio Performance's Trading212PDFExtractor: executed orders, interest on cash, bank deposits
 * and card payments. Numbers use a decimal point.
 */

const n = (text: string | undefined) => (text === undefined || text === '-' ? 0 : (num(text, 'en') ?? 0))

/** `2026-01-06 08:12:29 VWCE IE00BK5BQT80 EUR 44466988302 Verkaufen 1.73 147.02 254.9286 Market OTC ...` */
const ORDER = new RegExp(String.raw`^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} (\S+) (${ISIN.source}) ([A-Z]{3}) (\S+) (Kaufen|Verkaufen|Buy|Sell) ([\d.]+) ([\d.]+) ([\d.]+) (.*)$`)
/** End of an order row: `<fx rate> <account currency> <fx fee> <taxes> <result> <value> <taxes>`. */
const ORDER_TAIL = /([\d.]+) ([A-Z]{3}) (-|-?[\d.]+) (-|-?[\d.]+) (-|-?[\d.]+) (-?[\d.]+) (-|-?[\d.]+)$/
const CASH = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} (.*?)(Verzinsung von Geld|Interest on cash|Bankeinzahlung|Bank deposit|Kartenkauf|Card debit|Auszahlung|Withdrawal) ([A-Z]{3}) (-?[\d.]+) (-?[\d.]+|-)/

function detect(text: string): number {
  return /Trading 212/.test(text) && /Aktivit.tsauszug|Activity statement/i.test(text) && /Invest-Konto|Invest account/i.test(text) ? 0.95 : 0
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('trading212', table.fileName, context)
  for (const line of textLines(table)) {
    const order = ORDER.exec(line.text)
    if (order) {
      const when = at(order[1], order[2])
      const tail = ORDER_TAIL.exec(order[11] ?? '')
      if (!when) continue
      const sell = order[7] === 'Verkaufen' || order[7] === 'Sell'
      const quantity = n(order[8])
      const cashCurrency = tail?.[2] ?? order[5] ?? 'EUR'
      // The value in the account currency when the row has it, else the value in the instrument currency.
      const gross = tail ? Math.abs(n(tail[6])) : n(order[10])
      out.add({
        type: sell ? 'sell' : 'buy',
        at: when,
        row: line.number,
        product: order[3] ?? '',
        isin: order[4] as string,
        ticker: order[3] as string,
        assetClass: guessAssetClass(''),
        quantity,
        price: n(order[9]),
        currency: order[5] as string,
        amount: gross,
        cashCurrency,
        fxCosts: Math.abs(n(tail?.[3])),
        taxes: Math.abs(n(tail?.[7])),
        orderId: order[6] as string,
      })
      continue
    }
    const cash = CASH.exec(line.text)
    const when = cash ? at(cash[1], cash[2]) : null
    if (!cash || !when) continue
    const kind = cash[4] ?? ''
    const amount = n(cash[6])
    const base = { at: when, row: line.number, cashCurrency: cash[5] as string, amount }
    if (/Verzinsung|Interest/.test(kind)) out.add({ ...base, product: 'Interest', type: 'dividend', taxes: Math.abs(n(cash[7])) })
    else if (/einzahlung|deposit/i.test(kind)) out.add({ ...base, product: 'Cash', type: 'deposit' })
    else out.add({ ...base, product: 'Cash', type: 'withdrawal' })
  }
  if (out.transactions.length === 0) out.issue('warning', 'No Trading 212 orders or cash movements found in this PDF.')
  return out
}

export const trading212Pdf: PdfReader = {
  detect,
  parse(tables, context) {
    return result(
      'Trading 212',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: false, fxCosts: true, taxes: true, dividends: false, deposits: true },
      {
        transactionCosts: 'Trading 212 charges no commission; currency conversion is a separate FX fee.',
        dividends: 'Dividends from the activity statement PDF are not read yet; import the CSV export for them.',
      },
    )
  },
}
