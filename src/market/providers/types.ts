import type { Settings } from '../../settings/settings.ts'
import type { DateRange } from '../types.ts'

export interface DailyClose {
  date: string
  close: number
}

export interface ProviderSplit {
  date: string
  /** New shares per old share. */
  ratio: number
}

export interface ProviderResult {
  /** Trading currency of the closes, e.g. `USD` or `GBp`. */
  currency: string
  closes: DailyClose[]
  splits: ProviderSplit[]
}

export interface PriceProvider {
  id: string
  label: string
  /** Whether the provider is configured (key or proxy URL present). */
  isAvailable(settings: Settings): boolean
  supports(symbol: string, kind: 'security' | 'crypto'): boolean
  fetchDaily(symbol: string, range: DateRange, settings: Settings): Promise<ProviderResult>
}

/** A response that says the request cannot succeed (unknown symbol, plan limit), not worth retrying. */
export class ProviderError extends Error {
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`)
    this.name = 'ProviderError'
  }
}

export function toEpochSeconds(isoDate: string, endOfDay = false): number {
  return Math.floor(Date.parse(`${isoDate}T${endOfDay ? '23:59:59' : '00:00:00'}Z`) / 1000)
}
