import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('never contains amounts, only percentages and dates', () => {
    const json = JSON.stringify(shareCard(points, 0, 399, benchmark, slices))
    for (const amount of ['123456', '98765', '24691', '99999', '1234', '90000', '34000']) expect(json).not.toContain(amount)
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
    render(<ShareDialog points={points} from={0} to={399} benchmarks={[benchmark]} slices={slices} onClose={() => undefined} />)
    expect(screen.getByLabelText('Text to go with it')).toHaveProperty('value', expect.stringContaining('VWCE'))

    fireEvent.click(screen.getByLabelText('Compare with VWCE'))
    expect(screen.getByLabelText('Text to go with it')).toHaveProperty('value', expect.not.stringContaining('VWCE'))

    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Text copied.'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('+39.90%'))
  })

  it('closes with Escape and the close button', () => {
    const onClose = vi.fn()
    render(<ShareDialog points={points} from={0} to={399} benchmarks={[]} slices={[]} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(screen.queryByLabelText(/Compare with/)).toBeNull()
  })
})
