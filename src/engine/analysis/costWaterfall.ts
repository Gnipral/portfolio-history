import type { Transaction } from '../../model/transaction.ts'
import type { EngineOptions } from '../options.ts'
import type { PriceBook } from '../priceBook.ts'
import { computeDailySeries, type DailyPoint } from '../series.ts'
import { chargesByYear } from './charges.ts'
import { incomeRows } from './income.ts'
import type { Window } from './performance.ts'

/** From the gross gains of the prices to the net profit of a period, step by step. */

export type WaterfallStep = 'priceGains' | 'dividends' | 'brokerFees' | 'tradeTaxes' | 'fxCosts' | 'withholdingTax' | 'otherTaxes'

export interface WaterfallRow {
  step: WaterfallStep
  /** Signed: gains and income positive, charges negative, in the base currency. */
  amount: number
  /** Share of the invested capital at the end of the period. */
  ofInvested?: number
  /** False when a dashboard toggle leaves it out: then it is shown, but not part of the net profit. */
  counted: boolean
}

export interface CostWaterfall {
  rows: WaterfallRow[]
  /** The profit of the period, as on the dashboard: the sum of the counted rows. */
  net: number
  netOfInvested?: number
  invested: number
}

const inPeriod = (from: string, to: string) => (t: { date: string }) => t.date >= from && t.date <= to

/**
 * The waterfall of the period. Income and charges come from the transactions of those days (as in the
 * Dividends and Costs views); the gains of the prices are what is left of the period's profit after them,
 * so the steps always add up to the profit on the dashboard. A charge the toggles leave out is listed as
 * not counted, without changing the sum.
 */
export function costWaterfall(transactions: Transaction[], points: DailyPoint[], window: Window, options: EngineOptions): CostWaterfall {
  const first = points[window.from]
  const last = points[window.to]
  if (!first || !last) return { rows: [], net: 0, invested: 0 }
  const before = window.from > 0 ? points[window.from - 1] : undefined
  const net = last.pnl - (before?.pnl ?? 0)
  const within = transactions.filter(inPeriod(first.date, last.date))

  const charges = chargesByYear(within).reduce(
    (sum, y) => ({
      transactionCosts: sum.transactionCosts + y.transactionCosts,
      fxCosts: sum.fxCosts + y.fxCosts,
      tradeTaxes: sum.tradeTaxes + y.tradeTaxes,
      incomeTaxes: sum.incomeTaxes + y.incomeTaxes,
      otherTaxes: sum.otherTaxes + y.otherTaxes,
    }),
    { transactionCosts: 0, fxCosts: 0, tradeTaxes: 0, incomeTaxes: 0, otherTaxes: 0 },
  )
  const dividends = incomeRows(within).reduce((sum, row) => sum + row.gross, 0)
  if (!options.includeDividends) {
    // A payment that does not count takes its collection and conversion costs with it, as in the ledger.
    for (const t of within) {
      if (t.type !== 'dividend') continue
      charges.transactionCosts -= t.costsEur
      charges.fxCosts -= t.fxCostsEur
    }
  }

  const rows: WaterfallRow[] = [
    { step: 'dividends', amount: dividends, counted: options.includeDividends },
    { step: 'brokerFees', amount: -charges.transactionCosts, counted: options.includeCosts },
    { step: 'tradeTaxes', amount: -charges.tradeTaxes, counted: options.includeTaxes },
    { step: 'fxCosts', amount: -charges.fxCosts, counted: options.includeFxCosts },
    // Without dividends, their withholding tax never happened either (as the ledger counts it).
    { step: 'withholdingTax', amount: -charges.incomeTaxes, counted: options.includeTaxes && options.includeDividends },
    { step: 'otherTaxes', amount: -charges.otherTaxes, counted: options.includeTaxes },
  ]
  const counted = rows.filter((r) => r.counted).reduce((sum, r) => sum + r.amount, 0)
  const invested = last.invested
  const share = (amount: number) => (invested > 0 ? { ofInvested: amount / invested } : {})
  const all: WaterfallRow[] = [{ step: 'priceGains', amount: net - counted, counted: true }, ...rows.filter((r) => r.amount !== 0)]
  return {
    rows: all.map((r) => ({ ...r, ...share(r.amount) })),
    net,
    ...(invested > 0 ? { netOfInvested: net / invested } : {}),
    invested,
  }
}

/** The same options with every charge left out: the portfolio as if nothing had been paid. */
export function withoutCharges(options: EngineOptions): EngineOptions {
  return { ...options, includeCosts: false, includeTaxes: false, includeFxCosts: false }
}

/**
 * The daily series of the portfolio as if no costs, taxes or FX costs had been paid, to compare with the
 * real one: what the Costs view showed as "Profit without them" and "Time-weighted return lost".
 */
export function seriesWithoutCharges(transactions: Transaction[], prices: PriceBook, options: EngineOptions, today: string): DailyPoint[] {
  return computeDailySeries(transactions, prices, withoutCharges(options), today).points
}

export interface ChargesImpact {
  /** Profit of the period as it is, and as if no charges had been paid. */
  pnl: number
  pnlWithout: number
  /** Time-weighted return of the period, as it is and without charges. */
  twr: number
  twrWithout: number
  /** What the charges cost: in money, and in time-weighted return (as a positive fraction). */
  profitLost: number
  twrLost: number
}

/** What the counted charges cost in the period, from the real series and the one without charges (same days). */
export function chargesImpact(points: DailyPoint[], without: DailyPoint[], window: Window): ChargesImpact | undefined {
  const change = (series: DailyPoint[]) => {
    const end = series[window.to]
    if (!end) return undefined
    const start = window.from > 0 ? series[window.from - 1] : undefined
    return { pnl: end.pnl - (start?.pnl ?? 0), twr: (1 + end.twr) / (1 + (start?.twr ?? 0)) - 1 }
  }
  const real = change(points)
  const ideal = change(without)
  if (!real || !ideal) return undefined
  return {
    pnl: real.pnl,
    pnlWithout: ideal.pnl,
    twr: real.twr,
    twrWithout: ideal.twr,
    profitLost: ideal.pnl - real.pnl,
    twrLost: ideal.twr - real.twr,
  }
}
