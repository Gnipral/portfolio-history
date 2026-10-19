import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../../data/db.ts'
import { loadEngineInputs, type EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { computeDailySeries, type SeriesResult } from '../../engine/series.ts'
import { localToday } from '../../market/dates.ts'
import { syncMarketData, type SyncProgress } from '../../market/sync.ts'
import { loadSettings } from '../../settings/settings.ts'

/** Prices are brought up to date once per day and import per session, not on every visit of the page. */
let lastSyncKey: string | null = null

export interface PortfolioState {
  /** undefined while loading, 0 when nothing is imported. */
  transactionCount: number | undefined
  inputs: EngineInputs | null
  series: SeriesResult | null
  sync: SyncProgress | null
  syncProblems: number
}

export function usePortfolio(options: EngineOptions): PortfolioState {
  const transactionCount = useLiveQuery(() => db.transactions.count())
  const [inputs, setInputs] = useState<EngineInputs | null>(null)
  const [sync, setSync] = useState<SyncProgress | null>(null)
  const [syncProblems, setSyncProblems] = useState(0)

  useEffect(() => {
    if (!transactionCount) {
      setInputs(null)
      return
    }
    let cancelled = false
    void (async () => {
      const loaded = await loadEngineInputs(db)
      if (cancelled) return
      setInputs(loaded)
      const today = localToday()
      const syncKey = `${today}:${transactionCount}`
      if (lastSyncKey === syncKey) return
      lastSyncKey = syncKey
      const report = await syncMarketData({
        database: db,
        transactions: loaded.transactions,
        settings: await loadSettings(),
        today,
        now: new Date(),
        onProgress: (progress) => {
          if (!cancelled) setSync(progress)
        },
      })
      if (cancelled) return
      setSyncProblems(Object.keys(report.problems).length)
      setInputs(await loadEngineInputs(db))
    })()
    return () => {
      cancelled = true
    }
  }, [transactionCount])

  const series = useMemo(
    () => (inputs ? computeDailySeries(inputs.transactions, inputs.prices, options, localToday()) : null),
    [inputs, options],
  )

  return { transactionCount, inputs, series, sync, syncProblems }
}

/** Lets tests start from a clean state. */
export function resetSyncSession(): void {
  lastSyncKey = null
}
