import type { Transaction } from '../../model/transaction.ts'
import { Ledger, sortTransactions, type Holding, type Sale } from '../ledger.ts'
import type { EngineOptions } from '../options.ts'

/**
 * The Belgian tax on capital gains on financial assets (solidariteitsbijdrage), as voted for gains
 * from 1 January 2026: 10% of the net gains of a year above a yearly exemption. Gains made before
 * 2026 are not taxed: the cost basis of what was held on 31 December 2025 is raised to its value
 * on that day, or kept when the historical cost is higher (allowed for sales until 2030).
 * Unused exemption carries over up to a fixed amount per year, within a maximum exemption.
 * This is an estimate: the exemption is indexed every year and the actual tax depends on the return.
 */
export const BELGIAN_CGT = {
  firstYear: 2026,
  referenceDate: '2025-12-31',
  rate: 0.1,
  exemption: 10_000,
  carryOverPerYear: 1_000,
  maxExemption: 15_000,
} as const

export interface CapitalGainsYear {
  year: string
  gains: number
  losses: number
  /** Gains minus losses of the year; losses do not carry over to other years. */
  net: number
  /** Exemption available this year, including what was carried over. */
  exemption: number
  taxable: number
  tax: number
}

export interface CapitalGainsResult {
  years: CapitalGainsYear[]
  /** Taxable sales (from 2026 on), with the stepped-up cost basis. */
  sales: Sale[]
  /** Products held on the reference date without a price: their historical cost is used. */
  withoutReference: string[]
}

/**
 * Estimate per year from 2026 until `today`. `priceOf` gives the EUR price per unit of a holding on a
 * date (the dashboard's price book).
 */
export function belgianCapitalGains(
  transactions: Transaction[],
  options: EngineOptions,
  priceOf: (holding: Holding, date: string) => number | undefined,
  today: string,
): CapitalGainsResult {
  const ordered = sortTransactions(transactions)
  // Every charge counts: commissions and taxes of a buy raise the acquisition value, those of a sale lower the proceeds.
  const ledger = new Ledger({ ...options, includeCosts: true, includeTaxes: true, includeFxCosts: true }, false, { transactions: ordered })
  const withoutReference: string[] = []
  let steppedUp = false
  const stepUp = () => {
    steppedUp = true
    ledger.stepUp((holding) => {
      const price = priceOf(holding, BELGIAN_CGT.referenceDate)
      if (price === undefined) withoutReference.push(holding.product)
      return price
    })
  }
  for (const t of ordered) {
    if (!steppedUp && t.date > BELGIAN_CGT.referenceDate) stepUp()
    ledger.apply(t)
  }
  if (!steppedUp && today > BELGIAN_CGT.referenceDate) stepUp()

  const sales = ledger.sales.filter((s) => Number(s.date.slice(0, 4)) >= BELGIAN_CGT.firstYear)
  const years: CapitalGainsYear[] = []
  let carried = 0
  for (let year = BELGIAN_CGT.firstYear; year <= Number(today.slice(0, 4)); year++) {
    const ofYear = sales.filter((s) => s.date.startsWith(String(year)))
    const gains = ofYear.reduce((sum, s) => sum + Math.max(s.gain, 0), 0)
    const losses = ofYear.reduce((sum, s) => sum + Math.max(-s.gain, 0), 0)
    const net = gains - losses
    const exemption = Math.min(BELGIAN_CGT.exemption + carried, BELGIAN_CGT.maxExemption)
    const taxable = Math.max(0, net - exemption)
    years.push({ year: String(year), gains, losses, net, exemption, taxable, tax: taxable * BELGIAN_CGT.rate })
    // Gains above the yearly exemption use up what was carried over; part of an unused yearly exemption carries over.
    const used = Math.min(Math.max(net, 0), exemption)
    const unused = Math.max(0, BELGIAN_CGT.exemption - used)
    carried = carried - Math.max(0, used - BELGIAN_CGT.exemption) + Math.min(unused, BELGIAN_CGT.carryOverPerYear)
    carried = Math.min(carried, BELGIAN_CGT.maxExemption - BELGIAN_CGT.exemption)
  }
  return { years, sales, withoutReference: [...new Set(withoutReference)] }
}
