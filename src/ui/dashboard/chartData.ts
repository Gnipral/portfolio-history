import type { DailyPoint } from '../../engine/series.ts'

export type ChartMode = 'eur' | 'percent'

export interface LinePoint {
  time: string
  value: number
}

export interface ChartData {
  /** Main line: portfolio value (EUR) or time-weighted return (percent). */
  main: LinePoint[]
  /** Secondary line: invested capital (EUR) or simple return (percent, only for the full history). */
  secondary: LinePoint[]
  /** Lower pane: profit/loss in EUR; empty in percent mode. */
  pnl: LinePoint[]
}

/**
 * Chart lines for the visible days. In percent mode the time-weighted return starts at 0 on the
 * first visible day, so a 1M range shows the return of that month. The simple return is measured
 * since the first transaction and cannot be rebased, so it is only shown for the full history.
 */
export function chartData(points: DailyPoint[], from: number, to: number, mode: ChartMode): ChartData {
  const visible = points.slice(from, to + 1)
  if (mode === 'eur') {
    return {
      main: visible.map((p) => ({ time: p.date, value: round(p.value) })),
      secondary: visible.map((p) => ({ time: p.date, value: round(p.invested) })),
      pnl: visible.map((p) => ({ time: p.date, value: round(p.pnl) })),
    }
  }
  const base = 1 + (from > 0 ? (points[from - 1]?.twr ?? 0) : 0)
  return {
    main: visible.map((p) => ({ time: p.date, value: round(((1 + p.twr) / base - 1) * 100) })),
    secondary: from === 0 ? visible.map((p) => ({ time: p.date, value: round(p.simpleReturn * 100) })) : [],
    pnl: [],
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
