import { Collector, guessAssetClass, result } from '../adapters/kit.ts'
import type { ImportContext, RawTable } from '../types.ts'
import { blocks, find, ISIN, num, textLines, wordDate, type Line, type NumberLocale, type PdfReader } from './kit.ts'

/**
 * Saxo Bank reports, in English and German, as in Portfolio Performance's SaxoBankPDFExtractor:
 * Trade Details, Corporate Action Detail (dividends), Cash Transfer Detail, Cash Amount Detail
 * (interest) and the account statement (deposits). Amounts come from the booking table at the end
 * of each report: one row per booking, in the account currency, with the conversion cost apart.
 */

/** Saxo writes numbers in the notation of the account: `1.234,56`, or `1'234.56` (Swiss). Set per report. */
let locale: NumberLocale = 'de'
const n = (text: string | undefined) => num(text, locale) ?? 0
const DATE = String.raw`\d{1,2}-[\p{L}]{3}-\d{4}`
/** A date, or `-` where the report leaves one out. */
const DATE_OR_DASH = String.raw`(?:${DATE}|-)`
const AMOUNT = String.raw`-?[\d.',]+`

/** `05-Dez-2024 11:21:27` → date and time. */
function stamp(date: string | undefined, time?: string) {
  const parsed = date ? wordDate(date.replace(/-/g, ' ')) : null
  return parsed ? { date: parsed, time: time?.slice(0, 5) ?? '00:00' } : null
}

function detect(text: string): number {
  if (!/Saxo Bank|saxobank/i.test(text)) return 0
  return /Trade details,|Corporate Action Detail|Cash Transfer Detail Report|Cash Amount Detail Report|Kontoauszugsbericht/.test(text) ? 0.95 : 0
}

interface Booking {
  label: string
  amount: number
  conversion: number
  booked: number
}

/** Booking rows: `<label> <id> <trade date> <value date> <amount> <rate> <conversion cost> <booked>`. */
const TRADE_BOOKING = new RegExp(String.raw`^(.*?) ?(\d{8,}) ${DATE} ${DATE} (${AMOUNT}) ([\d.,]+) (${AMOUNT}) (${AMOUNT})$`, 'u')
/** Corporate action rows: `<id> <ex date> <record date> <posting date> <pay date> <amount> <rate> <booked>`. */
const ACTION_BOOKING = new RegExp(String.raw`^(.*?) ?(\d{8,}) ${DATE_OR_DASH} ${DATE_OR_DASH} ${DATE_OR_DASH} ${DATE_OR_DASH} (${AMOUNT}) ([\d.,]+) (${AMOUNT})$`, 'u')

/** The label of a booking row can be on the row itself or wrapped around it. */
function bookings(lines: Line[], pattern: RegExp, conversionGroup: number | null): Booking[] {
  return lines.flatMap((line, i) => {
    const match = pattern.exec(line.text)
    if (!match) return []
    const label = match[1] || `${lines[i - 1]?.text ?? ''} ${lines[i + 1]?.text ?? ''}`
    return [{ label, amount: n(match[3]), conversion: conversionGroup ? n(match[conversionGroup]) : 0, booked: n(match.at(-1)) }]
  })
}

function currencyOf(lines: Line[]): string {
  return find(lines, /^(?:Currency|Währung) ?: ([A-Z]{3})\b/)?.[1] ?? find(lines, /(?:Trade details|Corporate Action Detail|Cash Transfer Details|Cash Amount Details), ([A-Z]{3})$/)?.[1] ?? 'EUR'
}

function parseTrade(out: Collector, block: Line[], cashCurrency: string) {
  const row = block[0]?.number ?? 0
  const text = block.map((l) => l.text).join('\n')
  const time = new RegExp(String.raw`(?:Trade time|Handelszeit) (${DATE}) (\d{2}:\d{2}:\d{2})`, 'u').exec(text)
  const when = stamp(time?.[1], time?.[2])
  const isin = new RegExp(String.raw`^ISIN (${ISIN.source})`, 'm').exec(text)?.[1]
  const side = /^(?:B\/S|K\/V) (Buy|Sell|Kauf|Verkauf)/m.exec(text)?.[1]
  const quantity = Math.abs(n(/(?:Quantity|Menge) (-?[\d.,']+)$/m.exec(text)?.[1]))
  const price = /(?:Price|Preis) ([\d.,']+) ([A-Z]{3})$/m.exec(text)
  if (!when || !side || !quantity) {
    out.issue('warning', 'Saxo trade report not recognised; skipped.', row)
    return
  }
  // The name is on the Instrument line, or around it when it wraps.
  const index = block.findIndex((l) => /^Instrument /.test(l.text))
  const inline = /^Instrument (.*?) ?(?:Trade time|Handelszeit)/.exec(block[index]?.text ?? '')?.[1]
  const product = inline || [block[index - 1]?.text, block[index + 1]?.text].filter(Boolean).join(' ')

  let gross = 0
  let costs = 0
  let taxes = 0
  let fxCosts = 0
  for (const b of bookings(block, TRADE_BOOKING, 5)) {
    // Charges are negative bookings; a refund of commission is a positive one and lowers the costs.
    const charge = b.conversion - b.booked
    fxCosts -= b.conversion
    // Accrued interest paid with a bond is part of what the bond cost.
    if (/Share Amount|Aktienbetrag|Traded Value|Gehandelter Wert|Accrued|Stückzins|Anleihe/i.test(b.label)) gross += Math.abs(charge)
    else if (/Stamp|Stempel|Tax|Steuer|Taxe/i.test(b.label)) taxes += charge
    else costs += charge
  }
  if (gross === 0) gross = Math.abs(n(/(?:Traded Value|Gehandelter Wert) (-?[\d.,']+) [A-Z]{3}$/m.exec(text)?.[1]))
  const buy = side === 'Buy' || side === 'Kauf'
  out.add({
    type: buy ? 'buy' : 'sell',
    at: when,
    row,
    product,
    ...(isin ? { isin } : {}),
    ...(/^Symbol (\S+?):/m.exec(text)?.[1] ? { ticker: /^Symbol (\S+?):/m.exec(text)?.[1] as string } : {}),
    assetClass: /^ETF$/m.test(text) ? 'etf' : guessAssetClass(product),
    quantity,
    price: n(price?.[1]),
    currency: price?.[2] ?? cashCurrency,
    amount: gross,
    cashCurrency,
    costs,
    taxes,
    fxCosts,
    ...(/(?:Order ID|Order-ID) (\d+)/.exec(text)?.[1] ? { orderId: /(?:Order ID|Order-ID) (\d+)/.exec(text)?.[1] as string } : {}),
  })
}

function parseDividend(out: Collector, block: Line[], cashCurrency: string) {
  const row = block[0]?.number ?? 0
  const text = block.map((l) => l.text).join('\n')
  const rows = bookings(block, ACTION_BOOKING, null)
  const pay = new RegExp(String.raw`\d{8,} ${DATE_OR_DASH} ${DATE_OR_DASH} ${DATE_OR_DASH} (${DATE})`, 'u').exec(text)?.[1]
  const when = stamp(pay)
  if (!when || rows.length === 0) {
    out.issue('warning', 'Saxo corporate action report without bookings; skipped.', row)
    return
  }
  const gross = rows.filter((b) => /Dividend/i.test(b.label)).reduce((s, b) => s + Math.abs(b.booked), 0)
  const taxes = rows.filter((b) => /Tax|Steuer/i.test(b.label)).reduce((s, b) => s + Math.abs(b.booked), 0)
  const costs = rows.filter((b) => !/Dividend|Tax|Steuer/i.test(b.label)).reduce((s, b) => s + Math.abs(b.booked), 0)
  const isin = new RegExp(String.raw`^ISIN (${ISIN.source})`, 'm').exec(text)?.[1]
  out.add({
    type: 'dividend',
    at: when,
    row,
    product: /^(?:Description|Beschreibung) (.*?)(?: (?:Dividend per share|Dividende pro Aktie).*)?$/m.exec(text)?.[1] ?? isin ?? 'Dividend',
    ...(isin ? { isin } : {}),
    quantity: n(/(?:Eligible quantity|Berechtigte Menge|Geeignete Menge) ([\d.,']+)/.exec(text)?.[1]),
    amount: gross,
    cashCurrency,
    costs,
    taxes,
  })
}

function parseCash(out: Collector, block: Line[], cashCurrency: string) {
  for (const line of block) {
    const transfer = new RegExp(String.raw`^(Einlage|Deposit|Auszahlung|Withdrawal|Abhebung) \d{8,} (${DATE}) ${DATE} (${AMOUNT}) [\d.,]+ ${AMOUNT} (${AMOUNT})$`, 'u').exec(line.text)
    const interest = new RegExp(String.raw`^(Interest|Zinsen) \d{8,} (${DATE}) (${AMOUNT}) [A-Z]{3} [\d.,]+ (${AMOUNT})$`, 'u').exec(line.text)
    const statement = new RegExp(String.raw`^(${DATE}) ${DATE} (DEPOSIT|WITHDRAWAL) .*? (${AMOUNT}) ${AMOUNT}$`, 'u').exec(line.text)
    const match = transfer ?? interest ?? statement
    const when = stamp(match?.[2] && !statement ? match[2] : statement?.[1])
    if (!match || !when) continue
    const amount = n(transfer?.[4] ?? interest?.[4] ?? statement?.[3])
    const base = { at: when, row: line.number, cashCurrency, amount }
    if (interest) out.add({ ...base, product: 'Interest', type: amount >= 0 ? 'dividend' : 'fee' })
    else out.add({ ...base, product: 'Cash', type: amount >= 0 && !/WITHDRAWAL|Auszahlung|Withdrawal|Abhebung/.test(match[0]) ? 'deposit' : 'withdrawal' })
  }
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('saxo', table.fileName, context)
  const lines = textLines(table)
  const cashCurrency = currencyOf(lines)
  // Conversion rates have six decimals: `1.000000` means a dot is the decimal separator.
  locale = /\d'\d{3}|\b\d\.\d{6}\b/.test(table.text ?? '') ? 'ch' : 'de'
  // A report can hold several trades or events: each starts at its instrument or event line.
  for (const block of blocks(lines, /^(Instrument|Event|Kontoauszug, )\b|^(Cash Transfer Detail Report|Cash Amount Detail Report)$/)) {
    const first = block[0]?.text ?? ''
    if (/^Instrument/.test(first)) parseTrade(out, [...lines.slice(Math.max(0, lines.indexOf(block[0] as Line) - 1), lines.indexOf(block[0] as Line)), ...block], cashCurrency)
    else if (/^Event (Dividend|Cash dividend|Bardividende)/i.test(first)) parseDividend(out, block, cashCurrency)
    else parseCash(out, block, cashCurrency)
  }
  if (out.transactions.length === 0 && !out.issues.length) out.issue('warning', 'No Saxo trades, dividends or cash transfers found in this PDF.')
  return out
}

export const saxoPdf: PdfReader = {
  detect,
  parse(tables, context) {
    return result(
      'Saxo',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: true, taxes: true, dividends: true, deposits: true },
      {},
    )
  },
}
