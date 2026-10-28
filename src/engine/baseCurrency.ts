import { FxRates } from '../market/fx.ts'
import { PriceSeries } from '../market/priceCache.ts'
import type { FxDay } from '../market/types.ts'
import type { Transaction } from '../model/transaction.ts'

/** Currencies the portfolio can be shown in: the euro and those of the ECB reference rates in the static data. */
export const BASE_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'CAD', 'AUD', 'JPY', 'HKD', 'SGD'] as const
export type BaseCurrency = (typeof BASE_CURRENCIES)[number]

/**
 * Units of `base` per EUR on a date. Outside the known rates (before the first, or after a long gap) the
 * nearest known rate is used, so an amount is never dropped for a missing rate.
 */
export class BaseRate {
  private readonly days: FxDay[]

  constructor(
    private readonly fx: FxRates,
    days: FxDay[],
    readonly base: string,
  ) {
    this.days = days.filter((d) => d.rates[base] !== undefined).sort((a, b) => a.date.localeCompare(b.date))
  }

  on(date: string): number {
    if (this.base === 'EUR') return 1
    const rate = this.fx.rate(this.base, date)
    if (rate !== undefined) return rate
    const first = this.days[0]
    if (!first) return 1
    const nearest = date < first.date ? first : (this.days.findLast((d) => d.date <= date) ?? first)
    return nearest.rates[this.base] as number
  }
}

/** Converts like FxRates, but to the base currency instead of EUR, so the price book values in that currency. */
export class BaseFxRates extends FxRates {
  constructor(
    days: FxDay[],
    private readonly baseRate: BaseRate,
  ) {
    super(days)
  }

  override toEur(amount: number, currency: string, date: string): number | undefined {
    if (currency === this.baseRate.base) return amount
    const eur = super.toEur(amount, currency, date)
    return eur === undefined ? undefined : eur * this.baseRate.on(date)
  }
}

/** The transaction with every EUR amount in the base currency of its date. The field names keep saying EUR. */
export function rebaseTransaction(t: Transaction, rate: BaseRate): Transaction {
  const f = rate.on(t.date)
  if (f === 1) return t
  return {
    ...t,
    amountEur: t.amountEur * f,
    costsEur: t.costsEur * f,
    taxesEur: t.taxesEur * f,
    fxCostsEur: t.fxCostsEur * f,
    totalEur: t.totalEur * f,
  }
}

/** A benchmark's EUR closes in the base currency. */
export function rebaseSeries(series: PriceSeries, rate: BaseRate): PriceSeries {
  if (rate.base === 'EUR') return series
  return new PriceSeries(
    series.symbol,
    series.dates,
    series.closes.map((close, i) => close * rate.on(series.dates[i] as string)),
  )
}
