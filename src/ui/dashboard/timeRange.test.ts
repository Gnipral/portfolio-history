import { describe, expect, it } from 'vitest'
import { clampIndex, periodRange, rangeChange, rangeStart, visibleRange } from './timeRange.ts'

describe('rangeStart', () => {
  const first = '2023-10-25'
  const last = '2026-10-19'

  it('computes the quick ranges', () => {
    expect(rangeStart('1M', first, last)).toBe('2026-09-19')
    expect(rangeStart('3M', first, last)).toBe('2026-07-19')
    expect(rangeStart('YTD', first, last)).toBe('2026-01-01')
    expect(rangeStart('1Y', first, last)).toBe('2025-10-19')
    expect(rangeStart('ALL', first, last)).toBe(first)
  })

  it('starts the week on Monday and the month on its first day', () => {
    // 19 October 2026 is a Monday: the week starts that day.
    expect(rangeStart('WTD', first, last)).toBe('2026-10-19')
    expect(rangeStart('WTD', first, '2026-10-25')).toBe('2026-10-19')
    expect(rangeStart('WTD', first, '2026-10-21')).toBe('2026-10-19')
    expect(rangeStart('MTD', first, last)).toBe('2026-10-01')
  })

  it('goes back five years, but not before the first transaction', () => {
    expect(rangeStart('5Y', '2015-01-01', last)).toBe('2021-10-19')
    expect(rangeStart('5Y', first, last)).toBe(first)
  })

  it('never starts before the first transaction', () => {
    expect(rangeStart('1Y', '2026-05-01', last)).toBe('2026-05-01')
  })
})

describe('visibleRange and clampIndex', () => {
  const days = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'].map((date) => ({ date }))

  it('maps a range to point indices', () => {
    expect(visibleRange(days, 'ALL')).toEqual({ from: 0, to: 4 })
    expect(visibleRange([], 'ALL')).toEqual({ from: 0, to: -1 })
  })

  it('keeps the selection inside the range and defaults to its end', () => {
    expect(clampIndex(null, { from: 2, to: 4 })).toBe(4)
    expect(clampIndex(1, { from: 2, to: 4 })).toBe(2)
    expect(clampIndex(3, { from: 2, to: 4 })).toBe(3)
  })
})

describe('rangeChange', () => {
  // TWR +10% then +10% again; profit 100 then 210
  const points = [
    { pnl: 0, twr: 0 },
    { pnl: 100, twr: 0.1 },
    { pnl: 210, twr: 0.21 },
  ]

  it('gives profit and TWR made within the range', () => {
    expect(rangeChange(points, 2, 2).pnl).toBe(110)
    expect(rangeChange(points, 2, 2).twr).toBeCloseTo(0.1, 12)
    expect(rangeChange(points, 0, 2).pnl).toBe(210)
    expect(rangeChange(points, 0, 2).twr).toBeCloseTo(0.21, 12)
  })
})

describe('periodRange', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'].map((date) => ({ date }))

  it('shows the days of a saved period', () => {
    expect(periodRange(days, { from: '2026-01-02', to: '2026-01-04' })).toEqual({ from: 1, to: 3 })
  })

  it('runs an open period up to the last day, so it grows along', () => {
    expect(periodRange(days, { from: '2026-01-03', to: null })).toEqual({ from: 2, to: 4 })
  })

  it('stays within the history', () => {
    expect(periodRange(days, { from: '2025-06-01', to: '2027-01-01' })).toEqual({ from: 0, to: 4 })
    expect(periodRange([], { from: '2026-01-01', to: null })).toEqual({ from: 0, to: -1 })
  })
})
