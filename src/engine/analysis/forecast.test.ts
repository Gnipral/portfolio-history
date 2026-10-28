import { describe, expect, it } from 'vitest'
import { tx } from '../testing.ts'
import { dividendForecast } from './forecast.ts'

const A = 'NL0000000001'
const B = 'NL0000000002'
const today = '2026-03-01'

const transactions = [
  tx('buy', '2025-01-10', { isin: A, quantity: 10, price: 50, amount: 500 }),
  tx('buy', '2025-01-10', { isin: B, quantity: 5, price: 20, amount: 100 }),
  // 1 euro a share, with 30 % withholding tax on its own row.
  tx('dividend', '2025-06-15', { isin: A, amount: 10 }),
  tx('tax', '2025-06-15', { isin: A, amount: 3 }),
  tx('dividend', '2025-07-01', { isin: B, amount: 5 }),
  // 1.20 a share, no tax.
  tx('dividend', '2025-12-15', { isin: A, amount: 12 }),
  tx('buy', '2026-02-01', { isin: A, quantity: 10, price: 55, amount: 550 }),
  tx('sell', '2026-02-10', { isin: B, quantity: 5, price: 22, amount: 110 }),
  // Older than a year: not part of the estimate.
  tx('dividend', '2025-02-01', { isin: A, amount: 50 }),
]

describe('dividendForecast', () => {
  const forecast = dividendForecast(transactions, today)

  it("repeats last year's dividend per share on the shares held today, a year later", () => {
    expect(forecast.payments).toEqual([
      expect.objectContaining({ date: '2026-06-15', key: A, perShare: 1, gross: 20, net: 14 }),
      expect.objectContaining({ date: '2026-12-15', key: A, perShare: 1.2, gross: 24, net: 24 }),
    ])
    expect(forecast.gross).toBeCloseTo(44)
    expect(forecast.net).toBeCloseTo(38)
  })

  it('leaves out positions sold since', () => {
    expect(forecast.positions.map((p) => p.key)).toEqual([A])
    expect(forecast.positions[0]).toMatchObject({ payments: 2, next: '2026-06-15', isin: A })
  })

  it('spreads the payments over the months up to a year from today', () => {
    expect(forecast.months[0]?.month).toBe('2026-03')
    expect(forecast.months.at(-1)?.month).toBe('2027-03')
    expect(forecast.months.find((m) => m.month === '2026-06')).toMatchObject({ gross: 20, net: 14 })
    expect(forecast.months.filter((m) => m.gross > 0)).toHaveLength(2)
  })

  it('expects nothing without dividends in the last year', () => {
    expect(dividendForecast(transactions.slice(0, 2), today)).toMatchObject({ payments: [], gross: 0, net: 0, positions: [] })
  })
})
