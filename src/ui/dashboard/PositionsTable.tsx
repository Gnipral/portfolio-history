import { useMemo, useState } from 'react'
import type { Position } from '../../engine/positions.ts'
import { formatDate, formatEur, formatPercent, formatSignedEur, trendClass } from '../format.ts'
import { nextSort, sortPositions, withWeights, type PositionColumn, type SortState } from './positionSort.ts'

const COLUMNS: { key: PositionColumn; label: string; numeric: boolean }[] = [
  { key: 'product', label: 'Product', numeric: false },
  { key: 'quantity', label: 'Quantity', numeric: true },
  { key: 'averageCost', label: 'Avg cost', numeric: true },
  { key: 'price', label: 'Price', numeric: true },
  { key: 'value', label: 'Value', numeric: true },
  { key: 'pnl', label: 'P/L', numeric: true },
  { key: 'pnlPercent', label: 'P/L %', numeric: true },
  { key: 'weight', label: 'Weight', numeric: true },
]

const quantityFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 })

interface Props {
  positions: Position[]
  date: string
  /** Key of the position whose chart is open. */
  selectedKey?: string | null
  onSelect?: (key: string) => void
}

export function PositionsTable({ positions, date, selectedKey = null, onSelect }: Props) {
  const [sort, setSort] = useState<SortState>({ column: 'value', descending: true })
  const rows = useMemo(() => sortPositions(withWeights(positions), sort), [positions, sort])

  if (rows.length === 0) return <p className="muted">No open positions on {formatDate(date)}.</p>

  return (
    <table className="table positions">
      <thead>
        <tr>
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
        {rows.map((row) => (
          <tr key={row.key} className={row.key === selectedKey ? 'selected' : undefined}>
            <td>
              {onSelect ? (
                <button type="button" className="link-button" aria-expanded={row.key === selectedKey} onClick={() => onSelect(row.key)}>
                  {row.product}
                </button>
              ) : (
                <div>{row.product}</div>
              )}
              <div className="muted small">{[row.symbol, row.isin].filter(Boolean).join(' · ')}</div>
            </td>
            <td className="num">{quantityFormat.format(row.quantity)}</td>
            <td className="num">{formatEur(row.averageCost)}</td>
            <td className="num">
              {row.price === undefined ? '–' : formatEur(row.price)}
              {(row.stale || row.priceSource === 'trade') && (
                <span
                  className="badge warning"
                  title={
                    row.priceSource === 'trade'
                      ? 'No market price: valued at the last trade price'
                      : `Last market price from ${row.priceDate ? formatDate(row.priceDate) : 'an earlier date'}`
                  }
                >
                  {row.priceSource === 'trade' ? 'trade' : 'old'}
                </span>
              )}
            </td>
            <td className="num">{formatEur(row.value)}</td>
            <td className={`num ${trendClass(row.pnl)}`}>{formatSignedEur(row.pnl)}</td>
            <td className={`num ${trendClass(row.pnlPercent)}`}>{formatPercent(row.pnlPercent)}</td>
            <td className="num">{formatPercent(row.weight, false)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
