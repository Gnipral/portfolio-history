import { instrumentKey } from '../market/instruments.ts'
import type { Transaction } from '../model/transaction.ts'
import { includedCharges, type EngineOptions } from './options.ts'

const EPSILON = 1e-9

interface Lot {
  quantity: number
  /** Cost per unit in EUR, including the charges that count. */
  unitCost: number
}

export interface Holding {
  key: string
  product: string
  isin?: string
  quantity: number
  /** Cost basis of the units held, in EUR. */
  cost: number
  /** FIFO lots, oldest first (also kept for the average method, where they are not used). */
  lots: Lot[]
  /** EUR price per unit of the last trade, used when no market price is known. */
  lastTradePrice?: number
  /** Profit realized on this instrument, in EUR. */
  realized: number
}

/** Money moving between the investor and the portfolio on one day, in EUR. */
export interface DayFlows {
  /** Securities mode: buy outlays and standalone charges. Cash mode: deposits. */
  inflow: number
  /** Securities mode: sell proceeds and dividends. Cash mode: withdrawals. */
  outflow: number
}

export interface LedgerIssue {
  date: string
  message: string
}

/**
 * Replays transactions in order and keeps positions, cost basis, realized profit and cash.
 * Pure bookkeeping: market prices are applied by the caller.
 */
export class Ledger {
  readonly holdings = new Map<string, Holding>()
  readonly issues: LedgerIssue[] = []
  /** Realized profit in EUR: sales minus cost, dividends, minus standalone fees and taxes. */
  realized = 0
  /** Buy outlays minus sell proceeds: the money put into securities. */
  netInvestedInSecurities = 0
  /** Deposits minus withdrawals. */
  netDeposits = 0
  /** Cash balance, only meaningful when the import contains deposits. */
  cash = 0

  constructor(
    private readonly options: EngineOptions,
    /** Whether the portfolio includes cash, with deposits and withdrawals as the only external flows. */
    readonly cashMode: boolean,
  ) {}

  private holding(t: Transaction, key = instrumentKey(t)): Holding {
    let holding = this.holdings.get(key)
    if (!holding) {
      holding = { key, product: t.product, ...(t.isin ? { isin: t.isin } : {}), quantity: 0, cost: 0, lots: [], realized: 0 }
      this.holdings.set(key, holding)
    }
    holding.product = t.product
    return holding
  }

  /** Applies one transaction and returns the external flows it causes. */
  apply(t: Transaction): DayFlows {
    const flows: DayFlows = { inflow: 0, outflow: 0 }
    const charges = includedCharges(t, this.options)

    switch (t.type) {
      case 'buy': {
        const outlay = Math.abs(t.amountEur) + charges
        const holding = this.holding(t)
        holding.quantity += t.quantity
        holding.cost += outlay
        holding.lots.push({ quantity: t.quantity, unitCost: outlay / t.quantity })
        holding.lastTradePrice = Math.abs(t.amountEur) / t.quantity
        this.netInvestedInSecurities += outlay
        this.cash -= outlay
        flows.inflow += outlay
        break
      }
      case 'sell': {
        const proceeds = Math.abs(t.amountEur) - charges
        const holding = this.holding(t)
        let quantity = t.quantity
        if (quantity > holding.quantity + EPSILON) {
          this.issues.push({
            date: t.date,
            message: `${t.product}: sold ${t.quantity} but only ${holding.quantity} held; the export may miss earlier buys.`,
          })
          quantity = holding.quantity
        }
        const costSold = this.removeCost(holding, quantity)
        const gain = proceeds - costSold
        holding.realized += gain
        this.realized += gain
        holding.quantity -= quantity
        if (holding.quantity < EPSILON) {
          holding.quantity = 0
          holding.cost = 0
          holding.lots = []
        }
        holding.lastTradePrice = Math.abs(t.amountEur) / t.quantity
        this.netInvestedInSecurities -= proceeds
        this.cash += proceeds
        flows.outflow += proceeds
        break
      }
      case 'split':
        this.applySplit(t)
        break
      case 'dividend': {
        if (!this.options.includeDividends) break
        const amount = Math.abs(t.amountEur) - (this.options.includeTaxes ? t.taxesEur : 0)
        this.holding(t).realized += amount
        this.realized += amount
        this.cash += amount
        flows.outflow += amount
        break
      }
      case 'fee':
      case 'tax':
      case 'fx': {
        const counts =
          t.type === 'fee' ? this.options.includeCosts : t.type === 'tax' ? this.options.includeTaxes : this.options.includeFxCosts
        // Standalone charges: the row amount itself, or the FX cost of a conversion row.
        const amount = counts ? (t.type === 'fx' ? t.fxCostsEur : Math.abs(t.amountEur)) : 0
        this.realized -= amount
        this.cash -= amount
        flows.inflow += amount
        break
      }
      case 'deposit':
        this.netDeposits += Math.abs(t.amountEur)
        this.cash += Math.abs(t.amountEur)
        break
      case 'withdrawal':
        this.netDeposits -= Math.abs(t.amountEur)
        this.cash -= Math.abs(t.amountEur)
        break
      case 'other':
        break
    }

    if (this.cashMode) {
      if (t.type === 'deposit') return { inflow: Math.abs(t.amountEur), outflow: 0 }
      if (t.type === 'withdrawal') return { inflow: 0, outflow: Math.abs(t.amountEur) }
      return { inflow: 0, outflow: 0 }
    }
    return flows
  }

  /** Removes the cost of `quantity` units and returns it. */
  private removeCost(holding: Holding, quantity: number): number {
    if (quantity <= 0 || holding.quantity <= 0) return 0
    if (this.options.costBasis === 'average') {
      const cost = (holding.cost * quantity) / holding.quantity
      holding.cost -= cost
      // Keep lots consistent so switching method later replays correctly from scratch.
      let remaining = quantity
      while (remaining > EPSILON && holding.lots.length > 0) {
        const lot = holding.lots[0] as Lot
        const take = Math.min(lot.quantity, remaining)
        lot.quantity -= take
        remaining -= take
        if (lot.quantity < EPSILON) holding.lots.shift()
      }
      return cost
    }
    let remaining = quantity
    let cost = 0
    while (remaining > EPSILON && holding.lots.length > 0) {
      const lot = holding.lots[0] as Lot
      const take = Math.min(lot.quantity, remaining)
      cost += take * lot.unitCost
      lot.quantity -= take
      remaining -= take
      if (lot.quantity < EPSILON) holding.lots.shift()
    }
    holding.cost -= cost
    return cost
  }

  /**
   * A split changes the number of units, not the cost. With an ISIN change the position and its
   * cost move to the new key.
   */
  private applySplit(t: Transaction): void {
    if (!t.split) return
    const key = instrumentKey(t)
    const fromKey = t.split.fromIsin ?? key
    const from = this.holdings.get(fromKey)
    if (!from || from.quantity <= EPSILON) {
      this.issues.push({ date: t.date, message: `${t.product}: split for a position that is not held.` })
      return
    }
    const share = Math.min(1, t.split.fromQuantity / from.quantity)
    const ratio = t.quantity / t.split.fromQuantity
    const movedCost = from.cost * share
    const movedLots = from.lots.map((lot) => ({ quantity: lot.quantity * share * ratio, unitCost: lot.unitCost / ratio }))
    const lastPrice = from.lastTradePrice

    from.quantity -= t.split.fromQuantity
    from.cost -= movedCost
    from.lots = share >= 1 ? [] : from.lots.map((lot) => ({ ...lot, quantity: lot.quantity * (1 - share) }))
    if (from.quantity < EPSILON) {
      from.quantity = 0
      from.cost = 0
    }

    const target = this.holding(t, key)
    target.quantity += t.quantity
    target.cost += movedCost
    target.lots.push(...movedLots)
    if (lastPrice !== undefined) target.lastTradePrice = lastPrice / ratio
  }

  openHoldings(): Holding[] {
    return [...this.holdings.values()].filter((h) => h.quantity > EPSILON)
  }
}

/** Replays all transactions up to and including `date`. */
export function ledgerOn(transactions: Transaction[], date: string, options: EngineOptions, cashMode: boolean): Ledger {
  const ledger = new Ledger(options, cashMode)
  for (const t of sortTransactions(transactions)) {
    if (t.date > date) break
    ledger.apply(t)
  }
  return ledger
}

/** Oldest first; the sort is stable, so the order of the adapter is kept for equal timestamps. */
export function sortTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))
}

export function hasDeposits(transactions: Transaction[]): boolean {
  return transactions.some((t) => t.type === 'deposit' || t.type === 'withdrawal')
}
