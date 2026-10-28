import type { PortfolioDatabase } from '../data/db.ts'
import type { Transaction } from '../model/transaction.ts'
import type { Settings } from '../settings/settings.ts'
import { BENCHMARKS } from './benchmarks.ts'
import { deriveInstruments, type Instrument } from './instruments.ts'
import { isNetworkError } from './http.ts'
import { resolveIsins } from './openFigi.ts'
import { missingRanges, savePrices } from './priceCache.ts'
import { CRYPTO_PREFIX, searchCoinId } from './providers/coinGecko.ts'
import { PROVIDERS, PROVIDER_QUEUES } from './providers/index.ts'
import type { PriceProvider, ProviderResult } from './providers/types.ts'
import type { RequestQueue } from './queue.ts'
import { syncFx, syncStaticBenchmark } from './staticData.ts'
import type { DateRange, SymbolRecord } from './types.ts'

export interface SyncProgress {
  phase: 'fx' | 'benchmarks' | 'symbols' | 'prices' | 'done'
  done: number
  total: number
  message: string
}

export interface SyncOptions {
  database: PortfolioDatabase
  transactions: Transaction[]
  settings: Settings
  today: string
  now: Date
  benchmarkIds?: string[]
  onProgress?: (progress: SyncProgress) => void
  providers?: PriceProvider[]
  queues?: Record<string, RequestQueue>
}

export interface SyncReport {
  errors: string[]
  /** Instrument key -> problem, for instruments without (complete) prices. */
  problems: Record<string, string>
  /**
   * Keys of the problems caused by the connection (too slow or gone) rather than by the instrument:
   * the stored prices are still shown, and the next update tries again.
   */
  connection: string[]
}

const FIGI_BATCH = 10

function queueFor(queues: Record<string, RequestQueue>, id: string): RequestQueue {
  const queue = queues[id]
  if (!queue) throw new Error(`No request queue for ${id}`)
  return queue
}

/** Resolves symbols for instruments that have none yet; manual symbols are never overwritten. */
async function resolveSymbols(
  options: Required<Pick<SyncOptions, 'database' | 'settings' | 'now' | 'queues'>>,
  instruments: Instrument[],
  problems: Record<string, string>,
  connection: string[],
): Promise<void> {
  const { database, settings, now, queues } = options
  const existing = new Map((await database.symbols.bulkGet(instruments.map((i) => i.key))).flatMap((r) => (r ? [[r.key, r]] : [])))
  const pending = instruments.filter((i) => !existing.get(i.key)?.symbol)
  const resolvedAt = now.toISOString()

  const securities = pending.filter((i) => i.kind === 'security' && i.isin)
  if (securities.length > 0 && !settings.proxyUrl) {
    for (const i of securities) problems[i.key] = 'No symbol yet: set the price proxy URL in Settings, or enter the symbol manually.'
  } else {
    for (let start = 0; start < securities.length; start += FIGI_BATCH) {
      const batch = securities.slice(start, start + FIGI_BATCH)
      try {
        const results = await queueFor(queues, 'openfigi').run(() =>
          resolveIsins(
            settings.proxyUrl,
            batch.map((i) => ({ isin: i.isin as string, ...(i.brokerExchange ? { brokerExchange: i.brokerExchange } : {}) })),
          ),
        )
        const records: SymbolRecord[] = batch.map((instrument, n) => {
          const result = results[n] ?? { error: 'No answer' }
          if ('error' in result) problems[instrument.key] = `Symbol not found: ${result.error}. Enter it manually.`
          return {
            key: instrument.key,
            kind: 'security',
            source: 'openfigi',
            resolvedAt,
            ...('error' in result ? { error: result.error } : { symbol: result.symbol, ...(result.name ? { name: result.name } : {}) }),
          }
        })
        await database.symbols.bulkPut(records)
      } catch (error) {
        for (const i of batch) problems[i.key] = `Symbol lookup failed: ${String(error)}`
        if (isNetworkError(error)) connection.push(...batch.map((i) => i.key))
      }
    }
  }

  for (const instrument of pending.filter((i) => i.kind === 'crypto')) {
    try {
      const id = instrument.ticker ? await queueFor(queues, 'coingecko').run(() => searchCoinId(instrument.ticker as string)) : undefined
      if (!id) problems[instrument.key] = 'Coin not found on CoinGecko. Enter the symbol as crypto:<coingecko id>.'
      await database.symbols.put({
        key: instrument.key,
        kind: 'crypto',
        source: 'coingecko',
        resolvedAt,
        ...(id ? { symbol: `${CRYPTO_PREFIX}${id}` } : { error: 'not found' }),
      })
    } catch (error) {
      problems[instrument.key] = `Coin lookup failed: ${String(error)}`
      if (isNetworkError(error)) connection.push(instrument.key)
    }
  }

  // Without an ISIN, the broker's ticker is the best guess; it can be corrected on the Prices page.
  const byTicker = pending.filter((i) => i.kind === 'security' && !i.isin && i.ticker)
  if (byTicker.length > 0) {
    await database.symbols.bulkPut(
      byTicker.map((i): SymbolRecord => ({ key: i.key, kind: 'security', source: 'broker', resolvedAt, symbol: i.ticker as string })),
    )
  }
  for (const instrument of pending.filter((i) => i.kind === 'security' && !i.isin && !i.ticker)) {
    problems[instrument.key] = 'No ISIN in the export: enter the symbol manually.'
  }
}

async function fetchRange(
  symbol: string,
  kind: 'security' | 'crypto',
  range: DateRange,
  settings: Settings,
  providers: PriceProvider[],
  queues: Record<string, RequestQueue>,
): Promise<{ result: ProviderResult; provider: PriceProvider }> {
  const candidates = providers.filter((p) => p.isAvailable(settings) && p.supports(symbol, kind))
  if (candidates.length === 0) throw new Error('No price source configured for this symbol. Add an API key or the price proxy in Settings.')
  const failures: unknown[] = []
  for (const provider of candidates) {
    try {
      const result = await queueFor(queues, provider.id).run(() => provider.fetchDaily(symbol, range, settings))
      return { result, provider }
    } catch (error) {
      failures.push(error)
    }
  }
  // Only the connection failed: keep that error, so the caller knows to try again later.
  if (failures.every(isNetworkError)) throw failures[0]
  throw new Error(failures.map((error) => (error instanceof Error ? error.message : String(error))).join('; '))
}

/**
 * Brings FX rates, benchmark closes and the prices of every instrument up to date.
 * Only missing days are fetched; everything is cached in IndexedDB.
 */
export async function syncMarketData(options: SyncOptions): Promise<SyncReport> {
  const { database, transactions, settings, today, now, onProgress } = options
  const providers = options.providers ?? PROVIDERS
  const queues = options.queues ?? PROVIDER_QUEUES
  const errors: string[] = []
  const problems: Record<string, string> = {}
  const connection: string[] = []

  onProgress?.({ phase: 'fx', done: 0, total: 1, message: 'Updating exchange rates' })
  errors.push(...(await syncFx(database, today)).errors)

  const benchmarks = BENCHMARKS.filter((b) => (options.benchmarkIds ?? ['iwda']).includes(b.id))
  onProgress?.({ phase: 'benchmarks', done: 0, total: benchmarks.length, message: 'Loading benchmark data' })
  for (const benchmark of benchmarks) {
    try {
      await syncStaticBenchmark(database, benchmark, today)
    } catch (error) {
      errors.push(`Benchmark ${benchmark.symbol}: ${String(error)}`)
    }
  }

  const instruments = deriveInstruments(transactions, today)
  onProgress?.({ phase: 'symbols', done: 0, total: instruments.length, message: 'Looking up symbols' })
  await resolveSymbols({ database, settings, now, queues }, instruments, problems, connection)

  const records = new Map((await database.symbols.toArray()).map((r) => [r.key, r]))
  const jobs: { key: string; symbol: string; kind: 'security' | 'crypto'; range: DateRange }[] = []
  for (const instrument of instruments) {
    const symbol = records.get(instrument.key)?.symbol
    if (symbol) jobs.push({ key: instrument.key, symbol, kind: instrument.kind, range: instrument.range })
  }
  for (const benchmark of benchmarks) {
    const coverage = await database.coverage.get(benchmark.symbol)
    if (coverage) jobs.push({ key: benchmark.symbol, symbol: benchmark.symbol, kind: 'security', range: { from: coverage.from, to: today } })
  }

  let done = 0
  const total = jobs.length
  onProgress?.({ phase: 'prices', done, total, message: 'Fetching prices' })
  await Promise.all(
    jobs.map(async (job) => {
      try {
        const coverage = await database.coverage.get(job.symbol)
        for (const range of missingRanges(coverage, job.range, today)) {
          const { result, provider } = await fetchRange(job.symbol, job.kind, range, settings, providers, queues)
          // Sources deliver float noise such as 345.9700012207031.
          const points = result.closes.map((c) => ({ symbol: job.symbol, date: c.date, close: Number(c.close.toFixed(6)) }))
          await savePrices(database, job.symbol, points, range, { currency: result.currency, source: provider.id }, now, today)
          if (result.splits.length > 0) {
            await database.splits.bulkPut(
              result.splits.map((s) => ({ id: `${job.symbol}:${s.date}`, symbol: job.symbol, date: s.date, ratio: s.ratio, source: 'provider' as const })),
            )
          }
        }
      } catch (error) {
        problems[job.key] = error instanceof Error ? error.message : String(error)
        if (isNetworkError(error)) connection.push(job.key)
      } finally {
        done++
        onProgress?.({ phase: 'prices', done, total, message: `Fetching prices (${done}/${total})` })
      }
    }),
  )

  onProgress?.({ phase: 'done', done: total, total, message: 'Done' })
  return { errors, problems, connection }
}

export async function setManualSymbol(database: PortfolioDatabase, key: string, symbol: string, kind: 'security' | 'crypto', now: Date) {
  await database.symbols.put({ key, symbol, kind, source: 'manual', resolvedAt: now.toISOString() })
}

/** Removes a manual symbol so the next update resolves it automatically again. */
export async function clearSymbol(database: PortfolioDatabase, key: string) {
  await database.symbols.delete(key)
}

export async function addManualSplit(database: PortfolioDatabase, symbol: string, date: string, ratio: number) {
  await database.splits.put({ id: `${symbol}:${date}`, symbol, date, ratio, source: 'manual' })
}
