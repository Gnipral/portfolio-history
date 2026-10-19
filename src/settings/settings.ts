import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PortfolioDatabase } from '../data/db.ts'

/** Stored only in this browser's IndexedDB. */
export interface Settings {
  /** URL of the deployed workers/price-proxy, without trailing slash. */
  proxyUrl: string
  twelveDataKey: string
  alphaVantageKey: string
}

export const DEFAULT_SETTINGS: Settings = {
  proxyUrl: '',
  twelveDataKey: '',
  alphaVantageKey: '',
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
