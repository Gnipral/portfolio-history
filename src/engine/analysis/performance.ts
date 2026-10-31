import { daysBetween } from '../../market/dates.ts'
import { irrBetween } from '../returns.ts'
import { riskSummary, type PeriodReturn } from './risk.ts'

/**
 * Return and risk measures over a period of the daily series. The portfolio and its benchmark are both
 * series of `{ date, twr }` with one point per calendar day (the benchmark lines are built on the same
 * days), so a period is a pair of indices into them, as on the dashboard.
 */

export interface IndexPoint {
  date: string
  /** Time-weighted return since the first point. */
  twr: number
}

/** First and last index of the period, both included: the return of day `from` counts. */
export interface Window {
  from: number
  to: number
}

export type AlphaMethod = 'arithmetic' | 'geometric'

export const TRADING_DAYS_PER_YEAR = 252

/** Below this many daily returns a standard deviation says little; the risk ratios are then left out. */
export const MIN_RETURNS = 20

const level = (point: IndexPoint) => 1 + point.twr

/** The level of the index just before the period starts: the base its return is measured from. */
function baseIndex(window: Window): number {
  return Math.max(0, window.from - 1)
}

/** Time-weighted return over the period: day `from` included, as `rangeChange` on the dashboard. */
export function periodTwr(points: IndexPoint[], window: Window): number {
  const start = window.from > 0 ? points[window.from - 1] : undefined
  const end = points[window.to]
  if (!end) return 0
  return level(end) / (start ? level(start) : 1) - 1
}

/** Calendar days the period covers, from the day before it starts (or its first day) to its last day. */
export function periodDays(points: IndexPoint[], window: Window): number {
  const start = points[baseIndex(window)]
  const end = points[window.to]
  return start && end ? daysBetween(start.date, end.date) : 0
}

/** `(1 + r)^(365 / days) − 1`; undefined for a period without days. */
export function annualize(periodReturn: number, days: number): number | undefined {
  if (!(days > 0) || periodReturn <= -1) return undefined
  return (1 + periodReturn) ** (365 / days) - 1
}

/** The period's TWR, rebased to start at 0 on the day before it: what `riskSummary` and the heatmap expect. */
export function rebase(points: IndexPoint[], window: Window): IndexPoint[] {
  const start = window.from > 0 ? points[window.from - 1] : undefined
  const base = start ? level(start) : 1
  return points.slice(window.from, window.to + 1).map((p) => ({ date: p.date, twr: level(p) / base - 1 }))
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}

export interface DailyReturn {
  date: string
  /** Index into the points. */
  index: number
  return: number
}

/**
 * Returns on trading days: Monday to Friday. Each one runs from the previous trading day's close, so
 * what crypto does over a weekend lands in Monday's return instead of being lost, and the count per
 * year stays close to 252 for every kind of portfolio. Holidays stay in, as a day without movement.
 */
export function tradingDayReturns(points: IndexPoint[], window: Window): DailyReturn[] {
  const result: DailyReturn[] = []
  const start = window.from > 0 ? points[window.from - 1] : undefined
  let previous = start ? level(start) : 1
  for (let i = window.from; i <= window.to; i++) {
    const point = points[i]
    if (!point || !isWeekday(point.date)) continue
    // The first point of the whole series is the start itself, not a return.
    if (i === 0) {
      previous = level(point)
      continue
    }
    result.push({ date: point.date, index: i, return: level(point) / previous - 1 })
    previous = level(point)
  }
  return result
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Sample standard deviation (n − 1). */
function deviation(values: number[]): number {
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - average) ** 2, 0) / (values.length - 1))
}

/** Annualised volatility: the standard deviation of the trading-day returns × √252. */
export function volatility(returns: number[]): number | undefined {
  if (returns.length < MIN_RETURNS) return undefined
  return deviation(returns) * Math.sqrt(TRADING_DAYS_PER_YEAR)
}

/** The risk-free rate per trading day, from a yearly rate. */
export function dailyRiskFree(yearly: number): number {
  return (1 + yearly) ** (1 / TRADING_DAYS_PER_YEAR) - 1
}

/** (annualised TWR − risk-free rate) / volatility. */
export function sharpe(annualTwr: number | undefined, vol: number | undefined, riskFree: number): number | undefined {
  if (annualTwr === undefined || vol === undefined || vol === 0) return undefined
  return (annualTwr - riskFree) / vol
}

/**
 * Annualised downside deviation: the root mean square of the shortfalls below the daily risk-free
 * rate, over all trading days (a day above the rate counts as zero shortfall), × √252.
 */
export function downsideDeviation(returns: number[], riskFree: number): number | undefined {
  if (returns.length < MIN_RETURNS) return undefined
  const threshold = dailyRiskFree(riskFree)
  const squares = returns.reduce((sum, r) => sum + Math.min(0, r - threshold) ** 2, 0)
  return Math.sqrt(squares / returns.length) * Math.sqrt(TRADING_DAYS_PER_YEAR)
}

/** Like Sharpe, but divided by the downside deviation: only falls count as risk. */
export function sortino(annualTwr: number | undefined, returns: number[], riskFree: number): number | undefined {
  const downside = downsideDeviation(returns, riskFree)
  if (annualTwr === undefined || downside === undefined || downside === 0) return undefined
  return (annualTwr - riskFree) / downside
}

/** Omega at a 0% threshold: the sum of the gains over the absolute sum of the losses. */
export function omega(returns: number[]): number | undefined {
  if (returns.length < MIN_RETURNS) return undefined
  const gains = returns.reduce((sum, r) => sum + Math.max(0, r), 0)
  const losses = returns.reduce((sum, r) => sum - Math.min(0, r), 0)
  return losses > 0 ? gains / losses : undefined
}

/** Beta and correlation of the portfolio's daily returns against the benchmark's, on the same days. */
export function betaAndCorrelation(portfolio: number[], benchmark: number[]): { beta: number; correlation: number } | undefined {
  const n = Math.min(portfolio.length, benchmark.length)
  if (n < MIN_RETURNS) return undefined
  const p = portfolio.slice(0, n)
  const b = benchmark.slice(0, n)
  const meanP = mean(p)
  const meanB = mean(b)
  let covariance = 0
  let varianceP = 0
  let varianceB = 0
  for (let i = 0; i < n; i++) {
    const dp = (p[i] as number) - meanP
    const db = (b[i] as number) - meanB
    covariance += dp * db
    varianceP += dp * dp
    varianceB += db * db
  }
  if (varianceB === 0 || varianceP === 0) return undefined
  return { beta: covariance / varianceB, correlation: covariance / Math.sqrt(varianceP * varianceB) }
}

/** Annualised portfolio TWR against the annualised benchmark TWR: the difference, or the ratio minus one. */
export function alpha(portfolio: number | undefined, benchmark: number | undefined, method: AlphaMethod): number | undefined {
  if (portfolio === undefined || benchmark === undefined) return undefined
  return method === 'arithmetic' ? portfolio - benchmark : (1 + portfolio) / (1 + benchmark) - 1
}

export interface ReturnStats {
  /** TWR over the period, not annualised. */
  twr: number
  annualTwr?: number
  days: number
  volatility?: number
  sharpe?: number
  sortino?: number
  omega?: number
  /** Deepest fall from a high within the period, as a negative fraction or 0. */
  maxDrawdown: number
}

/** Leaves out the fields that are undefined, as exactOptionalPropertyTypes asks. */
function defined<T extends object>(value: { [K in keyof T]: T[K] | undefined }): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function maxDrawdownOf(points: IndexPoint[], window: Window): number {
  let peak = window.from > 0 && points[window.from - 1] ? level(points[window.from - 1] as IndexPoint) : 1
  let deepest = 0
  for (let i = window.from; i <= window.to; i++) {
    const point = points[i]
    if (!point) continue
    peak = Math.max(peak, level(point))
    deepest = Math.min(deepest, level(point) / peak - 1)
  }
  return deepest
}

/** Return and risk of one series over the period. `riskFree` is a yearly fraction, e.g. 0.02. */
export function returnStats(points: IndexPoint[], window: Window, riskFree: number): ReturnStats {
  const twr = periodTwr(points, window)
  const days = periodDays(points, window)
  const annualTwr = annualize(twr, days)
  const returns = tradingDayReturns(points, window).map((r) => r.return)
  const vol = volatility(returns)
  return defined({
    twr,
    days,
    maxDrawdown: maxDrawdownOf(points, window),
    annualTwr,
    volatility: vol,
    sharpe: sharpe(annualTwr, vol, riskFree),
    sortino: sortino(annualTwr, returns, riskFree),
    omega: omega(returns),
  })
}

export interface PerformanceOptions {
  /** Yearly risk-free rate as a fraction, e.g. 0.02 for 2%. */
  riskFree: number
  alphaMethod: AlphaMethod
}

export interface PerformanceStats {
  portfolio: ReturnStats
  benchmark?: ReturnStats
  /** Annualised portfolio TWR against the annualised benchmark TWR. */
  alpha?: number
  beta?: number
  correlation?: number
}

/**
 * Everything the Performance page shows about return and risk for the period, for the portfolio and,
 * when given, its benchmark (the same money, on the same days).
 */
export function performanceStats(points: IndexPoint[], benchmark: IndexPoint[] | undefined, window: Window, options: PerformanceOptions): PerformanceStats {
  const portfolio = returnStats(points, window, options.riskFree)
  if (!benchmark || benchmark.length === 0) return { portfolio }
  const bench = returnStats(benchmark, window, options.riskFree)
  const result: PerformanceStats = { portfolio, benchmark: bench }
  const a = alpha(portfolio.annualTwr, bench.annualTwr, options.alphaMethod)
  if (a !== undefined) result.alpha = a
  const pairs = pairedReturns(points, benchmark, window)
  const relation = betaAndCorrelation(pairs.portfolio, pairs.benchmark)
  if (relation) Object.assign(result, relation)
  return result
}

/** Trading-day returns of both series on the same days. */
function pairedReturns(points: IndexPoint[], benchmark: IndexPoint[], window: Window): { portfolio: number[]; benchmark: number[] } {
  const own = tradingDayReturns(points, window)
  const theirs = new Map(tradingDayReturns(benchmark, window).map((r) => [r.date, r.return]))
  const portfolio: number[] = []
  const bench: number[] = []
  for (const r of own) {
    const other = theirs.get(r.date)
    if (other === undefined) continue
    portfolio.push(r.return)
    bench.push(other)
  }
  return { portfolio, benchmark: bench }
}

export interface RollingPoint {
  date: string
  volatility: number
  /** Annualised TWR over the window. */
  annualTwr: number
  sharpe?: number
  /** Against the benchmark's annualised TWR over the same window; absent without a benchmark. */
  alpha?: number
}

/**
 * Rolling 12-month figures: for every trading day in the period, the last 252 trading-day returns, which
 * may reach back before the period so its first days have a value too. Days without a full window
 * before them are left out. Running sums keep this linear in the length of the history.
 */
export function rollingStats(
  points: IndexPoint[],
  benchmark: IndexPoint[] | undefined,
  window: Window,
  options: PerformanceOptions,
  size = TRADING_DAYS_PER_YEAR,
): RollingPoint[] {
  const all = tradingDayReturns(points, { from: 0, to: points.length - 1 })
  const benchLevels = benchmark ? benchmark.map(level) : undefined
  const result: RollingPoint[] = []
  let sum = 0
  let squares = 0
  for (let k = 0; k < all.length; k++) {
    const today = all[k] as DailyReturn
    sum += today.return
    squares += today.return ** 2
    if (k >= size) {
      const leaving = (all[k - size] as DailyReturn).return
      sum -= leaving
      squares -= leaving ** 2
    }
    if (k < size - 1 || today.index < window.from || today.index > window.to) continue
    // The window starts at the close before its first return.
    const startIndex = k >= size ? (all[k - size] as DailyReturn).index : 0
    const start = points[startIndex] as IndexPoint
    const days = daysBetween(start.date, today.date)
    const annualTwr = annualize(level(points[today.index] as IndexPoint) / level(start) - 1, days)
    const variance = (squares - (sum * sum) / size) / (size - 1)
    const vol = Math.sqrt(Math.max(0, variance) * TRADING_DAYS_PER_YEAR)
    if (annualTwr === undefined) continue
    const point: RollingPoint = { date: today.date, volatility: vol, annualTwr }
    const s = sharpe(annualTwr, vol, options.riskFree)
    if (s !== undefined) point.sharpe = s
    if (benchLevels) {
      const benchAnnual = annualize((benchLevels[today.index] as number) / (benchLevels[startIndex] as number) - 1, days)
      const a = alpha(annualTwr, benchAnnual, options.alphaMethod)
      if (a !== undefined) point.alpha = a
    }
    result.push(point)
  }
  return result
}

export interface ComparedPeriod {
  /** `YYYY-MM` or `YYYY`. */
  period: string
  portfolio: number
  benchmark?: number
  /** Portfolio minus benchmark, in return points. */
  delta?: number
}

/**
 * Monthly and yearly TWR of the period for the heatmap, with the benchmark's for the same months and years
 * and the difference. The first and last month or year may be partial, for both alike.
 */
export function periodComparison(points: IndexPoint[], benchmark: IndexPoint[] | undefined, window: Window): { months: ComparedPeriod[]; years: ComparedPeriod[] } {
  const own = riskSummary(rebase(points, window))
  const theirs = benchmark && benchmark.length > 0 ? riskSummary(rebase(benchmark, window)) : undefined
  const join = (mine: PeriodReturn[], other: PeriodReturn[] | undefined): ComparedPeriod[] => {
    const lookup = new Map(other?.map((p) => [p.period, p.return]))
    return mine.map((p) => {
      const b = lookup.get(p.period)
      return b === undefined ? { period: p.period, portfolio: p.return } : { period: p.period, portfolio: p.return, benchmark: b, delta: p.return - b }
    })
  }
  return { months: join(own.months, theirs?.months), years: join(own.years, theirs?.years) }
}

interface FlowPoint extends IndexPoint {
  value: number
  inflow: number
  outflow: number
}

export interface TimingEffect {
  /** The period: its dates, or a calendar year within it. */
  period: string
  /** Money-weighted return per year (XIRR) over the period. */
  xirr: number
  /** Time-weighted return over the period, annualised. */
  annualTwr: number
  /** XIRR − annualised TWR: what the timing of deposits and withdrawals added (positive) or cost per year. */
  effect: number
}

function timing(points: FlowPoint[], window: Window, label: string): TimingEffect | undefined {
  const xirr = irrBetween(points, window.from, window.to)
  const annualTwr = annualize(periodTwr(points, window), periodDays(points, window))
  if (xirr === undefined || annualTwr === undefined) return undefined
  return { period: label, xirr, annualTwr, effect: xirr - annualTwr }
}

/**
 * The timing effect over the period and per calendar year in it. Both sides are yearly rates over the
 * same days, so a yearly figure is never compared with a cumulative one; a partial year is annualised
 * on both sides alike.
 */
export function timingEffect(points: FlowPoint[], window: Window): { total?: TimingEffect; years: TimingEffect[] } {
  const first = points[window.from]
  const last = points[window.to]
  if (!first || !last) return { years: [] }
  const total = timing(points, window, `${first.date}–${last.date}`)
  const years: TimingEffect[] = []
  let start = window.from
  for (let i = window.from; i <= window.to; i++) {
    const year = (points[i] as FlowPoint).date.slice(0, 4)
    const next = points[i + 1]
    if (i < window.to && next && next.date.slice(0, 4) === year) continue
    const effect = timing(points, { from: start, to: i }, year)
    if (effect) years.push(effect)
    start = i + 1
  }
  return { ...(total ? { total } : {}), years }
}
