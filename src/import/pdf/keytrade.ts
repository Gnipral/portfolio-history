import { Collector, guessAssetClass, result } from '../adapters/kit.ts'
import type { ImportContext, RawTable } from '../types.ts'
import { at, blocks, find, ISIN, num, textLines, type Line, type PdfReader } from './kit.ts'

/**
 * Keytrade Bank contract notes ("borderel", "bordereau", "Abrechnung") and coupon notes in Dutch,
 * French and German, as in Portfolio Performance's KeytradeBankPDFExtractor. Costs follow from the
 * difference between the gross and the net amount, so the many layouts of the fee lines (which the
 * PDF text sometimes runs together) do not matter; taxes are read from their own lines.
 */

const n = (text: string | undefined) => num(text, 'de') ?? 0

const TRADE = new RegExp(String.raw`(Kauf|Achat|Aankoop|Verkauf|Vente|Verkoop) ([\d.,]+) (.+?) \((${ISIN.source})\) (?:aan|à|für) ([\d.,]+)`)
const COUPON = new RegExp(String.raw`(?:CREDIT|BETALING) COUPONS? NR .*?: ([\d.,]+) (.+?) \((${ISIN.source})\)`)
/** Luxembourg coupon notes: `22 SARTORIUS AG O.N. NR 200629 0,35 EUR`, ISIN further down. */
const LUX_COUPON = /^([\d.,]+) (.+?) NR \d+ [\d.,]+ [A-Z]{3}$/
const START = new RegExp(`${TRADE.source}|${COUPON.source}|^(Betrag|Montant):`)

// The PDF text can carry stray letters of a watermark between a label and its amount.
const GROSS = /(?:Brutobedrag|Bruttobetrag|Montant brut)\D{0,5}?([\d.,]+) ([A-Z]{3})/
const NET = /(?:^|\b)(Debet|Débit|Lastschrift|Credit|Crédit|Gutschrift|Nettoguthaben|Net CREDIT|Netto credit) ([\d.,]+) ([A-Z]{3})/
/** Taxes with a rate: stock exchange tax, withholding tax and the Belgian withholding tax. */
const TAXES =
  /(?:Beurstaks|Taxe boursi.re|Imp.t . la source|Pr.compte mobilier(?: belge)?|Verrechnungssteuer|Quellensteuer|Bronheffing|roerende voorheffing)[^%]*?[\d.,]+ ?% -? ?([\d.,]+) ([A-Z]{3})/gi
const RATE = /(?:Wisselkoers|Wechselkurs|Taux de change) ([A-Z]{3})\/([A-Z]{3}) ([\d.,]+)/

function detect(text: string): number {
  if (!/Keytrade ?Bank|keytradebank/i.test(text)) return 0
  return text.split(/\r?\n/).some((line) => START.test(line.trim()) || LUX_COUPON.test(line.trim())) ? 0.95 : 0
}

function parseNote(out: Collector, block: Line[]) {
  const row = block[0]?.number ?? 0
  const joined = block.map((l) => l.text).join(' ')
  const net = NET.exec(joined)
  const gross = GROSS.exec(joined)
  const cashCurrency = net?.[3] ?? gross?.[2] ?? 'EUR'
  const orderId = /(?:Ref\. ?[Nn]ummer|Num.ro de r.f\.|Belegnummer)\s*:?\s*([\w/]+)/.exec(joined)?.[1]

  const trade = TRADE.exec(joined)
  const coupon = COUPON.exec(joined)
  const lux = trade || coupon ? null : find(block, LUX_COUPON)
  if (!trade && !coupon && !lux) return
  if (!net && (trade || !gross)) {
    out.issue('warning', 'Keytrade note without a net amount; skipped.', row)
    return
  }
  const date =
    /(?:uitvoering|ex.cution|Ausf.hrungsdatum und -zeit)\s*:\s*(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}:\d{2})/.exec(joined) ??
    /(?:Ordre cr.. .|Auftragserstellung)\s*:\s*(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}:\d{2})/.exec(joined) ??
    /(?:Nettoguthaben|Net CREDIT) [\d.,]+ [A-Z]{3} (?:Datum|Date) (\d{2}\/\d{2}\/\d{4})/.exec(joined) ??
    /(?:Date valeur|Valuta ?datum|Valutadatum)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/.exec(joined)
  const when = at(date?.[1], date?.[2])
  if (!when) {
    out.issue('warning', 'Keytrade note without a date; skipped.', row)
    return
  }

  // Gross in the currency of the net amount: at the rate on the note, else at the ECB rate.
  const toCash = (amount: number, currency: string) => {
    if (currency === cashCurrency) return amount
    const rate = RATE.exec(joined)
    if (rate && rate[1] === cashCurrency && rate[2] === currency) return amount / n(rate[3])
    if (rate && rate[2] === cashCurrency && rate[1] === currency) return amount * n(rate[3])
    return out.convert(amount, currency, cashCurrency, when.date, row)
  }
  const taxes = [...joined.matchAll(TAXES)].reduce((total, m) => total + toCash(n(m[1]), m[2] ?? cashCurrency), 0)
  const grossAmount = gross ? toCash(n(gross[1]), gross[2] ?? cashCurrency) : n(net?.[2])
  // When the text separates the net label from its amount, the net of a coupon is gross minus taxes.
  const netAmount = net ? n(net[2]) : grossAmount - taxes

  if (trade) {
    const buy = /Kauf|Achat|Aankoop/.test(trade[1] ?? '') && !/Verkauf/.test(trade[1] ?? '')
    const quantity = n(trade[2])
    const product = trade[3] ?? ''
    // A buy costs gross + costs + taxes; a sale pays gross - costs - taxes.
    const costs = Math.max(0, (buy ? netAmount - grossAmount : grossAmount - netAmount) - taxes)
    out.add({
      type: buy ? 'buy' : 'sell',
      at: when,
      row,
      product,
      ...(trade[4] ? { isin: trade[4] } : {}),
      assetClass: /Trackers|ETF/i.test(joined) ? 'etf' : guessAssetClass(product),
      quantity,
      price: n(trade[5]),
      currency: /\) (?:aan|à|für) [\d.,]+ ?([A-Z]{3})/.exec(joined)?.[1] ?? cashCurrency,
      amount: grossAmount,
      cashCurrency,
      costs,
      taxes,
      ...(orderId ? { orderId } : {}),
    })
    return
  }

  const isin = coupon?.[3] ?? new RegExp(String.raw`(?:Wertpapier|Titre):\d+\/(${ISIN.source})`).exec(joined)?.[1]
  out.add({
    type: 'dividend',
    at: when,
    row,
    product: ((coupon?.[2] ?? lux?.[2]) || 'Dividend').trim(),
    ...(isin ? { isin } : {}),
    quantity: n(coupon?.[1] ?? lux?.[1]),
    amount: grossAmount,
    cashCurrency,
    // Everything withheld between gross and net is tax on a coupon.
    taxes: Math.max(0, grossAmount - netAmount),
    ...(orderId ? { orderId } : {}),
  })
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('keytrade', table.fileName, context)
  const lines = textLines(table)
  // A note starts at its reference line or at the trade or coupon line when there is none.
  for (const block of blocks(lines, /^(Borderel|Bordereau|Coupon|Abrechnung)$|^(Betrag|Montant):|^(Effectenrekening|Compte[ -]titres?|Wertschriftenkonto):? ?\d+$/)) parseNote(out, block)
  if (out.transactions.length === 0 && !out.issues.length) out.issue('warning', 'No Keytrade contract notes or coupon notes found in this PDF.')
  return out
}

export const keytradePdf: PdfReader = {
  detect,
  parse(tables, context) {
    return result(
      'Keytrade Bank',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: false },
      {
        fxCosts: 'Keytrade includes currency conversion in the net amount of the contract note.',
        deposits: 'Contract notes do not show deposits or withdrawals; import the account history as well.',
      },
    )
  },
}
