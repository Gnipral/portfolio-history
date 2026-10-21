/** Risk figures from the time-weighted return index of the daily series. */

interface IndexPoint {
  date: string
  /** Time-weighted return since the first transaction. */
  twr: number
}

export interface Drawdown {
  /** Fall from the peak, as a negative fraction. */
  depth: number
  peak: string
  trough: string
  /** First day back at the peak; undefined when not recovered yet. */
  recovered?: string
}

export interface PeriodReturn {
  /** `YYYY-MM` or `YYYY`. */
  period: string
  return: number
}

export interface RiskSummary {
  maxDrawdown?: Drawdown
  /** Fall from the highest point so far on the last day, as a negative fraction or 0. */
  currentDrawdown: number
  /** Annualized standard deviation of the daily returns on weekdays; undefined below 20 returns. */
  volatility?: number
  months: PeriodReturn[]
  years: PeriodReturn[]
  bestMonth?: PeriodReturn
  worstMonth?: PeriodReturn
  /** Share of the months with a positive return. */
  positiveMonths: number
}

const TRADING_DAYS = 252

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}

/** Returns per period from the index level at the end of each period (the first one from 1). */
function periodReturns(points: IndexPoint[], periodOf: (date: string) => string): PeriodReturn[] {
  const result: PeriodReturn[] = []
  let startLevel = 1
  for (let i = 0; i < points.length; i++) {
    const point = points[i] as IndexPoint
    const next = points[i + 1]
    const period = periodOf(point.date)
    if (next && periodOf(next.date) === period) continue
    const level = 1 + point.twr
    result.push({ period, return: level / startLevel - 1 })
    startLevel = level
  }
  return result
}

export function riskSummary(points: IndexPoint[]): RiskSummary {
  let peak = 1
  let peakDate = points[0]?.date ?? ''
  let peakLevel = 1
  let maxDrawdown: Drawdown | undefined
  const daily: number[] = []
  for (let i = 0; i < points.length; i++) {
    const point = points[i] as IndexPoint
    const level = 1 + point.twr
    if (i > 0 && isWeekday(point.date)) daily.push(level / (1 + (points[i - 1] as IndexPoint).twr) - 1)
    if (level >= peak) {
      peak = level
      peakDate = point.date
      continue
    }
    const depth = level / peak - 1
    if (!maxDrawdown || depth < maxDrawdown.depth) {
      maxDrawdown = { depth, peak: peakDate, trough: point.date }
      peakLevel = peak
    }
  }
  if (maxDrawdown) {
    const trough = maxDrawdown.trough
    const recovered = points.find((p) => p.date > trough && 1 + p.twr >= peakLevel)?.date
    if (recovered) maxDrawdown = { ...maxDrawdown, recovered }
  }

  const last = points.at(-1)
  const currentDrawdown = last ? Math.min(0, (1 + last.twr) / peak - 1) : 0
  let volatility: number | undefined
  if (daily.length >= 20) {
    const mean = daily.reduce((sum, r) => sum + r, 0) / daily.length
    const variance = daily.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (daily.length - 1)
    volatility = Math.sqrt(variance * TRADING_DAYS)
  }
  const months = periodReturns(points, (date) => date.slice(0, 7))
  const years = periodReturns(points, (date) => date.slice(0, 4))
  const sorted = [...months].sort((a, b) => a.return - b.return)
  return {
    ...(maxDrawdown ? { maxDrawdown } : {}),
    currentDrawdown,
    ...(volatility === undefined ? {} : { volatility }),
    months,
    years,
    ...(sorted.length ? { bestMonth: sorted.at(-1) as PeriodReturn, worstMonth: sorted[0] as PeriodReturn } : {}),
    positiveMonths: months.length ? months.filter((m) => m.return > 0).length / months.length : 0,
  }
}

