import type { Position } from '../../engine/positions.ts'
import { indexOfDate, rangeChange } from './timeRange.ts'

interface ProfitPoint {
  date: string
  pnl: number
  twr: number
}

export interface PeriodProfit {
  key: 'day' | 'month' | 'year' | 'start'
  /** First day of the period. */
  from: string
  /** Profit made in the period, in EUR. */
  pnl: number
  /** Time-weighted return of the period. */
  twr: number
}

/**
 * Profit on the selected day, in its month, in its year and since the first transaction. Every
 * period ends on the selected day and starts no earlier than the history.
 */
export function profitPeriods(points: ProfitPoint[], selected: number): PeriodProfit[] {
  const first = points[0]?.date
  const end = points[selected]?.date
  if (!first || !end) return []
  const start = (date: string) => Math.max(0, Math.min(selected, indexOfDate(first, date)))
  const periods: { key: PeriodProfit['key']; from: number }[] = [
    { key: 'day', from: selected },
    { key: 'month', from: start(`${end.slice(0, 7)}-01`) },
    { key: 'year', from: start(`${end.slice(0, 4)}-01-01`) },
    { key: 'start', from: 0 },
  ]
  return periods.map(({ key, from }) => ({ key, from: points[from]!.date, ...rangeChange(points, from, selected) }))
}

/** The open positions with the best and the worst return on their cost. */
export function bestAndWorst(positions: Position[]): { best: Position; worst: Position } | null {
  const held = positions.filter((p) => p.value > 0 && p.costBasis > 0)
  if (held.length < 2) return null
  const sorted = [...held].sort((a, b) => b.pnlPercent - a.pnlPercent)
  return { best: sorted[0]!, worst: sorted.at(-1)! }
}
