import { describe, expect, it } from 'vitest'
import { parseIsharesHoldings, serializeIndexWeights } from './holdings.ts'

// The layout of the iShares "Download holdings" CSV, with made-up numbers.
const SAMPLE = [
  '﻿Fund Holdings as of,"29/Oct/2026"',
  ' ',
  'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Market Currency',
  '"AAPL","APPLE","Information Technology","Equity","500.00","50.00","500.00","2.00","250.00","United States","NASDAQ","USD"',
  '"ASML","ASML HOLDING","Information Technology","Equity","300.00","30.00","300.00","1.00","300.00","Netherlands","Euronext Amsterdam","EUR"',
  '"BRK B","BERKSHIRE HATHAWAY INC CLASS B","Financials","Equity","1,50.00","15.00","150.00","1.00","150.00","United States","New York Stock Exchange Inc.","USD"',
  '"USD","USD CASH","Cash and/or Derivatives","Cash","50.00","5.00","50.00","50.00","1.00","United States","-","USD"',
  '"ESZ6","S&P500 EMINI DEC 26","Cash and/or Derivatives","Futures","0.00","0.00","9,999.00","1.00","1.00","-","Index And Options Market","USD"',
  '"XYZ","UNKNOWN LAND, INC.","Industrials","Equity","0.00","0.00","0.00","0.00","0.00","Atlantis","-","USD"',
  '',
  '"The content contained herein is owned or licensed by BlackRock"',
].join('\r\n')

describe('parseIsharesHoldings', () => {
  const file = parseIsharesHoldings(SAMPLE, 'iShares')

  it('reads the date and keeps equities with a weight, largest first', () => {
    expect(file.asOf).toBe('2026-10-29')
    expect(file.holdings.map((h) => h.ticker)).toEqual(['AAPL', 'ASML', 'BRK B'])
  })

  it('weighs by market value over the total of every row, cash included', () => {
    // 500 / (500 + 300 + 150 + 50) = 0.5
    expect(file.holdings[0]).toEqual({ ticker: 'AAPL', name: 'APPLE', country: 'US', weight: 0.5 })
    expect(file.holdings[1]?.country).toBe('NL')
    expect(file.holdings[2]?.weight).toBe(0.15)
  })

  it('refuses a page that is no holdings file', () => {
    expect(() => parseIsharesHoldings('<!doctype html><html></html>', 'iShares')).toThrow(/date/)
  })

  it('writes one holding per line', () => {
    const text = serializeIndexWeights(file)
    expect(text.split('\n')[4]).toBe('    {"ticker":"AAPL","name":"APPLE","country":"US","weight":0.5},')
    expect(JSON.parse(text)).toEqual(file)
  })
})

describe('countries', () => {
  it('knows the names iShares writes differently, such as Hong Kong', () => {
    const csv = [
      'Fund Holdings as of,"29/Oct/2026"',
      'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Market Currency',
      '"1299","AIA GROUP LTD","Financials","Equity","10.00","100.00","10.00","1.00","10.00","Hong Kong","Hong Kong Exchanges And Clearing Ltd","HKD"',
    ].join('\n')
    expect(parseIsharesHoldings(csv, 'iShares').holdings[0]?.country).toBe('HK')
  })
})
