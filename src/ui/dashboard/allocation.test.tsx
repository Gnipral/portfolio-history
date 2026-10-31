import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tx } from '../../engine/testing.ts'
import type { Position } from '../../engine/positions.ts'
import { allocationSlices, colorSlots, groupedSlices, instrumentFacts, SERIES_SLOTS } from './allocation.ts'
import { AllocationBar } from './AllocationBar.tsx'

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

describe('AllocationBar', () => {
  const slices = [
    { key: 'other', label: 'Other', value: 300, share: 0.375, slot: 0 },
    { key: 'B', label: 'Beta', value: 500, share: 0.625, slot: 1 },
  ]

  it('draws one segment per slice, largest first, and names each with its share', () => {
    render(<AllocationBar slices={slices} dimension="position" onDimension={() => {}} />)
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText(/62\.50%/)).toBeTruthy()
    const track = screen.getByRole('img', { name: /Beta 62\.50%, Other 37\.50%/ })
    expect([...track.children].map((segment) => (segment as HTMLElement).style.width)).toEqual(['62.5%', '37.5%'])
  })

  it('switches between type, position, currency and country', () => {
    const onDimension = vi.fn()
    render(<AllocationBar slices={slices} dimension="assetClass" onDimension={onDimension} />)
    expect(screen.getByRole('button', { name: 'Type' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Country' }))
    expect(onDimension).toHaveBeenCalledWith('country')
  })
})

describe('groupedSlices', () => {
  it('groups the positions by type, currency or the country of the ISIN', () => {
    const facts = instrumentFacts([
      tx('buy', '2026-01-02', { isin: 'IE00B4L5Y983', assetClass: 'etf', currency: 'EUR', quantity: 1, amount: 1 }),
      tx('buy', '2026-01-02', { isin: 'US0378331005', assetClass: 'stock', currency: 'USD', quantity: 1, amount: 1 }),
      tx('buy', '2026-01-02', { isin: 'BE0003565737', assetClass: 'stock', currency: 'EUR', quantity: 1, amount: 1 }),
    ])
    const positions = [position('IE00B4L5Y983', 600), position('US0378331005', 300), position('BE0003565737', 100)]
    expect(groupedSlices(positions, 'assetClass', facts).map((s) => [s.label, s.share])).toEqual([
      ['ETFs', 0.6],
      ['Stocks', 0.4],
    ])
    expect(groupedSlices(positions, 'currency', facts).map((s) => s.label)).toEqual(['EUR', 'USD'])
    expect(groupedSlices(positions, 'country', facts).map((s) => s.label)).toEqual(['Ireland', 'United States', 'Belgium'])
  })
})
