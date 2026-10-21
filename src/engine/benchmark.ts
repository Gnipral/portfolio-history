import type { PriceSeries } from '../market/priceCache.ts'
import { twrIndex } from './returns.ts'

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

export interface MixComponent {
  prices: PriceSeries
  /** Share of every euro, between 0 and 1; the shares add up to 1. */
  weight: number
}

/**
 * A mix of benchmarks: every inflow and outflow is split over the components by weight, and each
 * part is invested as `simulateBenchmark` does, without rebalancing afterwards. The time-weighted
 * return is chain-linked from the mix value and the flows.
 */
export function simulateMix(days: FlowPoint[], components: MixComponent[]): BenchmarkPoint[] {
  const parts = components.map((c) =>
    simulateBenchmark(
      days.map((d) => ({ date: d.date, inflow: d.inflow * c.weight, outflow: d.outflow * c.weight })),
      c.prices,
    ),
  )
  const values = days.map((_, i) => parts.reduce((sum, part) => sum + (part[i]?.value ?? 0), 0))
  const index = twrIndex(days.map((d, i) => ({ value: values[i] as number, inflow: d.inflow, outflow: d.outflow })))
  return days.map((d, i) => ({
    date: d.date,
    value: values[i] as number,
    pnl: parts.reduce((sum, part) => sum + (part[i]?.pnl ?? 0), 0),
    twr: (index[i] as number) - 1,
  }))
}
