/** Daily closing price of a symbol, in the symbol's trading currency. Split-adjusted as delivered by the source. */
export interface PricePoint {
  symbol: string
  date: string
  close: number
}

/** The contiguous date range for which prices of a symbol have been fetched. */
export interface PriceCoverage {
  symbol: string
  from: string
  to: string
  currency: string
  source: string
  /** ISO timestamp of the last fetch, used to avoid refetching the same day. */
  fetchedAt: string
}

/** ECB reference rates of one day, units of currency per 1 EUR. */
export interface FxDay {
  date: string
  rates: Record<string, number>
}

export interface SplitEvent {
  /** `${symbol}:${date}` */
  id: string
  symbol: string
  date: string
  /** New shares per old share. */
  ratio: number
  source: 'provider' | 'manual'
}

export interface DateRange {
  from: string
  to: string
}

/** How an instrument is priced: the resolved or manually entered symbol. */
export interface SymbolRecord {
  /** Instrument key: ISIN, or the product name when there is no ISIN. */
  key: string
  symbol?: string
  kind: 'security' | 'crypto'
  source: 'openfigi' | 'coingecko' | 'manual'
  name?: string
  error?: string
  resolvedAt: string
}
