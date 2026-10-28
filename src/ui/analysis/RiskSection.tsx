import { useMemo } from 'react'
import { riskSummary } from '../../engine/analysis/risk.ts'
import type { SeriesResult } from '../../engine/series.ts'
import { formatDate, formatPercent, trendClass } from '../format.ts'
import { locale, t } from '../../i18n/i18n.ts'

const shortMonth = new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' })
const MONTHS = Array.from({ length: 12 }, (_, i) => shortMonth.format(new Date(Date.UTC(2026, i, 1))))
const monthName = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })

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
          <span className="card-label">{t('Largest fall')}</span>
          <span className="card-value negative">{drawdown ? formatPercent(drawdown.depth) : '–'}</span>
          {drawdown && (
            <span className="muted small">
              {t('{from} to {to}', { from: formatDate(drawdown.peak), to: formatDate(drawdown.trough) })};{' '}
              {drawdown.recovered ? t('back on {date}', { date: formatDate(drawdown.recovered) }) : t('not recovered yet')}
            </span>
          )}
        </div>
        <div className="card">
          <span className="card-label">{t('Below the top now')}</span>
          <span className={`card-value ${trendClass(risk.currentDrawdown)}`}>{formatPercent(risk.currentDrawdown)}</span>
        </div>
        <div className="card">
          <span className="card-label">{t('Volatility')}</span>
          <span className="card-value">{risk.volatility === undefined ? '–' : formatPercent(risk.volatility, false)}</span>
          <span className="muted small">{t('Per year, from the daily returns')}</span>
        </div>
        <div className="card">
          <span className="card-label">{t('Best month')}</span>
          <span className="card-value positive">{risk.bestMonth ? formatPercent(risk.bestMonth.return) : '–'}</span>
          {risk.bestMonth && <span className="muted small">{month(risk.bestMonth.period)}</span>}
        </div>
        <div className="card">
          <span className="card-label">{t('Worst month')}</span>
          <span className="card-value negative">{risk.worstMonth ? formatPercent(risk.worstMonth.return) : '–'}</span>
          {risk.worstMonth && <span className="muted small">{month(risk.worstMonth.period)}</span>}
        </div>
        <div className="card">
          <span className="card-label">{t('Months up')}</span>
          <span className="card-value">{formatPercent(risk.positiveMonths, false)}</span>
          <span className="muted small">{t('of {count} months', { count: risk.months.length })}</span>
        </div>
      </div>

      <div className="panel">
        <h3>{t('Return per month')}</h3>
        <div className="table-scroll">
          <table className="table returns-table">
            <thead>
              <tr>
                <th>{t('Year')}</th>
                {MONTHS.map((m) => (
                  <th key={m} className="num">
                    {m}
                  </th>
                ))}
                <th className="num">{t('Year')}</th>
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
          {t('Time-weighted, so deposits and withdrawals do not affect these numbers. The first and the current month are partial.')}
        </p>
      </div>
    </>
  )
}
