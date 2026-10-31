/** Static data published in public/data/ by the daily snapshot workflow. */

export const DATA_START = '2010-01-01'

/**
 * ECB reference currencies kept in fx-rates.json (units per 1 EUR). GBX is derived in the app as GBP * 100.
 * Changing this list rebuilds fx-rates.json from DATA_START on the next run.
 */
export const FX_CURRENCIES = ['AUD', 'CAD', 'CHF', 'CZK', 'DKK', 'GBP', 'HKD', 'HUF', 'JPY', 'NOK', 'PLN', 'SEK', 'SGD', 'USD']

export interface BenchmarkConfig {
  id: string
  name: string
  /** Yahoo Finance symbol. */
  symbol: string
  currency: string
}

export const BENCHMARKS: BenchmarkConfig[] = [
  { id: 'iwda', name: 'iShares Core MSCI World UCITS ETF (Acc)', symbol: 'IWDA.AS', currency: 'EUR' },
  { id: 'vwce', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', symbol: 'VWCE.DE', currency: 'EUR' },
  { id: 'sxr8', name: 'iShares Core S&P 500 UCITS ETF (Acc)', symbol: 'SXR8.DE', currency: 'EUR' },
]

export const FX_FILE = 'fx-rates.json'
export const META_FILE = 'meta.json'
export const benchmarkFile = (id: string) => `benchmark-${id}.json`

/** Constituent weights of the MSCI World ETF, for the over/underweight column in Analysis. */
export const INDEX_WEIGHTS_FILE = 'msci-world-weights.json'
