import { Collector, guessAssetClass, result } from '../adapters/kit.ts'
import type { ImportContext, RawTable } from '../types.ts'
import { at, ISIN, num, textLines, wordDate, type Line, type NumberLocale, type PdfReader } from './kit.ts'

/**
 * Trade Republic PDFs, following Portfolio Performance's TradeRepublicPDFExtractor for the documents
 * most accounts receive: the securities settlement (buy, sell, savings plan) and the dividend or
 * distribution note in German, English, French, Italian and Spanish, and the account statement
 * (2024+) that lists every cash movement. Corporate action notes are not read; the CSV transaction
 * export covers them.
 */

const DAY = String.raw`(?:\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2})`
/**
 * The position, joined over its lines: `iShs Core MSCI EM IMI U.ETF 1 Stk. 24,045 EUR 24,05 EUR`, or in
 * newer notes `Mondelez US6092071058 2.000000 Pcs. 0.425 USD 0.85 USD`.
 */
const UNITS = String.raw`(?:Stk\.|Pcs\.|titre\(s\)|unit\.|Pz\.|tít\.|Stücke?)`
/** Bonds: `Bundesrep.Deutschland 1.019 EUR 98,05 % 999,13 EUR`, a nominal amount at a percentage. */
const BOND = /^(.+?) ([\d.,]+) ([A-Z]{3}) ([\d.,]+) ?% ([\d.,]+) ([A-Z]{3})/
const POSITION = new RegExp(String.raw`^(.+?) ([\d.,]+)(?: ${UNITS})? ([\d.,]+) ([A-Z]{3}) ([\d.,]+) ([A-Z]{3})`)
/** Newer dividend notes put the amount first: `Realty Income 6.28 USD US7561091049 23.908066 Stücke 0.26 USD`. */
const POSITION_AMOUNT_FIRST = new RegExp(String.raw`^(.+?) ([\d.,]+) ([A-Z]{3}) (${'[A-Z]{2}[A-Z0-9]{9}\\d'}) ([\d.,]+) ${UNITS} ([\d.,]+) ([A-Z]{3})`)
const POSITION_HEADER = /^(POSITION|POSIZIONE|POSICI[ÓO]N|INTITUL[ÉE]) /
const SETTLEMENT = /WERTPAPIERABRECHNUNG|SECURITIES SETTLEMENT|REGOLAMENTO TITOLI|LIQUIDACI[ÓO]N DE VALORES|CONFIRMATION DE L'INVESTISSEMENT|R[ÈE]GLEMENT DES TITRES|RELEV[ÉE] DE TRANSACTION|CONFERMA DEL PIANO|EJECUCI[ÓO]N DEL PLAN/
const INCOME = /^(AUSSCHÜTTUNG|DIVIDENDE|DIVIDEND|CASH DIVIDEND|DISTRIBUTION|DISTRIBUZIONE|DIVIDENDO|BARAUSSCHÜTTUNG|ERTRAGSGUTSCHRIFT)\b/m
const SELL = /\b(Verkauf|Sell|Vente|Vendita|Venta)\b/
const BOOKING = /^(BUCHUNG|BOOKING|COMPTABILISATION DES OP[ÉE]RATIONS|R[ÉE]GLEMENT|PRENOTAZIONE|RESERVA)$/
const TAX = /steuer|solidarit|tax|imp[ôo]t|impost|impuesto|retenue|ritenuta|retenci/i
const TOTAL = /^(GESAMT|TOTAL|TOTALE|Zwischensumme|Subtotal|Sous-total|Subtotale)\b/i

const STATEMENT = /^(UMSATZÜBERSICHT|ACCOUNT TRANSACTIONS|TRANSACTIONS DU COMPTE|TRANSAZIONI SUL CONTO|TRANSACCIONES DE CUENTA)$/m

/** Every Trade Republic document is recognised, so the ones that are not read get a clear message. */
function detect(text: string): number {
  return /TRADE REPUBLIC BANK|Trade Republic/.test(text) ? 0.9 : 0
}

function localeOf(lines: Line[]): NumberLocale {
  const total = lines.find((l) => /^(GESAMT|TOTAL|TOTALE) -?[\d.,]+ [A-Z]{3}$/.test(l.text))?.text ?? ''
  return /\d\.\d{2} [A-Z]{3}$/.test(total) && !/,\d{2} [A-Z]{3}$/.test(total) ? 'en' : 'de'
}

/** The booking: account, value date and the net amount in the account currency. */
function booking(lines: Line[], locale: NumberLocale) {
  const start = lines.findIndex((l) => BOOKING.test(l.text))
  for (const line of lines.slice(start + 1)) {
    const match = new RegExp(String.raw`(${DAY}) (-?[\d.,]+) ([A-Z]{3})$`).exec(line.text)
    if (match) return { date: match[1] as string, amount: num(match[2], locale) ?? 0, currency: match[3] as string }
  }
  return null
}

/** Signed billing lines between the position total and the booking, e.g. `Kapitalertragssteuer -30,63 EUR`. */
function billing(lines: Line[], locale: NumberLocale, currency: string) {
  const end = lines.findIndex((l) => BOOKING.test(l.text))
  let taxes = 0
  for (const line of lines.slice(0, end < 0 ? undefined : end)) {
    const match = /^(.+?) (-?[\d.,]+) ([A-Z]{3})$/.exec(line.text)
    if (!match || TOTAL.test(match[1] as string) || POSITION.test(line.text) || match[3] !== currency) continue
    if (TAX.test(match[1] as string)) taxes -= num(match[2], locale) ?? 0
  }
  return taxes
}

/**
 * Gross amount in the account currency at the rate on the note (`Zwischensumme 1,2153 EUR/USD 1,09 EUR`:
 * 1 EUR = 1,2153 USD), else at the ECB rate.
 */
function grossIn(out: Collector, lines: Line[], locale: NumberLocale, amount: number, from: string, to: string, date: string, row: number) {
  if (from === to) return amount
  for (const line of lines) {
    const rate = new RegExp(String.raw`([\d.,]+) (${to}\/${from}|${from}\/${to}) [\d.,]+ ${to}$`).exec(line.text)
    const value = num(rate?.[1], locale)
    if (rate && value) return rate[2] === `${to}/${from}` ? amount / value : amount * value
  }
  return out.convert(amount, from, to, date, row)
}

function parseNote(out: Collector, lines: Line[]) {
  const locale = localeOf(lines)
  const index = lines.findIndex((l) => POSITION_HEADER.test(l.text))
  const end = lines.findIndex((l, i) => i > index && /^(GESAMT|TOTAL|TOTALE) /.test(l.text))
  const block = lines.slice(index + 1, end < 0 ? index + 6 : end)
  const joined = block.map((l) => l.text).join(' ')
  const reversed = POSITION_AMOUNT_FIRST.exec(joined)
  const bond = BOND.exec(joined)
  // Reordered as name, quantity, price, price currency, amount, amount currency; a bond counts in units of 100.
  const position: (string | undefined)[] | null =
    index < 0
      ? null
      : reversed
        ? [reversed[0], reversed[1], reversed[5], reversed[6], reversed[7], reversed[2], reversed[3]]
        : bond
          ? [bond[0], bond[1], String((num(bond[2], locale) ?? 0) / 100).replace('.', locale === 'de' ? ',' : '.'), bond[4], bond[3], bond[5], bond[6]]
          : POSITION.exec(joined)
  const book = booking(lines, locale)
  if (!position || !book) {
    out.issue('warning', 'Trade Republic note not recognised; skipped.')
    return
  }
  const row = block[0]?.number ?? 0
  const [, label = '', quantityText, priceText, priceCurrency = book.currency, amountText, amountCurrency = book.currency] = position
  const isin = new RegExp(String.raw`\b(${ISIN.source})\b`).exec(block.map((l) => l.text).join(' '))?.[1]
  const name = label.replace(new RegExp(String.raw` ?\b${ISIN.source}\b`), '')
  const quantity = num(quantityText, locale) ?? 0
  const net = Math.abs(book.amount)
  const taxes = billing(lines, locale, book.currency)

  if (SETTLEMENT.test(lines.map((l) => l.text).join('\n'))) {
    const overview = lines.find((l) => new RegExp(DAY).test(l.text) && /(Order|Sparplan|Savings plan|investissement|piano|plan|Kauf|Verkauf|Buy|Sell)/i.test(l.text))?.text ?? ''
    const stamp = new RegExp(String.raw`(${DAY})(?:,? (?:um|at|alle|a las|à) (\d{2}:\d{2}))?`).exec(overview)
    const when = at(stamp?.[1]?.replace(/\//g, '.') ?? book.date.replace(/\//g, '.'), stamp?.[2])
    if (!when) return
    const sell = SELL.test(overview)
    const gross = grossIn(out, lines, locale, num(amountText, locale) ?? 0, amountCurrency, book.currency, when.date, row)
    const costs = Math.max(0, (sell ? gross - net : net - gross) - taxes)
    out.add({
      type: sell ? 'sell' : 'buy',
      at: when,
      row,
      product: name,
      ...(isin ? { isin } : {}),
      assetClass: guessAssetClass(name),
      quantity,
      price: num(priceText, locale) ?? 0,
      currency: priceCurrency,
      amount: gross,
      cashCurrency: book.currency,
      costs,
      taxes,
    })
    return
  }

  const when = at(book.date.replace(/\//g, '.'))
  if (!when) return
  const gross = grossIn(out, lines, locale, num(amountText, locale) ?? 0, amountCurrency, book.currency, when.date, row)
  out.add({
    type: 'dividend',
    at: when,
    row,
    product: name,
    ...(isin ? { isin } : {}),
    quantity,
    amount: gross,
    cashCurrency: book.currency,
    // Everything withheld between gross and net is tax on a distribution.
    taxes: Math.max(0, gross - net),
  })
}

/** `1.173,16 €` or `€10,000.00` */
const MONEY = /(-?€ ?[\d.,]+|-?[\d.,]+ ?€)/g

function euro(text: string, locale: NumberLocale): number {
  const negative = text.includes('-')
  return (negative ? -1 : 1) * (num(text.replace(/[€\s-]/g, ''), locale) ?? 0)
}

/**
 * The account statement: one entry per cash movement, starting at its day (`02 Jan.`); the year,
 * the type and the description can wrap onto the next lines. The direction of an amount follows from
 * the balance after it.
 */
function parseStatement(out: Collector, lines: Line[]) {
  const start = lines.findIndex((l) => /^(DATUM TYP BESCHREIBUNG|DATE TYPE DESCRIPTION|DATE TYPE DESCRIPTION|DATA TIPO DESCRIZIONE|FECHA TIPO DESCRIPCI)/.test(l.text))
  const body = lines.slice(start + 1)
  const locale: NumberLocale = body.some((l) => /€\d{1,3},\d{3}\.\d{2}|€\d+\.\d{2}\b/.test(l.text)) ? 'en' : 'de'
  const entries: { lines: Line[] }[] = []
  for (const line of body) {
    if (/^\d{1,2} \p{L}{3,5}\.?( \d{4})?\b/u.test(line.text)) entries.push({ lines: [line] })
    else entries.at(-1)?.lines.push(line)
  }
  const opening = /(?:Cashkonto|Cash account|Compte espèces|Conto corrente|Cuenta de efectivo) (-?€ ?[\d.,]+|-?[\d.,]+ ?€)/.exec(lines.map((l) => l.text).join('\n'))
  let balance: number | null = opening ? euro(opening[1] as string, locale) : null
  for (const entry of entries) {
    const text = entry.lines.map((l) => l.text).join(' ')
    const day = /^(\d{1,2}) (\p{L}{3,5})\.?/u.exec(text)
    const year = /\b(20\d{2})\b/.exec(text)?.[1]
    const date = day && year ? wordDate(`${day[1]} ${day[2]} ${year}`) : null
    const money = [...text.matchAll(MONEY)].map((m) => m[1] as string)
    if (!date || money.length < 2) continue
    const after = euro(money.at(-1) as string, locale)
    const size = Math.abs(euro(money.at(-2) as string, locale))
    const incoming = balance === null ? /PayIn|Deposit|Einzahlung|Dividend|Ertr|Zins|Interest|Prämie|Reward|Saveback|Sell|Verkauf/i.test(text) : after > balance - 1e-9
    balance = after
    const signed = incoming ? size : -size
    const row = entry.lines[0]?.number ?? 0
    const base = { at: { date, time: '00:00' }, row, cashCurrency: 'EUR', amount: signed }
    const isin = new RegExp(String.raw`\b(${ISIN.source})\b`).exec(text)?.[1]
    const trade = /(Buy trade|Sell trade|Kauf|Verkauf|Savings plan execution|Sparplanausführung|Achat|Vente|Acquisto|Vendita|Compra|Venta)\b.*?(?:quantity|Anzahl|quantité|quantità|cantidad): ([\d.,]+)/i.exec(text)
    if (trade && isin) {
      const quantity = num(trade[2], 'en') ?? 0
      const name = new RegExp(String.raw`${isin} (.+?), (?:quantity|Anzahl|quantité|quantità|cantidad)`).exec(text)?.[1] ?? isin
      out.add({ ...base, type: incoming ? 'sell' : 'buy', product: name, isin, assetClass: guessAssetClass(name), quantity, price: quantity ? size / quantity : 0 })
    } else if (/Dividend|Ertr[äa]g|Distribution|Aussch/i.test(text) && isin) {
      out.add({ ...base, type: 'dividend', product: isin, isin })
    } else if (/Zins|Interest|Intérêts|Interessi|Intereses/i.test(text)) {
      out.add({ ...base, product: 'Interest', type: incoming ? 'dividend' : 'fee' })
    } else if (/Prämie|Reward|Saveback|Bonus/i.test(text)) {
      out.add({ ...base, product: 'Bonus', type: 'dividend' })
    } else if (/Steuer|Tax|Impôt|Impost|Impuesto/i.test(text)) {
      out.add({ ...base, product: incoming ? 'Tax refund' : 'Taxes', type: incoming ? 'dividend' : 'tax' })
    } else if (/Gebühr|Fee|Frais|Commission|Comisi/i.test(text)) {
      out.add({ ...base, product: 'Fees', type: incoming ? 'deposit' : 'fee' })
    } else {
      // Transfers, card payments and everything else that only moves cash.
      out.add({ ...base, product: 'Cash', type: incoming ? 'deposit' : 'withdrawal' })
    }
  }
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('trade-republic', table.fileName, context)
  const lines = textLines(table)
  const text = lines.map((l) => l.text).join('\n')
  if (SETTLEMENT.test(text) || INCOME.test(text)) parseNote(out, lines)
  else if (STATEMENT.test(text)) parseStatement(out, lines)
  else {
    out.issue('warning', 'This kind of Trade Republic document (corporate action, tax or interest note) is not read. The transaction export (CSV) contains it.')
    return out
  }
  if (out.transactions.length === 0 && !out.issues.length) out.issue('warning', 'No Trade Republic transactions found in this PDF.')
  return out
}

export const tradeRepublicPdf: PdfReader = {
  detect,
  parse(tables, context) {
    return result(
      'Trade Republic',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: true },
      { fxCosts: 'Trade Republic includes currency conversion in the price; there is no separate FX cost.' },
    )
  },
}
