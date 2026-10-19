import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PortfolioDatabase } from '../data/db.ts'
import { DEFAULT_BENCHMARK_ID } from '../market/benchmarks.ts'

/** Stored only in this browser's IndexedDB. */
export interface Settings {
  /** URL of the deployed workers/price-proxy, without trailing slash. */
  proxyUrl: string
  twelveDataKey: string
  alphaVantageKey: string
  /** Id from BENCHMARKS, compared with the portfolio on the dashboard. */
  benchmarkId: string
}

/** The project's own deployment of workers/price-proxy (Cloudflare Workers Builds from main). */
export const DEFAULT_PROXY_URL = 'https://portfolio-history-price-proxy.tibo-dhave.workers.dev'

export const DEFAULT_SETTINGS: Settings = {
  proxyUrl: DEFAULT_PROXY_URL,
  twelveDataKey: '',
  alphaVantageKey: '',
  benchmarkId: DEFAULT_BENCHMARK_ID,
}

const SETTINGS_KEY = 'settings'

export async function loadSettings(database: PortfolioDatabase = db): Promise<Settings> {
  const stored = (await database.kv.get(SETTINGS_KEY))?.value
  if (!stored) return DEFAULT_SETTINGS
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(changes: Partial<Settings>, database: PortfolioDatabase = db): Promise<Settings> {
  const next = { ...(await loadSettings(database)), ...changes }
  next.proxyUrl = next.proxyUrl.trim().replace(/\/+$/, '')
  next.twelveDataKey = next.twelveDataKey.trim()
  next.alphaVantageKey = next.alphaVantageKey.trim()
  await database.kv.put({ key: SETTINGS_KEY, value: JSON.stringify(next) })
  return next
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => loadSettings())
}
