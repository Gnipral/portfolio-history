import type { PortfolioDatabase } from '../data/db.ts'
import { addDays, daysBetween, lastIndexOnOrBefore } from './dates.ts'
import type { DateRange, PriceCoverage, PricePoint } from './types.ts'

/**
 * Date ranges still to fetch for `need`, given what is cached.
 * The open end is fetched at most once per day: today's close is not final until tomorrow.
 */
export function missingRanges(coverage: PriceCoverage | undefined, need: DateRange, today: string): DateRange[] {
  if (need.from > need.to) return []
  if (!coverage) return [need]
  const ranges: DateRange[] = []
  if (need.from < coverage.from) ranges.push({ from: need.from, to: addDays(coverage.from, -1) })
  const fetchedToday = coverage.fetchedAt.slice(0, 10) >= today
  if (need.to > coverage.to && !fetchedToday) ranges.push({ from: addDays(coverage.to, 1), to: need.to })
  return ranges
}

/**
 * Stores fetched prices and extends the coverage. Coverage never includes today,
 * so today's provisional close is replaced by the final one on a later fetch.
 */
export async function savePrices(
  database: PortfolioDatabase,
  symbol: string,
  points: PricePoint[],
  range: DateRange,
  info: { currency: string; source: string },
  now: Date,
  today: string,
): Promise<void> {
  const yesterday = addDays(today, -1)
  const to = range.to < today ? range.to : yesterday
  await database.transaction('rw', database.prices, database.coverage, async () => {
    await database.prices.bulkPut(points)
    const existing = await database.coverage.get(symbol)
    const coverage: PriceCoverage = {
      symbol,
      from: existing && existing.from < range.from ? existing.from : range.from,
      to: existing && existing.to > to ? existing.to : to,
      currency: info.currency,
      source: info.source,
      fetchedAt: now.toISOString(),
    }
    await database.coverage.put(coverage)
  })
}

/** Closing prices of one symbol, sorted by date. */
export class PriceSeries {
  constructor(
    readonly symbol: string,
    readonly dates: string[],
    readonly closes: number[],
  ) {}

  static fromPoints(symbol: string, points: PricePoint[]): PriceSeries {
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
    return new PriceSeries(
      symbol,
      sorted.map((p) => p.date),
      sorted.map((p) => p.close),
    )
  }

  get lastDate(): string | undefined {
    return this.dates.at(-1)
  }

  /** Last close on or before `date`, with the number of days since that close (0 = same day). */
  closeOn(date: string): { close: number; date: string; ageDays: number } | undefined {
    const index = lastIndexOnOrBefore(this.dates, date)
    if (index < 0) return undefined
    const closeDate = this.dates[index] as string
    return { close: this.closes[index] as number, date: closeDate, ageDays: daysBetween(closeDate, date) }
  }
}

export async function loadSeries(database: PortfolioDatabase, symbol: string): Promise<PriceSeries> {
  const points = await database.prices.where('symbol').equals(symbol).toArray()
  return PriceSeries.fromPoints(symbol, points)
}
