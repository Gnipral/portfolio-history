import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { degiroAdapter } from '../import/adapters/degiro/index.ts'
import { SAMPLE_ROWS, table } from '../import/adapters/degiro/fixtures.ts'
import { tx } from '../engine/testing.ts'
import { DEFAULT_SETTINGS } from '../settings/settings.ts'
import { customBenchmark } from './benchmarks.ts'
import { deriveInstruments } from './instruments.ts'
import { loadSeries } from './priceCache.ts'
import { TimeoutError } from './http.ts'
import { ProviderError, type PriceProvider } from './providers/types.ts'
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

  it('keeps a position open that was bought again after selling units from before the export', () => {
    const [vertiv] = deriveInstruments(
      [tx('sell', '2026-04-08', { isin: 'US0000000099', quantity: 6, amount: 1500 }), tx('buy', '2026-10-15', { isin: 'US0000000099', quantity: 5, amount: 900 })],
      today,
    )
    expect(vertiv).toMatchObject({ open: true, range: { from: '2026-04-08', to: today } })
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
    syncMarketData({ database, transactions, settings, today, now, benchmarks: [], providers: [fake], queues })

  it('fetches a stock added to compare with from the first transaction on, like a position', async () => {
    const apple = customBenchmark({ symbol: 'AAPL', name: 'Apple Inc.' })
    await syncMarketData({ database, transactions, settings: { ...DEFAULT_SETTINGS, proxyUrl: 'https://proxy.example' }, today, now, benchmarks: [apple], providers: [fake], queues })
    const first = transactions.map((t) => t.date).sort()[0]
    expect(fake.fetchDaily).toHaveBeenCalledWith('AAPL', expect.objectContaining({ from: first }), expect.anything())
    expect(await database.coverage.get('AAPL')).toMatchObject({ currency: 'USD', from: first })
  })

  it('resolves symbols, fetches prices and splits, and reports progress', async () => {
    const onProgress = vi.fn()
    const report = await syncMarketData({
      database,
      transactions,
      settings: { ...DEFAULT_SETTINGS, proxyUrl: 'https://proxy.example' },
      today,
      now,
      benchmarks: [],
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

  it('tells a slow connection apart from a product without prices', async () => {
    const slow: PriceProvider = {
      ...fake,
      supports: () => true,
      fetchDaily: vi.fn(async (symbol: string) => {
        if (symbol === 'NOPE') throw new ProviderError('fake', 'unknown symbol')
        throw new TimeoutError('https://prices.example')
      }),
    }
    await setManualSymbol(database, 'US0000000002', 'NOPE', 'security', now)
    const report = await syncMarketData({ database, transactions, settings: { ...DEFAULT_SETTINGS, proxyUrl: 'https://proxy.example' }, today, now, benchmarks: [], providers: [slow], queues })
    expect(report.problems.US0000000002).toMatch(/unknown symbol/)
    expect(report.connection).not.toContain('US0000000002')
    expect(report.connection.length).toBeGreaterThan(0)
    expect(report.connection.every((key) => /too slow/.test(report.problems[key] ?? ''))).toBe(true)
  })

  it('explains what to do without a proxy', async () => {
    const report = await run({ ...DEFAULT_SETTINGS, proxyUrl: '' })
    expect(report.problems.US0000000002).toMatch(/price proxy URL/)
  })

  it('keeps manual symbols and reports providers that cannot price them', async () => {
    await setManualSymbol(database, 'US0000000002', 'NOPE', 'security', now)
    const report = await run()
    expect((await database.symbols.get('US0000000002'))?.source).toBe('manual')
    expect(report.problems.US0000000002).toMatch(/No price source/)
  })

  it('uses the broker ticker for products without an ISIN', async () => {
    const withTicker = tx('buy', '2026-03-02', { product: 'EXMP', ticker: 'EXMP', quantity: 1, amount: 100 })
    const withoutTicker = tx('buy', '2026-03-02', { product: 'Unknown fund', quantity: 1, amount: 100 })
    const report = await syncMarketData({
      database,
      transactions: [withTicker, withoutTicker],
      settings: DEFAULT_SETTINGS,
      today,
      now,
      benchmarks: [],
      providers: [fake],
      queues,
    })
    expect(await database.symbols.get('EXMP')).toMatchObject({ symbol: 'EXMP', source: 'broker' })
    expect(report.problems.EXMP).toBeUndefined()
    expect(report.problems['Unknown fund']).toMatch(/No ISIN/)
  })
})
