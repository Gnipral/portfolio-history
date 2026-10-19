import { fetchJson } from '../http.ts'
import type { DateRange } from '../types.ts'
import { ProviderError, toEpochSeconds, type PriceProvider, type ProviderResult } from './types.ts'

interface YahooResult {
  meta: { currency?: string; gmtoffset?: number }
  timestamp?: number[]
  indicators: { quote: { close: (number | null)[] }[] }
  events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> }
}

interface YahooChart {
  chart: { result?: YahooResult[] | null; error?: { description?: string } | null }
}

function exchangeDate(timestamp: number, gmtoffset: number): string {
  return new Date((timestamp + gmtoffset) * 1000).toISOString().slice(0, 10)
}

/**
 * Includes the bar of a session still open: it is the current price and is replaced by the final close later.
 * Keeps every split from the start of the range on, also after its end.
 */
export function parseYahooChart(body: YahooChart, range: DateRange): ProviderResult {
  const result = body.chart.result?.[0]
  if (!result) throw new ProviderError('Yahoo', body.chart.error?.description ?? 'no data')
  const offset = result.meta.gmtoffset ?? 0
  const closes = result.indicators.quote[0]?.close ?? []
  const points = (result.timestamp ?? [])
    .map((t, i) => ({ date: exchangeDate(t, offset), close: closes[i] }))
    .filter((p): p is { date: string; close: number } => typeof p.close === 'number')
    .filter((p) => p.date >= range.from && p.date <= range.to)
  const splits = Object.values(result.events?.splits ?? {})
    .filter((s) => s.numerator > 0 && s.denominator > 0)
    .map((s) => ({ date: exchangeDate(s.date, offset), ratio: s.numerator / s.denominator }))
    .filter((s) => s.date >= range.from)
  return { currency: result.meta.currency ?? 'USD', closes: points, splits }
}

export const yahooProxyProvider: PriceProvider = {
  id: 'yahoo-proxy',
  label: 'Yahoo Finance (via price proxy)',
  isAvailable: (settings) => settings.proxyUrl !== '',
  supports: (_symbol, kind) => kind === 'security',
  async fetchDaily(symbol, range, settings) {
    // Always ask up to now: closes are split-adjusted for every later split, so splits after a
    // closed position are needed too. Closes outside the range are dropped by the parser.
    const params = new URLSearchParams({
      period1: String(toEpochSeconds(range.from)),
      period2: String(Math.max(toEpochSeconds(range.to, true), Math.floor(Date.now() / 1000))),
    })
    const url = `${settings.proxyUrl}/yahoo/chart/${encodeURIComponent(symbol)}?${params}`
    return parseYahooChart(await fetchJson<YahooChart>(url), range)
  },
}
