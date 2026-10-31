import type { BenchmarkPoint } from '../../engine/benchmark.ts'
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
  /** Per benchmark, bought with the same money: value (EUR) or its return from the first visible day (percent). */
  benchmarks: LinePoint[][]
}

/**
 * Chart lines for the days `from` to `to`. In percent mode the time-weighted return starts at 0 on the day
 * `base` (the first visible day, `from` unless given), so a 1M window shows the return of that month. The
 * simple return is measured since the first transaction and cannot be rebased, so it is not drawn in percent.
 */
export function chartData(
  points: DailyPoint[],
  from: number,
  to: number,
  mode: ChartMode,
  benchmarkLines: BenchmarkPoint[][] = [],
  base: number = from,
): ChartData {
  const visible = points.slice(from, to + 1)
  if (mode === 'eur') {
    return {
      benchmarks: benchmarkLines.map((line) => line.slice(from, to + 1).map((p) => ({ time: p.date, value: round(p.value) }))),
      main: visible.map((p) => ({ time: p.date, value: round(p.value) })),
      secondary: visible.map((p) => ({ time: p.date, value: round(p.invested) })),
      pnl: visible.map((p) => ({ time: p.date, value: round(p.pnl) })),
    }
  }
  const start = 1 + (base > 0 ? (points[base - 1]?.twr ?? 0) : 0)
  return {
    benchmarks: benchmarkLines.map((line) => {
      const lineBase = 1 + (base > 0 ? (line[base - 1]?.twr ?? 0) : 0)
      return line.slice(from, to + 1).map((p) => ({ time: p.date, value: round(((1 + p.twr) / lineBase - 1) * 100) }))
    }),
    main: visible.map((p) => ({ time: p.date, value: round(((1 + p.twr) / start - 1) * 100) })),
    // No invested line in percent: the simple return moves with deposits, and the percentages show prices only.
    secondary: [],
    pnl: [],
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
