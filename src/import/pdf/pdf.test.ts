import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../model/transaction.ts'
import { fixedRates } from '../adapters/kit.ts'
import { pageLines } from '../readPdf.ts'
import { importTables } from '../registry.ts'

/** PDF texts in the layouts of real broker documents; all names, numbers and amounts are made up. */
const RATES = fixedRates({ USD: 1.25, CHF: 0.95 })

function load(...texts: string[]) {
  return importTables(
    texts.map((text, i) => ({ fileName: `doc-${i}.pdf`, rows: [], text })),
    { context: RATES },
  )
}

function only(transactions: Transaction[], type: Transaction['type']): Transaction[] {
  return transactions.filter((t) => t.type === type)
}

describe('pageLines', () => {
  it('joins the text items on one baseline into a line, top to bottom', () => {
    const item = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 5, height: 10 })
    expect(pageLines([item('EUR', 120, 700), item('Netto debit', 10, 700), item('-1.287,54', 70, 701), item('Waardecode', 10, 680)])).toEqual([
      'Netto debit -1.287,54 EUR',
      'Waardecode',
    ])
  })
})

describe('Bolero contract notes', () => {
  const note = [
    'Overzicht transacties en rekeninguittreksels voor klantnummer 1234567',
    'EUR-REKENING - 14',
    'Borderel 300100001 Limit order',
    '08/01/2025 09:14:00 Valuta 10/01/2025 Xetra',
    'Uw Aankoop Online van 10 EXAMPLE ETF ACC aan 100,00 EUR 1.000,00 EUR',
    'Makelaarsloon 2,50 EUR',
    'Beurstaks 1,20 EUR',
    'Netto debit -1.003,70 EUR',
    'Waardecode IE0000000001',
    'Borderel 300100002',
    '15/05/2025 07:30:00 Valuta 15/05/2025',
    'Uw Uitbetaling dividenden van 10 EXAMPLE CORP aan 1,000000 EUR 10,00 EUR',
    'Roerende voorheffing (basisbedrag 10,00 EUR) 3,00 EUR',
    'Netto credit 7,00 EUR',
    'Waardecode BE0000000002',
    'Rekeninguittreksel Nr 3 Vorig Saldo: 0,00 EUR',
    '06/01/2025 Provisionering rekening klant Valuta 06/01/2025 5.000,00 EUR',
    '15/05/2025 Uitbetaling dividenden EXAMPLE CORP Valuta 15/05/2025 7,00 EUR',
    'KBC BANK NV Documentreferte: 15',
  ].join('\n')

  it('reads buys with costs and the stock exchange tax, dividends with withholding tax and deposits', () => {
    const result = load(note)
    expect(result.broker).toBe('Bolero')
    expect(only(result.transactions, 'buy')).toEqual([expect.objectContaining({ quantity: 10, amountEur: -1000, costsEur: 2.5, taxesEur: 1.2, isin: 'IE0000000001' })])
    expect(only(result.transactions, 'dividend')).toEqual([expect.objectContaining({ amountEur: 10, taxesEur: 3, isin: 'BE0000000002' })])
    // The dividend line of the account statement is not counted a second time.
    expect(only(result.transactions, 'deposit')).toEqual([expect.objectContaining({ amountEur: 5000 })])
  })
})

describe('Keytrade contract notes', () => {
  it('derives costs from gross and net, and reads the tax lines', () => {
    const result = load(
      [
        'Keytrade Bank, Belgisch bijkantoor van Arkéa Direct Bank SA (Frankrijk)',
        'Borderel',
        'Effectenrekening: 1234567',
        'Ref. Nummer : 30000001/01',
        'Aankoop 20 EXAMPLE ETF (IE0000000001) aan 50 EUR',
        'Datum en tijdstip van uitvoering: 30/11/2023 16:37:39 CET',
        'Brutobedrag - 1.000,00 EUR',
        'Beurstaks - 0,12% - 1,20 EUR',
        'Makelaarsloon - 14,95 EUR',
        'Debet 1.016,15 EUR',
      ].join('\n'),
    )
    expect(result.broker).toBe('Keytrade Bank')
    expect(only(result.transactions, 'buy')).toEqual([
      expect.objectContaining({ quantity: 20, price: 50, amountEur: -1000, costsEur: 14.95, taxesEur: 1.2, dateTime: '2023-11-30T16:37' }),
    ])
  })
})

describe('Saxo reports', () => {
  it('books the conversion cost of a trade as FX cost and the stamp duty as tax', () => {
    const result = load(
      [
        'Saxo Bank CH / The Circle 38 / 8058 Zürich-Flughafen / Switzerland',
        'Währung: CHF 05-Dez-2024 - 05-Dez-2024',
        'Trade details, CHF',
        'Instrument Example World UCITS ETF Handelszeit 05-Dez-2024 11:21:27',
        'ISIN IE0000000001 Valuta 09-Dez-2024',
        'K/V Kauf Preis 100,00 USD',
        'Eröffnung/Schluss To-Open Menge 10,00',
        'Stempelgebühr 39683058642 05-Dez-2024 09-Dez-2024 -1,50 0,900000 -0,01 -1,36',
        'Aktienbetrag 39679982249 05-Dez-2024 09-Dez-2024 -1.000,00 0,900000 -2,00 -902,00',
      ].join('\n'),
    )
    expect(result.broker).toBe('Saxo')
    const [buy] = only(result.transactions, 'buy')
    expect(buy).toMatchObject({ quantity: 10, isin: 'IE0000000001', dateTime: '2024-12-05T11:21' })
    // 900 CHF gross, 1.35 CHF stamp duty, 2.01 CHF conversion cost; 1 EUR = 0.95 CHF.
    expect(buy?.amountEur).toBeCloseTo(-900 / 0.95, 4)
    expect(buy?.taxesEur).toBeCloseTo(1.35 / 0.95, 4)
    expect(buy?.fxCostsEur).toBeCloseTo(2.01 / 0.95, 4)
  })
})

describe('Revolut', () => {
  it('reads a trade confirmation', () => {
    const result = load(
      [
        'Trade Confirmation',
        'Order details',
        'Symbol Security Name ISIN Type Quantity Unit Price Total Amount Settlement date',
        'EXMP Example World UCITS ETF (Acc) IE0000000001 Buy 2.5 €40.00 €100 06 Jan 2025',
        'Total Fee charged €0.10',
        'EXMP Example World UCITS ETF (Acc) Buy 2.5 €40.00 €100 02 Jan 2025 08:10:12 GMT XOFF',
        'Revolut Securities Europe UAB',
      ].join('\n'),
    )
    expect(result.broker).toBe('Revolut')
    expect(only(result.transactions, 'buy')).toEqual([expect.objectContaining({ quantity: 2.5, amountEur: -100, costsEur: 0.1, dateTime: '2025-01-02T08:10' })])
  })
})

describe('Trading 212 activity statement', () => {
  it('reads orders, interest with tax and deposits', () => {
    const result = load(
      [
        'Aktivitätsauszug',
        'Trading 212 Invest Trading 212 CFD',
        'Invest-Konto - ausgeführte Aufträge',
        '2026-01-06 08:12:29 EXMP IE0000000001 EUR 44466988302 Verkaufen 2 100 200 Market OTC Reguläre Zeiten 1 EUR - - 1.5 200 0.40',
        '2026-01-06 02:10:08 Verzinsung von Geld EUR 1.83 -0.48 €-0.48 1.35',
        '2026-01-07 11:30:16 JP Morgan Bankeinzahlung EUR 22.33 - - 22.33',
      ].join('\n'),
    )
    expect(result.broker).toBe('Trading 212')
    expect(only(result.transactions, 'sell')).toEqual([expect.objectContaining({ quantity: 2, amountEur: 200, taxesEur: 0.4 })])
    expect(only(result.transactions, 'dividend')).toEqual([expect.objectContaining({ amountEur: 1.83, taxesEur: 0.48 })])
    expect(only(result.transactions, 'deposit')[0]?.amountEur).toBe(22.33)
  })
})

describe('DEGIRO', () => {
  const transactions = [
    'Transacties van 01-01-2025 t/m 31-12-2025',
    'Datum Tijd Product ISIN Beurs Uitvoeringsplaats Aantal Koers Lokale waarde Waarde EUR Wisselkoers AutoFX Kosten Transactiekosten Totaal EUR',
    '16-01-2025 21:59 EXAMPLE CORP US0000000001 NDQ XNAS 10 50,0000 USD -500,00 USD -400,00 1,2500 -1,00 -2,00 -403,00',
    '04-02-2025 10:32 EXAMPLE ETF IE0000000002 EAM XAMS 30 10,0000 EUR -300,00 EUR -300,00 0,00 -1,00 -301,00',
    'flatexDEGIRO Bank Dutch Branch',
  ].join('\n')
  const account = [
    'Rekeningoverzicht van 01-01-2025 t/m 31-12-2025',
    'Datum Tijd Valutadatum Product ISIN Omschrijving FX Mutatie Saldo',
    '15-03-2025 07:39 14-03-2025 EXAMPLE CORP US0000000001 Dividendbelasting USD -0,75 USD -0,75',
    '15-03-2025 07:39 14-03-2025 EXAMPLE CORP US0000000001 Dividend USD 5,00 USD 4,25',
    '02-01-2025 08:42 01-01-2025 iDEAL Deposit EUR 1.000,00 EUR 1.000,00',
    'flatexDEGIRO Bank Dutch Branch',
  ].join('\n')

  it('reads the transactions overview and the account statement as their CSV exports', () => {
    const result = load(transactions, account)
    expect(result.broker).toBe('DEGIRO')
    const buys = only(result.transactions, 'buy')
    expect(buys).toEqual([
      expect.objectContaining({ isin: 'US0000000001', quantity: 10, amountEur: -400, costsEur: 2, fxCostsEur: 1, currency: 'USD' }),
      expect.objectContaining({ isin: 'IE0000000002', quantity: 30, amountEur: -300, costsEur: 1 }),
    ])
    expect(only(result.transactions, 'dividend')[0]?.amountEur).toBe(4)
    expect(only(result.transactions, 'tax')[0]?.amountEur).toBe(-0.6)
    expect(only(result.transactions, 'deposit')[0]?.amountEur).toBe(1000)
  })
})

describe('Trade Republic', () => {
  it('reads a settlement with costs and taxes, and a dividend at the rate of the note', () => {
    const settlement = [
      'TRADE REPUBLIC BANK GMBH BRUNNENSTRASSE 19-21 10119 BERLIN',
      'WERTPAPIERABRECHNUNG',
      'ÜBERSICHT',
      'Market-Order Verkauf am 18.06.2025, um 17:50 Uhr an der Lang & Schwarz Exchange.',
      'POSITION ANZAHL KURS BETRAG',
      'Example Corp. 80 Stk. 25,00 EUR 2.000,00 EUR',
      'Registered Shares o.N.',
      'DE0000000003',
      'GESAMT 2.000,00 EUR',
      'ABRECHNUNG',
      'POSITION BETRAG',
      'Fremdkostenzuschlag -1,00 EUR',
      'Kapitalertragssteuer -30,00 EUR',
      'GESAMT 1.969,00 EUR',
      'BUCHUNG',
      'VERRECHNUNGSKONTO VALUTA BETRAG',
      'DE00000000000000000000 20.06.2025 1.969,00 EUR',
    ].join('\n')
    const dividend = [
      'TRADE REPUBLIC BANK GMBH BRUNNENSTRASSE 19-21 10119 BERLIN',
      'DIVIDENDE',
      'POSITION ANZAHL ERTRÄGNIS BETRAG',
      'Example Inc. 10 Stk. 0,50 USD 5,00 USD',
      'ISIN: US0000000004',
      'GESAMT 5,00 USD',
      'ABRECHNUNG',
      'Quellensteuer DE für US-Emittent -0,75 USD',
      'Zwischensumme 4,25 USD',
      'Zwischensumme 1,25 EUR/USD 3,40 EUR',
      'GESAMT 3,40 EUR',
      'BUCHUNG',
      'DE00000000000000000000 11.12.2025 3,40 EUR',
    ].join('\n')
    const result = load(settlement, dividend)
    expect(result.broker).toBe('Trade Republic')
    expect(only(result.transactions, 'sell')).toEqual([
      expect.objectContaining({ quantity: 80, amountEur: 2000, costsEur: 1, taxesEur: 30, isin: 'DE0000000003', dateTime: '2025-06-18T17:50' }),
    ])
    expect(only(result.transactions, 'dividend')).toEqual([expect.objectContaining({ amountEur: 4, taxesEur: 0.6, isin: 'US0000000004' })])
  })

  it('reads the account statement, with the direction of each amount from the balance', () => {
    const statement = [
      'TRADE REPUBLIC BANK GMBH BRUNNENSTRASSE 19-21 10119 BERLIN',
      'KONTOÜBERSICHT',
      'Cashkonto 100,00 € 1.050,00 € 60,00 € 1.090,00 €',
      'UMSATZÜBERSICHT',
      'DATUM TYP BESCHREIBUNG ZAHLUNGSEINGANG ZAHLUNGSAUSGANG SALDO',
      '02 Jan. ',
      'Überweisung Einzahlung akzeptiert 1.000,00 € 1.100,00 €',
      '2025',
      '03 Jan. Savings plan execution IE0000000001 Example ETF, quantity: 0.5',
      'Handel 50,00 € 1.050,00 €',
      '2025',
      '04 Jan. ',
      'Kartentransaktion Bakery 10,00 € 1.040,00 €',
      '2025',
      '05 Jan. ',
      'Zinszahlung Your interest payment 50,00 € 1.090,00 €',
      '2025',
    ].join('\n')
    const result = load(statement)
    expect(only(result.transactions, 'deposit')[0]?.amountEur).toBe(1000)
    expect(only(result.transactions, 'buy')).toEqual([expect.objectContaining({ isin: 'IE0000000001', quantity: 0.5, amountEur: -50 })])
    expect(only(result.transactions, 'withdrawal')[0]?.amountEur).toBe(-10)
    expect(only(result.transactions, 'dividend')[0]).toMatchObject({ product: 'Interest', amountEur: 50 })
  })

  it('names the Trade Republic documents it does not read', () => {
    const result = load('TRADE REPUBLIC BANK GMBH\nSPLIT\nPOSITION ANZAHL')
    expect(result.transactions).toEqual([])
    expect(result.issues[0]?.message).toMatch(/not read/)
  })
})
