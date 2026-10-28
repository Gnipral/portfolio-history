import { addDays } from '../market/dates.ts'
import type { DailyClose } from '../market/providers/types.ts'
import type { DateRange } from '../market/types.ts'

/** A made-up instrument of the demo portfolio, priced by a fixed random walk. */
export interface DemoInstrument {
  symbol: string
  product: string
  isin?: string
  ticker: string
  assetClass: 'etf' | 'stock' | 'crypto'
  currency: string
  start: number
  /** Yearly drift and volatility of the walk. */
  drift: number
  volatility: number
}

export const DEMO_PREFIX = 'demo:'

export const DEMO_INSTRUMENTS: DemoInstrument[] = [
  { symbol: 'demo:world', product: 'DEMO GLOBAL EQUITY ETF', isin: 'IE00DEMO0001', ticker: 'DWLD', assetClass: 'etf', currency: 'EUR', start: 80, drift: 0.08, volatility: 0.15 },
  { symbol: 'demo:europe', product: 'DEMO EUROPE ETF', isin: 'IE00DEMO0002', ticker: 'DEUR', assetClass: 'etf', currency: 'EUR', start: 50, drift: 0.05, volatility: 0.16 },
  { symbol: 'demo:tech', product: 'DEMO TECH INC', isin: 'US00DEMO0003', ticker: 'DTEC', assetClass: 'stock', currency: 'USD', start: 120, drift: 0.14, volatility: 0.32 },
  { symbol: 'demo:bank', product: 'DEMO BANK NV', isin: 'BE00DEMO0004', ticker: 'DBNK', assetClass: 'stock', currency: 'EUR', start: 30, drift: 0.03, volatility: 0.24 },
  { symbol: 'demo:coin', product: 'Demo Coin', ticker: 'DMC', assetClass: 'crypto', currency: 'EUR', start: 2000, drift: 0.2, volatility: 0.7 },
]

/** First day of every walk: the demo portfolio starts later. */
const BASE_DATE = '2020-01-01'

/** Small seeded generator, so every visit sees the same prices. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedOf(text: string): number {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

const walks = new Map<string, DailyClose[]>()

/** Every close of an instrument from the base date up to `to`; crypto trades on weekends too. */
function walk(instrument: DemoInstrument, to: string): DailyClose[] {
  const cached = walks.get(instrument.symbol)
  if (cached && (cached.at(-1)?.date ?? '') >= to) return cached
  const next = random(seedOf(instrument.symbol))
  const daysPerYear = instrument.assetClass === 'crypto' ? 365 : 252
  const mean = instrument.drift / daysPerYear
  const spread = instrument.volatility / Math.sqrt(daysPerYear)
  const closes: DailyClose[] = []
  let price = instrument.start
  for (let date = BASE_DATE; date <= to; date = addDays(date, 1)) {
    if (instrument.assetClass !== 'crypto' && isWeekend(date)) continue
    // Box-Muller: a normal draw from two uniform ones.
    const normal = Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next())
    price *= Math.exp(mean - spread ** 2 / 2 + spread * normal)
    closes.push({ date, close: Math.round(price * 100) / 100 })
  }
  walks.set(instrument.symbol, closes)
  return closes
}

export function demoInstrument(symbol: string): DemoInstrument | undefined {
  return DEMO_INSTRUMENTS.find((i) => i.symbol === symbol)
}

/** Closes of a demo symbol within a range. */
export function demoCloses(instrument: DemoInstrument, range: DateRange): DailyClose[] {
  return walk(instrument, range.to).filter((c) => c.date >= range.from && c.date <= range.to)
}

/** The last close on or before a date. */
export function demoPrice(instrument: DemoInstrument, date: string): number {
  const closes = walk(instrument, date)
  for (let i = closes.length - 1; i >= 0; i--) if (closes[i]!.date <= date) return closes[i]!.close
  return instrument.start
}
