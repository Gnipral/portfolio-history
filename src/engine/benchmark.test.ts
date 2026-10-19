import { describe, expect, it } from 'vitest'
import { PriceSeries } from '../market/priceCache.ts'
import { simulateBenchmark } from './benchmark.ts'

const series = (closes: [string, number][]) =>
  PriceSeries.fromPoints('IWDA.AS', closes.map(([date, close]) => ({ symbol: 'IWDA.AS', date, close })))

const day = (date: string, inflow = 0, outflow = 0) => ({ date, inflow, outflow })

describe('simulateBenchmark', () => {
  const prices = series([
    ['2026-01-05', 100],
    ['2026-01-06', 110],
    ['2026-01-07', 120],
  ])

  it('buys the benchmark with the same money on the same days', () => {
    // 1000 at 100 = 10 units; 1100 more at 110 = 10 units; 20 units at 120 = 2400
    const points = simulateBenchmark([day('2026-01-05', 1000), day('2026-01-06', 1100), day('2026-01-07')], prices)
    expect(points.map((p) => p.value)).toEqual([1000, 2200, 2400])
    expect(points.at(-1)?.pnl).toBeCloseTo(300, 10)
    expect(points.at(-1)?.twr).toBeCloseTo(0.2, 12)
  })

  it('sells the same amount when the portfolio takes money out', () => {
    // 10 units; take out 550 at 110 = 5 units sold; 5 units at 120 = 600
    const points = simulateBenchmark([day('2026-01-05', 1000), day('2026-01-06', 0, 550), day('2026-01-07')], prices)
    expect(points.map((p) => p.value)).toEqual([1000, 550, 600])
    // 600 + 550 - 1000
    expect(points.at(-1)?.pnl).toBeCloseTo(150, 10)
  })

  it('never goes below zero when more is taken out than it is worth', () => {
    const points = simulateBenchmark([day('2026-01-05', 1000), day('2026-01-06', 0, 2000)], prices)
    expect(points.at(-1)?.value).toBe(0)
    expect(points.at(-1)?.pnl).toBe(1000)
  })

  it('invests money from before the first benchmark price at that price', () => {
    const points = simulateBenchmark([day('2026-01-04', 500), day('2026-01-05'), day('2026-01-06')], prices)
    expect(points.map((p) => p.value)).toEqual([500, 500, 550])
    expect(points[0]?.twr).toBe(0)
  })
})
