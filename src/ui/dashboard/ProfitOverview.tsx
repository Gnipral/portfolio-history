import type { Position } from '../../engine/positions.ts'
import { shortName } from '../share/shareCard.ts'
import { formatPercent, formatSignedEur, trendClass } from '../format.ts'
import { bestAndWorst, type PeriodProfit } from './profit.ts'

const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const utc = (date: string) => new Date(`${date}T00:00:00Z`)

function periodLabel(period: PeriodProfit, end: string): string {
  if (period.key === 'day') return dayMonth.format(utc(end))
  if (period.key === 'month') return monthYear.format(utc(end))
  if (period.key === 'year') return end.slice(0, 4)
  return 'Since the start'
}

interface Props {
  periods: PeriodProfit[]
  /** The selected day: the end of every period. */
  date: string
  positions: Position[]
  /** Profit of the same money in the first benchmark, on the selected day. */
  benchmark?: { label: string; pnl: number } | undefined
  /** Profit since the start, to compare with the benchmark. */
  pnl: number
}

/** Profit per period in euros and percent, the best and worst position, and the gap with the benchmark. */
export function ProfitOverview({ periods, date, positions, benchmark, pnl }: Props) {
  const extremes = bestAndWorst(positions)
  const gap = benchmark ? pnl - benchmark.pnl : 0

  return (
    <section className="profit-overview panel" aria-labelledby="profit-title">
      <h3 id="profit-title" className="cards-title">
        Profit
      </h3>
      <div className="profit-periods">
        {periods.map((period) => (
          <div key={period.key} className="profit-period">
            <span className="card-label">{periodLabel(period, date)}</span>
            <span className={`profit-eur ${trendClass(period.pnl)}`}>{formatSignedEur(period.pnl)}</span>
            <span className={`small ${trendClass(period.twr)}`}>{formatPercent(period.twr)}</span>
          </div>
        ))}
      </div>
      {(extremes || benchmark) && (
        <ul className="profit-facts">
          {extremes && (
            <>
              <li>
                <span className="card-label">Best position</span>
                <strong title={extremes.best.product}>{shortName(extremes.best)}</strong>
                <span className={trendClass(extremes.best.pnlPercent)}>
                  {formatPercent(extremes.best.pnlPercent)} · {formatSignedEur(extremes.best.pnl)}
                </span>
              </li>
              <li>
                <span className="card-label">Worst position</span>
                <strong title={extremes.worst.product}>{shortName(extremes.worst)}</strong>
                <span className={trendClass(extremes.worst.pnlPercent)}>
                  {formatPercent(extremes.worst.pnlPercent)} · {formatSignedEur(extremes.worst.pnl)}
                </span>
              </li>
            </>
          )}
          {benchmark && (
            <li>
              <span className="card-label">Versus {benchmark.label}</span>
              <strong className={trendClass(gap)}>{formatSignedEur(gap)}</strong>
              <span className="muted">
                {gap >= 0 ? 'more' : 'less'} than the same money in {benchmark.label}
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
