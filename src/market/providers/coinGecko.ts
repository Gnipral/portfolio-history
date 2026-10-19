import { fetchJson } from '../http.ts'
import type { DateRange } from '../types.ts'
import { ProviderError, toEpochSeconds, type PriceProvider, type ProviderResult } from './types.ts'

/** Crypto symbols are stored as `crypto:<coingecko id>`, e.g. `crypto:bitcoin`. */
export const CRYPTO_PREFIX = 'crypto:'

/** Last price of every UTC day, in EUR. */
export function parseMarketChart(body: { prices?: [number, number][] }, range: DateRange): ProviderResult {
  if (!body.prices) throw new ProviderError('CoinGecko', 'no data')
  const byDay = new Map<string, number>()
  for (const [ms, price] of body.prices) byDay.set(new Date(ms).toISOString().slice(0, 10), price)
  const closes = [...byDay.entries()]
    .map(([date, close]) => ({ date, close }))
    .filter((p) => p.date >= range.from && p.date <= range.to)
    .sort((a, b) => a.date.localeCompare(b.date))
  return { currency: 'EUR', closes, splits: [] }
}

/** Finds the CoinGecko id for a ticker such as BTC. */
export async function searchCoinId(ticker: string): Promise<string | undefined> {
  const body = await fetchJson<{ coins?: { id: string; symbol: string; market_cap_rank: number | null }[] }>(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`,
  )
  const matches = (body.coins ?? []).filter((c) => c.symbol.toLowerCase() === ticker.toLowerCase())
  matches.sort((a, b) => (a.market_cap_rank ?? Infinity) - (b.market_cap_rank ?? Infinity))
  return matches[0]?.id
}

/** Key-less public API. Its history is limited to the last 365 days. */
export const coinGeckoProvider: PriceProvider = {
  id: 'coingecko',
  label: 'CoinGecko',
  isAvailable: () => true,
  supports: (symbol, kind) => kind === 'crypto' && symbol.startsWith(CRYPTO_PREFIX),
  async fetchDaily(symbol, range) {
    const id = symbol.slice(CRYPTO_PREFIX.length)
    const params = new URLSearchParams({
      vs_currency: 'eur',
      from: String(toEpochSeconds(range.from)),
      to: String(toEpochSeconds(range.to, true)),
    })
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range?${params}`
    return parseMarketChart(await fetchJson(url), range)
  },
}
