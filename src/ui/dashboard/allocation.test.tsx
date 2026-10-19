import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { tx } from '../../engine/testing.ts'
import type { Position } from '../../engine/positions.ts'
import { allocationSlices, colorSlots, SERIES_SLOTS } from './allocation.ts'
import { AllocationChart } from './AllocationChart.tsx'

const position = (key: string, value: number): Position => ({
  key,
  product: `Product ${key}`,
  quantity: 1,
  averageCost: value,
  costBasis: value,
  price: value,
  stale: false,
  value,
  pnl: 0,
  pnlPercent: 0,
})

afterEach(cleanup)

describe('colorSlots', () => {
  it('gives the instruments with the most money invested a fixed slot', () => {
    const transactions = Array.from({ length: 9 }, (_, i) =>
      tx('buy', '2026-01-01', { isin: `K${i}`, quantity: 1, amount: (i + 1) * 100 }),
    )
    const slots = colorSlots(transactions)
    expect(slots.size).toBe(SERIES_SLOTS)
    expect(slots.get('K8')).toBe(1)
    expect(slots.get('K2')).toBe(7)
    expect(slots.has('K1')).toBe(false)
  })
})

describe('allocationSlices', () => {
  const slots = new Map([
    ['A', 2],
    ['B', 1],
  ])

  it('keeps slot order, folds the rest into Other and ignores empty positions', () => {
    const slices = allocationSlices([position('A', 300), position('B', 500), position('C', 200), position('D', 0)], slots)
    expect(slices.map((s) => [s.key, s.slot, s.share])).toEqual([
      ['B', 1, 0.5],
      ['A', 2, 0.3],
      ['other', 0, 0.2],
    ])
  })

  it('keeps the color of an instrument when its rank changes', () => {
    const slices = allocationSlices([position('A', 900), position('B', 100)], slots)
    expect(slices.find((s) => s.key === 'A')?.slot).toBe(2)
  })

  it('is empty without value', () => {
    expect(allocationSlices([], slots)).toEqual([])
  })
})

describe('AllocationChart', () => {
  it('names every slice with its share in the legend', () => {
    render(
      <AllocationChart
        slices={[
          { key: 'B', label: 'Beta', value: 500, share: 0.625, slot: 1 },
          { key: 'other', label: 'Other', value: 300, share: 0.375, slot: 0 },
        ]}
      />,
    )
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('62.50%')).toBeTruthy()
    expect(screen.getByRole('img', { name: /Allocation/ })).toBeTruthy()
  })
})
