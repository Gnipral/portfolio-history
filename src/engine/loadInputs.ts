import type { PortfolioDatabase } from '../data/db.ts'
import type { Benchmark } from '../market/benchmarks.ts'
import { FxRates } from '../market/fx.ts'
import { PriceSeries } from '../market/priceCache.ts'
import type { PricePoint } from '../market/types.ts'
import type { Transaction } from '../model/transaction.ts'
import { PriceBook, type SplitAdjustment } from './priceBook.ts'

export interface LoadedBenchmark {
  info: Benchmark
  /** Closes in EUR. */
  series: PriceSeries
}

export interface EngineInputs {
  transactions: Transaction[]
  prices: PriceBook
  /** The benchmarks asked for that have closes, in the order asked. */
  benchmarks: LoadedBenchmark[]
}

/** Reads everything the engine needs from IndexedDB in one go. */
export async function loadEngineInputs(database: PortfolioDatabase, benchmarks: Benchmark[] = []): Promise<EngineInputs> {
  const [transactions, symbolRecords, coverage, fxDays, splitRows] = await Promise.all([
    database.transactions.toArray(),
    database.symbols.toArray(),
    database.coverage.toArray(),
    database.fxDays.toArray(),
    database.splits.toArray(),
  ])

  const symbols = new Map(symbolRecords.flatMap((r) => (r.symbol ? [[r.key, r.symbol] as const] : [])))
  const wanted = [...new Set([...symbols.values(), ...benchmarks.map((b) => b.symbol)])]
  const points = await database.prices.where('symbol').anyOf(wanted).toArray()
  const bySymbol = new Map<string, PricePoint[]>()
  for (const p of points) {
    const list = bySymbol.get(p.symbol) ?? []
    list.push(p)
    bySymbol.set(p.symbol, list)
  }

  const splits = new Map<string, SplitAdjustment[]>()
  for (const s of splitRows) splits.set(s.symbol, [...(splits.get(s.symbol) ?? []), { date: s.date, ratio: s.ratio }])

  const prices = new PriceBook(
    {
      symbols,
      series: new Map([...bySymbol].map(([symbol, list]) => [symbol, PriceSeries.fromPoints(symbol, list)])),
      currencies: new Map(coverage.map((c) => [c.symbol, c.currency])),
      splits,
      fx: new FxRates(fxDays),
    },
    transactions,
  )
  return {
    transactions,
    prices,
    benchmarks: benchmarks.flatMap((info) => {
      const list = bySymbol.get(info.symbol)
      return list?.length ? [{ info, series: PriceSeries.fromPoints(info.symbol, list) }] : []
    }),
  }
}
