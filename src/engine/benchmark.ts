import type { PriceSeries } from '../market/priceCache.ts'

interface FlowPoint {
  date: string
  inflow: number
  outflow: number
}

export interface BenchmarkPoint {
  date: string
  /** Value of the benchmark position bought with the same money, in EUR. */
  value: number
  /** value + money taken out - money put in, as for the portfolio. */
  pnl: number
  /** Price return of the benchmark since the first day: its time-weighted return. */
  twr: number
}

/**
 * "What if every euro had gone into the benchmark instead": the portfolio's inflows buy units of the
 * benchmark on the same day, its outflows sell them. Prices must be in EUR. Money that arrives
 * before the first benchmark price is invested at that first price. When more is taken out than the
 * benchmark position is worth, the position is sold out and the rest counts as profit already taken.
 */
export function simulateBenchmark(days: FlowPoint[], prices: PriceSeries): BenchmarkPoint[] {
  const points: BenchmarkPoint[] = []
  let units = 0
  let pending = 0
  let paidIn = 0
  let takenOut = 0
  let firstPrice: number | undefined

  for (const day of days) {
    paidIn += day.inflow
    takenOut += day.outflow
    const price = prices.closeOn(day.date)?.close
    if (price === undefined || price <= 0) {
      pending += day.inflow - day.outflow
      points.push({ date: day.date, value: Math.max(pending, 0), pnl: Math.max(pending, 0) + takenOut - paidIn, twr: 0 })
      continue
    }
    firstPrice ??= price
    units += (pending + day.inflow) / price
    pending = 0
    units = Math.max(0, units - day.outflow / price)
    const value = units * price
    points.push({ date: day.date, value, pnl: value + takenOut - paidIn, twr: price / firstPrice - 1 })
  }
  return points
}
