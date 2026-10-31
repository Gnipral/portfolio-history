import { daysBetween } from '../../market/dates.ts'
import { t } from '../../i18n/i18n.ts'

export type RangeKey = 'WTD' | 'MTD' | '1M' | '3M' | 'YTD' | '1Y' | '5Y' | 'ALL'

export const RANGES: RangeKey[] = ['WTD', 'MTD', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL']

/** First date of a quick range ending at `lastDate`, never before `firstDate`. Weeks start on Monday. */
export function rangeStart(range: RangeKey, firstDate: string, lastDate: string): string {
  const last = new Date(`${lastDate}T00:00:00Z`)
  const months = (n: number) => {
    const date = new Date(last)
    date.setUTCMonth(date.getUTCMonth() - n)
    return date.toISOString().slice(0, 10)
  }
  const start = startOf(range, firstDate, lastDate, last, months)
  return start < firstDate ? firstDate : start
}

function startOf(range: RangeKey, firstDate: string, lastDate: string, last: Date, months: (n: number) => string): string {
  switch (range) {
    case 'WTD': {
      const monday = new Date(last)
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
      return monday.toISOString().slice(0, 10)
    }
    case 'MTD':
      return `${lastDate.slice(0, 7)}-01`
    case '1M':
      return months(1)
    case '3M':
      return months(3)
    case 'YTD':
      return `${lastDate.slice(0, 4)}-01-01`
    case '1Y':
      return months(12)
    case '5Y':
      return months(60)
    case 'ALL':
      return firstDate
  }
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

/** The days of a saved period, within the history; an open end runs up to the last day. */
export function periodRange(dates: { date: string }[], period: { from: string; to: string | null }): VisibleRange {
  const first = dates[0]?.date
  const lastIndex = dates.length - 1
  if (!first || lastIndex < 0) return { from: 0, to: -1 }
  const clamp = (index: number) => Math.max(0, Math.min(lastIndex, index))
  const from = clamp(indexOfDate(first, period.from))
  const to = period.to ? clamp(indexOfDate(first, period.to)) : lastIndex
  return { from: Math.min(from, to), to }
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

/** What a quick range covers, in words: for the summary under the chart and the tooltips of the buttons. */
export function rangeDescription(range: RangeKey): string {
  switch (range) {
    case 'WTD':
      return t('This week')
    case 'MTD':
      return t('This month')
    case 'YTD':
      return t('Year to date')
    case '1M':
      return t('Last month')
    case '3M':
      return t('Last 3 months')
    case '1Y':
      return t('Last year')
    case '5Y':
      return t('Last 5 years')
    case 'ALL':
      return t('Since the first transaction')
  }
}
