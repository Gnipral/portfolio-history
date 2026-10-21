import { useMemo } from 'react'
import { realizedByYear, realizedSales } from '../../engine/analysis/realized.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { formatEur, formatSignedEur, trendClass } from '../format.ts'
import { SalesTable } from './SalesTable.tsx'

interface Props {
  inputs: EngineInputs
  options: EngineOptions
}

/** Profit and loss of every sale, with the cost basis method and toggles of the dashboard. */
export function RealizedSection({ inputs, options }: Props) {
  const sales = useMemo(() => realizedSales(inputs.transactions, options), [inputs, options])
  const years = useMemo(() => realizedByYear(sales), [sales])
  if (sales.length === 0) return <p className="muted">No sales yet.</p>

  return (
    <>
      <div className="panel">
        <h3>Realized per year</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Sales</th>
              <th className="num">Proceeds</th>
              <th className="num">Cost basis</th>
              <th className="num">Gains</th>
              <th className="num">Losses</th>
              <th className="num">Net</th>
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
          Cost basis by the {options.costBasis === 'fifo' ? 'FIFO' : 'average cost'} method of the settings. Costs and taxes count
          as the dashboard toggles say. Dividends are not included; see Dividends.
        </p>
      </div>
      <div className="panel">
        <h3>Every sale</h3>
        <SalesTable sales={sales} />
      </div>
    </>
  )
}
