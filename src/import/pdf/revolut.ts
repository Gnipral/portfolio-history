import { Collector, guessAssetClass, result } from '../adapters/kit.ts'
import { parseDate } from '../parse.ts'
import type { ImportContext, RawTable } from '../types.ts'
import { find, ISIN, num, textLines, wordDate, type Line, type PdfReader } from './kit.ts'

/**
 * Revolut trading PDFs, as in Portfolio Performance's RevolutLtdPDFExtractor: the trade confirmation,
 * the account statement (transactions table per currency, with the portfolio breakdown that links
 * symbols to ISINs) and the older DriveWealth account statement (ACTIVITY section, US dates).
 */

const n = (text: string | undefined) => num(text, 'en') ?? 0
/** `€1,234.56`, `-€0.01`, `US$5`, `$0` */
const MONEY = String.raw`-?(?:US)?[€$£¥][\d,]+(?:\.\d+)?`
const SIGNS: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '¥': 'JPY' }

function money(text: string | undefined): { amount: number; currency: string } {
  const match = /^(-?)(?:US)?([€$£¥])([\d,]+(?:\.\d+)?)$/.exec(text ?? '')
  return match ? { amount: (match[1] ? -1 : 1) * n(match[3]), currency: SIGNS[match[2] as string] ?? 'USD' } : { amount: 0, currency: 'USD' }
}

function detect(text: string): number {
  if (!/Revolut/.test(text)) return 0
  return /^Order details$|^Account Statement|Trade Confirmation/m.test(text) ? 0.95 : 0
}

/** `SPPW SPDR MSCI World UCITS ETF (Acc) IE00BFY0GT14 0.27 €77.61 €21.70 2.97%` → symbol, name, ISIN. */
function breakdown(lines: Line[]): Map<string, { name: string; isin: string }> {
  const map = new Map<string, { name: string; isin: string }>()
  for (const line of lines) {
    const match = new RegExp(String.raw`^([A-Z0-9]{1,6}(?:\.[A-Z]{1,4})?) (.+) (${ISIN.source}) [\d.,]+ `).exec(line.text)
    if (match) map.set(match[1] as string, { name: match[2] as string, isin: match[3] as string })
  }
  return map
}

function parseConfirmation(out: Collector, lines: Line[]) {
  const start = lines.findIndex((l) => l.text === 'Order details')
  const order = lines
    .slice(start + 1)
    .map((l) => ({ line: l, match: new RegExp(String.raw`^([A-Z0-9]{1,6}(?:\.[A-Z]{1,4})?) (.+) (${ISIN.source}) (Buy|Sell) ([\d.,]+) (${MONEY})(?: (${MONEY}))? (\d{2} \w{3} \d{4})$`).exec(l.text) }))
    .find((o) => o.match)
  if (!order?.match) {
    out.issue('warning', 'Revolut trade confirmation not recognised; skipped.', lines[start]?.number)
    return
  }
  const [, symbol, name, isin, side, quantity, price, total] = order.match
  const execution = find(lines.slice(start), /(\d{2} \w{3} \d{4}) (\d{2}:\d{2}):\d{2} GMT/)
  const date = wordDate(execution?.[1] ?? order.match[8] ?? '')
  if (!date) return
  const unit = money(price)
  const fee = money(find(lines, new RegExp(String.raw`^Total Fee charged (${MONEY})$`))?.[1])
  const shares = n(quantity)
  out.add({
    type: side === 'Buy' ? 'buy' : 'sell',
    at: { date, time: execution?.[2] ?? '00:00' },
    row: order.line.number,
    product: name ?? '',
    ...(isin ? { isin } : {}),
    ...(symbol ? { ticker: symbol } : {}),
    assetClass: guessAssetClass(name ?? ''),
    quantity: shares,
    price: unit.amount,
    amount: total ? money(total).amount : shares * unit.amount,
    cashCurrency: unit.currency,
    costs: fee.amount,
  })
}

/** Transactions table: `29 Sep 2024 10:03:54 GMT [symbol] <type> [quantity price side] <value> <fees> <commission>`. */
function parseStatement(out: Collector, lines: Line[]) {
  const products = breakdown(lines)
  const row = new RegExp(String.raw`^(\d{2} \w{3} \d{4}) (\d{2}:\d{2}):\d{2} GMT (?:([A-Z0-9]{1,6}(?:\.[A-Z]{1,4})?) )?(.+?) (?:([\d.,]+) (${MONEY}) (Buy|Sell) )?(${MONEY}) (${MONEY}) (${MONEY})$`)
  for (const line of lines) {
    const match = row.exec(line.text)
    const date = match ? wordDate(match[1] as string) : null
    if (!match || !date) continue
    const [, , time, symbol, type = '', quantity, price, side, value, fees, commission] = match
    const amount = money(value)
    const costs = Math.abs(money(fees).amount) + Math.abs(money(commission).amount)
    const known = symbol ? products.get(symbol) : undefined
    const base = {
      at: { date, time: time ?? '00:00' },
      row: line.number,
      product: known?.name ?? symbol ?? 'Cash',
      ...(known ? { isin: known.isin } : {}),
      ...(symbol ? { ticker: symbol } : {}),
      cashCurrency: amount.currency,
      amount: amount.amount,
    }
    if (/^Trade/.test(type) && side) {
      const shares = n(quantity)
      out.add({ ...base, type: side === 'Buy' ? 'buy' : 'sell', assetClass: guessAssetClass(base.product), quantity: shares, price: money(price).amount, costs })
    } else if (/^Dividend$/i.test(type)) out.add({ ...base, type: 'dividend', costs })
    else if (/tax/i.test(type)) out.add({ ...base, type: amount.amount > 0 ? 'dividend' : 'tax' })
    else if (/top-up|deposit/i.test(type)) out.add({ ...base, product: 'Cash', type: 'deposit' })
    else if (/withdrawal/i.test(type)) out.add({ ...base, product: 'Cash', type: 'withdrawal' })
    else if (/fee/i.test(type)) out.add({ ...base, product: 'Fees', type: 'fee' })
    else out.issue('warning', `Revolut transaction "${type}" skipped.`, line.number)
  }
}

/** DriveWealth statements (Revolut Trading Ltd, until 2021): dates are month/day/year. */
function parseActivity(out: Collector, lines: Line[]) {
  const usDate = (text: string) => {
    const [m, d, y] = text.split('/')
    return parseDate(`${y}-${m}-${d}`)
  }
  for (const line of lines) {
    const trade = /^(\d{2}\/\d{2}\/\d{4}) \d{2}\/\d{2}\/\d{4} ([A-Z]{3}) (BUY|SELL) ([A-Z0-9.]{1,10}) - (.+?) - TRD .* ([\d.,]+) ([\d.,]+) \(?([\d.,]+)\)?$/.exec(line.text)
    const deposit = /^(\d{2}\/\d{2}\/\d{4}) \d{2}\/\d{2}\/\d{4} ([A-Z]{3}) \w+ Cash Disbursement - Wallet \([A-Z]{3}\) ([\d.,]+)$/.exec(line.text)
    const dividend = /^(\d{2}\/\d{2}\/\d{4}) \d{2}\/\d{2}\/\d{4} ([A-Z]{3}) (DIV|DIVNRA) ([A-Z0-9.]{1,10}) - (.+?) \(?(-?[\d.,]+)\)?$/.exec(line.text)
    if (trade) {
      const date = usDate(trade[1] as string)
      if (!date) continue
      const product = (trade[5] ?? '').replace(/\s+(COM|SHS|ORD|SPON ADS|CL [A-Z]).*$/, '').trim()
      out.add({
        type: trade[3] === 'BUY' ? 'buy' : 'sell',
        at: { date, time: '00:00' },
        row: line.number,
        product,
        ticker: trade[4] as string,
        quantity: n(trade[6]),
        price: n(trade[7]),
        amount: n(trade[8]),
        cashCurrency: trade[2] as string,
      })
    } else if (deposit) {
      const date = usDate(deposit[1] as string)
      if (date) out.add({ type: 'deposit', at: { date, time: '00:00' }, row: line.number, product: 'Cash', amount: n(deposit[3]), cashCurrency: deposit[2] as string })
    } else if (dividend) {
      const date = usDate(dividend[1] as string)
      // DIVNRA is the US withholding tax on a dividend.
      if (date) out.add({ type: dividend[3] === 'DIV' ? 'dividend' : 'tax', at: { date, time: '00:00' }, row: line.number, product: dividend[4] as string, ticker: dividend[4] as string, amount: n(dividend[6]), cashCurrency: dividend[2] as string })
    }
  }
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('revolut', table.fileName, context)
  const lines = textLines(table)
  if (lines.some((l) => l.text === 'Order details')) parseConfirmation(out, lines)
  else if (lines.some((l) => l.text === 'ACTIVITY')) parseActivity(out, lines)
  else parseStatement(out, lines)
  if (out.transactions.length === 0 && !out.issues.length) out.issue('warning', 'No Revolut trades or cash movements found in this PDF.')
  return out
}

export const revolutPdf: PdfReader = {
  detect,
  parse(tables, context) {
    return result(
      'Revolut',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: false, dividends: true, deposits: true },
      {
        fxCosts: 'Revolut converts currencies in the app; the conversion is not in the trading statement.',
        taxes: 'The Revolut statement shows dividends net of withholding tax.',
      },
    )
  },
}
