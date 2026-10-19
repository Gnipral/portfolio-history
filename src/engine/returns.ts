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

/**
 * Time-weighted return as a cumulative index (1 = start), chain-linked daily.
 * Inflows count at the start of the day, outflows at the end:
 *   r = (value + outflow) / (previous value + inflow) - 1
 * A day with nothing invested has a return of 0.
 */
export function twrIndex(days: FlowDay[]): number[] {
  const index: number[] = []
  let previousValue = 0
  let level = 1
  for (const day of days) {
    const base = previousValue + day.inflow
    if (base > 0) level *= (day.value + day.outflow) / base
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

function npv(flows: { years: number; amount: number }[], rate: number): { value: number; derivative: number } {
  let value = 0
  let derivative = 0
  for (const f of flows) {
    const discount = (1 + rate) ** -f.years
    value += f.amount * discount
    derivative -= f.years * f.amount * discount / (1 + rate)
  }
  return { value, derivative }
}

/**
 * Annualized money-weighted return (XIRR). Newton-Raphson from `guess`, with bisection as a
 * fallback when Newton does not converge. Undefined when the flows have no solution
 * (no sign change, or all on one day).
 */
export function xirr(cashFlows: CashFlow[], guess = 0.1): number | undefined {
  const flows = cashFlows.filter((f) => f.amount !== 0)
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return undefined
  const first = flows.reduce((min, f) => (f.date < min ? f.date : min), (flows[0] as CashFlow).date)
  const timed = flows.map((f) => ({ years: daysBetween(first, f.date) / YEAR_DAYS, amount: f.amount }))
  if (timed.every((f) => f.years === 0)) return undefined

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

function bisect(flows: { years: number; amount: number }[]): number | undefined {
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

/**
 * XIRR for every day: the flows up to that day plus the value as if sold that evening.
 * Each day starts from the previous day's answer, which keeps Newton fast and stable.
 */
export function irrSeries(days: IrrDay[]): (number | undefined)[] {
  const flows: CashFlow[] = []
  const result: (number | undefined)[] = []
  let guess = 0.1
  for (const day of days) {
    if (day.inflow) flows.push({ date: day.date, amount: -day.inflow })
    if (day.outflow) flows.push({ date: day.date, amount: day.outflow })
    const irr = xirr([...flows, { date: day.date, amount: day.value }], guess)
    if (irr !== undefined) guess = irr
    result.push(irr)
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
