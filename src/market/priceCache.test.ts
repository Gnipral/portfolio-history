import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { PriceSeries, loadSeries, missingRanges, savePrices } from './priceCache.ts'
import type { PriceCoverage } from './types.ts'

const coverage = (from: string, to: string, fetchedAt = '2026-10-10T10:00:00Z'): PriceCoverage => ({
  symbol: 'VRT',
  from,
  to,
  currency: 'USD',
  source: 'test',
  fetchedAt,
})

describe('missingRanges', () => {
  const today = '2026-10-19'

  it('fetches everything when nothing is cached', () => {
    expect(missingRanges(undefined, { from: '2024-01-01', to: today }, today)).toEqual([{ from: '2024-01-01', to: today }])
  })

  it('fetches only the days before and after the cached range', () => {
    expect(missingRanges(coverage('2025-01-01', '2026-10-09'), { from: '2024-06-01', to: today }, today)).toEqual([
      { from: '2024-06-01', to: '2024-12-31' },
      { from: '2026-10-10', to: today },
    ])
  })

  it('fetches nothing when the range is cached', () => {
    expect(missingRanges(coverage('2024-01-01', '2026-10-18'), { from: '2025-01-01', to: '2026-10-18' }, today)).toEqual([])
  })

  it('fetches the open end only once per day', () => {
    const fetchedToday = coverage('2024-01-01', '2026-10-18', '2026-10-19T08:00:00Z')
    expect(missingRanges(fetchedToday, { from: '2024-01-01', to: today }, today)).toEqual([])
  })

  it('ignores an empty request', () => {
    expect(missingRanges(undefined, { from: '2026-10-20', to: today }, today)).toEqual([])
  })
})

describe('price cache', () => {
  const database = new PortfolioDatabase('test-prices')
  afterEach(async () => {
    await database.delete()
    await database.open()
  })

  const now = new Date('2026-10-19T12:00:00Z')
  const today = '2026-10-19'

  it('stores prices and extends the coverage without including today', async () => {
    await savePrices(
      database,
      'VRT',
      [
        { symbol: 'VRT', date: '2026-10-15', close: 210 },
        { symbol: 'VRT', date: '2026-10-16', close: 212 },
      ],
      { from: '2026-10-15', to: '2026-10-16' },
      { currency: 'USD', source: 'test' },
      now,
      today,
    )
    await savePrices(
      database,
      'VRT',
      [
        { symbol: 'VRT', date: '2026-10-16', close: 212.5 }, // corrected close overwrites
        { symbol: 'VRT', date: '2026-10-19', close: 215 }, // provisional
      ],
      { from: '2026-10-17', to: today },
      { currency: 'USD', source: 'test' },
      now,
      today,
    )

    expect(await database.coverage.get('VRT')).toMatchObject({ from: '2026-10-15', to: '2026-10-18', currency: 'USD' })
    const series = await loadSeries(database, 'VRT')
    expect(series.dates).toEqual(['2026-10-15', '2026-10-16', '2026-10-19'])
    expect(series.closes).toEqual([210, 212.5, 215])
  })

  it('keeps prices of different symbols apart', async () => {
    await database.prices.bulkPut([
      { symbol: 'A', date: '2026-10-16', close: 1 },
      { symbol: 'B', date: '2026-10-16', close: 2 },
    ])
    expect((await loadSeries(database, 'B')).closes).toEqual([2])
  })
})

describe('PriceSeries.closeOn', () => {
  const series = PriceSeries.fromPoints('X', [
    { symbol: 'X', date: '2026-10-16', close: 12 },
    { symbol: 'X', date: '2026-10-14', close: 10 },
  ])

  it('returns the last close on or before the date with its age', () => {
    expect(series.closeOn('2026-10-14')).toEqual({ close: 10, date: '2026-10-14', ageDays: 0 })
    expect(series.closeOn('2026-10-18')).toEqual({ close: 12, date: '2026-10-16', ageDays: 2 })
    expect(series.closeOn('2026-10-13')).toBeUndefined()
    expect(series.lastDate).toBe('2026-10-16')
  })
})
