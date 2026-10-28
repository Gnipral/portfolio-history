import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../data/db.ts'
import { loadEngineInputs, type EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { computeDailySeries, type SeriesResult } from '../../engine/series.ts'
import { localToday } from '../../market/dates.ts'
import { syncMarketData, type SyncProgress } from '../../market/sync.ts'
import { BENCHMARKS, DEFAULT_BENCHMARK_ID } from '../../market/benchmarks.ts'
import { loadSettings, useSettings } from '../../settings/settings.ts'
import { useOnline } from '../useOnline.ts'

/** Prices are brought up to date once per day, import and benchmark per session, not on every visit of the page. */
let lastSyncKey: string | null = null

/** After a failure of the connection, the prices are tried again this often while the dashboard is open. */
export const RETRY_MS = 60_000

export interface PortfolioState {
  /** undefined while loading, 0 when nothing is imported. */
  transactionCount: number | undefined
  inputs: EngineInputs | null
  series: SeriesResult | null
  sync: SyncProgress | null
  /** Instruments with a problem of their own; not those that only failed on the connection. */
  syncProblems: number
  /** The last update could not reach a price source: the stored prices are shown. */
  slowConnection: boolean
  online: boolean
}

export function usePortfolio(options: EngineOptions): PortfolioState {
  const transactionCount = useLiveQuery(() => db.transactions.count())
  const benchmarkId = useSettings()?.benchmarkId
  const [inputs, setInputs] = useState<EngineInputs | null>(null)
  const [sync, setSync] = useState<SyncProgress | null>(null)
  const [syncProblems, setSyncProblems] = useState(0)
  const [slowConnection, setSlowConnection] = useState(false)
  // Raised to try the prices again after a failure of the connection.
  const [attempt, setAttempt] = useState(0)
  const online = useOnline()

  useEffect(() => {
    // benchmarkId is undefined while the settings load, and empty when every benchmark is off.
    if (!transactionCount || benchmarkId === undefined) {
      if (transactionCount === 0) setInputs(null)
      return
    }
    // Every benchmark is loaded: they are small, and the dashboard can show several or a mix.
    const main = BENCHMARKS.find((b) => b.id === benchmarkId) ?? BENCHMARKS.find((b) => b.id === DEFAULT_BENCHMARK_ID)
    const benchmarks = [...(main ? [main] : []), ...BENCHMARKS.filter((b) => b !== main)]
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      const loaded = await loadEngineInputs(db, benchmarks)
      if (cancelled) return
      setInputs(loaded)
      const today = localToday()
      const syncKey = `${today}:${transactionCount}:${benchmarkId}`
      // Offline: show what is stored and sync as soon as the connection is back.
      if (!online || lastSyncKey === syncKey) return
      lastSyncKey = syncKey
      const report = await syncMarketData({
        database: db,
        transactions: loaded.transactions,
        settings: await loadSettings(),
        today,
        now: new Date(),
        benchmarkIds: benchmarks.map((b) => b.id),
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
      setInputs(await loadEngineInputs(db, benchmarks))
    })()
    return () => {
      cancelled = true
      clearTimeout(retry)
    }
  }, [transactionCount, benchmarkId, online, attempt])

  const series = useMemo(
    () => (inputs ? computeDailySeries(inputs.transactions, inputs.prices, options, localToday()) : null),
    [inputs, options],
  )

  return { transactionCount, inputs, series, sync, syncProblems, slowConnection, online }
}

/** Lets tests start from a clean state. */
export function resetSyncSession(): void {
  lastSyncKey = null
}
