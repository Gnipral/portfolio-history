import type { PortfolioDatabase } from '../data/db.ts'
import type { Benchmark } from './benchmarks.ts'
import { addDays } from './dates.ts'
import { parseFrankfurter, parseStaticFx, type StaticFxFile } from './fx.ts'
import { fetchJson } from './http.ts'
import { savePrices } from './priceCache.ts'
import type { FxDay } from './types.ts'

export function dataUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/${file}`
}

/** [date, close, adjusted close], as written by scripts/snapshot-data.ts */
export interface StaticBenchmarkFile {
  symbol: string
  currency: string
  closes: [string, number, number][]
}

export interface FxSources {
  loadStatic: () => Promise<{ currencies: string[]; days: FxDay[] }>
  fetchLive: (from: string, to: string, currencies: string[]) => Promise<FxDay[]>
}

export const defaultFxSources: FxSources = {
  async loadStatic() {
    const file = await fetchJson<StaticFxFile>(dataUrl('fx-rates.json'))
    return { currencies: file.currencies, days: parseStaticFx(file) }
  },
  async fetchLive(from, to, currencies) {
    const url = `https://api.frankfurter.dev/v1/${from}..${to}?base=EUR&symbols=${currencies.join(',')}`
    return parseFrankfurter(await fetchJson(url))
  },
}

const FX_CHECK_KEY = 'fx:lastLiveCheck'

export interface FxSyncResult {
  lastDate: string | undefined
  added: number
  errors: string[]
}

/**
 * Fills the FX table from the static snapshot first, then asks Frankfurter (at most once per day)
 * for days published after the snapshot. Errors are reported, not thrown: cached rates stay usable offline.
 */
export async function syncFx(
  database: PortfolioDatabase,
  today: string,
  sources: FxSources = defaultFxSources,
): Promise<FxSyncResult> {
  const errors: string[] = []
  let added = 0
  let last = (await database.fxDays.orderBy('date').last())?.date
  let currencies: string[] = []

  try {
    const snapshot = await sources.loadStatic()
    currencies = snapshot.currencies
    const newer = snapshot.days.filter((d) => !last || d.date > last)
    if (newer.length > 0) {
      await database.fxDays.bulkPut(newer)
      added += newer.length
      last = newer.reduce((max, d) => (d.date > max ? d.date : max), last ?? '')
    }
  } catch (error) {
    errors.push(`Static FX rates: ${String(error)}`)
  }

  const lastCheck = (await database.kv.get(FX_CHECK_KEY))?.value
  if (last && last < today && lastCheck !== today && currencies.length > 0) {
    try {
      const live = (await sources.fetchLive(addDays(last, 1), today, currencies)).filter((d) => d.date > (last as string))
      if (live.length > 0) {
        await database.fxDays.bulkPut(live)
        added += live.length
        last = live.reduce((max, d) => (d.date > max ? d.date : max), last)
      }
      await database.kv.put({ key: FX_CHECK_KEY, value: today })
    } catch (error) {
      errors.push(`Live FX rates: ${String(error)}`)
    }
  }
  return { lastDate: last, added, errors }
}

/** Loads a benchmark's static closes into the price cache when the snapshot is newer than the cache. */
export async function syncStaticBenchmark(
  database: PortfolioDatabase,
  benchmark: Benchmark,
  today: string,
  load: (file: string) => Promise<StaticBenchmarkFile> = (file) => fetchJson(dataUrl(file)),
): Promise<number> {
  const file = await load(`benchmark-${benchmark.id}.json`)
  const first = file.closes[0]?.[0]
  const last = file.closes.at(-1)?.[0]
  if (!first || !last) return 0
  const coverage = await database.coverage.get(benchmark.symbol)
  if (coverage && coverage.to >= last && coverage.from <= first) return 0
  const points = file.closes.map(([date, close]) => ({ symbol: benchmark.symbol, date, close }))
  // Not a live fetch: leave the fetch time at the epoch so newer days can still be fetched live today.
  await savePrices(
    database,
    benchmark.symbol,
    points,
    { from: first, to: last },
    { currency: file.currency, source: 'static' },
    new Date(0),
    today,
  )
  return points.length
}
