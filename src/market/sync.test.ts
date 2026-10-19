import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { degiroAdapter } from '../import/adapters/degiro/index.ts'
import { SAMPLE_ROWS, table } from '../import/adapters/degiro/fixtures.ts'
import { DEFAULT_SETTINGS } from '../settings/settings.ts'
import { deriveInstruments } from './instruments.ts'
import { loadSeries } from './priceCache.ts'
import type { PriceProvider } from './providers/types.ts'
import { RequestQueue } from './queue.ts'
import { setManualSymbol, syncMarketData } from './sync.ts'

const transactions = degiroAdapter.parse([table(SAMPLE_ROWS)]).transactions
const today = '2026-10-19'
const now = new Date('2026-10-19T12:00:00Z')

describe('deriveInstruments', () => {
  it('derives price periods per instrument, ending at the close of a position', () => {
    const byKey = Object.fromEntries(deriveInstruments(transactions, today).map((i) => [i.key, i]))
    expect(byKey.US0000000002).toMatchObject({ open: true, range: { from: '2026-01-05', to: today }, brokerExchange: 'NSY' })
    // The old biotech ISIN ends at the ISIN change, the new one continues
    expect(byKey.US0000000004).toMatchObject({ open: false, range: { from: '2026-01-04', to: '2026-01-16' } })
    expect(byKey.US0000000005).toMatchObject({ open: true, range: { from: '2026-01-16', to: today } })
    expect(byKey.IE0000000006?.kind).toBe('security')
  })
})

describe('syncMarketData', () => {
  const database = new PortfolioDatabase('test-sync')
  const queues = Object.fromEntries(
    ['yahoo-proxy', 'fake', 'openfigi', 'coingecko'].map((id) => [id, new RequestQueue({ maxRetries: 0 })]),
  )
  const fake: PriceProvider = {
    id: 'fake',
    label: 'Fake',
    isAvailable: () => true,
    supports: (symbol) => symbol !== 'NOPE',
    fetchDaily: vi.fn(async (_symbol, range) => ({
      currency: 'USD',
      closes: [{ date: range.to, close: 100 }],
      splits: [{ date: '2026-07-02', ratio: 4 }],
    })),
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/openfigi/mapping')) {
        return new Response(JSON.stringify(Array.from({ length: 6 }, () => ({ data: [{ ticker: 'TCK', exchCode: 'US' }] }))))
      }
      return new Response('offline', { status: 503 })
    })
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await database.delete()
    await database.open()
  })

  const run = (settings = { ...DEFAULT_SETTINGS, proxyUrl: 'https://proxy.example' }) =>
    syncMarketData({ database, transactions, settings, today, now, benchmarkIds: [], providers: [fake], queues })

  it('resolves symbols, fetches prices and splits, and reports progress', async () => {
    const onProgress = vi.fn()
    const report = await syncMarketData({
      database,
      transactions,
      settings: { ...DEFAULT_SETTINGS, proxyUrl: 'https://proxy.example' },
      today,
      now,
      benchmarkIds: [],
      providers: [fake],
      queues,
      onProgress,
    })

    expect(report.problems).toEqual({})
    expect((await database.symbols.get('US0000000002'))?.symbol).toBe('TCK')
    expect((await loadSeries(database, 'TCK')).closes.length).toBeGreaterThan(0)
    expect(await database.splits.count()).toBe(1)
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'done' }))
    // Static data could not be loaded (fetch fails): reported, not thrown
    expect(report.errors.length).toBeGreaterThan(0)
  })

  it('fetches nothing again on the same day', async () => {
    await run()
    const calls = vi.mocked(fake.fetchDaily).mock.calls.length
    await run()
    expect(vi.mocked(fake.fetchDaily).mock.calls.length).toBe(calls)
  })

  it('explains what to do without a proxy', async () => {
    const report = await run(DEFAULT_SETTINGS)
    expect(report.problems.US0000000002).toMatch(/price proxy URL/)
  })

  it('keeps manual symbols and reports providers that cannot price them', async () => {
    await setManualSymbol(database, 'US0000000002', 'NOPE', 'security', now)
    const report = await run()
    expect((await database.symbols.get('US0000000002'))?.source).toBe('manual')
    expect(report.problems.US0000000002).toMatch(/No price source/)
  })
})
