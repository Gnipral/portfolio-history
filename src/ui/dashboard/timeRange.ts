import { daysBetween } from '../../market/dates.ts'

export type RangeKey = '1M' | '3M' | 'YTD' | '1Y' | 'ALL'

export const RANGES: RangeKey[] = ['1M', '3M', 'YTD', '1Y', 'ALL']

/** First date of a quick range ending at `lastDate`, never before `firstDate`. */
export function rangeStart(range: RangeKey, firstDate: string, lastDate: string): string {
  const months = (n: number) => {
    const date = new Date(`${lastDate}T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - n)
    return date.toISOString().slice(0, 10)
  }
  const start =
    range === '1M'
      ? months(1)
      : range === '3M'
        ? months(3)
        : range === 'YTD'
          ? `${lastDate.slice(0, 4)}-01-01`
          : range === '1Y'
            ? months(12)
            : firstDate
  return start < firstDate ? firstDate : start
}

/** Index of a date in a series with one point per calendar day starting at `firstDate`. */
export function indexOfDate(firstDate: string, date: string): number {
  return daysBetween(firstDate, date)
}

export interface VisibleRange {
  from: number
  to: number
}

export function visibleRange(dates: { date: string }[], range: RangeKey): VisibleRange {
  const first = dates[0]?.date
  const last = dates.at(-1)?.date
  if (!first || !last) return { from: 0, to: -1 }
  return { from: indexOfDate(first, rangeStart(range, first, last)), to: dates.length - 1 }
}

/** Keeps a selected index inside the visible range, defaulting to its end. */
export function clampIndex(index: number | null, range: VisibleRange): number {
  if (index === null || index > range.to) return range.to
  return Math.max(index, range.from)
}

interface RangePoint {
  pnl: number
  /** Time-weighted return since the first transaction. */
  twr: number
}

/** Change over a visible range: profit made and time-weighted return from its start up to `to`. */
export function rangeChange(points: RangePoint[], from: number, to: number): { pnl: number; twr: number } {
  const before = from > 0 ? points[from - 1] : undefined
  const end = points[to]
  if (!end) return { pnl: 0, twr: 0 }
  return { pnl: end.pnl - (before?.pnl ?? 0), twr: (1 + end.twr) / (1 + (before?.twr ?? 0)) - 1 }
}
