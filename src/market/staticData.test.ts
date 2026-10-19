import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { BENCHMARKS } from './benchmarks.ts'
import { BENCHMARKS as SNAPSHOT_BENCHMARKS } from '../../scripts/lib/config.ts'
import { missingRanges } from './priceCache.ts'
import { syncFx, syncStaticBenchmark, type FxSources } from './staticData.ts'

const database = new PortfolioDatabase('test-static')
afterEach(async () => {
  await database.delete()
  await database.open()
})

function sources(overrides: Partial<FxSources> = {}): FxSources {
  return {
    loadStatic: async () => ({
      currencies: ['USD'],
      days: [
        { date: '2026-10-15', rates: { USD: 1.16 } },
        { date: '2026-10-16', rates: { USD: 1.17 } },
      ],
    }),
    fetchLive: async () => [
      { date: '2026-10-16', rates: { USD: 9 } },
      { date: '2026-10-19', rates: { USD: 1.18 } },
    ],
    ...overrides,
  }
}

describe('syncFx', () => {
  it('loads the snapshot, then live days after it', async () => {
    const fetchLive = vi.fn(sources().fetchLive)
    const result = await syncFx(database, '2026-10-19', sources({ fetchLive }))

    expect(result).toEqual({ lastDate: '2026-10-19', added: 3, errors: [] })
    expect(fetchLive).toHaveBeenCalledWith('2026-10-17', '2026-10-19', ['USD'])
    expect((await database.fxDays.get('2026-10-16'))?.rates.USD).toBe(1.17)
  })

  it('asks the live source only once per day', async () => {
    const fetchLive = vi.fn(async () => [])
    await syncFx(database, '2026-10-19', sources({ fetchLive }))
    await syncFx(database, '2026-10-19', sources({ fetchLive }))
    expect(fetchLive).toHaveBeenCalledTimes(1)
  })

  it('keeps working offline with cached rates', async () => {
    await syncFx(database, '2026-10-19', sources())
    const offline = sources({
      loadStatic: () => Promise.reject(new TypeError('Failed to fetch')),
      fetchLive: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    const result = await syncFx(database, '2026-10-20', offline)
    expect(result.lastDate).toBe('2026-10-19')
    expect(result.errors).toHaveLength(1)
    expect(await database.fxDays.count()).toBe(3)
  })
})

describe('syncStaticBenchmark', () => {
  const iwda = BENCHMARKS[0]!
  const file = {
    symbol: 'IWDA.AS',
    currency: 'EUR',
    closes: [
      ['2026-10-15', 130.71, 130.71],
      ['2026-10-16', 130.55, 130.55],
    ] as [string, number, number][],
  }

  it('loads the closes once and still allows a live fetch of newer days', async () => {
    expect(await syncStaticBenchmark(database, iwda, '2026-10-19', async () => file)).toBe(2)
    expect(await syncStaticBenchmark(database, iwda, '2026-10-19', async () => file)).toBe(0)

    const coverage = await database.coverage.get('IWDA.AS')
    expect(coverage).toMatchObject({ from: '2026-10-15', to: '2026-10-16', source: 'static' })
    expect(missingRanges(coverage, { from: '2026-10-15', to: '2026-10-19' }, '2026-10-19')).toEqual([
      { from: '2026-10-17', to: '2026-10-19' },
    ])
  })

  it('matches the benchmarks of the snapshot workflow', () => {
    expect(BENCHMARKS).toEqual(SNAPSHOT_BENCHMARKS)
  })
})
