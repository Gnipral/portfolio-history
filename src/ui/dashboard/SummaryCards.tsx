import type { DailyPoint } from '../../engine/series.ts'
import { formatDate, formatEur, formatPercent, formatSignedEur, trendClass } from '../format.ts'

interface Card {
  label: string
  value: string
  trend?: number
  hint?: string
}

/** Annualized from one year of history on; before that over the period, since a year's rate from a few weeks is meaningless. */
function moneyWeighted(point: DailyPoint): Card {
  const days = point.irrDays ?? 0
  const annual = days >= 365
  const value = annual ? point.irr : point.irrPeriod
  return {
    label: 'Money-weighted return',
    value: value === undefined ? '–' : formatPercent(value),
    ...(value === undefined ? {} : { trend: value }),
    hint: annual ? 'XIRR, per year' : `Over ${days} days, not per year`,
  }
}

/** The portfolio value, large, with the result so far as a pill under it. */
function ValueCard({ point, cashMode }: { point: DailyPoint; cashMode: boolean }) {
  return (
    <div className="card hero">
      <span className="card-label">Value</span>
      <span className="card-value">{formatEur(point.value)}</span>
      <span className={`pill ${trendClass(point.pnl)}`} title="Profit / loss and simple return">
        {point.pnl < 0 ? '▼' : '▲'} {formatSignedEur(point.pnl)} ({formatPercent(point.simpleReturn)})
      </span>
      <span className="muted small">{cashMode ? 'Securities and cash' : 'Securities'}</span>
    </div>
  )
}

export function SummaryCards({ point, cashMode }: { point: DailyPoint; cashMode: boolean }) {
  const cards: Card[] = [
    {
      label: 'Invested',
      value: formatEur(point.invested),
      hint: cashMode ? 'Deposits minus withdrawals' : 'Bought minus sold',
    },
    { label: 'Profit / loss', value: formatSignedEur(point.pnl), trend: point.pnl },
    { label: 'Realized', value: formatSignedEur(point.realized), trend: point.realized },
    { label: 'Unrealized', value: formatSignedEur(point.unrealized), trend: point.unrealized },
    {
      label: 'Simple return',
      value: formatPercent(point.simpleReturn),
      trend: point.simpleReturn,
      hint: 'Profit / highest invested capital',
    },
    { label: 'Time-weighted return', value: formatPercent(point.twr), trend: point.twr, hint: 'TWR, independent of deposits' },
    moneyWeighted(point),
  ]

  return (
    <div className="stack">
      <h3 className="cards-title">{formatDate(point.date)}</h3>
      <div className="cards">
        <ValueCard point={point} cashMode={cashMode} />
        {cards.map((card) => (
          <div className="card" key={card.label}>
            <span className="card-label">{card.label}</span>
            <span className={`card-value ${card.trend === undefined ? '' : trendClass(card.trend)}`}>{card.value}</span>
            {card.hint && <span className="muted small">{card.hint}</span>}
          </div>
        ))}
      </div>
      {point.estimated > 0 && (
        <p className="muted small">
          {point.estimated} {point.estimated === 1 ? 'position is' : 'positions are'} valued with a trade price or an
          outdated market price on this date. See Prices.
        </p>
      )}
    </div>
  )
}
