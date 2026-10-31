import { describe, expect, it } from 'vitest'
import { FxRates } from '../market/fx.ts'
import { PriceSeries } from '../market/priceCache.ts'
import { checkData, problemCount } from './dataCheck.ts'
import { DEFAULT_OPTIONS } from './options.ts'
import { PriceBook } from './priceBook.ts'
import { tx } from './testing.ts'

const A = 'XA0000000001'
const B = 'XB0000000002'
const C = 'XC0000000003'
const TODAY = '2026-03-10'

/** Closes per ISIN; an ISIN in `symbols` without closes has a symbol but no price. */
function book(closes: Record<string, [string, number][]>, symbols: string[] = Object.keys(closes)) {
  return new PriceBook({
    symbols: new Map(symbols.map((isin) => [isin, `S${isin}`])),
    series: new Map(
      Object.entries(closes).map(([isin, points]) => [`S${isin}`, PriceSeries.fromPoints(`S${isin}`, points.map(([date, close]) => ({ symbol: `S${isin}`, date, close })))]),
    ),
    currencies: new Map(symbols.map((isin) => [`S${isin}`, 'EUR'])),
    splits: new Map(),
    fx: new FxRates([]),
  })
}

const buy = (isin: string, date: string, quantity: number, amount: number, file = 'export.csv') =>
  tx('buy', date, { isin, quantity, amount, source: { broker: 'test', file, row: 1 } })

const check = (transactions: ReturnType<typeof tx>[], prices: PriceBook) =>
  checkData({ transactions, prices, options: DEFAULT_OPTIONS, issues: [], today: TODAY })

describe('checkData', () => {
  it('finds nothing to look at in clean data', () => {
    const result = check([buy(A, '2026-03-02', 10, 1000)], book({ [A]: [['2026-03-02', 100], [TODAY, 110]] }))
    expect(problemCount(result)).toBe(0)
  })

  it('names products without a symbol, without a market price and with an old price', () => {
    const result = check(
      [buy(A, '2026-01-02', 1, 100), buy(B, '2026-01-02', 1, 100), buy(C, '2026-01-02', 1, 100)],
      book({ [B]: [['2026-01-02', 100], ['2026-02-20', 90]] }, [B, C]),
    )
    expect(result.noSymbol.map((f) => f.key)).toEqual([A])
    expect(result.noMarketPrice.map((f) => f.key)).toEqual([C])
    expect(result.stalePrices).toEqual([{ key: B, product: B, priceDate: '2026-02-20' }])
  })

  it('reports trades that do not match the close of their day, and recognizes a split', () => {
    // Bought at 400 a share while the source says 100: a 4:1 split the export does not know.
    const result = check(
      [buy(A, '2026-03-02', 10, 4000), buy(A, '2026-03-03', 10, 4040)],
      book({ [A]: [['2026-03-02', 100], ['2026-03-03', 101], [TODAY, 102]] }),
    )
    expect(result.pricesNotMatchingTrades).toEqual([
      expect.objectContaining({ key: A, checked: 2, mismatched: 2, splitRatio: 4, tradePrice: 400, marketPrice: 100 }),
    ])
  })

  it('leaves a trade alone that is close to the close, and one without a close that day', () => {
    const result = check(
      [buy(A, '2026-03-02', 10, 1100), buy(A, '2026-03-04', 10, 5000)],
      book({ [A]: [['2026-03-02', 100], [TODAY, 100]] }),
    )
    expect(result.pricesNotMatchingTrades).toEqual([])
  })

  it('flags the same transaction in two files, but not two identical rows of one file', () => {
    const result = check(
      [
        buy(A, '2026-03-02', 10, 1000, 'statement.pdf'),
        buy(A, '2026-03-02', 10, 1000, 'export.csv'),
        buy(B, '2026-03-02', 5, 500, 'export.csv'),
        buy(B, '2026-03-02', 5, 500, 'export.csv'),
      ],
      book({ [A]: [['2026-03-02', 100], [TODAY, 100]], [B]: [['2026-03-02', 100], [TODAY, 100]] }),
    )
    expect(result.possibleDuplicates).toEqual([{ key: A, product: A, date: '2026-03-02', type: 'buy', files: ['statement.pdf', 'export.csv'] }])
  })

  it('splits ledger issues into missing history and the rest', () => {
    const result = checkData({
      transactions: [],
      prices: book({}),
      options: DEFAULT_OPTIONS,
      issues: [
        { date: '2026-01-05', message: 'Sold without a purchase', missingHistory: 'Apple' },
        { date: '2026-01-06', message: 'Sold without a purchase', missingHistory: 'Apple' },
        { date: '2026-02-01', message: 'Something else' },
      ],
      today: TODAY,
    })
    expect(result.missingHistory).toEqual([{ key: 'Apple', product: 'Apple' }])
    expect(result.ledgerIssues).toEqual([{ date: '2026-02-01', message: 'Something else' }])
    expect(problemCount(result)).toBe(2)
  })
})
