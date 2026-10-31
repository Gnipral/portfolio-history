import { instrumentKey } from '../../market/instruments.ts'
import type { AssetClass, Transaction } from '../../model/transaction.ts'
import type { EngineOptions } from '../options.ts'
import type { PriceBook } from '../priceBook.ts'
import { positionSeries, type PositionPoint } from './positionSeries.ts'
import type { Window } from './performance.ts'

/** What each position added to the result and to the return of the period. */

interface PortfolioDay {
  date: string
  /** Portfolio value at the end of the day. */
  value: number
  inflow: number
  /** Time-weighted return since the first transaction. */
  twr: number
}

export interface Contribution {
  key: string
  product: string
  isin?: string
  assetClass: AssetClass
  /** Result of the position in the period, in the base currency. */
  pnl: number
  /** Share of the securities on the last day of the period, 0 to 1; 0 when no longer held. */
  weight: number
  /** Result over what was at stake: the value at the start of the period plus the money put in during it. */
  return?: number
  /** Σ previous day's weight × the day's return, linked with Carino's factors, in basis points of the portfolio. */
  contributionBps: number
}

export interface ContributionResult {
  positions: Contribution[]
  /** The sum of the contributions, in basis points. */
  totalBps: number
  /**
   * The portfolio's TWR over the period, in basis points. The linked contributions add up to it, except for
   * what belongs to no position (interest, fees on cash), so the sum can differ slightly from this: worth
   * a footnote.
   */
  twrBps: number
}

/** Below one cent the base of a day is a rounding residue, as in the TWR itself. */
const MIN_BASE = 0.01

/**
 * The instruments ever held, each with the ISIN a corporate action turned into it folded in, as the
 * position chart does.
 */
function heldKeys(transactions: Transaction[]): Map<string, Transaction> {
  const absorbed = new Set(transactions.filter((t) => t.type === 'split' && t.split?.fromIsin).map((t) => t.split?.fromIsin as string))
  const latest = new Map<string, Transaction>()
  for (const t of [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))) {
    if (t.type !== 'buy' && t.type !== 'transferIn' && t.type !== 'sell') continue
    const key = instrumentKey(t)
    if (!absorbed.has(key)) latest.set(key, t)
  }
  return latest
}

/** ln(1 + r) / r, the Carino factor; 1 for a return of zero, where the limit is 1. */
function carino(r: number): number {
  return Math.abs(r) < 1e-12 ? 1 : Math.log1p(r) / r
}

/**
 * Carino's link per day of the window: a day's contribution times this factor makes the parts add up to
 * the compounded return of the period, instead of to the plain sum of the daily returns.
 */
function linkFactors(days: PortfolioDay[], window: Window): Map<string, number> {
  const before = window.from > 0 ? days[window.from - 1] : undefined
  const last = days[window.to] as PortfolioDay
  const total = carino((1 + last.twr) / (1 + (before?.twr ?? 0)) - 1)
  const factors = new Map<string, number>()
  for (let i = window.from; i <= window.to; i++) {
    const day = days[i] as PortfolioDay
    const previous = i > 0 ? (days[i - 1] as PortfolioDay).twr : 0
    factors.set(day.date, carino((1 + day.twr) / (1 + previous) - 1) / total)
  }
  return factors
}

/**
 * The contribution of every position to the period. A position's result per day is the change of its
 * own result (see `positionSeries`); its contribution to the return divides that by the portfolio's
 * base of the day: the value of the evening before plus the money that came in, as in the TWR.
 */
export function contributions(
  transactions: Transaction[],
  prices: PriceBook,
  options: EngineOptions,
  days: PortfolioDay[],
  window: Window,
  today: string,
): ContributionResult {
  const first = days[window.from]
  const last = days[window.to]
  const before = window.from > 0 ? days[window.from - 1] : undefined
  if (!first || !last) return { positions: [], totalBps: 0, twrBps: 0 }

  const bases = new Map<string, number>()
  for (let i = window.from; i <= window.to; i++) {
    const day = days[i] as PortfolioDay
    bases.set(day.date, (i > 0 ? (days[i - 1] as PortfolioDay).value : 0) + day.inflow)
  }

  const factors = linkFactors(days, window)
  const positions: Contribution[] = []
  for (const [key, t] of heldKeys(transactions)) {
    const byDate = new Map<string, PositionPoint>(positionSeries(transactions, prices, options, key, today).points.map((p) => [p.date, p]))
    const pnlOn = (date: string | undefined) => (date ? (byDate.get(date)?.pnl ?? 0) : 0)
    let contribution = 0
    let previousPnl = pnlOn(before?.date)
    let putIn = 0
    for (let i = window.from; i <= window.to; i++) {
      const date = (days[i] as PortfolioDay).date
      const point = byDate.get(date)
      const pnl = point?.pnl ?? previousPnl
      const base = bases.get(date) ?? 0
      if (base > MIN_BASE) contribution += ((pnl - previousPnl) / base) * (factors.get(date) ?? 1)
      putIn += point?.inflow ?? 0
      previousPnl = pnl
    }
    const pnl = pnlOn(last.date) - pnlOn(before?.date)
    const startValue = before ? (byDate.get(before.date)?.value ?? 0) : 0
    const atStake = startValue + putIn
    const endValue = byDate.get(last.date)?.value ?? 0
    // A position not held during the period has nothing to show.
    if (atStake === 0 && pnl === 0 && endValue === 0) continue
    positions.push({
      key,
      product: t.product,
      ...(t.isin ? { isin: t.isin } : {}),
      assetClass: t.assetClass,
      pnl,
      weight: endValue,
      ...(atStake > 0 ? { return: pnl / atStake } : {}),
      contributionBps: contribution * 10_000,
    })
  }

  const securities = positions.reduce((sum, p) => sum + Math.max(0, p.weight), 0)
  for (const p of positions) p.weight = securities > 0 ? Math.max(0, p.weight) / securities : 0
  const twr = (1 + last.twr) / (1 + (before?.twr ?? 0)) - 1
  return {
    positions: positions.sort((a, b) => b.pnl - a.pnl),
    totalBps: positions.reduce((sum, p) => sum + p.contributionBps, 0),
    twrBps: twr * 10_000,
  }
}

/** The three positions that added most and the three that added least in money, best and worst first. */
export function topAndBottom(positions: Contribution[], count = 3): { top: Contribution[]; bottom: Contribution[] } {
  const sorted = [...positions].sort((a, b) => b.pnl - a.pnl)
  const top = sorted.slice(0, count)
  // The worst ones, worst first, without repeating a position that is already among the best.
  const bottom = sorted.slice(Math.max(count, sorted.length - count)).reverse()
  return { top, bottom }
}
