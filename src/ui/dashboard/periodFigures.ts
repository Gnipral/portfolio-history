import type { BenchmarkPoint } from '../../engine/benchmark.ts'
import { mwr, type CashFlow } from '../../engine/returns.ts'
import type { DailyPoint } from '../../engine/series.ts'
import { rangeChange } from './timeRange.ts'

/** A money-weighted return over a period: per year once the period is a year long, else over the period itself. */
export interface PeriodMwr {
  value: number
  annual: boolean
  days: number
}

/** What the figures row and the side panel show: the period from `from` up to the day `to`. */
export interface PeriodFigures {
  /** Value and invested capital on the last day. */
  value: number
  invested: number
  /** Profit made in the period, and as a share of the highest invested capital so far. */
  pnl: number
  pnlPercent: number
  twr: number
  mwr?: PeriodMwr
  /** The same money in the benchmark: its value on the last day, and its profit and return in the period. */
  benchmark?: { value: number; pnl: number; twr: number }
  /** Profit and time-weighted return above the benchmark in the period. */
  alpha?: { pnl: number; twr: number }
}

const YEAR = 365

/**
 * Money-weighted return over days `from`..`to`: the value the day before counts as money put in at the start,
 * the value on the last day as taken out. Annualized from a year on; before that a yearly rate from a few weeks
 * means nothing, so the return over the period is given.
 */
export function periodMwr(points: Pick<DailyPoint, 'date' | 'value' | 'inflow' | 'outflow'>[], from: number, to: number): PeriodMwr | undefined {
  const start = points[from]
  const end = points[to]
  if (!start || !end) return undefined
  const flows: CashFlow[] = []
  const before = from > 0 ? (points[from - 1]?.value ?? 0) : 0
  if (before) flows.push({ date: start.date, amount: -before })
  for (let i = from; i <= to; i++) {
    const day = points[i]
    if (!day) continue
    if (day.inflow) flows.push({ date: day.date, amount: -day.inflow })
    if (day.outflow) flows.push({ date: day.date, amount: day.outflow })
  }
  flows.push({ date: end.date, amount: end.value })
  const result = mwr(flows)
  if (!result) return undefined
  if (result.spanDays < YEAR) return { value: result.period, annual: false, days: result.spanDays }
  const annual = (1 + result.period) ** (YEAR / result.spanDays) - 1
  return Number.isFinite(annual) ? { value: annual, annual: true, days: result.spanDays } : undefined
}

export function periodFigures(points: DailyPoint[], from: number, to: number, benchmark?: BenchmarkPoint[]): PeriodFigures | undefined {
  const end = points[to]
  if (!end) return undefined
  const change = rangeChange(points, from, to)
  const mwrResult = periodMwr(points, from, to)
  const figures: PeriodFigures = {
    value: end.value,
    invested: end.invested,
    pnl: change.pnl,
    pnlPercent: end.capitalBase > 0 ? change.pnl / end.capitalBase : 0,
    twr: change.twr,
    ...(mwrResult ? { mwr: mwrResult } : {}),
  }
  const last = benchmark?.[to]
  if (!benchmark || !last) return figures
  const same = rangeChange(benchmark, from, to)
  return {
    ...figures,
    benchmark: { value: last.value, pnl: same.pnl, twr: same.twr },
    alpha: { pnl: change.pnl - same.pnl, twr: change.twr - same.twr },
  }
}
