/** Benchmarks published in public/data/ by the daily snapshot workflow (see scripts/lib/config.ts). */
export interface Benchmark {
  id: string
  name: string
  symbol: string
  currency: string
}

export const BENCHMARKS: Benchmark[] = [
  { id: 'iwda', name: 'iShares Core MSCI World UCITS ETF (Acc)', symbol: 'IWDA.AS', currency: 'EUR' },
  { id: 'vwce', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', symbol: 'VWCE.DE', currency: 'EUR' },
  { id: 'sxr8', name: 'iShares Core S&P 500 UCITS ETF (Acc)', symbol: 'SXR8.DE', currency: 'EUR' },
]

export const DEFAULT_BENCHMARK_ID = 'iwda'
