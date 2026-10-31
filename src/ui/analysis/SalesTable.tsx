import type { Sale } from '../../engine/ledger.ts'
import { t } from '../../i18n/i18n.ts'
import { formatDate, formatEur, formatPercent, formatQuantity, formatSignedEur, trendClass } from '../format.ts'


/** Sales, newest first, with their cost basis and result. */
export function SalesTable({ sales }: { sales: Sale[] }) {
  const rows = [...sales].reverse()
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('Date')}</th>
          <th>{t('Product')}</th>
          <th className="num">{t('Quantity')}</th>
          <th className="num">{t('Proceeds')}</th>
          <th className="num">{t('Cost basis')}</th>
          <th className="num">{t('Result')}</th>
          <th className="num">%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s, i) => (
          <tr key={`${s.date}-${s.key}-${i}`}>
            <td>{formatDate(s.date)}</td>
            <td>
              <div>{s.product}</div>
              {s.isin && <div className="muted small">{s.isin}</div>}
            </td>
            <td className="num">{formatQuantity(s.quantity)}</td>
            <td className="num">{formatEur(s.proceeds)}</td>
            <td className="num">{formatEur(s.cost)}</td>
            <td className={`num ${trendClass(s.gain)}`}>{formatSignedEur(s.gain)}</td>
            <td className={`num ${trendClass(s.gain)}`}>{s.cost > 0 ? formatPercent(s.gain / s.cost) : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
