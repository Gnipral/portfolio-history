import { otherAssetsOn, type OtherAsset } from '../../engine/otherAssets.ts'
import type { DailyPoint } from '../../engine/series.ts'
import { t, tn } from '../../i18n/i18n.ts'
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
    label: t('Money-weighted return'),
    value: value === undefined ? '–' : formatPercent(value),
    ...(value === undefined ? {} : { trend: value }),
    hint: annual ? t('XIRR, per year') : t('Over {days} days, not per year', { days }),
  }
}

/** The portfolio value, large, with the result so far as a pill under it. */
function ValueCard({ point, cashMode }: { point: DailyPoint; cashMode: boolean }) {
  return (
    <div className="card hero">
      <span className="card-label">{t('Value')}</span>
      <span className="card-value">{formatEur(point.value)}</span>
      <span className={`pill ${trendClass(point.pnl)}`} title={t('Profit / loss and simple return')}>
        {point.pnl < 0 ? '▼' : '▲'} {formatSignedEur(point.pnl)} ({formatPercent(point.simpleReturn)})
      </span>
      <span className="muted small">{cashMode ? t('Securities and cash') : t('Securities')}</span>
    </div>
  )
}

export function SummaryCards({ point, cashMode, otherAssets = [] }: { point: DailyPoint; cashMode: boolean; otherAssets?: OtherAsset[] }) {
  const others = otherAssetsOn(otherAssets, point.date)
  const cards: Card[] = [
    {
      label: t('Invested'),
      value: formatEur(point.invested),
      hint: cashMode ? t('Deposits minus withdrawals') : t('Bought minus sold'),
    },
    { label: t('Profit / loss'), value: formatSignedEur(point.pnl), trend: point.pnl },
    { label: t('Realized'), value: formatSignedEur(point.realized), trend: point.realized },
    { label: t('Unrealized'), value: formatSignedEur(point.unrealized), trend: point.unrealized },
    {
      label: t('Simple return'),
      value: formatPercent(point.simpleReturn),
      trend: point.simpleReturn,
      hint: t('Profit / highest invested capital'),
    },
    { label: t('Time-weighted return'), value: formatPercent(point.twr), trend: point.twr, hint: t('TWR, independent of deposits') },
    moneyWeighted(point),
    ...(others.count > 0
      ? [{ label: t('Net worth'), value: formatEur(point.value + others.total), hint: tn(others.count, 'With {count} other asset (Analysis > Planning)', 'With {count} other assets (Analysis > Planning)') }]
      : []),
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
          {tn(
            point.estimated,
            '{count} position is valued with a trade price or an outdated market price on this date. See Prices.',
            '{count} positions are valued with a trade price or an outdated market price on this date. See Prices.',
          )}
        </p>
      )}
    </div>
  )
}
