import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Position } from '../../engine/positions.ts'
import { nextSort, sortPositions, withWeights } from './positionSort.ts'
import { PositionsTable } from './PositionsTable.tsx'

function position(product: string, value: number, cost: number, extra: Partial<Position> = {}): Position {
  return {
    key: product,
    product,
    quantity: 10,
    averageCost: cost / 10,
    costBasis: cost,
    price: value / 10,
    priceSource: 'market',
    stale: false,
    value,
    pnl: value - cost,
    pnlPercent: (value - cost) / cost,
    ...extra,
  }
}

const positions = [position('Beta', 300, 200), position('Alpha', 700, 800), position('Gamma', 0, 100, { quantity: 0 })]

afterEach(cleanup)

describe('position sorting', () => {
  it('adds the weight in the total value', () => {
    expect(withWeights(positions).map((r) => r.weight)).toEqual([0.3, 0.7, 0])
  })

  it('sorts by any column', () => {
    const rows = withWeights(positions)
    expect(sortPositions(rows, { column: 'value', descending: true }).map((r) => r.product)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(sortPositions(rows, { column: 'pnl', descending: true }).map((r) => r.product)).toEqual(['Beta', 'Alpha', 'Gamma'])
    expect(sortPositions(rows, { column: 'product', descending: false }).map((r) => r.product)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('flips the direction on the active column', () => {
    expect(nextSort({ column: 'value', descending: true }, 'value')).toEqual({ column: 'value', descending: false })
    expect(nextSort({ column: 'value', descending: true }, 'product')).toEqual({ column: 'product', descending: false })
    expect(nextSort({ column: 'product', descending: false }, 'pnl')).toEqual({ column: 'pnl', descending: true })
  })
})

describe('PositionsTable', () => {
  const products = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent)

  it('shows the largest position first and sorts on click', () => {
    render(<PositionsTable positions={positions.slice(0, 2)} date="2026-10-19" />)
    expect(products()).toEqual(['Alpha', 'Beta'])
    fireEvent.click(screen.getByRole('button', { name: /Product/ }))
    expect(products()).toEqual(['Alpha', 'Beta'])
    fireEvent.click(screen.getByRole('button', { name: /P\/L %/ }))
    expect(products()).toEqual(['Beta', 'Alpha'])
    expect(screen.getByRole('columnheader', { name: /P\/L %/ }).getAttribute('aria-sort')).toBe('descending')
  })

  it('marks positions valued at a trade price', () => {
    render(<PositionsTable positions={[position('Delisted', 100, 120, { priceSource: 'trade' })]} date="2026-10-19" />)
    expect(screen.getByText('trade')).toBeTruthy()
  })

  it('says when nothing is held', () => {
    render(<PositionsTable positions={[]} date="2026-10-19" />)
    expect(screen.getByText('No open positions on 19 Oct 2026.')).toBeTruthy()
  })
})
