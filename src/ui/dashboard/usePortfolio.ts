import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { db } from '../../data/db.ts'
import { loadEngineInputs, type EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { computeDailySeries, type SeriesResult } from '../../engine/series.ts'
import { localToday } from '../../market/dates.ts'
import { syncMarketData, type SyncProgress } from '../../market/sync.ts'
import { benchmarkCatalog, DEFAULT_BENCHMARK_ID, type Benchmark } from '../../market/benchmarks.ts'
import { DEFAULT_SETTINGS, loadSettings, useSettings } from '../../settings/settings.ts'
import { setDisplayCurrency } from '../format.ts'
import { useOnline } from '../useOnline.ts'
import { instrumentKey } from '../../market/instruments.ts'
import { filterByAssetClass } from './assetClasses.ts'
import { engineOptions } from './toggles.ts'

/** Prices are brought up to date once per day, import and benchmark per session, not on every visit of the page. */
let lastSyncKey: string | null = null

/** After a failure of the connection, the prices are tried again this often while the app is open. */
export const RETRY_MS = 60_000

export interface PortfolioState {
  /** undefined while loading, 0 when nothing is imported. */
  transactionCount: number | undefined
  /** Everything loaded, whatever the filter: for what must not change with it, such as colors. */
  allInputs: EngineInputs | null
  /** What the page shows: only the chosen types of asset when filtered. */
  inputs: EngineInputs | null
  /** The engine options for `inputs`: securities only when filtered. */
  options: EngineOptions
  series: SeriesResult | null
  sync: SyncProgress | null
  /** Instruments with a problem of their own; not those that only failed on the connection. */
  syncProblems: number
  /** The last update could not reach a price source: the stored prices are shown. */
  slowConnection: boolean
  online: boolean
  /** The base currency of the settings while the amounts are still in EUR: none of its rates is stored yet. */
  currencyFallback: string | null
}

/** What is loaded and synced once for the whole app, plus the series with the options of the settings. */
interface LoadedPortfolio {
  transactionCount: number | undefined
  /** The inputs without the products switched off on the Prices page. */
  counted: EngineInputs | null
  sync: SyncProgress | null
  syncProblems: number
  slowConnection: boolean
  online: boolean
  currencyFallback: string | null
  /** The options of the settings and the export, and the series with them: what most pages show. */
  baseOptions: EngineOptions
  baseSeries: SeriesResult | null
}

/** Loads the inputs, keeps the prices up to date and computes the series; nothing happens while `enabled` is false. */
function useLoadedPortfolio(enabled: boolean): LoadedPortfolio {
  const transactionCount = useLiveQuery(async (): Promise<number | undefined> => (enabled ? db.transactions.count() : undefined), [enabled])
  const importRecord = useLiveQuery(() => (enabled ? db.imports.get('current') : undefined), [enabled])
  const settings = useSettings()
  const benchmarkId = settings?.benchmarkId
  const baseCurrency = settings?.baseCurrency ?? 'EUR'
  // Stocks added to compare with: a new one is loaded and its prices fetched right away.
  const customKey = JSON.stringify(settings?.customBenchmarks ?? [])
  const [loaded, setInputs] = useState<EngineInputs | null>(null)
  const [sync, setSync] = useState<SyncProgress | null>(null)
  const [syncProblems, setSyncProblems] = useState(0)
  const [slowConnection, setSlowConnection] = useState(false)
  // Raised to try the prices again after a failure of the connection.
  const [attempt, setAttempt] = useState(0)
  const online = useOnline()

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is raised to try the prices again
  useEffect(() => {
    if (!enabled) return
    // benchmarkId is undefined while the settings load, and empty when every benchmark is off.
    if (!transactionCount || benchmarkId === undefined) {
      if (transactionCount === 0) setInputs(null)
      return
    }
    // Every benchmark is loaded: they are small, and the dashboard can show several or a mix.
    const catalog = benchmarkCatalog(JSON.parse(customKey) as Benchmark[])
    const main = catalog.find((b) => b.id === benchmarkId) ?? catalog.find((b) => b.id === DEFAULT_BENCHMARK_ID)
    const benchmarks = [...(main ? [main] : []), ...catalog.filter((b) => b !== main)]
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      const loaded = await loadEngineInputs(db, benchmarks, baseCurrency)
      if (cancelled) return
      setInputs(loaded)
      const today = localToday()
      const syncKey = `${today}:${transactionCount}:${benchmarkId}:${customKey}`
      // Offline: show what is stored and sync as soon as the connection is back.
      if (!online || lastSyncKey === syncKey) return
      lastSyncKey = syncKey
      const report = await syncMarketData({
        database: db,
        transactions: loaded.transactions,
        settings: await loadSettings(),
        today,
        now: new Date(),
        benchmarks,
        onProgress: (progress) => {
          if (!cancelled) setSync(progress)
        },
      })
      if (cancelled) return
      const connection = new Set(report.connection)
      setSyncProblems(Object.keys(report.problems).filter((key) => !connection.has(key)).length)
      setSlowConnection(connection.size > 0)
      // Try again in a while, and on the next visit of the dashboard, instead of tomorrow.
      if (connection.size > 0) {
        lastSyncKey = null
        retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS)
      }
      setInputs(await loadEngineInputs(db, benchmarks, baseCurrency))
    })()
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [enabled, transactionCount, benchmarkId, customKey, baseCurrency, online, attempt])

  // Products switched off on the Prices page count nowhere: not in the figures, the chart or the analysis.
  const excludedKey = (settings?.excludedInstruments ?? []).join('|')
  const counted = useMemo(() => {
    if (!loaded || excludedKey === '') return loaded
    const excluded = new Set(excludedKey.split('|'))
    return { ...loaded, transactions: loaded.transactions.filter((t) => !excluded.has(instrumentKey(t))) }
  }, [loaded, excludedKey])

  const capabilities = importRecord?.capabilities
  const baseOptions = useMemo(() => engineOptions(settings ?? DEFAULT_SETTINGS, capabilities), [settings, capabilities])
  const baseSeries = useMemo(
    () => (enabled && counted && counted.transactions.length > 0 ? computeDailySeries(counted.transactions, counted.prices, baseOptions, localToday()) : null),
    [enabled, counted, baseOptions],
  )

  // The amounts are in the currency the inputs were converted to, which can still be EUR.
  if (loaded) setDisplayCurrency(loaded.currency)
  const currencyFallback = loaded && loaded.currency !== baseCurrency ? baseCurrency : null

  return { transactionCount, counted, sync, syncProblems, slowConnection, online, currencyFallback, baseOptions, baseSeries }
}

/** The portfolio loaded once for the whole app; null outside the provider, where a page loads it itself. */
export const PortfolioContext = createContext<LoadedPortfolio | null>(null)

/** Loads the portfolio for the provider; used by PortfolioProvider only. */
export function useSharedPortfolio(): LoadedPortfolio {
  return useLoadedPortfolio(true)
}

const sameOptions = (a: EngineOptions, b: EngineOptions) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The portfolio with `baseOptions`, filtered to `assetClasses` (empty shows everything). Inside the app it
 * reuses what the provider loaded, and its series when nothing differs; a page rendered on its own, as in a
 * test, loads the portfolio itself.
 */
export function usePortfolio(baseOptions: EngineOptions, assetClasses: readonly string[] = []): PortfolioState {
  const shared = useContext(PortfolioContext)
  const own = useLoadedPortfolio(shared === null)
  const state = shared ?? own
  const { counted } = state

  const filterKey = assetClasses.join('|')
  const filtered = filterKey !== ''
  // Cash belongs to no type of asset: a filtered view is securities only.
  const options = useMemo(() => (filtered ? { ...baseOptions, includeDeposits: false } : baseOptions), [baseOptions, filtered])
  const view = useMemo(
    () => (counted && filtered ? { ...counted, transactions: filterByAssetClass(counted.transactions, filterKey.split('|')) } : counted),
    [counted, filtered, filterKey],
  )
  const reuse = !filtered && sameOptions(options, state.baseOptions) && state.baseSeries !== null
  const series = useMemo(
    () => (reuse ? state.baseSeries : view && view.transactions.length > 0 ? computeDailySeries(view.transactions, view.prices, options, localToday()) : null),
    [reuse, state.baseSeries, view, options],
  )

  return {
    transactionCount: state.transactionCount,
    allInputs: counted,
    inputs: view,
    options,
    series,
    sync: state.sync,
    syncProblems: state.syncProblems,
    slowConnection: state.slowConnection,
    online: state.online,
    currencyFallback: state.currencyFallback,
  }
}

/** Lets tests start from a clean state. */
export function resetSyncSession(): void {
  lastSyncKey = null
}
