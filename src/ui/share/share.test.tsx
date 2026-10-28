import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Position } from '../../engine/positions.ts'
import type { DailyPoint } from '../../engine/series.ts'
import type { Slice } from '../dashboard/allocation.ts'
import type { BenchmarkLine } from '../dashboard/benchmarkLines.ts'
import { ShareDialog } from './ShareDialog.tsx'
import { PUBLIC_URL, shareCard, shareText } from './shareCard.ts'

function day(index: number, twr: number): DailyPoint {
  const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10)
  return {
    date,
    value: 123_456.78 + index,
    invested: 98_765.43,
    capitalBase: 98_765.43,
    pnl: 24_691.35,
    realized: 0,
    unrealized: 0,
    simpleReturn: 0.25,
    inflow: 0,
    outflow: 0,
    estimated: 0,
    twr,
    days: index,
  }
}

const points = Array.from({ length: 400 }, (_, i) => day(i, i / 1000))
const benchmark: BenchmarkLine = {
  id: 'vwce',
  label: 'VWCE',
  color: '--series-2',
  points: points.map((p) => ({ date: p.date, value: 99_999, pnl: 1_234, twr: p.twr / 2 })),
}
const slices: Slice[] = [
  { key: 'ETFs', label: 'ETFs', value: 90_000, share: 0.724, slot: 1 },
  { key: 'Stocks', label: 'Stocks', value: 34_000, share: 0.276, slot: 2 },
]

function position(product: string, value: number, cost: number, symbol?: string): Position {
  return { key: product, product, ...(symbol ? { symbol } : {}), quantity: 4321, averageCost: cost / 4321, costBasis: cost, stale: false, value, pnl: value - cost, pnlPercent: (value - cost) / cost }
}

const positions = [
  position('APPLE INC', 3_125.5, 2_500, 'AAPL'),
  position('VANGUARD FTSE ALL-WORLD UCITS ETF USD ACC', 9_375.25, 7_000, 'VWCE.DE'),
  position('DEMO BANK NV', 1_000, 1_250, 'demo:bank'),
]

describe('shareCard', () => {
  it('measures the return from the first day of the period', () => {
    const card = shareCard(points, 100, 399, benchmark, slices)
    expect(card.from).toBe('2025-04-11')
    expect(card.to).toBe(points[399]!.date)
    expect(card.twr).toBeCloseTo(1.399 / 1.099 - 1)
    expect(card.curve[0]).toBe(0)
    expect(card.curve.at(-1)).toBe(27.3)
    expect(card.benchmark?.twr).toBeCloseTo(1.1995 / 1.0495 - 1)
  })

  it('thins the curve out but keeps the last day', () => {
    const card = shareCard(points, 0, 399, undefined, [])
    expect(card.curve.length).toBeLessThanOrEqual(120)
    expect(card.curve.at(-1)).toBe(39.9)
  })

  it('lists the positions by weight with their return, under a short name', () => {
    expect(shareCard(points, 0, 399, undefined, []).positions).toEqual([])
    expect(shareCard(points, 0, 399, undefined, [], positions).positions).toEqual([
      { name: 'VWCE', weight: 69, return: 0.339 },
      { name: 'AAPL', weight: 23, return: 0.25 },
      { name: 'DEMO BANK NV', weight: 7, return: -0.2 },
    ])
  })

  it('sums up what does not fit in one row, and can put the best return first', () => {
    const many = [...positions, position('SHELL PLC', 600, 500), position('ASML HOLDING', 500, 250)]
    expect(shareCard(points, 0, 399, undefined, [], many, { limit: 3 }).positions).toEqual([
      { name: 'VWCE', weight: 64, return: 0.339 },
      { name: 'AAPL', weight: 21, return: 0.25 },
      // 1,000 + 600 + 500 on a cost of 1,250 + 500 + 250.
      { name: 'Other 3', weight: 14, return: 0.05, others: 3 },
    ])
    expect(shareCard(points, 0, 399, undefined, [], many, { order: 'return', limit: 10 }).positions.map((p) => p.name)).toEqual([
      'ASML HOLDING',
      'VWCE',
      'AAPL',
      'SHELL PLC',
      'DEMO BANK NV',
    ])
  })

  it('never contains amounts or quantities, only percentages and dates', () => {
    const json = JSON.stringify(shareCard(points, 0, 399, benchmark, slices, positions))
    for (const amount of ['123456', '98765', '24691', '99999', '1234', '90000', '34000', '3125', '9375', '2500', '7000', '1250', '4321']) expect(json).not.toContain(amount)
    expect(json).toContain('"percent":72')
  })

  it('writes a text with the period, the comparison and the link', () => {
    const text = shareText(shareCard(points, 0, 399, benchmark, []))
    expect(text).toContain('My portfolio from 1 Jan 2025 to 4 Feb 2026: +39.90% time-weighted (VWCE: +19.95%).')
    expect(text).toContain(PUBLIC_URL)
  })
})

describe('ShareDialog', () => {
  const writeText = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    writeText.mockClear()
  })

  it('copies the text and drops the comparison when switched off', async () => {
    render(<ShareDialog points={points} from={0} to={399} benchmarks={[benchmark]} slices={slices} positions={positions} onClose={() => undefined} />)
    expect(screen.getByLabelText('Text to go with it')).toHaveProperty('value', expect.stringContaining('VWCE'))

    fireEvent.click(screen.getByLabelText('Compare with VWCE'))
    expect(screen.getByLabelText('Text to go with it')).toHaveProperty('value', expect.not.stringContaining('VWCE'))

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Text copied.'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('+39.90%'))
  })

  it('shows the positions only when asked', () => {
    render(<ShareDialog points={points} from={0} to={399} benchmarks={[]} slices={[]} positions={positions} onClose={() => undefined} />)
    expect(screen.getByText(/no amounts, quantities or product names/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Largest' }))
    expect(screen.getByText(/the names of your positions: no amounts or quantities/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Largest' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('closes with Escape and the close button', () => {
    const onClose = vi.fn()
    render(<ShareDialog points={points} from={0} to={399} benchmarks={[]} slices={[]} positions={[]} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText(/Compare with/)).toBeNull()
    expect(screen.queryByRole('group', { name: 'My positions' })).toBeNull()
  })
})
