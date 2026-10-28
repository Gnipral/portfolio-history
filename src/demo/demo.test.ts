import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { loadEngineInputs } from '../engine/loadInputs.ts'
import { computeDailySeries } from '../engine/series.ts'
import { addDays } from '../market/dates.ts'
import { RequestQueue } from '../market/queue.ts'
import { syncMarketData } from '../market/sync.ts'
import { DEFAULT_SETTINGS } from '../settings/settings.ts'
import { DEMO_DATABASE, enterDemo, isDemo, leaveDemo } from './demoMode.ts'
import { demoTransactions, seedDemo } from './demoPortfolio.ts'
import { DEMO_INSTRUMENTS, demoCloses } from './demoPrices.ts'
import { demoProvider } from './demoProvider.ts'

const today = '2026-10-28'
const options = { includeDividends: true, includeCosts: true, includeTaxes: true, includeFxCosts: true, includeDeposits: true, costBasis: 'average' as const }

describe('demo prices', () => {
  it('are the same on every call, without weekends except for crypto', () => {
    const world = DEMO_INSTRUMENTS[0]!
    const range = { from: '2024-01-01', to: '2024-01-31' }
    const first = demoCloses(world, range)
    expect(demoCloses(world, range)).toEqual(first)
    expect(first.some((c) => ['2024-01-06', '2024-01-07'].includes(c.date))).toBe(false)
    expect(demoCloses(DEMO_INSTRUMENTS.find((i) => i.assetClass === 'crypto')!, range)).toHaveLength(31)
  })

  it('come from the demo provider for demo symbols only', async () => {
    expect(demoProvider.supports('demo:world', 'security')).toBe(true)
    expect(demoProvider.supports('VWCE.DE', 'security')).toBe(false)
    const result = await demoProvider.fetchDaily('demo:tech', { from: '2025-01-01', to: '2025-01-10' }, DEFAULT_SETTINGS)
    expect(result.currency).toBe('USD')
    expect(result.closes.length).toBeGreaterThan(5)
  })
})

describe('demo portfolio', () => {
  it('grows with the days and stays the same for a given day', () => {
    const now = demoTransactions(today)
    expect(demoTransactions(today)).toEqual(now)
    expect(demoTransactions('2026-12-31').length).toBeGreaterThan(now.length)
    expect(now[0]).toMatchObject({ type: 'deposit', date: '2021-03-01' })
    expect(new Set(now.map((t) => t.type))).toEqual(new Set(['deposit', 'withdrawal', 'buy', 'sell', 'dividend', 'tax']))
  })

  const database = new PortfolioDatabase('test-demo')
  afterEach(() => vi.unstubAllGlobals())

  it('has every price offline, never goes below zero cash and makes a full history', { timeout: 60_000 }, async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    await seedDemo(database, today, new Date(`${today}T12:00:00Z`))
    // The ECB rates normally come from the static snapshot; offline here, so a flat rate.
    const days: string[] = []
    for (let d = '2021-01-01'; d <= today; d = addDays(d, 1)) days.push(d)
    await database.fxDays.bulkPut(days.map((date) => ({ date, rates: { USD: 1.1 } })))
    const transactions = await database.transactions.toArray()
    const report = await syncMarketData({
      database,
      transactions,
      settings: DEFAULT_SETTINGS,
      today,
      now: new Date(`${today}T12:00:00Z`),
      benchmarks: [],
      providers: [demoProvider],
      queues: { demo: new RequestQueue({ maxRetries: 0 }) },
    })
    expect(report.problems).toEqual({})

    const inputs = await loadEngineInputs(database)
    const series = computeDailySeries(inputs.transactions, inputs.prices, options, today)
    expect(series.cashMode).toBe(true)
    expect(series.issues).toEqual([])
    const last = series.points.at(-1)!
    expect(last.date).toBe(today)
    expect(last.estimated).toBe(0)
    expect(last.value).toBeGreaterThan(last.invested * 0.5)
  })
})

describe('demo mode', () => {
  it('is switched with a flag and a fresh start', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { hash: '', reload })
    expect(isDemo()).toBe(false)
    enterDemo()
    expect(isDemo()).toBe(true)
    leaveDemo()
    expect(isDemo()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(2)
    expect(DEMO_DATABASE).not.toBe('portfolio-history')
    vi.unstubAllGlobals()
  })
})
