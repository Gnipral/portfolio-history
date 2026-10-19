import { fetchJson } from '../http.ts'
import { micForSymbol, splitSymbol } from '../symbols.ts'
import type { DateRange } from '../types.ts'
import { ProviderError, type PriceProvider, type ProviderResult } from './types.ts'

interface TwelveDataSeries {
  status: 'ok' | 'error'
  code?: number
  message?: string
  meta?: { currency?: string }
  values?: { datetime: string; close: string }[]
}

export function parseTwelveData(body: TwelveDataSeries): ProviderResult {
  if (body.status !== 'ok') throw new ProviderError('Twelve Data', body.message ?? `error ${body.code ?? ''}`)
  const closes = (body.values ?? [])
    .map((v) => ({ date: v.datetime.slice(0, 10), close: Number(v.close) }))
    .filter((p) => Number.isFinite(p.close))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { currency: body.meta?.currency ?? 'USD', closes, splits: [] }
}

export function twelveDataUrl(symbol: string, range: DateRange, apiKey: string): string {
  const { ticker, suffix } = splitSymbol(symbol)
  const params = new URLSearchParams({
    symbol: ticker,
    interval: '1day',
    start_date: range.from,
    end_date: range.to,
    order: 'ASC',
    outputsize: '5000',
    apikey: apiKey,
  })
  const mic = micForSymbol(symbol)
  if (suffix && mic) params.set('mic_code', mic)
  return `https://api.twelvedata.com/time_series?${params}`
}

/** Free plan: 8 requests per minute, 800 per day. Exchange coverage depends on the plan. */
export const twelveDataProvider: PriceProvider = {
  id: 'twelve-data',
  label: 'Twelve Data',
  isAvailable: (settings) => settings.twelveDataKey !== '',
  supports: (symbol, kind) => kind === 'security' && (splitSymbol(symbol).suffix === '' || micForSymbol(symbol) !== undefined),
  async fetchDaily(symbol, range, settings) {
    return parseTwelveData(await fetchJson<TwelveDataSeries>(twelveDataUrl(symbol, range, settings.twelveDataKey)))
  },
}
