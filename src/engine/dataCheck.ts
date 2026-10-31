import type { Transaction } from '../model/transaction.ts'
import { instrumentKey } from '../market/instruments.ts'
import type { LedgerIssue } from './ledger.ts'
import type { EngineOptions } from './options.ts'
import { positionsOn } from './positions.ts'
import type { PriceBook } from './priceBook.ts'

/**
 * Checks of the data behind the figures, gathered in one place: products without prices, prices that do not
 * match the trades, transactions imported twice, an export that starts too late. Each check says what it
 * found per product, so the page can name them; none of them changes any figure.
 */

/** A trade price further than this from the market close of that day points to a wrong symbol or split. */
export const PRICE_MISMATCH = 0.3

/** Splits and reverse splits look like a trade price that is a whole multiple of the close. */
const SPLIT_TOLERANCE = 0.1

export interface ProductFinding {
  key: string
  product: string
}

export interface PriceMismatch extends ProductFinding {
  date: string
  /** Per unit, in the currency of the inputs. */
  tradePrice: number
  marketPrice: number
  /** Trades of this product compared with a market close, and how many of them did not match. */
  checked: number
  mismatched: number
  /** When the gap is a whole factor, e.g. 4 for a 4:1 split the price source knows and the export not. */
  splitRatio?: number
}

export interface StalePrice extends ProductFinding {
  /** The date of the last close found. */
  priceDate: string
}

export interface PossibleDuplicate extends ProductFinding {
  date: string
  type: Transaction['type']
  files: string[]
}

export interface DataCheck {
  /** Held today, but no symbol to fetch prices with. */
  noSymbol: ProductFinding[]
  /** Held today with a symbol, but valued at the last trade price: the source has no price for it. */
  noMarketPrice: ProductFinding[]
  /** Held today, with a last close older than a week: a delisted product or a symbol of another listing. */
  stalePrices: StalePrice[]
  pricesNotMatchingTrades: PriceMismatch[]
  /** Products sold or split without the purchase in the export. */
  missingHistory: ProductFinding[]
  /** Other problems the ledger met, such as selling more than was held. */
  ledgerIssues: LedgerIssue[]
  possibleDuplicates: PossibleDuplicate[]
}

export interface DataCheckInputs {
  transactions: Transaction[]
  prices: PriceBook
  options: EngineOptions
  issues: LedgerIssue[]
  today: string
}

export function checkData({ transactions, prices, options, issues, today }: DataCheckInputs): DataCheck {
  const positions = positionsOn(transactions, prices, options, today)
  const noSymbol: ProductFinding[] = []
  const noMarketPrice: ProductFinding[] = []
  const stalePrices: StalePrice[] = []
  for (const p of positions) {
    if (!p.symbol) noSymbol.push({ key: p.key, product: p.product })
    else if (p.priceSource !== 'market') noMarketPrice.push({ key: p.key, product: p.product })
    else if (p.stale && p.priceDate) stalePrices.push({ key: p.key, product: p.product, priceDate: p.priceDate })
  }

  const missingHistory = new Map<string, ProductFinding>()
  const ledgerIssues: LedgerIssue[] = []
  for (const issue of issues) {
    if (issue.missingHistory) missingHistory.set(issue.missingHistory, { key: issue.missingHistory, product: issue.missingHistory })
    else ledgerIssues.push(issue)
  }

  return {
    noSymbol,
    noMarketPrice,
    stalePrices,
    pricesNotMatchingTrades: priceMismatches(transactions, prices),
    missingHistory: [...missingHistory.values()],
    ledgerIssues,
    possibleDuplicates: possibleDuplicates(transactions),
  }
}

/** The number of things to look at: what can make a figure wrong. */
export function problemCount(check: DataCheck): number {
  return (
    check.noSymbol.length +
    check.noMarketPrice.length +
    check.stalePrices.length +
    check.pricesNotMatchingTrades.length +
    check.missingHistory.length +
    check.ledgerIssues.length +
    check.possibleDuplicates.length
  )
}

/** A whole factor between 2 and 100, either way round: what a split the export does not know looks like. */
function wholeFactor(ratio: number): number | undefined {
  const factor = ratio >= 1 ? ratio : 1 / ratio
  const whole = Math.round(factor)
  if (whole < 2 || whole > 100 || Math.abs(factor - whole) > SPLIT_TOLERANCE * whole) return undefined
  return ratio >= 1 ? whole : 1 / whole
}

/**
 * Buys and sells compared with the market close of their day. One product's worst gap is reported, with how
 * many of its trades were off: a single odd trade can be a typo, every trade off is a wrong symbol or split.
 */
function priceMismatches(transactions: Transaction[], prices: PriceBook): PriceMismatch[] {
  const found = new Map<string, PriceMismatch>()
  const checked = new Map<string, number>()
  for (const t of transactions) {
    if ((t.type !== 'buy' && t.type !== 'sell') || t.quantity <= 0 || t.amountEur === 0) continue
    const key = instrumentKey(t)
    const market = prices.marketPrice(key, t.date)
    if (market?.source !== 'market' || market.date !== t.date || market.eur <= 0) continue
    checked.set(key, (checked.get(key) ?? 0) + 1)
    const tradePrice = Math.abs(t.amountEur) / t.quantity
    const ratio = tradePrice / market.eur
    if (Math.abs(Math.log(ratio)) <= Math.log(1 + PRICE_MISMATCH)) continue
    const previous = found.get(key)
    const worse = !previous || Math.abs(Math.log(ratio)) > Math.abs(Math.log(previous.tradePrice / previous.marketPrice))
    const splitRatio = wholeFactor(ratio)
    found.set(key, {
      ...(worse
        ? { key, product: t.product, date: t.date, tradePrice, marketPrice: market.eur, ...(splitRatio ? { splitRatio } : {}) }
        : previous),
      checked: 0,
      mismatched: (previous?.mismatched ?? 0) + 1,
    })
  }
  return [...found.values()].map((m) => ({ ...m, checked: checked.get(m.key) ?? m.mismatched }))
}

/**
 * The same transaction in two files, e.g. the PDF statements and the CSV of one broker. Within one file two
 * identical rows are two real trades, so only rows from different files count.
 */
function possibleDuplicates(transactions: Transaction[]): PossibleDuplicate[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (t.type === 'split') continue
    const key = [t.date, t.type, instrumentKey(t), t.quantity, t.totalEur.toFixed(2)].join('|')
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const duplicates: PossibleDuplicate[] = []
  for (const group of groups.values()) {
    const files = [...new Set(group.map((t) => t.source.file))]
    const first = group[0]
    if (files.length < 2 || !first) continue
    duplicates.push({ key: instrumentKey(first), product: first.product, date: first.date, type: first.type, files })
  }
  return duplicates.sort((a, b) => a.date.localeCompare(b.date))
}
