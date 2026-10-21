import { useMemo } from 'react'
import { riskSummary } from '../../engine/analysis/risk.ts'
import type { SeriesResult } from '../../engine/series.ts'
import { formatDate, formatPercent, trendClass } from '../format.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function month(period: string): string {
  return monthName.format(new Date(`${period}-01T00:00:00Z`))
}

/** Falls, volatility and the return of every month, from the time-weighted return. */
export function RiskSection({ series }: { series: SeriesResult }) {
  const risk = useMemo(() => riskSummary(series.points), [series])
  const byYear = new Map<string, Map<number, number>>()
  for (const m of risk.months) {
    const row = byYear.get(m.period.slice(0, 4)) ?? new Map<number, number>()
    row.set(Number(m.period.slice(5, 7)) - 1, m.return)
    byYear.set(m.period.slice(0, 4), row)
  }
  const drawdown = risk.maxDrawdown

  return (
    <>
      <div className="cards">
        <div className="card">
          <span className="card-label">Largest fall</span>
          <span className="card-value negative">{drawdown ? formatPercent(drawdown.depth) : '–'}</span>
          {drawdown && (
            <span className="muted small">
              {formatDate(drawdown.peak)} to {formatDate(drawdown.trough)};{' '}
              {drawdown.recovered ? `back on ${formatDate(drawdown.recovered)}` : 'not recovered yet'}
            </span>
          )}
        </div>
        <div className="card">
          <span className="card-label">Below the top now</span>
          <span className={`card-value ${trendClass(risk.currentDrawdown)}`}>{formatPercent(risk.currentDrawdown)}</span>
        </div>
        <div className="card">
          <span className="card-label">Volatility</span>
          <span className="card-value">{risk.volatility === undefined ? '–' : formatPercent(risk.volatility, false)}</span>
          <span className="muted small">Per year, from the daily returns</span>
        </div>
        <div className="card">
          <span className="card-label">Best month</span>
          <span className="card-value positive">{risk.bestMonth ? formatPercent(risk.bestMonth.return) : '–'}</span>
          {risk.bestMonth && <span className="muted small">{month(risk.bestMonth.period)}</span>}
        </div>
        <div className="card">
          <span className="card-label">Worst month</span>
          <span className="card-value negative">{risk.worstMonth ? formatPercent(risk.worstMonth.return) : '–'}</span>
          {risk.worstMonth && <span className="muted small">{month(risk.worstMonth.period)}</span>}
        </div>
        <div className="card">
          <span className="card-label">Months up</span>
          <span className="card-value">{formatPercent(risk.positiveMonths, false)}</span>
          <span className="muted small">of {risk.months.length} months</span>
        </div>
      </div>

      <div className="panel">
        <h3>Return per month</h3>
        <div className="table-scroll">
          <table className="table returns-table">
            <thead>
              <tr>
                <th>Year</th>
                {MONTHS.map((m) => (
                  <th key={m} className="num">
                    {m}
                  </th>
                ))}
                <th className="num">Year</th>
              </tr>
            </thead>
            <tbody>
              {risk.years.map((y) => (
                <tr key={y.period}>
                  <td>{y.period}</td>
                  {MONTHS.map((m, i) => {
                    const value = byYear.get(y.period)?.get(i)
                    return (
                      <td key={m} className={`num ${value === undefined ? '' : trendClass(value)}`}>
                        {value === undefined ? '' : formatPercent(value)}
                      </td>
                    )
                  })}
                  <td className={`num ${trendClass(y.return)}`}>
                    <strong>{formatPercent(y.return)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Time-weighted, so deposits and withdrawals do not affect these numbers. The first and the current month are partial.
        </p>
      </div>
    </>
  )
}
