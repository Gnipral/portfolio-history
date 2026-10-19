import type { Position } from '../../engine/positions.ts'

export type PositionColumn = 'product' | 'quantity' | 'averageCost' | 'price' | 'value' | 'pnl' | 'pnlPercent' | 'weight'

export interface PositionRow extends Position {
  /** Share of the total market value of the open positions. */
  weight: number
}

export interface SortState {
  column: PositionColumn
  descending: boolean
}

export function withWeights(positions: Position[]): PositionRow[] {
  const total = positions.reduce((sum, p) => sum + p.value, 0)
  return positions.map((p) => ({ ...p, weight: total > 0 ? p.value / total : 0 }))
}

export function sortPositions(rows: PositionRow[], sort: SortState): PositionRow[] {
  const direction = sort.descending ? -1 : 1
  return [...rows].sort((a, b) => {
    const difference =
      sort.column === 'product' ? a.product.localeCompare(b.product) : (a[sort.column] ?? 0) - (b[sort.column] ?? 0)
    return difference * direction || a.product.localeCompare(b.product)
  })
}

/** Clicking the active column flips the direction; a new column starts high-to-low, text A-Z. */
export function nextSort(current: SortState, column: PositionColumn): SortState {
  if (current.column === column) return { column, descending: !current.descending }
  return { column, descending: column !== 'product' }
}
