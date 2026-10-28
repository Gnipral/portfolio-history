import type { PortfolioDatabase } from '../data/db.ts'
import type { Benchmark } from '../market/benchmarks.ts'
import { FxRates } from '../market/fx.ts'
import { PriceSeries } from '../market/priceCache.ts'
import type { PricePoint } from '../market/types.ts'
import type { Transaction } from '../model/transaction.ts'
import { BaseFxRates, BaseRate, rebaseSeries, rebaseTransaction } from './baseCurrency.ts'
import { PriceBook, type SplitAdjustment } from './priceBook.ts'

export interface LoadedBenchmark {
  info: Benchmark
  /** Closes in the base currency. */
  series: PriceSeries
}

/** Everything the engine needs, with all amounts in the base currency (the EUR field names stay). */
export interface EngineInputs {
  transactions: Transaction[]
  prices: PriceBook
  /** The benchmarks asked for that have closes, in the order asked. */
  benchmarks: LoadedBenchmark[]
  /** The currency of every amount: the base asked for, or EUR while no rate of it is stored yet. */
  currency: string
}

/** Reads everything the engine needs from IndexedDB in one go, converted to `base` (EUR by default). */
export async function loadEngineInputs(database: PortfolioDatabase, benchmarks: Benchmark[] = [], base = 'EUR'): Promise<EngineInputs> {
  const [stored, symbolRecords, coverage, fxDays, splitRows] = await Promise.all([
    database.transactions.toArray(),
    database.symbols.toArray(),
    database.coverage.toArray(),
    database.fxDays.toArray(),
    database.splits.toArray(),
  ])

  const fx = new FxRates(fxDays)
  const asked = new BaseRate(fx, fxDays, base)
  // Without any rate of the base currency (offline before the first sync), stay in EUR instead of
  // calling a euro a dollar.
  const rate = asked.known ? asked : new BaseRate(fx, fxDays, 'EUR')
  base = rate.base
  const transactions = base === 'EUR' ? stored : stored.map((t) => rebaseTransaction(t, rate))

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
      fx: base === 'EUR' ? fx : new BaseFxRates(fxDays, rate),
    },
    transactions,
  )
  return {
    currency: base,
    transactions,
    prices,
    benchmarks: benchmarks.flatMap((info) => {
      const list = bySymbol.get(info.symbol)
      if (!list?.length) return []
      // A stock added to compare with can quote in dollars or pence: its closes go to EUR first, at the rate of each day.
      const currency = coverage.find((c) => c.symbol === info.symbol)?.currency || info.currency || 'EUR'
      const inEur =
        currency === 'EUR'
          ? list
          : list.flatMap((p) => {
              const close = fx.toEur(p.close, currency, p.date)
              return close === undefined ? [] : [{ ...p, close }]
            })
      return inEur.length ? [{ info, series: rebaseSeries(PriceSeries.fromPoints(info.symbol, inEur), rate) }] : []
    }),
  }
}
