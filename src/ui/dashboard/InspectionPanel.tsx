import type { Position } from '../../engine/positions.ts'
import { locale, t } from '../../i18n/i18n.ts'
import type { Transaction } from '../../model/transaction.ts'
import { shortName } from '../share/shareCard.ts'
import { formatDate, formatEur, formatPercent, formatQuantity, formatSignedEur, formatStoredEur } from '../format.ts'
import type { PeriodFigures, PeriodMwr } from './periodFigures.ts'
import { bestAndWorst, type PeriodProfit } from './profit.ts'

const monthYear = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dayMonth = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
const utc = (date: string) => new Date(`${date}T00:00:00Z`)

function periodLabel(period: PeriodProfit, end: string): string {
  if (period.key === 'day') return dayMonth.format(utc(end))
  if (period.key === 'month') return monthYear.format(utc(end))
  if (period.key === 'year') return end.slice(0, 4)
  return t('Since the start')
}

const TYPE_LABELS: Partial<Record<Transaction['type'], string>> = {
  buy: t('Buy'),
  sell: t('Sell'),
  dividend: t('Dividend'),
  deposit: t('Deposit'),
  withdrawal: t('Withdrawal'),
  fee: t('Fee'),
  tax: t('Tax'),
  fx: t('Currency exchange'),
  split: t('Split'),
  transferIn: t('Transfer in'),
  transferOut: t('Transfer out'),
  other: t('Other'),
}

/** XIRR per year, or over the period when it is shorter than a year. */
export function formatMwr(mwr: PeriodMwr | undefined): string {
  if (!mwr) return '–'
  return mwr.annual ? `${formatPercent(mwr.value)} ${t('p.a.')}` : `${formatPercent(mwr.value)} ${t('in {days} d', { days: mwr.days })}`
}

interface Props {
  date: string
  /** The playhead was set by hand; `onUnpin` puts it back at the end of the period. */
  pinned: boolean
  onUnpin: () => void
  /** From the start of the period up to `date`. */
  figures: PeriodFigures
  benchmarkLabel?: string | undefined
  periods: PeriodProfit[]
  positions: Position[]
  transactions: Transaction[]
  /** Cash on the day, when the portfolio holds cash. */
  cash?: number | undefined
  unrealized: number
  realized: number
}

/** "State inspection": the portfolio on the inspected day, as a plain list of label and number. */
export function InspectionPanel({ date, pinned, onUnpin, figures, benchmarkLabel, periods, positions, transactions, cash, unrealized, realized }: Props) {
  const extremes = bestAndWorst(positions)
  return (
    <aside className="inspection" aria-label={t('State inspection')}>
      <div className="inspection-head">
        <span className="label-caps">{t('State inspection')}</span>
        {pinned && (
          <button type="button" className="pinned" onClick={onUnpin} aria-label={t('Unpin: back to the end of the period')} title={t('Back to the end of the period')}>
            {t('Pinned')} ×
          </button>
        )}
      </div>
      <div className="inspection-date">
        <span className="label-caps">{t('Valuation date')}</span>
        <strong className="inspection-day">{formatDate(date)}</strong>
      </div>

      {transactions.length > 0 && (
        <ul className="inspection-trades" aria-label={t('Transactions on this day')}>
          {transactions.map((tx) => (
            <li key={tx.id}>
              <span className="label-caps">{TYPE_LABELS[tx.type] ?? tx.type}</span>
              <span className="trade-product">{tx.product}</span>
              <span className="figure">
                {tx.quantity ? `${formatQuantity(tx.quantity)} · ` : ''}
                {formatStoredEur(tx.totalEur)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="kv">
        <dt>{t('Portfolio value')}</dt>
        <dd>{formatEur(figures.value)}</dd>
        <dt>{t('Invested capital')}</dt>
        <dd>{formatEur(figures.invested)}</dd>
        <dt>{t('Profit')}</dt>
        <dd>{formatSignedEur(figures.pnl)}</dd>
        <dt>{t('Profit (%)')}</dt>
        <dd>{formatPercent(figures.pnlPercent)}</dd>
        <dt>{t('TWR')}</dt>
        <dd>{formatPercent(figures.twr)}</dd>
        <dt>{t('XIRR')}</dt>
        <dd>{formatMwr(figures.mwr)}</dd>
        {figures.benchmark && (
          <>
            <dt className="benchmark">{t('{name} (same capital)', { name: benchmarkLabel ?? t('Benchmark') })}</dt>
            <dd className="benchmark">
              {formatEur(figures.benchmark.value)}
              <span className="kv-note">{formatPercent(figures.benchmark.twr)}</span>
            </dd>
          </>
        )}
      </dl>
      {figures.alpha && (
        <dl className="kv alpha">
          <dt>{t('Alpha / outperformance')}</dt>
          <dd>
            {formatSignedEur(figures.alpha.pnl)}
            <span className="kv-note">{formatPercent(figures.alpha.twr)}</span>
          </dd>
        </dl>
      )}

      <div className="inspection-block">
        <span className="label-caps">{t('Profit')}</span>
        <div className="inspection-profits">
          {periods.map((period) => (
            <div key={period.key}>
              <span className="label-caps">{periodLabel(period, date)}</span>
              <span className="figure">{formatSignedEur(period.pnl)}</span>
              <span className="kv-note">{formatPercent(period.twr)}</span>
            </div>
          ))}
        </div>
        <dl className="kv kv-small">
          {extremes && (
            <>
              <div className="kv-row">
                <dt title={extremes.best.product}>
                  {t('Best')}: {shortName(extremes.best)}
                </dt>
                <dd>{formatPercent(extremes.best.pnlPercent)}</dd>
              </div>
              <div className="kv-row">
                <dt title={extremes.worst.product}>
                  {t('Worst')}: {shortName(extremes.worst)}
                </dt>
                <dd>{formatPercent(extremes.worst.pnlPercent)}</dd>
              </div>
            </>
          )}
        </dl>
      </div>

      <dl className="kv kv-small">
        {cash !== undefined && (
          <>
            <dt>{t('Cash balance')}</dt>
            <dd>{formatEur(cash)}</dd>
          </>
        )}
        <dt>{t('Unrealized gain')}</dt>
        <dd>{formatSignedEur(unrealized)}</dd>
        <dt>{t('Realized gain')}</dt>
        <dd>{formatSignedEur(realized)}</dd>
      </dl>
    </aside>
  )
}
