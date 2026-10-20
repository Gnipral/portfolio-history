import { describe, expect, it } from 'vitest'
import { readCsv } from '../../readFile.ts'
import { importTables } from '../../registry.ts'
import { finalHoldings } from '../../summary.ts'
import { fixedRates } from '../kit.ts'
import { degiroAdapter } from './index.ts'
import { DUTCH_HEADER, ENGLISH_HEADER, SAMPLE_ROWS, table } from './fixtures.ts'

function parse(rows = SAMPLE_ROWS, header = DUTCH_HEADER) {
  return degiroAdapter.parse([table(rows, header)])
}

describe('DEGIRO detection', () => {
  it('recognizes the Dutch and English Transactions header', () => {
    expect(degiroAdapter.detect(table([], DUTCH_HEADER))).toBeGreaterThan(0.9)
    expect(degiroAdapter.detect(table([], ENGLISH_HEADER))).toBeGreaterThan(0.9)
  })

  it('rejects other files', () => {
    expect(degiroAdapter.detect(table([], ['Date', 'Description', 'Amount']))).toBe(0)
    expect(degiroAdapter.detect({ fileName: 'empty.csv', rows: [] })).toBe(0)
  })
})

describe('DEGIRO Transactions parsing', () => {
  const { transactions, issues } = parse()
  const byOrder = (id: string) => transactions.find((t) => t.orderId === id)

  it('parses every row and reports only informational notes', () => {
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
    // 10 rows: two split pairs collapse into one transaction each
    expect(transactions).toHaveLength(8)
  })

  it('sorts transactions oldest first', () => {
    const dates = transactions.map((t) => t.dateTime)
    expect(dates).toEqual([...dates].sort())
    expect(transactions[0]?.dateTime).toBe('2026-01-02T15:30')
  })

  it('maps a USD buy including FX rate, AutoFX and costs', () => {
    expect(byOrder('order-1')).toMatchObject({
      type: 'buy',
      date: '2026-01-05',
      dateTime: '2026-01-05T16:44',
      isin: 'US0000000002',
      exchange: 'NSY',
      venue: 'XNYS',
      quantity: 10,
      price: 120,
      currency: 'USD',
      fxRate: 1.2,
      localAmount: -1200,
      amountEur: -1000,
      fxCostsEur: 2.5,
      costsEur: 2,
      taxesEur: 0,
      totalEur: -1004.5,
      assetClass: 'stock',
    })
  })

  it('maps a sell with positive quantity and positive cash amount', () => {
    expect(byOrder('order-3')).toMatchObject({ type: 'sell', quantity: 4, amountEur: 500, totalEur: 496.75 })
  })

  it('keeps GBX prices in pence', () => {
    expect(byOrder('order-2')).toMatchObject({ currency: 'GBX', price: 1000, fxRate: 86, amountEur: -23.25 })
  })

  it('omits the FX rate for EUR trades and recognizes ETFs', () => {
    const etf = byOrder('order-e')
    expect(etf?.fxRate).toBeUndefined()
    expect(etf?.assetClass).toBe('etf')
  })

  it('turns a sell/buy pair without order ID into a split', () => {
    const split = transactions.find((t) => t.type === 'split' && t.isin === 'US0000000001')
    expect(split).toMatchObject({ quantity: 8, amountEur: 0, totalEur: 0, split: { ratio: 4, fromQuantity: 2 } })
    expect(split?.split?.fromIsin).toBeUndefined()
  })

  it('recognizes a reverse split with ISIN change', () => {
    const split = transactions.find((t) => t.type === 'split' && t.isin === 'US0000000005')
    expect(split).toMatchObject({ quantity: 5, split: { ratio: 0.025, fromQuantity: 200, fromIsin: 'US0000000004' } })
  })

  it('computes final holdings through splits and ISIN changes', () => {
    expect(finalHoldings(transactions)).toEqual([
      { isin: 'US0000000005', product: 'EXAMPLE BIOTECH NEW', quantity: 5 },
      { isin: 'US0000000002', product: 'EXAMPLE INDUSTRIES CORP', quantity: 6 },
      { isin: 'US0000000001', product: 'EXAMPLE SOFTWARE INC', quantity: 8 },
      { isin: 'GB0000000003', product: 'EXAMPLE UK PLC', quantity: 2 },
      { isin: 'IE0000000006', product: 'EXAMPLE WORLD UCITS ETF', quantity: 3 },
    ])
  })

  it('gives deterministic ids based on file and row', () => {
    expect(byOrder('order-1')?.id).toBe('degiro:Transactions.csv:8')
    expect(parse().transactions.map((t) => t.id)).toEqual(transactions.map((t) => t.id))
  })
})

describe('DEGIRO edge cases', () => {
  const buy = SAMPLE_ROWS[6] as (string | number | null)[]

  it('parses European-formatted CSV text', () => {
    const csv = [
      'Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID',
      '05-01-2026,16:44,EXAMPLE INDUSTRIES CORP,US0000000002,NSY,XNYS,10,"120,00",USD,"-1200,00",USD,"-1000,00","1,2000","-2,50","-2,00","-1004,50",order-1',
    ].join('\r\n')
    const result = importTables(readCsv('Transactions.csv', csv))
    expect(result.broker).toBe('DEGIRO')
    expect(result.transactions[0]).toMatchObject({ price: 120, amountEur: -1000, fxRate: 1.2, totalEur: -1004.5 })
  })

  it('reports rows that fail to parse with their row number', () => {
    const bad = [...buy]
    bad[0] = '32-13-2026'
    const badNumber = [...buy]
    badNumber[6] = 'ten'
    const noCurrency = [...buy]
    noCurrency[8] = null
    noCurrency[10] = null
    const { transactions, issues } = parse([bad, badNumber, noCurrency, buy])
    expect(transactions).toHaveLength(1)
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.row)).toEqual([2, 3, 4])
    expect(issues[0]?.message).toContain('Invalid date')
  })

  it('reports missing required columns', () => {
    const header = DUTCH_HEADER.filter((h) => h !== 'Waarde EUR')
    const { issues } = parse([], header)
    expect(issues[0]).toMatchObject({ severity: 'error' })
    expect(issues[0]?.message).toContain('valueEur')
  })

  it('skips quantity-0 placeholders and keeps unpaired corporate rows as trades', () => {
    const cashInLieu = ['04-12-2026', '00:00', 'EXAMPLE BIOTECH NEW', 'US0000000005', 'NDQ', null, -5, 0.3, 'USD', 1.5, 'USD', 1.25, 1.2, 0, null, 1.25, null]
    const placeholder = ['04-12-2026', '00:00', 'EXAMPLE BIOTECH NEWER', 'US0000000007', 'NDQ', null, 0, 9, 'USD', 0, 'USD', 0, 1.2, 0, null, 0, null]
    const { transactions, issues } = parse([cashInLieu, placeholder])
    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toMatchObject({ type: 'sell', quantity: 5 })
    expect(issues.map((i) => i.severity)).toEqual(['info', 'info'])
  })

  it('ignores blank rows', () => {
    expect(parse([[null, null], buy]).transactions).toHaveLength(1)
  })

  it('reports which data the export lacks', () => {
    const result = parse()
    expect(result.capabilities).toEqual({
      transactionCosts: true,
      fxCosts: true,
      taxes: false,
      dividends: false,
      deposits: false,
    })
    expect(result.missingReasons.dividends).toMatch(/does not contain dividends/)
  })
})

describe('DEGIRO Account statement', () => {
  const RATES = fixedRates({ USD: 1.25 })
  const header = 'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id'
  // Newest first, as DEGIRO writes it. All names, ISINs and order IDs are made up.
  const account = [
    header,
    '02-03-2026,09:00,02-03-2026,,,flatex terugstorting,,EUR,"-100,00",EUR,"498,40",',
    '01-03-2026,07:30,01-03-2026,EXAMPLE CORP,US0000000001,Dividendbelasting,,USD,"-0,75",USD,"4,25",',
    '01-03-2026,07:30,01-03-2026,EXAMPLE CORP,US0000000001,Dividend,,USD,"5,00",USD,"5,00",',
    '15-02-2026,07:30,15-02-2026,EXAMPLE CORP,US0000000002,"PRODUCTWIJZIGING : Koop 10 @ 50 USD",,USD,"0,00",USD,"0,00",',
    '15-02-2026,07:30,15-02-2026,EXAMPLE CORP OLD,US0000000001,"PRODUCTWIJZIGING : Verkoop 10 @ 50 USD",,USD,"0,00",USD,"0,00",',
    '10-01-2026,10:00,12-01-2026,EXAMPLE CORP OLD,US0000000001,Koop 10 @ 50 USD,,USD,"-500,00",USD,"-500,00",order-1',
    '10-01-2026,10:00,12-01-2026,EXAMPLE CORP OLD,US0000000001,DEGIRO Transactiekosten en/of kosten van derden,,EUR,"-2,00",EUR,"598,00",order-1',
    '09-01-2026,08:00,09-01-2026,EXAMPLE CORP OLD,US0000000001,Transactiebelasting,,EUR,"-1,40",EUR,"600,00",',
    '05-01-2026,09:00,05-01-2026,,,iDEAL storting,,EUR,"1000,00",EUR,"1000,00",',
    '05-01-2026,09:00,05-01-2026,,,Valuta Debitering,"1,2500",EUR,"-400,00",EUR,"1000,00",',
  ].join('\n')

  it('reads trades, fees, corporate actions, dividends and cash movements on its own', () => {
    const result = importTables(readCsv('Account.csv', account), { context: RATES })
    expect(result.broker).toBe('DEGIRO')
    expect(result.issues.filter((i) => i.severity !== 'info')).toEqual([])
    const types = result.transactions.map((t) => t.type)
    expect(types).toEqual(['deposit', 'tax', 'buy', 'split', 'dividend', 'tax', 'withdrawal'])
    expect(result.transactions.find((t) => t.type === 'buy')).toMatchObject({ quantity: 10, amountEur: -400, costsEur: 2, orderId: 'order-1' })
    expect(result.transactions.find((t) => t.type === 'split')?.split).toEqual({ ratio: 1, fromQuantity: 10, fromIsin: 'US0000000001' })
    expect(result.transactions.find((t) => t.type === 'dividend')).toMatchObject({ amountEur: 4, isin: 'US0000000001' })
    expect(result.capabilities).toMatchObject({ dividends: true, deposits: true, taxes: true, fxCosts: false })
    expect(finalHoldings(result.transactions)).toEqual([{ isin: 'US0000000002', product: 'EXAMPLE CORP', quantity: 10 }])
  })

  it('takes only what the Transactions export lacks when both are imported', () => {
    const result = importTables([table(SAMPLE_ROWS), ...readCsv('Account.csv', account)], { context: RATES })
    const fromAccount = result.transactions.filter((t) => t.source.file === 'Account.csv')
    expect(fromAccount.map((t) => t.type)).toEqual(['deposit', 'tax', 'dividend', 'tax', 'withdrawal'])
    expect(result.capabilities).toMatchObject({ dividends: true, deposits: true, taxes: true, fxCosts: true })
  })

  it('reads English and Portuguese statements with the older trade descriptions', () => {
    const english = [
      'Date,Time,Value date,Product,ISIN,Description,FX,Change,,Balance,,Order Id',
      '06-11-2023,15:33,06-11-2023,EXAMPLE INC,US0000000003,Buy 5 Example Inc@21.31 USD (US0000000003),,USD,-106.55,USD,0,order-2',
    ].join('\n')
    const portuguese = [
      'Data,Hora,Data Valor,Produto,ISIN,Descrição,T.,Mudança,,Saldo,,ID da Ordem',
      '06-11-2023,15:33,06-11-2023,EXAMPLE INC,US0000000003,"Compra 1 EXAMPLE INC@77,3 EUR (US0000000003)",,EUR,"-77,30",EUR,"0,00",order-3',
    ].join('\n')
    expect(importTables(readCsv('en.csv', english), { context: RATES }).transactions[0]).toMatchObject({ type: 'buy', quantity: 5, price: 21.31 })
    expect(importTables(readCsv('pt.csv', portuguese), { context: RATES }).transactions[0]).toMatchObject({ type: 'buy', quantity: 1, amountEur: -77.3 })
  })
})
