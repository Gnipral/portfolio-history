import { lazy, Suspense, useMemo } from 'react'
import { dividendForecast, type DividendForecast } from '../../engine/analysis/forecast.ts'
import { incomeRows, incomeTotals, type IncomeRow } from '../../engine/analysis/income.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { positionsOn, type Position } from '../../engine/positions.ts'
import { addDays, localToday } from '../../market/dates.ts'
import { formatDate, formatEur, formatPercent } from '../format.ts'

// recharts is large; it is already split off for the allocation chart.
const MonthlyIncomeChart = lazy(() => import('./MonthlyIncomeChart.tsx').then((m) => ({ default: m.MonthlyIncomeChart })))

interface Props {
  inputs: EngineInputs
  options: EngineOptions
}

const KIND_LABELS: Record<IncomeRow['kind'], string> = { dividend: 'Dividends', interest: 'Interest', bonus: 'Bonuses' }

/** Last `count` months up to `today`, oldest first, as `YYYY-MM`. */
function lastMonths(today: string, count: number): string[] {
  const months: string[] = []
  const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`)
  for (let i = 0; i < count; i++) {
    months.unshift(date.toISOString().slice(0, 7))
    date.setUTCMonth(date.getUTCMonth() - 1)
  }
  return months
}

/** Dividends, interest and bonuses per year, month and position, gross and net. */
export function DividendsSection({ inputs, options }: Props) {
  const today = localToday()
  const rows = useMemo(() => incomeRows(inputs.transactions), [inputs])
  const positions = useMemo(() => positionsOn(inputs.transactions, inputs.prices, options, today), [inputs, options, today])
  const forecast = useMemo(() => dividendForecast(inputs.transactions, today), [inputs, today])
  if (rows.length === 0) return <p className="muted">The export contains no dividends or interest.</p>

  const yearAgo = addDays(today, -365)
  const lastYear = rows.filter((r) => r.date > yearAgo)
  const sum = (list: IncomeRow[], field: 'gross' | 'taxes' | 'net') => list.reduce((s, r) => s + r[field], 0)
  const perYear = incomeTotals(rows, (r) => r.date.slice(0, 4))
  const perKind = incomeTotals(rows, (r) => KIND_LABELS[r.kind])
  const months = lastMonths(today, 24)
  const monthly = months.map((month) => ({ month, net: sum(rows.filter((r) => r.date.startsWith(month)), 'net') }))
  const perProduct = incomeTotals(
    rows.filter((r) => r.kind === 'dividend'),
    (r) => r.key,
  ).sort((a, b) => b.net - a.net)

  return (
    <>
      <div className="cards">
        <div className="card">
          <span className="card-label">Net, last 12 months</span>
          <span className="card-value positive">{formatEur(sum(lastYear, 'net'))}</span>
          <span className="muted small">{formatEur(sum(lastYear, 'net') / 12)} a month on average</span>
        </div>
        <div className="card">
          <span className="card-label">Net, all time</span>
          <span className="card-value positive">{formatEur(sum(rows, 'net'))}</span>
          <span className="muted small">Gross {formatEur(sum(rows, 'gross'))}</span>
        </div>
        <div className="card">
          <span className="card-label">Withheld taxes, all time</span>
          <span className="card-value">{formatEur(sum(rows, 'taxes'))}</span>
          <span className="muted small">{sum(rows, 'gross') > 0 ? formatPercent(sum(rows, 'taxes') / sum(rows, 'gross'), false) : '–'} of gross</span>
        </div>
      </div>

      <ForecastPanel forecast={forecast} positions={positions} today={today} />

      <div className="panel">
        <h3>Net income per month</h3>
        <Suspense fallback={<div className="income-chart" />}>
          <MonthlyIncomeChart data={monthly} />
        </Suspense>
      </div>

      <div className="dashboard-grid">
        <div className="panel">
          <h3>Per year</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Payments</th>
                <th className="num">Gross</th>
                <th className="num">Taxes</th>
                <th className="num">Costs</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {perYear.map((y) => (
                <tr key={y.label}>
                  <td>{y.label}</td>
                  <td className="num">{y.count}</td>
                  <td className="num">{formatEur(y.gross)}</td>
                  <td className="num">{formatEur(y.taxes)}</td>
                  <td className="num">{formatEur(y.costs)}</td>
                  <td className="num">
                    <strong>{formatEur(y.net)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Per kind</h3>
          <table className="table">
            <tbody>
              {perKind.map((k) => (
                <tr key={k.label}>
                  <td>{k.label}</td>
                  <td className="num">{formatEur(k.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Per position</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Payments</th>
              <th className="num">Gross</th>
              <th className="num">Net</th>
              <th className="num">Net, last 12 months</th>
              <th className="num" title="Net dividends of the last 12 months divided by the cost basis held today">
                Yield on cost
              </th>
              <th className="num">Last paid</th>
            </tr>
          </thead>
          <tbody>
            {perProduct.map((p) => {
              const own = rows.filter((r) => r.key === p.label)
              const recent = sum(
                own.filter((r) => r.date > yearAgo),
                'net',
              )
              const position = positions.find((pos) => pos.key === p.label)
              return (
                <tr key={p.label}>
                  <td>
                    <div>{own.at(-1)?.product ?? p.label}</div>
                    {own[0]?.isin && <div className="muted small">{own[0].isin}</div>}
                  </td>
                  <td className="num">{p.count}</td>
                  <td className="num">{formatEur(p.gross)}</td>
                  <td className="num">{formatEur(p.net)}</td>
                  <td className="num">{formatEur(recent)}</td>
                  <td className="num">{position && position.costBasis > 0 ? formatPercent(recent / position.costBasis, false) : '–'}</td>
                  <td className="num">{own.at(-1) ? formatDate((own.at(-1) as IncomeRow).date) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted small">All payments as booked, whatever the dashboard toggles say. Yield on cost only for positions held today.</p>
      </div>
    </>
  )
}

/** What the next 12 months will probably pay: last year's dividends per share on the shares held today. */
function ForecastPanel({ forecast, positions, today }: { forecast: DividendForecast; positions: Position[]; today: string }) {
  const value = positions.reduce((sum, p) => sum + Math.max(p.value, 0), 0)
  return (
    <div className="panel stack forecast">
      <h3>Expected in the next 12 months, based on last year</h3>
      <p className="callout info">
        Calculated from the dividends paid from <strong>{formatDate(addDays(today, -364))}</strong> to{' '}
        <strong>{formatDate(today)}</strong>: each one again a year later, per share, on the shares you hold today.
      </p>
      {forecast.payments.length === 0 ? (
        <p className="muted">
          No dividends expected: none of the positions held today paid a dividend in the last 12 months.
        </p>
      ) : (
        <>
          <div className="cards">
            <div className="card">
              <span className="card-label">Expected, net (from last year)</span>
              <span className="card-value positive">{formatEur(forecast.net)}</span>
              <span className="muted small">Gross {formatEur(forecast.gross)}</span>
            </div>
            <div className="card">
              <span className="card-label">A month on average</span>
              <span className="card-value">{formatEur(forecast.net / 12)}</span>
              <span className="muted small">Net, spread over the year</span>
            </div>
            <div className="card">
              <span className="card-label">Forward yield</span>
              <span className="card-value">{value > 0 ? formatPercent(forecast.gross / value, false) : '–'}</span>
              <span className="muted small">Gross, on the value of the portfolio today</span>
            </div>
          </div>
          <Suspense fallback={<div className="income-chart" />}>
            <MonthlyIncomeChart data={forecast.months} label="Expected net dividends per month" />
          </Suspense>
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Payments a year</th>
                <th className="num">Next payment</th>
                <th className="num">Expected gross</th>
                <th className="num">Expected net</th>
                <th className="num" title="Expected gross dividends divided by the value of the position today">
                  Yield
                </th>
              </tr>
            </thead>
            <tbody>
              {forecast.positions.map((p) => {
                const position = positions.find((pos) => pos.key === p.key)
                return (
                  <tr key={p.key}>
                    <td>
                      <div>{p.product}</div>
                      {p.isin && <div className="muted small">{p.isin}</div>}
                    </td>
                    <td className="num">{p.payments}</td>
                    <td className="num">{formatDate(p.next)}</td>
                    <td className="num">{formatEur(p.gross)}</td>
                    <td className="num">
                      <strong>{formatEur(p.net)}</strong>
                    </td>
                    <td className="num">{position && position.value > 0 ? formatPercent(p.gross / position.value, false) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
      <p className="muted small">
        An estimate: every dividend of the last 12 months, per share, paid again a year later on the shares held today, with
        the same withholding tax. Dividends can be raised, cut or moved; accumulating funds and positions that paid nothing
        last year count as zero.
      </p>
    </div>
  )
}
