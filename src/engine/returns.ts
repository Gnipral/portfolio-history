import { daysBetween } from '../market/dates.ts'

export interface CashFlow {
  date: string
  /** From the investor's point of view: money put in is negative, money received positive. */
  amount: number
}

interface FlowDay {
  value: number
  inflow: number
  outflow: number
}

/** Below one cent the base of a day is a rounding residue, not money at risk. */
const MIN_BASE = 0.01

/**
 * Time-weighted return as a cumulative index (1 = start), chain-linked daily.
 * Inflows count at the start of the day, outflows at the end:
 *   r = (value + outflow) / (previous value + inflow) - 1
 * A day with nothing (or only a rounding residue) invested has a return of 0, and so does a day
 * whose value is negative, e.g. cash below zero because the export misses a deposit.
 */
export function twrIndex(days: FlowDay[]): number[] {
  const index: number[] = []
  let previousValue = 0
  let level = 1
  for (const day of days) {
    const base = previousValue + day.inflow
    const end = day.value + day.outflow
    if (base >= MIN_BASE && end >= 0) level *= end / base
    index.push(level)
    previousValue = day.value
  }
  return index
}

/** Return between two points of a TWR index, e.g. for a 1M or YTD range. */
export function twrBetween(index: number[], from: number, to: number): number {
  const start = from > 0 ? (index[from - 1] as number) : 1
  return (index[to] as number) / start - 1
}

const YEAR_DAYS = 365
const MIN_RATE = -0.999999

interface Timed {
  /** Time since the first flow, in units of the span of all flows (0 to 1). */
  time: number
  amount: number
}

function npv(flows: Timed[], rate: number): { value: number; derivative: number } {
  let value = 0
  let derivative = 0
  for (const f of flows) {
    const discount = (1 + rate) ** -f.time
    value += f.amount * discount
    derivative -= f.time * f.amount * discount / (1 + rate)
  }
  return { value, derivative }
}

export interface Mwr {
  /** Money-weighted return over the span of the flows, not annualized. */
  period: number
  /** Calendar days from the first to the last non-zero flow. */
  spanDays: number
}

/**
 * Money-weighted return over the span of the flows, from the first to the last non-zero flow.
 * Time is measured in fractions of that span, so the rate solved for is the period return itself:
 * solving for a yearly rate instead overflows, or falls below -99.9999%, for big moves in a few days.
 * Undefined when the flows have no solution (no sign change, or all on one day).
 */
export function mwr(cashFlows: CashFlow[], guess = 0.1): Mwr | undefined {
  const flows = cashFlows.filter((f) => f.amount !== 0)
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return undefined
  let first = (flows[0] as CashFlow).date
  let last = first
  for (const f of flows) {
    if (f.date < first) first = f.date
    if (f.date > last) last = f.date
  }
  const spanDays = daysBetween(first, last)
  if (spanDays === 0) return undefined
  const timed = flows.map((f) => ({ time: daysBetween(first, f.date) / spanDays, amount: f.amount }))
  const period = solve(timed, guess)
  return period === undefined ? undefined : { period, spanDays }
}

/** Annualized money-weighted return (XIRR); undefined when not solvable or too large to represent. */
export function xirr(cashFlows: CashFlow[], guess = 0.1): number | undefined {
  const result = mwr(cashFlows, guess)
  return result && annualize(result)
}

function annualize({ period, spanDays }: Mwr): number | undefined {
  const annual = (1 + period) ** (YEAR_DAYS / spanDays) - 1
  return Number.isFinite(annual) ? annual : undefined
}

/** Newton-Raphson from `guess`, with bisection as a fallback when Newton does not converge. */
function solve(timed: Timed[], guess: number): number | undefined {
  let rate = Math.max(guess, MIN_RATE + 1e-6)
  for (let i = 0; i < 50; i++) {
    const { value, derivative } = npv(timed, rate)
    if (Math.abs(value) < 1e-9) return rate
    if (derivative === 0 || !Number.isFinite(derivative)) break
    const next = rate - value / derivative
    if (!Number.isFinite(next) || next <= MIN_RATE) break
    if (Math.abs(next - rate) < 1e-12) return next
    rate = next
  }
  return bisect(timed)
}

function bisect(flows: Timed[]): number | undefined {
  let low = MIN_RATE
  let high = 1
  const valueAt = (rate: number) => npv(flows, rate).value
  while (Math.sign(valueAt(low)) === Math.sign(valueAt(high))) {
    high *= 2
    if (high > 1e6) return undefined
  }
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2
    const value = valueAt(mid)
    if (Math.abs(value) < 1e-9 || high - low < 1e-12) return mid
    if (Math.sign(value) === Math.sign(valueAt(low))) low = mid
    else high = mid
  }
  return (low + high) / 2
}

interface IrrDay extends FlowDay {
  date: string
}

export interface MwrPoint extends Mwr {
  /** Annualized (XIRR); undefined when too large to represent. */
  annual?: number
}

/**
 * Money-weighted return for every day: the flows up to that day plus the value as if sold that
 * evening. Once everything is sold the span ends at the last sale, so idle days change nothing.
 * Each day starts from the previous day's answer scaled to the new span, which keeps Newton fast.
 */
export function irrSeries(days: IrrDay[]): (MwrPoint | undefined)[] {
  const flows: CashFlow[] = []
  const result: (MwrPoint | undefined)[] = []
  let previous: Mwr | undefined
  for (const day of days) {
    if (day.inflow) flows.push({ date: day.date, amount: -day.inflow })
    if (day.outflow) flows.push({ date: day.date, amount: day.outflow })
    const span = flows[0] ? daysBetween(flows[0].date, day.date) : 0
    const scaled = previous && span > 0 ? (1 + previous.period) ** (span / previous.spanDays) - 1 : 0.1
    const current = mwr([...flows, { date: day.date, amount: day.value }], Number.isFinite(scaled) ? scaled : 0.1)
    if (current) previous = current
    const annual = current && annualize(current)
    result.push(current && (annual === undefined ? current : { ...current, annual }))
  }
  return result
}

/**
 * XIRR over a range of days: the value before the range is treated as an investment
 * at its start, the value at its end as the final payout.
 */
export function irrBetween(days: IrrDay[], from: number, to: number): number | undefined {
  const flows: CashFlow[] = []
  const start = days[from]
  if (!start) return undefined
  const before = from > 0 ? (days[from - 1] as IrrDay).value : 0
  if (before) flows.push({ date: start.date, amount: -before })
  for (let i = from; i <= to; i++) {
    const day = days[i] as IrrDay
    if (day.inflow) flows.push({ date: day.date, amount: -day.inflow })
    if (day.outflow) flows.push({ date: day.date, amount: day.outflow })
  }
  const end = days[to]
  if (!end) return undefined
  flows.push({ date: end.date, amount: end.value })
  return xirr(flows)
}
