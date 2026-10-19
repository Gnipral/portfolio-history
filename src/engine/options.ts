import type { Transaction } from '../model/transaction.ts'

export type CostBasisMethod = 'average' | 'fifo'

/** The toggles of the dashboard. An excluded item is treated as if it never happened. */
export interface EngineOptions {
  costBasis: CostBasisMethod
  includeDividends: boolean
  includeCosts: boolean
  includeTaxes: boolean
  includeFxCosts: boolean
  /**
   * When on and the import contains deposits, the portfolio is cash + securities and only deposits
   * and withdrawals are external flows. Otherwise the portfolio is the securities alone and every
   * buy, sell and dividend is an external flow.
   */
  includeDeposits: boolean
}

export type ToggleKey = Exclude<keyof EngineOptions, 'costBasis'>

export type Toggles = Pick<EngineOptions, ToggleKey>

export const DEFAULT_OPTIONS: EngineOptions = {
  costBasis: 'average',
  includeDividends: true,
  includeCosts: true,
  includeTaxes: true,
  includeFxCosts: true,
  includeDeposits: true,
}

/** Costs, taxes and FX costs of a transaction that count under the current options, in EUR. */
export function includedCharges(t: Transaction, options: EngineOptions): number {
  return (
    (options.includeCosts ? t.costsEur : 0) +
    (options.includeTaxes ? t.taxesEur : 0) +
    (options.includeFxCosts ? t.fxCostsEur : 0)
  )
}
