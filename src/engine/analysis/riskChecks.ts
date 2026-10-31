import type { AssetClass, Transaction } from '../../model/transaction.ts'
import { instrumentKey } from '../../market/instruments.ts'
import { assetValueOn, type OtherAsset } from '../otherAssets.ts'
import type { Position } from '../positions.ts'

/**
 * Rules of thumb on how the portfolio is spread, after Ghostfolio's X-ray: each one says whether the
 * portfolio passes, with the numbers behind it. They are warnings to think about, not advice; the
 * thresholds are fixed and named in the result so the page can show them.
 */

export const THRESHOLDS = {
  /** One stock above this share of the securities. Funds and ETFs are spread by themselves. */
  singleStock: 0.1,
  /** Fewer stocks than this, and no fund or ETF at all. */
  fewStocks: 10,
  crypto: 0.1,
  /** Securities listed in other currencies than the base. */
  otherCurrencies: 0.5,
  /** Transaction and currency costs as a share of everything bought and sold. */
  fees: 0.01,
  /** Cash as a share of the portfolio, when it holds cash. */
  cash: 0.2,
  /** Months of spending the savings should cover. */
  emergencyMonths: 3,
} as const

export type RuleStatus = 'pass' | 'warn' | 'unknown'

export interface Share {
  label: string
  share: number
}

export interface RiskChecks {
  singleStock: { status: RuleStatus; heavy: Share[] }
  spread: { status: RuleStatus; stocks: number; funds: number }
  crypto: { status: RuleStatus; share: number }
  currency: { status: RuleStatus; share: number; currencies: Share[] }
  fees: { status: RuleStatus; ratio: number; fees: number; volume: number }
  cash: { status: RuleStatus; share: number; cash: number; held: boolean }
  /** `unknown` without yearly spending or without savings entered. */
  emergency: { status: RuleStatus; savings: number; months?: number; hasSavings: boolean; hasSpending: boolean }
}

export interface RiskCheckInputs {
  transactions: Transaction[]
  /** Open positions on `date`. */
  positions: Position[]
  /** The portfolio value on `date`: securities, plus cash when deposits are included. */
  portfolioValue: number
  /** Whether `portfolioValue` includes cash. */
  cashMode: boolean
  baseCurrency: string
  otherAssets: OtherAsset[]
  /** Spending per year from Analysis > Planning; 0 when not filled in. */
  yearlySpending: number
  date: string
}

const FUNDS: AssetClass[] = ['etf', 'fund']

/** Asset class and listing currency per instrument, from its latest trade; pence count as pounds. */
function facts(transactions: Transaction[]): Map<string, { assetClass: AssetClass; currency: string }> {
  const result = new Map<string, { assetClass: AssetClass; currency: string }>()
  for (const t of [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))) {
    if (t.type !== 'buy' && t.type !== 'sell' && t.type !== 'transferIn') continue
    result.set(instrumentKey(t), { assetClass: t.assetClass, currency: t.currency === 'GBX' || t.currency === 'GBp' ? 'GBP' : t.currency })
  }
  return result
}

const status = (warn: boolean): RuleStatus => (warn ? 'warn' : 'pass')

export function riskChecks(inputs: RiskCheckInputs): RiskChecks {
  const { positions, portfolioValue, cashMode, baseCurrency, date } = inputs
  const known = facts(inputs.transactions)
  const held = positions.filter((p) => p.value > 0)
  const securities = held.reduce((sum, p) => sum + p.value, 0)
  const shareOf = (value: number) => (securities > 0 ? value / securities : 0)
  const classOf = (p: Position) => known.get(p.key)?.assetClass ?? 'unknown'

  const stocks = held.filter((p) => classOf(p) === 'stock')
  const heavy = stocks
    .map((p) => ({ label: p.product, share: shareOf(p.value) }))
    .filter((s) => s.share > THRESHOLDS.singleStock)
    .sort((a, b) => b.share - a.share)
  const funds = held.filter((p) => FUNDS.includes(classOf(p))).length

  const crypto = shareOf(held.filter((p) => classOf(p) === 'crypto').reduce((sum, p) => sum + p.value, 0))

  const byCurrency = new Map<string, number>()
  for (const p of held) {
    const currency = known.get(p.key)?.currency ?? baseCurrency
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + p.value)
  }
  const currencies = [...byCurrency]
    .filter(([currency]) => currency !== baseCurrency)
    .map(([label, value]) => ({ label, share: shareOf(value) }))
    .sort((a, b) => b.share - a.share)
  const otherCurrencies = currencies.reduce((sum, c) => sum + c.share, 0)

  let fees = 0
  let volume = 0
  for (const t of inputs.transactions) {
    if (t.type !== 'buy' && t.type !== 'sell') continue
    fees += t.costsEur + t.fxCostsEur
    volume += Math.abs(t.amountEur)
  }
  const ratio = volume > 0 ? fees / volume : 0

  const cash = cashMode ? Math.max(0, portfolioValue - securities) : 0
  const cashShare = cashMode && portfolioValue > 0 ? cash / portfolioValue : 0

  const savingsAssets = inputs.otherAssets.filter((a) => a.kind === 'savings' && !a.debt)
  const savings = savingsAssets.reduce((sum, a) => sum + (assetValueOn(a, date) ?? 0), 0)
  const hasSavings = savingsAssets.length > 0
  const hasSpending = inputs.yearlySpending > 0
  const months = hasSpending ? savings / (inputs.yearlySpending / 12) : undefined

  return {
    singleStock: { status: status(heavy.length > 0), heavy },
    spread: { status: status(held.length > 0 && funds === 0 && stocks.length < THRESHOLDS.fewStocks), stocks: stocks.length, funds },
    crypto: { status: status(crypto > THRESHOLDS.crypto), share: crypto },
    currency: { status: status(otherCurrencies > THRESHOLDS.otherCurrencies), share: otherCurrencies, currencies },
    fees: { status: status(ratio > THRESHOLDS.fees), ratio, fees, volume },
    cash: { status: cashMode ? status(cashShare > THRESHOLDS.cash) : 'unknown', share: cashShare, cash, held: cashMode },
    emergency: {
      status: months === undefined || !hasSavings ? 'unknown' : status(months < THRESHOLDS.emergencyMonths),
      savings,
      ...(months === undefined ? {} : { months }),
      hasSavings,
      hasSpending,
    },
  }
}
