import { useMemo } from 'react'
import { realizedByYear, realizedSales } from '../../engine/analysis/realized.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { formatEur, formatSignedEur, trendClass } from '../format.ts'
import { SalesTable } from './SalesTable.tsx'
import { DownloadCsvButton } from '../components/DownloadCsvButton.tsx'
import { salesRows } from '../csvTables.ts'
import { localToday } from '../../market/dates.ts'
import { t } from '../../i18n/i18n.ts'

interface Props {
  inputs: EngineInputs
  options: EngineOptions
}

/** Profit and loss of every sale, with the cost basis method and toggles of the dashboard. */
export function RealizedSection({ inputs, options }: Props) {
  const sales = useMemo(() => realizedSales(inputs.transactions, options), [inputs, options])
  const years = useMemo(() => realizedByYear(sales), [sales])
  if (sales.length === 0) return <p className="muted">{t('No sales yet.')}</p>

  return (
    <>
      <div className="panel">
        <h3>{t('Realized per year')}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>{t('Year')}</th>
              <th className="num">{t('Sales')}</th>
              <th className="num">{t('Proceeds')}</th>
              <th className="num">{t('Cost basis')}</th>
              <th className="num">{t('Gains')}</th>
              <th className="num">{t('Losses')}</th>
              <th className="num">{t('Net')}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td className="num">{y.count}</td>
                <td className="num">{formatEur(y.proceeds)}</td>
                <td className="num">{formatEur(y.cost)}</td>
                <td className="num positive">{formatEur(y.gains)}</td>
                <td className="num negative">{formatEur(y.losses)}</td>
                <td className={`num ${trendClass(y.net)}`}>
                  <strong>{formatSignedEur(y.net)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          {options.costBasis === 'fifo'
            ? t('Cost basis by the FIFO method of the settings. Costs and taxes count as the dashboard toggles say. Dividends are not included; see Dividends.')
            : t('Cost basis by the average cost method of the settings. Costs and taxes count as the dashboard toggles say. Dividends are not included; see Dividends.')}
        </p>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h3>{t('Every sale')}</h3>
          <DownloadCsvButton rows={() => salesRows(sales, inputs.currency)} name={`sales-${localToday()}`} what={t('every sale')} />
        </div>
        <SalesTable sales={sales} />
      </div>
    </>
  )
}
