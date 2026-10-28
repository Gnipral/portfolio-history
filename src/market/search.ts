import type { Settings } from '../settings/settings.ts'
import { t } from '../i18n/i18n.ts'
import { fetchJson } from './http.ts'

export interface SymbolSearchResult {
  symbol: string
  name: string
  exchange: string
  type: string
}

/** Stocks, ETFs, funds and indices that match a name or ticker, through the price proxy (Yahoo Finance). */
export async function searchSymbols(query: string, settings: Pick<Settings, 'proxyUrl'>): Promise<SymbolSearchResult[]> {
  const q = query.trim()
  if (!q) return []
  if (!settings.proxyUrl) throw new Error(t('Searching needs the price proxy: fill in its URL under Settings > Price sources.'))
  const answer = await fetchJson<{ results?: SymbolSearchResult[] }>(`${settings.proxyUrl}/yahoo/search?${new URLSearchParams({ q: q.slice(0, 50) })}`)
  return Array.isArray(answer.results) ? answer.results : []
}
