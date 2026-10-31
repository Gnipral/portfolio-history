import { Fragment, useMemo, useState, type ReactNode } from 'react'
import type { Position } from '../../engine/positions.ts'
import { t } from '../../i18n/i18n.ts'
import { formatDate, formatEur, formatPercent, formatQuantity, formatSignedEur } from '../format.ts'
import { nextSort, sortPositions, withWeights, type PositionColumn, type SortState } from './positionSort.ts'

/** What the product cell says under the name: where it is listed, what it is and its currency. */
export interface HoldingFacts {
  exchange?: string
  type: string
  currency: string
}

const COLUMNS: { key: PositionColumn; label: string; numeric: boolean }[] = [
  { key: 'product', label: t('Product'), numeric: false },
  { key: 'quantity', label: t('Quantity'), numeric: true },
  { key: 'averageCost', label: t('Avg cost'), numeric: true },
  { key: 'price', label: t('Price'), numeric: true },
  { key: 'value', label: t('Value'), numeric: true },
  { key: 'weight', label: t('Weight'), numeric: true },
  { key: 'pnl', label: t('Unrealized profit'), numeric: true },
  { key: 'pnlPercent', label: t('Total return'), numeric: true },
]

interface Props {
  positions: Position[]
  date: string
  facts?: Map<string, HoldingFacts>
  /** Key of the position whose row is open. */
  selectedKey?: string | null
  onSelect?: (key: string) => void
  /** What an open row shows: the position's own chart. */
  detail?: (key: string) => ReactNode
}

/** The holdings on a day, largest first; a click on a row opens it in place. */
export function PositionsTable({ positions, date, facts, selectedKey = null, onSelect, detail }: Props) {
  const [sort, setSort] = useState<SortState>({ column: 'value', descending: true })
  const rows = useMemo(() => sortPositions(withWeights(positions), sort), [positions, sort])

  if (rows.length === 0) return <p className="muted">{t('No open positions on {date}.', { date: formatDate(date) })}</p>

  const value = rows.reduce((sum, row) => sum + row.value, 0)
  const cost = rows.reduce((sum, row) => sum + row.costBasis, 0)
  const pnl = value - cost

  return (
    <table className="table holdings">
      <thead>
        <tr>
          <th>{t('ISIN')}</th>
          {COLUMNS.map((column) => (
            <th
              key={column.key}
              className={column.numeric ? 'num' : undefined}
              aria-sort={sort.column === column.key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
            >
              <button type="button" className="sort-button" onClick={() => setSort(nextSort(sort, column.key))}>
                {column.label}
                {sort.column === column.key && <span aria-hidden="true">{sort.descending ? ' ▼' : ' ▲'}</span>}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const open = row.key === selectedKey
          const fact = facts?.get(row.key)
          return (
            <Fragment key={row.key}>
              <tr className={`holding${open ? ' selected' : ''}${onSelect ? ' clickable' : ''}`} onClick={onSelect ? () => onSelect(row.key) : undefined}>
                <td className="isin">{row.isin ?? '–'}</td>
                <td>
                  {onSelect ? (
                    <button
                      type="button"
                      className="holding-name"
                      aria-expanded={open}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect(row.key)
                      }}
                    >
                      {row.product}
                    </button>
                  ) : (
                    <div className="holding-name">{row.product}</div>
                  )}
                  <div className="holding-facts">
                    {[fact?.exchange, fact?.type, fact?.currency, row.symbol].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td className="num">{formatQuantity(row.quantity)}</td>
                <td className="num">{formatEur(row.averageCost)}</td>
                <td className="num">
                  {row.price === undefined ? '–' : formatEur(row.price)}
                  {(row.stale || row.priceSource === 'trade') && (
                    <span
                      className="badge"
                      title={
                        row.priceSource === 'trade'
                          ? t('No market price: valued at the last trade price')
                          : t('Last market price from {date}', { date: row.priceDate ? formatDate(row.priceDate) : t('an earlier date') })
                      }
                    >
                      {row.priceSource === 'trade' ? t('trade') : t('old')}
                    </span>
                  )}
                </td>
                <td className="num">{formatEur(row.value)}</td>
                <td className="num">{formatPercent(row.weight, false)}</td>
                <td className="num">{formatSignedEur(row.pnl)}</td>
                <td className="num">{formatPercent(row.pnlPercent)}</td>
              </tr>
              {open && detail && (
                <tr className="holding-detail">
                  <td colSpan={COLUMNS.length + 1}>{detail(row.key)}</td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={5}>{t('Total')}</td>
          <td className="num">{formatEur(value)}</td>
          <td className="num">{formatPercent(1, false)}</td>
          <td className="num">{formatSignedEur(pnl)}</td>
          <td className="num">{cost > 0 ? formatPercent(pnl / cost) : '–'}</td>
        </tr>
      </tfoot>
    </table>
  )
}
