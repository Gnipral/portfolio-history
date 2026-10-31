import type { IndexHolding, IndexWeights } from '../../market/indexWeights.ts'
import type { AssetClass } from '../../model/transaction.ts'

/** How far each stock's weight is from its weight in MSCI World: the active bets of the portfolio. */

export interface TiltInput {
  key: string
  isin?: string
  /** Price symbol, e.g. `ASML.AS` or `NOVO-B.CO`. */
  symbol?: string
  assetClass: AssetClass
  /** Share of the securities, 0 to 1. */
  weight: number
}

export type Tilt =
  | { key: string; kind: 'stock'; indexWeight: number; tilt: number; inIndex: boolean }
  /** An ETF or fund: spread by itself, no tilt of its own. */
  | { key: string; kind: 'fund' }
  /** Crypto, bonds and anything else outside an equity index. */
  | { key: string; kind: 'other' }

/** `NOVO-B.CO` → `NOVO B`, `BRK.B` → `BRK B`: tickers as iShares writes them, without the exchange suffix. */
export function normalizeTicker(symbol: string, fromYahoo: boolean): string {
  let base = symbol.trim().toUpperCase()
  // Yahoo appends the exchange (ASML.AS, 7203.T); iShares writes share classes with a dot (RCI.B).
  if (fromYahoo) base = base.replace(/\.[A-Z]{1,3}$/, '')
  return base.replace(/[.\-/]+/g, ' ').trim()
}

/** The index holding of a stock: by ticker, and by country (the ISIN prefix) when the ticker is not unique. */
function find(byTicker: Map<string, IndexHolding[]>, input: TiltInput): IndexHolding | undefined {
  if (!input.symbol) return undefined
  const candidates = byTicker.get(normalizeTicker(input.symbol, true)) ?? []
  if (candidates.length <= 1) return candidates[0]
  const country = input.isin?.slice(0, 2).toUpperCase()
  return candidates.find((h) => h.country === country)
}

/**
 * The tilt of every position: its weight minus its weight in the index; a stock outside the index weighs 0
 * there. Null without the index weights, so the column can be hidden.
 */
export function activeTilt(positions: TiltInput[], weights: IndexWeights | null): Tilt[] | null {
  if (!weights || weights.holdings.length === 0) return null
  const byTicker = new Map<string, IndexHolding[]>()
  for (const holding of weights.holdings) {
    const ticker = normalizeTicker(holding.ticker, false)
    byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), holding])
  }
  return positions.map((p): Tilt => {
    if (p.assetClass === 'etf' || p.assetClass === 'fund') return { key: p.key, kind: 'fund' }
    if (p.assetClass !== 'stock') return { key: p.key, kind: 'other' }
    const holding = find(byTicker, p)
    const indexWeight = holding?.weight ?? 0
    return { key: p.key, kind: 'stock', indexWeight, tilt: p.weight - indexWeight, inIndex: holding !== undefined }
  })
}
