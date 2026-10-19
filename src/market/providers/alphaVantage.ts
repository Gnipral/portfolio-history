import { fetchJson } from '../http.ts'
import { splitSymbol } from '../symbols.ts'
import type { DateRange } from '../types.ts'
import { ProviderError, type PriceProvider, type ProviderResult } from './types.ts'

/** Alpha Vantage suffixes documented in its examples (TSCO.LON, MBG.DEX). */
const SUFFIXES: Record<string, string> = { '': '', '.L': '.LON', '.DE': '.DEX' }

type AlphaVantageDaily = {
  'Time Series (Daily)'?: Record<string, { '4. close': string }>
  Information?: string
  Note?: string
  'Error Message'?: string
}

export function parseAlphaVantage(body: AlphaVantageDaily, range: DateRange, currency: string): ProviderResult {
  const series = body['Time Series (Daily)']
  if (!series) {
    throw new ProviderError('Alpha Vantage', body['Error Message'] ?? body.Information ?? body.Note ?? 'no data')
  }
  const closes = Object.entries(series)
    .map(([date, v]) => ({ date, close: Number(v['4. close']) }))
    .filter((p) => Number.isFinite(p.close) && p.date >= range.from && p.date <= range.to)
    .sort((a, b) => a.date.localeCompare(b.date))
  return { currency, closes, splits: [] }
}

/**
 * Free plan: 25 requests per day and only the last 100 trading days ("compact").
 * Used as a last resort to fill recent days.
 */
export const alphaVantageProvider: PriceProvider = {
  id: 'alpha-vantage',
  label: 'Alpha Vantage',
  isAvailable: (settings) => settings.alphaVantageKey !== '',
  supports: (symbol, kind) => kind === 'security' && splitSymbol(symbol).suffix in SUFFIXES,
  async fetchDaily(symbol, range, settings) {
    const { ticker, suffix } = splitSymbol(symbol)
    const params = new URLSearchParams({
      function: 'TIME_SERIES_DAILY',
      symbol: `${ticker}${SUFFIXES[suffix] ?? ''}`,
      outputsize: 'compact',
      apikey: settings.alphaVantageKey,
    })
    const currency = suffix === '.L' ? 'GBp' : suffix === '.DE' ? 'EUR' : 'USD'
    return parseAlphaVantage(await fetchJson(`https://www.alphavantage.co/query?${params}`), range, currency)
  },
}
