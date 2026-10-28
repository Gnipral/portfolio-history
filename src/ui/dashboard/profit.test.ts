import { describe, expect, it } from 'vitest'
import type { Position } from '../../engine/positions.ts'
import { addDays } from '../../market/dates.ts'
import { bestAndWorst, profitPeriods } from './profit.ts'

// One point per day from 20 Dec 2025: 10 euros profit and 0.1 % more return every day.
const points = Array.from({ length: 60 }, (_, i) => ({ date: addDays('2025-12-20', i), pnl: i * 10, twr: i / 1000 }))
const at = (date: string) => points.findIndex((p) => p.date === date)

describe('profitPeriods', () => {
  it('measures the day, the month, the year and the whole history up to the selected day', () => {
    const periods = profitPeriods(points, at('2026-02-10'))
    expect(periods.map((p) => [p.key, p.from, p.pnl])).toEqual([
      ['day', '2026-02-10', 10],
      ['month', '2026-02-01', 100],
      ['year', '2026-01-01', 410],
      ['start', '2025-12-20', 520],
    ])
    expect(periods[1]!.twr).toBeCloseTo(1.052 / 1.042 - 1)
  })

  it('starts a period no earlier than the history', () => {
    const periods = profitPeriods(points, at('2025-12-25'))
    expect(periods.find((p) => p.key === 'month')).toMatchObject({ from: '2025-12-20', pnl: 50 })
    expect(periods.find((p) => p.key === 'year')).toMatchObject({ from: '2025-12-20', pnl: 50 })
  })

  it('is empty without history', () => {
    expect(profitPeriods([], 0)).toEqual([])
  })
})

describe('bestAndWorst', () => {
  const position = (product: string, value: number, cost: number): Position => ({
    key: product,
    product,
    quantity: 1,
    averageCost: cost,
    costBasis: cost,
    stale: false,
    value,
    pnl: value - cost,
    pnlPercent: (value - cost) / cost,
  })

  it('finds the best and the worst return on cost', () => {
    const result = bestAndWorst([position('A', 120, 100), position('B', 80, 100), position('C', 300, 100)])
    expect(result?.best.product).toBe('C')
    expect(result?.worst.product).toBe('B')
  })

  it('needs two positions to compare', () => {
    expect(bestAndWorst([position('A', 120, 100)])).toBeNull()
  })
})
