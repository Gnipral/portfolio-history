import type { Cell, RawTable } from '../types.ts'
import { ISIN_ONLY, num, textLines, type Line, type NumberLocale } from './kit.ts'

/**
 * DEGIRO PDFs: the account statement ("Rekeningoverzicht", "Account statement", "Kontoauszug", ...)
 * and the transactions overview ("Transacties", "Transactions", "Transaktionsübersicht", ...), in the
 * layouts Portfolio Performance's DegiroPDFExtractor reads. Each PDF row is turned into a row of the
 * matching CSV export, so the DEGIRO adapter applies the same rules (corporate actions, partial
 * orders, AutoFX) to both. Only accounts in EUR are supported.
 */

const DATE = String.raw`\d{2}-\d{2}-\d{4}`
const NUMBER = String.raw`-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?`

export function detectDegiroPdf(text: string): number {
  if (!/DEGIRO/i.test(text)) return 0
  return /^(Datum|Date|Data|Fecha|Dátum) /m.test(text) && new RegExp(`^${DATE} \\d{2}:\\d{2} `, 'm').test(text) ? 0.95 : 0
}

/** Transactions overview: the row has an exchange code, a quantity and a price after the ISIN. */
function isTransactionsOverview(lines: Line[]): boolean {
  return lines.some((l) => /^(Transacties|Transactions|Transaktions|Transacciones|Transações|Transakcje|Transakce|Operazioni)\b.*\d{2}-\d{2}-\d{4}/i.test(l.text))
}

/** `1.234,56` or `1,234.56`: decided per document by which separator precedes the last two digits. */
function localeOf(lines: Line[]): NumberLocale {
  let comma = 0
  let dot = 0
  for (const line of lines) {
    comma += (line.text.match(/\d,\d{2}(?!\d)/g) ?? []).length
    dot += (line.text.match(/\d\.\d{2}(?!\d)/g) ?? []).length
  }
  return dot > comma ? 'en' : 'de'
}

const ACCOUNT_HEADER = ['Datum', 'Tijd', 'Valutadatum', 'Product', 'ISIN', 'Omschrijving', 'FX', 'Mutatie', null, 'Saldo', null, 'Order Id']

/** `date time [value date] [product] [ISIN] description [fx] currency amount [currency balance]` */
function accountRows(lines: Line[], locale: NumberLocale): Cell[][] {
  const pattern = new RegExp(String.raw`^(${DATE}) (\d{2}:\d{2}) (?:(${DATE}) )?(.*?) (?:(${NUMBER}) )?([A-Z]{3}) (${NUMBER})(?: ([A-Z]{3}) (${NUMBER}))?$`)
  const rows: Cell[][] = []
  for (const [i, line] of lines.entries()) {
    const match = pattern.exec(line.text)
    if (!match) continue
    const [, date, time, valueDate, middle = '', fxText, currency, amount, balanceCurrency, balance] = match
    // A long trade description wraps its price onto the next line: `(Acc)@504.96 EUR (IE00B5BMR087)`.
    const next = lines[i + 1]?.text ?? ''
    let description = /@|zu je/.test(next) && !new RegExp(`^${DATE}`).test(next) ? `${middle} ${next}` : middle
    let fx = fxText
    // `Kauf 1 zu je 177,5 USD -177,50`: the number before the currency is the price, not a rate.
    if (fx && /(?:@|zu je|à|a)$/.test(description.trim())) {
      description = `${description} ${fx} ${currency}`
      fx = undefined
    }
    const words = description.split(' ')
    const isinAt = words.findIndex((w) => ISIN_ONLY.test(w))
    const product = isinAt >= 0 ? words.slice(0, isinAt).join(' ') : ''
    const isin = isinAt >= 0 ? (words[isinAt] as string) : ''
    const text = isinAt >= 0 ? words.slice(isinAt + 1).join(' ') : description
    rows.push([date ?? null, time ?? null, valueDate ?? null, product || null, isin || null, text, fx ? (num(fx, locale) ?? null) : null, currency ?? null, num(amount, locale) ?? null, balanceCurrency ?? null, balance ? (num(balance, locale) ?? null) : null, null])
  }
  return rows
}

const TRANSACTIONS_HEADER = [
  'Datum', 'Tijd', 'Product', 'ISIN', 'Beurs', 'Uitvoeringsplaats', 'Aantal', 'Koers', null, 'Lokale waarde', null,
  'Waarde', null, 'Wisselkoers', 'AutoFX Kosten', 'Transactiekosten', null, 'Totaal', null, 'Order ID',
]

/**
 * `date time product ISIN exchange [venue] quantity [cur] price [cur] local [cur] value [cur] [rate] [autoFX] [fee] [cur] total [cur]`:
 * currencies sit before the numbers in older statements and after them in newer ones.
 */
function transactionRows(lines: Line[], locale: NumberLocale, withAutoFx: boolean): Cell[][] {
  const rows: Cell[][] = []
  for (const line of lines) {
    const head = new RegExp(String.raw`^(${DATE}) (\d{2}:\d{2}) (.+?) ([A-Z]{2}[A-Z0-9]{9}\d) (.*)$`).exec(line.text)
    if (!head) continue
    const [, date, time, product, isin, rest = ''] = head
    const tokens = rest.split(' ')
    const exchange = tokens.shift() ?? ''
    const venue = tokens[0] && /^[A-Z0-9]{4}$/.test(tokens[0]) ? (tokens.shift() as string) : ''
    const numbers: number[] = []
    const currencies: { currency: string; after: number }[] = []
    for (const token of tokens) {
      if (/^[A-Z]{3}$/.test(token)) currencies.push({ currency: token, after: numbers.length })
      else {
        const value = num(token, locale)
        if (value === undefined) break
        numbers.push(value)
      }
    }
    if (numbers.length < 5) continue
    const [quantity, price, local, value] = numbers as [number, number, number, number]
    const total = numbers.at(-1) as number
    // The price currency is the first currency of the row; the value is in EUR.
    const priceCurrency = currencies[0]?.currency ?? 'EUR'
    const middle = numbers.slice(4, -1)
    const rate = priceCurrency !== 'EUR' && middle.length > 0 ? (middle.shift() as number) : null
    const autoFx = withAutoFx ? (middle.shift() ?? null) : null
    const fee = middle.shift() ?? null
    rows.push([date ?? null, time ?? null, product ?? null, isin ?? null, exchange || null, venue || null, quantity, price, priceCurrency, local, priceCurrency, value, 'EUR', rate, autoFx, fee, 'EUR', total, 'EUR', null])
  }
  return rows
}

/** The PDF as the table of the matching DEGIRO CSV export. */
export function degiroPdfTable(table: RawTable): RawTable {
  const lines = textLines(table)
  const locale = localeOf(lines)
  if (isTransactionsOverview(lines)) {
    const withAutoFx = lines.some((l) => /AutoFX/i.test(l.text))
    return { fileName: table.fileName, rows: [TRANSACTIONS_HEADER, ...transactionRows(lines, locale, withAutoFx)] }
  }
  return { fileName: table.fileName, rows: [ACCOUNT_HEADER, ...accountRows(lines, locale)] }
}
