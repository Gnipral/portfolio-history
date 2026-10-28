import type { Position } from '../../engine/positions.ts'
import type { DailyPoint } from '../../engine/series.ts'
import type { BenchmarkLine } from '../dashboard/benchmarkLines.ts'
import type { Slice } from '../dashboard/allocation.ts'
import { formatDate, formatPercent } from '../format.ts'

/** Where people who see a shared card can try the app. */
export const PUBLIC_URL = 'https://gnipral.github.io/portfolio-history/'

/** Points in a shared curve: enough for its shape, too few to rebuild daily values from. */
const CURVE_POINTS = 120

/**
 * What a shared card shows. Only percentages, dates and, when chosen, the names of the positions:
 * never amounts or quantities, so it can be posted anywhere without telling how much someone owns.
 */
export interface ShareCard {
  from: string
  to: string
  /** Time-weighted return over the period. */
  twr: number
  /** Time-weighted return since `from`, in percent, rounded to 0.1. */
  curve: number[]
  benchmark?: { label: string; twr: number; curve: number[] } | undefined
  /** Share of the value per type of asset, in whole percent. */
  allocation: { label: string; percent: number; slot: number }[]
  /** The open positions, largest first, when chosen: weight in whole percent, return rounded to 0.1 %. */
  positions: SharedPosition[]
}

export interface SharedPosition {
  name: string
  /** Share of the value of the positions, in whole percent. */
  weight: number
  /** Unrealized return on the cost basis, as a fraction. */
  return: number
}

/** A short name: the ticker without its exchange when known, else the product name. */
function shortName(position: Position): string {
  const ticker = position.symbol && !position.symbol.includes(':') ? position.symbol.split('.')[0] : undefined
  if (ticker) return ticker
  return position.product.length > 28 ? `${position.product.slice(0, 27).trimEnd()}…` : position.product
}

function sharedPositions(positions: Position[]): SharedPosition[] {
  const open = positions.filter((p) => p.value > 0)
  const total = open.reduce((sum, p) => sum + p.value, 0)
  if (total <= 0) return []
  return open
    .sort((a, b) => b.value - a.value)
    .map((p) => ({ name: shortName(p), weight: Math.round((p.value / total) * 100), return: Math.round(p.pnlPercent * 1000) / 1000 }))
}

interface ReturnPoint {
  twr: number
}

/**
 * Rebased returns from `from` to `to`, thinned out evenly. Starts at 0 on the day before the
 * period (its base), and always keeps the last day.
 */
function curve(points: ReturnPoint[], from: number, to: number): number[] {
  const base = 1 + (from > 0 ? (points[from - 1]?.twr ?? 0) : 0)
  const start = Math.max(from - 1, 0)
  const count = to - start + 1
  const step = Math.max(1, (count - 1) / (CURVE_POINTS - 1))
  const result: number[] = []
  for (let i = 0; i < count; i += step) result.push(Math.round(i) + start)
  if (result.at(-1) !== to) result.push(to)
  return [...new Set(result)].map((index) => Math.round(((1 + (points[index]?.twr ?? 0)) / base - 1) * 1000) / 10)
}

function periodReturn(points: ReturnPoint[], from: number, to: number): number {
  const base = 1 + (from > 0 ? (points[from - 1]?.twr ?? 0) : 0)
  return (1 + (points[to]?.twr ?? 0)) / base - 1
}

/** The card for the days `from`–`to`, compared with the first benchmark line when given. */
export function shareCard(
  points: DailyPoint[],
  from: number,
  to: number,
  benchmark: BenchmarkLine | undefined,
  slices: Slice[],
  positions: Position[] = [],
): ShareCard {
  return {
    from: points[from]?.date ?? '',
    to: points[to]?.date ?? '',
    twr: periodReturn(points, from, to),
    curve: curve(points, from, to),
    benchmark: benchmark && {
      label: benchmark.label,
      twr: periodReturn(benchmark.points, from, to),
      curve: curve(benchmark.points, from, to),
    },
    allocation: slices.map((s) => ({ label: s.label, percent: Math.round(s.share * 100), slot: s.slot })).filter((s) => s.percent > 0),
    positions: sharedPositions(positions),
  }
}

/** The text that goes with a shared card, ready to paste under a post. */
export function shareText(card: ShareCard): string {
  const vs = card.benchmark ? ` (${card.benchmark.label}: ${formatPercent(card.benchmark.twr)})` : ''
  return (
    `My portfolio from ${formatDate(card.from)} to ${formatDate(card.to)}: ${formatPercent(card.twr)} time-weighted${vs}.\n` +
    `Made with Portfolio History: free, no account needed, and your data stays on your device. ${PUBLIC_URL}`
  )
}
