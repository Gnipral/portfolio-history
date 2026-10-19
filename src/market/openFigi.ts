import { fetchJson } from './http.ts'
import { preferredFigiExchanges, yahooSymbol } from './symbols.ts'

export interface FigiListing {
  ticker?: string
  exchCode?: string
  name?: string
  marketSector?: string
  securityType?: string
}

export type FigiResult = { data?: FigiListing[]; warning?: string; error?: string }

export interface FigiQuery {
  isin: string
  brokerExchange?: string
}

export interface Resolution {
  symbol: string
  name?: string
}

/** Picks the listing on the preferred exchange and turns it into a Yahoo-style symbol. */
export function chooseListing(query: FigiQuery, listings: FigiListing[]): Resolution | undefined {
  const candidates = listings.filter((l) => l.ticker && l.exchCode)
  for (const exchange of preferredFigiExchanges(query.isin, query.brokerExchange)) {
    const listing = candidates.find((l) => l.exchCode === exchange)
    const symbol = listing?.ticker ? yahooSymbol(listing.ticker, exchange) : undefined
    if (symbol) return { symbol, ...(listing?.name ? { name: listing.name } : {}) }
  }
  for (const listing of candidates) {
    const symbol = yahooSymbol(listing.ticker as string, listing.exchCode as string)
    if (symbol) return { symbol, ...(listing.name ? { name: listing.name } : {}) }
  }
  return undefined
}

/** Resolves up to 10 ISINs in one request through the price proxy (OpenFIGI has no CORS support). */
export async function resolveIsins(
  proxyUrl: string,
  queries: FigiQuery[],
): Promise<(Resolution | { error: string })[]> {
  const body = JSON.stringify(queries.map((q) => ({ idType: 'ID_ISIN', idValue: q.isin })))
  const results = await fetchJson<FigiResult[]>(`${proxyUrl.replace(/\/$/, '')}/openfigi/mapping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  return queries.map((query, i) => {
    const result = results[i]
    if (!result?.data?.length) return { error: result?.warning ?? result?.error ?? 'No listing found for this ISIN' }
    return chooseListing(query, result.data) ?? { error: 'No listing on a supported exchange' }
  })
}
