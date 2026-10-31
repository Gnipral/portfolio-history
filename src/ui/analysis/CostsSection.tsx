import { useMemo } from 'react'
import { chargesByYear } from '../../engine/analysis/charges.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { computeDailySeries, type SeriesResult } from '../../engine/series.ts'
import { localToday } from '../../market/dates.ts'
import { formatEur, formatPercent } from '../format.ts'
import { DownloadCsvButton } from '../components/DownloadCsvButton.tsx'
import { chargesRows } from '../csvTables.ts'
import { t } from '../../i18n/i18n.ts'

interface Props {
  inputs: EngineInputs
  options: EngineOptions
  series: SeriesResult
}

/** What the portfolio paid besides the investments, and what that cost in return. */
export function CostsSection({ inputs, options, series }: Props) {
  const years = useMemo(() => chargesByYear(inputs.transactions), [inputs])
  // The same portfolio as if no costs, taxes or FX costs had been paid.
  const withoutCharges = useMemo(
    () =>
      computeDailySeries(inputs.transactions, inputs.prices, { ...options, includeCosts: false, includeTaxes: false, includeFxCosts: false }, localToday()).points.at(-1),
    [inputs, options],
  )
  const now = series.points.at(-1)
  const total = years.reduce(
    (sum, y) => ({
      transactionCosts: sum.transactionCosts + y.transactionCosts,
      fxCosts: sum.fxCosts + y.fxCosts,
      taxes: sum.taxes + y.tradeTaxes + y.incomeTaxes + y.otherTaxes,
      total: sum.total + y.total,
    }),
    { transactionCosts: 0, fxCosts: 0, taxes: 0, total: 0 },
  )
  const counted = options.includeCosts || options.includeTaxes || options.includeFxCosts

  return (
    <>
      <div className="cards">
        <div className="card">
          <span className="card-label">{t('Paid in total')}</span>
          <span className="card-value negative">{formatEur(total.total)}</span>
          <span className="muted small">
            {t('Costs {costs} · FX {fx} · taxes {taxes}', { costs: formatEur(total.transactionCosts, true), fx: formatEur(total.fxCosts, true), taxes: formatEur(total.taxes, true) })}
          </span>
        </div>
        {now && withoutCharges && counted && (
          <>
            <div className="card">
              <span className="card-label">{t('Profit without them')}</span>
              <span className="card-value">{formatEur(withoutCharges.pnl)}</span>
              <span className="muted small">{t('{difference} more than the {now} now', { difference: formatEur(withoutCharges.pnl - now.pnl), now: formatEur(now.pnl) })}</span>
            </div>
            <div className="card">
              <span className="card-label">{t('Time-weighted return lost')}</span>
              <span className="card-value negative">{formatPercent(now.twr - withoutCharges.twr)}</span>
              <span className="muted small">
                {t('{now} instead of {without}', { now: formatPercent(now.twr), without: formatPercent(withoutCharges.twr) })}
              </span>
            </div>
          </>
        )}
      </div>
      {!counted && <p className="muted small">{t('Costs, taxes and FX costs are all switched off on the dashboard, so they do not lower its figures.')}</p>}

      <div className="panel">
        <div className="panel-header">
          <h3>{t('Per year')}</h3>
          <DownloadCsvButton rows={() => chargesRows(years, inputs.currency)} name={`costs-${localToday()}`} what={t('the costs per year')} />
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t('Year')}</th>
              <th className="num">{t('Transaction costs')}</th>
              <th className="num">{t('FX costs')}</th>
              <th className="num">{t('Taxes on trades')}</th>
              <th className="num">{t('Taxes on income')}</th>
              <th className="num">{t('Other taxes')}</th>
              <th className="num">{t('Total')}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td className="num">{formatEur(y.transactionCosts)}</td>
                <td className="num">{formatEur(y.fxCosts)}</td>
                <td className="num">{formatEur(y.tradeTaxes)}</td>
                <td className="num">{formatEur(y.incomeTaxes)}</td>
                <td className="num">{formatEur(y.otherTaxes)}</td>
                <td className="num">
                  <strong>{formatEur(y.total)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          {t('Transaction costs include fees booked on their own, such as connection and custody fees. The comparison counts only the charges that the dashboard toggles include.')}
        </p>
      </div>
    </>
  )
}
