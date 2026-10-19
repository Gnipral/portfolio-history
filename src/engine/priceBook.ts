import { daysBetween } from '../market/dates.ts'
import type { FxRates } from '../market/fx.ts'
import type { PriceSeries } from '../market/priceCache.ts'
import type { Transaction } from '../model/transaction.ts'
import { instrumentKey } from '../market/instruments.ts'
import type { Holding } from './ledger.ts'

/** A market price older than this is shown as stale (e.g. a delisted share). */
export const STALE_AFTER_DAYS = 7

/** Splits within this many days of each other are the same event reported by two sources. */
const SAME_SPLIT_DAYS = 5

export interface SplitAdjustment {
  date: string
  ratio: number
}

export interface PriceBookInputs {
  /** Instrument key → price symbol. */
  symbols: Map<string, string>
  series: Map<string, PriceSeries>
  /** Symbol → currency of its closes. */
  currencies: Map<string, string>
  /** Symbol → splits from the price source or entered manually. */
  splits: Map<string, SplitAdjustment[]>
  fx: FxRates
}

export interface Price {
  /** EUR per unit, as of the valuation date's share count. */
  eur: number
  source: 'market' | 'trade'
  /** Date of the close (market) or the trade (fallback). */
  date: string
  stale: boolean
}

/**
 * EUR prices per instrument and day. Sources deliver split-adjusted closes, while quantities
 * from the broker are the real share counts at that time; closes before a split are therefore
 * multiplied back by the ratio of every split after the valuation date.
 */
export class PriceBook {
  private readonly splits = new Map<string, SplitAdjustment[]>()

  constructor(
    private readonly inputs: PriceBookInputs,
    transactions: Transaction[] = [],
  ) {
    for (const [symbol, list] of inputs.splits) this.splits.set(symbol, [...list])
    // Splits in the broker export complete what the price source reported (e.g. Twelve Data has none).
    for (const t of transactions) {
      if (t.type !== 'split' || !t.split || t.split.fromIsin) continue
      const symbol = inputs.symbols.get(instrumentKey(t))
      if (!symbol) continue
      const list = this.splits.get(symbol) ?? []
      if (!list.some((s) => Math.abs(daysBetween(s.date, t.date)) <= SAME_SPLIT_DAYS)) {
        list.push({ date: t.date, ratio: t.split.ratio })
        this.splits.set(symbol, list)
      }
    }
  }

  symbolOf(key: string): string | undefined {
    return this.inputs.symbols.get(key)
  }

  /** Product of the ratios of splits that happen after `date`. */
  private splitFactor(symbol: string, date: string): number {
    return (this.splits.get(symbol) ?? []).filter((s) => s.date > date).reduce((factor, s) => factor * s.ratio, 1)
  }

  marketPrice(key: string, date: string): Price | undefined {
    const symbol = this.inputs.symbols.get(key)
    const series = symbol ? this.inputs.series.get(symbol) : undefined
    const close = series?.closeOn(date)
    if (!symbol || !close) return undefined
    const currency = this.inputs.currencies.get(symbol) ?? 'EUR'
    const eur = this.inputs.fx.toEur(close.close * this.splitFactor(symbol, date), currency, date)
    if (eur === undefined) return undefined
    return { eur, source: 'market', date: close.date, stale: close.ageDays > STALE_AFTER_DAYS }
  }

  /** Market price, or the last trade price when no market price is known. */
  price(holding: Holding, date: string): Price | undefined {
    const market = this.marketPrice(holding.key, date)
    if (market) return market
    if (holding.lastTradePrice === undefined) return undefined
    return {
      eur: holding.lastTradePrice,
      source: 'trade',
      date: holding.lastTradeDate ?? date,
      stale: holding.lastTradeDate ? daysBetween(holding.lastTradeDate, date) > STALE_AFTER_DAYS : false,
    }
  }
}
