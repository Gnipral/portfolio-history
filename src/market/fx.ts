import { daysBetween, lastIndexOnOrBefore } from './dates.ts'
import type { FxDay } from './types.ts'

/** Longest gap bridged with an earlier rate: covers weekends and the Easter/Christmas ECB holidays. */
export const MAX_FX_GAP_DAYS = 7

/** Currencies quoted in a fraction of a base currency. */
const SUBUNITS: Record<string, { base: string; factor: number }> = {
  GBX: { base: 'GBP', factor: 100 },
  GBp: { base: 'GBP', factor: 100 },
  ZAc: { base: 'ZAR', factor: 100 },
  ILA: { base: 'ILS', factor: 100 },
}

/** Lookup of historical EUR rates. A missing day uses the latest earlier rate within MAX_FX_GAP_DAYS. */
export class FxRates {
  private readonly dates: string[]
  private readonly days: FxDay[]

  constructor(days: FxDay[]) {
    this.days = [...days].sort((a, b) => a.date.localeCompare(b.date))
    this.dates = this.days.map((d) => d.date)
  }

  get lastDate(): string | undefined {
    return this.dates.at(-1)
  }

  /** Units of `currency` per 1 EUR on `date`, or undefined when unknown. */
  rate(currency: string, date: string): number | undefined {
    if (currency === 'EUR') return 1
    const subunit = SUBUNITS[currency]
    if (subunit) {
      const base = this.rate(subunit.base, date)
      return base === undefined ? undefined : base * subunit.factor
    }
    let index = lastIndexOnOrBefore(this.dates, date)
    while (index >= 0) {
      const day = this.days[index] as FxDay
      if (daysBetween(day.date, date) > MAX_FX_GAP_DAYS) return undefined
      const rate = day.rates[currency]
      if (rate !== undefined) return rate
      index--
    }
    return undefined
  }

  toEur(amount: number, currency: string, date: string): number | undefined {
    const rate = this.rate(currency, date)
    return rate === undefined ? undefined : amount / rate
  }
}

/** Shape of public/data/fx-rates.json written by the daily snapshot workflow. */
export interface StaticFxFile {
  base: 'EUR'
  currencies: string[]
  rates: Record<string, (number | null)[]>
}

export function parseStaticFx(file: StaticFxFile): FxDay[] {
  return Object.entries(file.rates).map(([date, values]) => {
    const rates: Record<string, number> = {}
    file.currencies.forEach((currency, i) => {
      const value = values[i]
      if (typeof value === 'number') rates[currency] = value
    })
    return { date, rates }
  })
}

/** Frankfurter time series response: `{ rates: { "2026-10-19": { "USD": 1.17 } } }`. */
export function parseFrankfurter(body: { rates?: Record<string, Record<string, number>> }): FxDay[] {
  return Object.entries(body.rates ?? {}).map(([date, rates]) => ({ date, rates }))
}
