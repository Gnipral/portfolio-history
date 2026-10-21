import { Collector, guessAssetClass, result } from '../adapters/kit.ts'
import type { ImportContext, RawTable } from '../types.ts'
import { at, blocks, find, ISIN, num, sum, textLines, type Line, type PdfReader } from './kit.ts'

/**
 * Bolero and KBC contract notes ("borderel") and account statements ("rekeninguittreksel"), as in
 * Portfolio Performance's KBCGroupNVPDFExtractor. A document can hold several contract notes and
 * the account statement that books them; only the contract notes and the cash movements without a
 * contract note (deposits, withdrawals, custody fees) are imported, so nothing is counted twice.
 */

const AMOUNT = String.raw`([\d.]+(?:,\d+)?)`
const n = (text: string | undefined) => num(text, 'de') ?? 0

/** Lines that follow the "Uw Aankoop/Verkoop/Uitbetaling" line inside a contract note. */
const DETAIL = /^(Makelaarsloon|Beurstaks|Netto (debit|credit)|Buitenlandse bronheffing|Roerende voorheffing|Kosten incassostelling|BTW|Sec Fee|Wisselkoers|Waardecode|Wettelijke fiscale informatie|Cash Dividend)/

function detect(text: string): number {
  if (!/KBC BANK NV|Bolero/.test(text)) return 0
  return /Borderel \d+|Rekeninguittreksel Nr/.test(text) ? 0.95 : 0
}

/** The "Uw ..." line with its continuation lines (a long product name or price wraps). */
function headline(block: Line[]): string {
  const start = block.findIndex((l) => /^Uw /.test(l.text))
  if (start < 0) return ''
  const parts = [block[start]?.text ?? '']
  for (const line of block.slice(start + 1)) {
    if (DETAIL.test(line.text)) break
    parts.push(line.text)
  }
  return parts.join(' ')
}

function dateOf(block: Line[]) {
  const stamp = find(block, /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}:\d{2}) Valuta/) ?? find(block, /^Uitvoeringsdatum : (\d{2}\/\d{2}\/\d{4}) Uitvoeringstijdstip : (\d{2}:\d{2}:\d{2})/)
  if (stamp) return at(stamp[1], stamp[2])
  return at(find(block, /^(\d{2}\/\d{2}\/\d{4}) Uitbetaling dividenden/)?.[1])
}

function fees(block: Line[]): number {
  return (
    sum(block, new RegExp(String.raw`^Makelaarsloon(?: .*)? ${AMOUNT} [A-Z]{3}$`), 'de') +
    sum(block, new RegExp(String.raw`^Sec Fee .* ${AMOUNT} [A-Z]{3}$`), 'de') +
    sum(block, new RegExp(String.raw`^Kosten incassostelling \(basisbedrag [\d.,]+ [A-Z]{3}\) ${AMOUNT} [A-Z]{3}$`), 'de') +
    // VAT on the collection fee.
    sum(block, new RegExp(String.raw`^BTW \(basisbedrag [\d.,]+ [A-Z]{3}\) ${AMOUNT} [A-Z]{3}$`), 'de')
  )
}

function taxes(block: Line[]): number {
  return (
    sum(block, new RegExp(String.raw`^Buitenlandse bronheffing \(basisbedrag [\d.,]+ [A-Z]{3}\) ${AMOUNT} [A-Z]{3}$`), 'de') +
    sum(block, new RegExp(String.raw`^Roerende voorheffing \(basisbedrag [\d.,]+ [A-Z]{3}\) ${AMOUNT} [A-Z]{3}$`), 'de') +
    sum(block, new RegExp(String.raw`^Roerende voorheffing op fondsen ${AMOUNT} [A-Z]{3}$`), 'de') +
    sum(block, new RegExp(String.raw`^Beurstaks ${AMOUNT} [A-Z]{3}$`), 'de')
  )
}

function parseContractNote(out: Collector, block: Line[], account: string) {
  const row = block[0]?.number ?? 0
  const head = headline(block)
  const when = dateOf(block)
  const net = find(block, new RegExp(String.raw`^Netto (debit|credit) -?${AMOUNT} ([A-Z]{3})$`))
  if (!head || !when || !net) {
    out.issue('warning', `${block[0]?.text}: contract note not recognised; skipped.`, row)
    return
  }
  const cashCurrency = net[3] ?? account
  const netAmount = n(net[2])
  const costs = fees(block)
  const tax = taxes(block)
  const orderId = /^Borderel (\d+)/.exec(block[0]?.text ?? '')?.[1]

  const trade = /^Uw (Aankoop|Verkoop|Inschrijving)(?: Online)? van (?:([A-Z]{3}) )?([\d.,]+) (.+?) aan (.*)$/.exec(head)
  if (trade) {
    const buy = trade[1] !== 'Verkoop'
    // Bonds are quoted in percent of the nominal amount: 40.000 EUR nominal at 96,25% is 400 units of 100.
    const bond = Boolean(trade[2]) || /\d%/.test(trade[5] ?? '')
    const quantity = n(trade[3]) / (bond ? 100 : 1)
    const gross = buy ? netAmount - costs - tax : netAmount + costs + tax
    const isin = find(block, /^Waardecode ([A-Z]{2}[A-Z0-9]{9}\d)$/)?.[1]
    const product = (trade[4] ?? '').replace(/ \((AS|BR|NY|PA|XE|LN|MI|MC|SW|DE|US)\)$/, '')
    out.add({
      type: buy ? 'buy' : 'sell',
      at: when,
      row,
      product,
      ...(isin ? { isin } : {}),
      assetClass: bond ? 'bond' : guessAssetClass(product),
      quantity,
      price: quantity ? gross / quantity : 0,
      amount: gross,
      cashCurrency,
      costs,
      taxes: tax,
      ...(orderId ? { orderId } : {}),
    })
    return
  }

  const dividend = /^Uw Uitbetaling dividenden van ([\d.,]+) (.+?) (?:aan [\d.,]+ |[\d.,]+ [A-Z]{3}$)/.exec(head)
  if (dividend) {
    const isin =
      find(block, new RegExp(String.raw`^Cash Dividend (${ISIN.source})`))?.[1] ?? find(block, /^Waardecode ([A-Z]{2}[A-Z0-9]{9}\d)$/)?.[1]
    const product = (dividend[2] ?? '').replace(/^CP /, '').replace(/ \((AS|BR|NY|PA|XE|LN)\).*$/, '')
    out.add({
      type: 'dividend',
      at: when,
      row,
      product,
      ...(isin ? { isin } : {}),
      quantity: n(dividend[1]),
      amount: netAmount + costs + tax,
      cashCurrency,
      costs,
      taxes: tax,
      ...(orderId ? { orderId } : {}),
    })
    return
  }
  out.issue('warning', `${block[0]?.text}: "${head}" is not a supported contract note; skipped.`, row)
}

/** Cash movements on an account statement that no contract note covers. */
const STATEMENT = [
  { pattern: /^(\d{2}\/\d{2}\/\d{4}) Provisionering rekening klant Valuta ?\d{2}\/\d{2}\/\d{4} ([\d.,]+) ([A-Z]{3})$/, type: 'deposit', product: 'Cash' },
  { pattern: /^(\d{2}\/\d{2}\/\d{4}) Overschrijving naar klant Valuta ?\d{2}\/\d{2}\/\d{4} -([\d.,]+) ([A-Z]{3})$/, type: 'withdrawal', product: 'Cash' },
  { pattern: /^(\d{2}\/\d{2}\/\d{4}) Bewaarloon Valuta \d{2}\/\d{2}\/\d{4} -([\d.,]+) ([A-Z]{3})$/, type: 'fee', product: 'Custody fee' },
] as const

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('bolero', table.fileName, context)
  const lines = textLines(table)
  let account = 'EUR'
  for (const block of blocks(lines, /^Borderel \d+|^Rekeninguittreksel Nr|^[A-Z]{3}-REKENING/)) {
    const first = block[0]?.text ?? ''
    const currency = /^([A-Z]{3})-REKENING/.exec(first)?.[1]
    if (currency) account = currency
    else if (first.startsWith('Borderel')) parseContractNote(out, block, account)
    else {
      for (const line of block) {
        for (const { pattern, type, product } of STATEMENT) {
          const match = pattern.exec(line.text)
          const when = match ? at(match[1]) : null
          if (match && when) out.add({ type, at: when, row: line.number, product, amount: n(match[2]), cashCurrency: match[3] ?? account })
        }
      }
    }
  }
  if (out.transactions.length === 0 && out.issues.length === 0) out.issue('warning', 'No contract notes or cash movements found in this PDF.')
  return out
}

export const boleroPdf: PdfReader = {
  detect,
  parse(tables, context) {
    return result(
      'Bolero',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: true },
      { fxCosts: 'Bolero books currency conversions separately; they are not in the contract notes.' },
    )
  },
}
