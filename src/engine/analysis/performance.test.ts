import { describe, expect, it } from 'vitest'
import { addDays } from '../../market/dates.ts'
import {
  alpha,
  annualize,
  betaAndCorrelation,
  dailyRiskFree,
  downsideDeviation,
  omega,
  performanceStats,
  periodComparison,
  periodDays,
  periodTwr,
  rebase,
  rollingStats,
  sharpe,
  sortino,
  timingEffect,
  tradingDayReturns,
  volatility,
  type IndexPoint,
} from './performance.ts'

/** One point per calendar day from `start`, at the given index levels (1 = start). */
function daily(start: string, levels: number[]): IndexPoint[] {
  return levels.map((level, i) => ({ date: addDays(start, i), twr: level - 1 }))
}

/**
 * Calendar days from a Monday where only weekdays move: each weekday applies the next return, a
 * weekend keeps Friday's level. The trading-day returns are then exactly `returns`.
 */
function weekdays(returns: number[], start = '2026-01-05'): IndexPoint[] {
  const points: IndexPoint[] = [{ date: addDays(start, -3), twr: 0 }] // the Friday before: the start level
  let level = 1
  let date = addDays(start, -2)
  for (const r of returns) {
    while (new Date(`${date}T00:00:00Z`).getUTCDay() % 6 === 0) {
      points.push({ date, twr: level - 1 })
      date = addDays(date, 1)
    }
    level *= 1 + r
    points.push({ date, twr: level - 1 })
    date = addDays(date, 1)
  }
  return points
}

const all = (points: IndexPoint[]) => ({ from: 0, to: points.length - 1 })
const alternating = (n: number, up: number, down: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? up : down))

describe('period return', () => {
  const points = daily('2026-03-01', [1, 1.1, 1.21])

  it('counts the return of the first day of the period, as the dashboard does', () => {
    expect(periodTwr(points, { from: 1, to: 2 })).toBeCloseTo(0.21)
    expect(periodTwr(points, { from: 2, to: 2 })).toBeCloseTo(0.1)
    expect(periodDays(points, { from: 1, to: 2 })).toBe(2)
  })

  it('annualises with (1 + r)^(365 / days) − 1', () => {
    expect(annualize(0.21, 730)).toBeCloseTo(0.1)
    expect(annualize(0.1, 0)).toBeUndefined()
  })

  it('rebases the period to start at 0 the day before it', () => {
    expect(rebase(points, { from: 2, to: 2 })[0]?.twr).toBeCloseTo(0.1)
  })
})

describe('tradingDayReturns', () => {
  it('folds a weekend into Monday instead of losing it', () => {
    // Thursday 8 Jan 2026 is the start; the price moves on Saturday and Sunday.
    const points = daily('2026-01-08', [1, 1, 1.1, 1.2, 1.2])
    expect(tradingDayReturns(points, all(points))).toEqual([
      { date: '2026-01-09', index: 1, return: 0 },
      { date: '2026-01-12', index: 4, return: expect.closeTo(0.2) },
    ])
  })
})

describe('risk ratios', () => {
  it('annualises the sample standard deviation with √252, from 20 returns on', () => {
    const returns = alternating(20, 0.01, -0.01)
    expect(volatility(returns)).toBeCloseTo(0.01 * Math.sqrt(20 / 19) * Math.sqrt(252))
    expect(volatility(returns.slice(1))).toBeUndefined()
  })

  it('computes Sharpe, the downside deviation, Sortino and Omega', () => {
    expect(sharpe(0.1, 0.2, 0.02)).toBeCloseTo(0.4)
    const returns = alternating(20, 0.02, -0.01)
    // Ten shortfalls of 1% below a 0% rate, over 20 days: √(10 × 0.0001 / 20) × √252.
    const downside = Math.sqrt(0.001 / 20) * Math.sqrt(252)
    expect(downsideDeviation(returns, 0)).toBeCloseTo(downside)
    expect(sortino(0.1, returns, 0)).toBeCloseTo(0.1 / downside)
    // Gains 10 × 2%, losses 10 × 1%.
    expect(omega(returns)).toBeCloseTo(2)
    expect(dailyRiskFree(0.02)).toBeCloseTo(1.02 ** (1 / 252) - 1)
  })

  it('finds beta 2 and correlation 1 for twice the benchmark, −1 for its mirror', () => {
    const benchmark = Array.from({ length: 20 }, (_, i) => ((i * 7) % 5) / 100 - 0.02)
    expect(betaAndCorrelation(benchmark.map((r) => 2 * r), benchmark)).toEqual({ beta: expect.closeTo(2), correlation: expect.closeTo(1) })
    expect(betaAndCorrelation(benchmark.map((r) => -r), benchmark)).toEqual({ beta: expect.closeTo(-1), correlation: expect.closeTo(-1) })
  })

  it('takes alpha as a difference or as a ratio', () => {
    expect(alpha(0.1, 0.05, 'arithmetic')).toBeCloseTo(0.05)
    expect(alpha(0.1, 0.05, 'geometric')).toBeCloseTo(1.1 / 1.05 - 1)
    expect(alpha(0.1, undefined, 'arithmetic')).toBeUndefined()
  })
})

describe('performanceStats', () => {
  it('gives the portfolio and benchmark figures and the alpha between them for the period', () => {
    const own = weekdays(alternating(60, 0.02, -0.01))
    const bench = weekdays(alternating(60, 0.01, -0.005))
    const window = all(own)
    const stats = performanceStats(own, bench, window, { riskFree: 0, alphaMethod: 'arithmetic' })
    const days = periodDays(own, window)
    const expectedOwn = annualize(periodTwr(own, window), days) as number
    const expectedBench = annualize(periodTwr(bench, window), days) as number
    expect(stats.portfolio.annualTwr).toBeCloseTo(expectedOwn)
    expect(stats.alpha).toBeCloseTo(expectedOwn - expectedBench)
    // Every portfolio return is exactly twice the benchmark's.
    expect(stats.beta).toBeCloseTo(2)
    expect(stats.correlation).toBeCloseTo(1)
    expect(stats.portfolio.maxDrawdown).toBeCloseTo(-0.01)
  })

  it('leaves out the benchmark when there is none', () => {
    const own = weekdays(alternating(30, 0.01, -0.01))
    expect(performanceStats(own, undefined, all(own), { riskFree: 0.02, alphaMethod: 'geometric' }).benchmark).toBeUndefined()
  })
})

describe('rollingStats', () => {
  it('starts once a full window of trading days is behind it, reaching back before the period', () => {
    const returns = [0.01, -0.01, 0.02, 0.01, -0.02, 0.03]
    const own = weekdays(returns)
    const rolling = rollingStats(own, own, all(own), { riskFree: 0, alphaMethod: 'arithmetic' }, 3)
    // Six returns and a window of three: values from the third return on.
    expect(rolling).toHaveLength(4)
    const last = rolling.at(-1)
    const window = returns.slice(3)
    const average = window.reduce((s, r) => s + r, 0) / 3
    const sd = Math.sqrt(window.reduce((s, r) => s + (r - average) ** 2, 0) / 2)
    expect(last?.volatility).toBeCloseTo(sd * Math.sqrt(252))
    // Against itself the alpha is zero.
    expect(last?.alpha).toBeCloseTo(0)

    // Only days inside the period get a value, but the window may start before it.
    const lastIndex = own.length - 1
    expect(rollingStats(own, undefined, { from: lastIndex, to: lastIndex }, { riskFree: 0, alphaMethod: 'arithmetic' }, 3)).toHaveLength(1)
  })
})

describe('periodComparison', () => {
  it('sets the months and years of the portfolio against the benchmark', () => {
    const levels = (january: number, february: number) => [...Array(30).fill(1), january, ...Array(27).fill(january), february]
    const own = daily('2026-01-01', levels(1.1, 1.21))
    const bench = daily('2026-01-01', levels(1.05, 1.05))
    const { months, years } = periodComparison(own, bench, all(own))
    expect(months.map((m) => m.period)).toEqual(['2026-01', '2026-02'])
    expect(months[1]).toEqual({ period: '2026-02', portfolio: expect.closeTo(0.1), benchmark: expect.closeTo(0), delta: expect.closeTo(0.1) })
    expect(years).toEqual([{ period: '2026', portfolio: expect.closeTo(0.21), benchmark: expect.closeTo(0.05), delta: expect.closeTo(0.16) }])
  })
})

describe('timingEffect', () => {
  /** A deposit of 100, flat for half a year, a second 100 just before a 10% rise over the second half. */
  function points() {
    return Array.from({ length: 366 }, (_, i) => {
      const date = addDays('2026-01-01', i)
      const inflow = i === 0 || i === 182 ? 100 : 0
      const value = i < 182 ? 100 : 200 * (1 + (0.1 * (i - 182)) / 183)
      return { date, value, inflow, outflow: 0, twr: i < 182 ? 0 : value / 200 - 1 }
    })
  }

  it('is the XIRR minus the annualised TWR: positive when money came in before a rise', () => {
    const series = points()
    const { total, years } = timingEffect(series, { from: 0, to: 365 })
    // TWR: 0% then 10%, over 365 days: 10% a year.
    expect(total?.annualTwr).toBeCloseTo(0.1)
    // XIRR x solves 100(1 + x) + 100(1 + x)^(183/365) = 220.
    const x = total?.xirr as number
    expect(100 * (1 + x) + 100 * (1 + x) ** (183 / 365)).toBeCloseTo(220, 2)
    expect(total?.effect).toBeGreaterThan(0.03)
    // 1 January 2027 alone is no period to solve an XIRR over: that year is left out.
    expect(years.map((y) => y.period)).toEqual(['2026'])
  })
})
