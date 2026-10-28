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

/** Prefix of the id of a benchmark the user found with the symbol search. */
const CUSTOM_PREFIX = 'custom:'

export function isCustomBenchmark(benchmark: Pick<Benchmark, 'id'>): boolean {
  return benchmark.id.startsWith(CUSTOM_PREFIX)
}

/** A stock, fund or index found with the search, to compare with. Its currency comes with its prices. */
export function customBenchmark(found: { symbol: string; name: string }): Benchmark {
  return { id: `${CUSTOM_PREFIX}${found.symbol}`, name: found.name, symbol: found.symbol, currency: '' }
}

/** The built-in benchmarks and the ones the user added, each once. */
export function benchmarkCatalog(custom: readonly Benchmark[]): Benchmark[] {
  const known = new Set(BENCHMARKS.map((b) => b.symbol))
  return [...BENCHMARKS, ...custom.filter((b) => !known.has(b.symbol))]
}
