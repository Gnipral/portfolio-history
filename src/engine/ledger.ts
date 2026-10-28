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
  lastTradeDate?: string
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
  /** Set when the export starts after these units were bought: the product, for a notice to the user. */
  missingHistory?: string
}

/** One sale with its result, in EUR. */
export interface Sale {
  date: string
  key: string
  product: string
  isin?: string
  quantity: number
  /** What the sale paid, after the charges that count. */
  proceeds: number
  /** Cost basis of the units sold. */
  cost: number
  /** proceeds - cost */
  gain: number
  /** Costs, taxes and FX costs of the sale that count. */
  charges: number
}

/** What the ledger needs to know besides the transaction it applies. */
export interface LedgerContext {
  /** All transactions, to recognize the withholding tax that belongs to a dividend. */
  transactions?: Transaction[]
  /** Market price in EUR per unit on a date, to value units transferred without a value. */
  priceOf?: (holding: Holding, date: string) => number | undefined
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
  /** Every sale so far, oldest first. */
  readonly sales: Sale[] = []

  /** Instrument and day of every dividend, as `key|date`. */
  private readonly dividendDays: Set<string>

  /**
   * Brokers in the import without a single deposit or withdrawal. With cash in the portfolio, their trades
   * are paid with money from outside, as if it was deposited for each buy and taken out after each sale or
   * dividend; otherwise their buys would spend the cash of another broker.
   */
  private readonly fundedFromOutside: Set<string>

  constructor(
    private readonly options: EngineOptions,
    /** Whether the portfolio includes cash, with deposits and withdrawals as the only external flows. */
    readonly cashMode: boolean,
    private readonly context: LedgerContext = {},
  ) {
    const transactions = context.transactions ?? []
    this.dividendDays = new Set(transactions.filter((t) => t.type === 'dividend').map((t) => `${instrumentKey(t)}|${t.date}`))
    const withCash = new Set(transactions.filter((t) => t.type === 'deposit' || t.type === 'withdrawal').map((t) => t.source.broker))
    this.fundedFromOutside = new Set(transactions.map((t) => t.source.broker).filter((broker) => !withCash.has(broker)))
  }

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
    const cashBefore = this.cash
    /** Units held since before the export, brought in at their value: money in, in every mode. */
    let broughtIn = 0
    const charges = includedCharges(t, this.options)

    switch (t.type) {
      case 'buy': {
        if (!(t.quantity > 0)) {
          this.issues.push({ date: t.date, message: `${t.product}: buy without a quantity skipped.` })
          break
        }
        const outlay = Math.abs(t.amountEur) + charges
        const holding = this.holding(t)
        holding.quantity += t.quantity
        holding.cost += outlay
        holding.lots.push({ quantity: t.quantity, unitCost: outlay / t.quantity })
        // Free units (staking rewards, stock dividends) say nothing about the market price.
        if (t.amountEur !== 0) {
          holding.lastTradePrice = Math.abs(t.amountEur) / t.quantity
          holding.lastTradeDate = t.date
        }
        this.netInvestedInSecurities += outlay
        this.cash -= outlay
        flows.inflow += outlay
        break
      }
      case 'sell': {
        if (!(t.quantity > 0)) {
          this.issues.push({ date: t.date, message: `${t.product}: sale without a quantity skipped.` })
          break
        }
        const proceeds = Math.abs(t.amountEur) - charges
        const holding = this.holding(t)
        const quantity = t.quantity
        if (quantity > holding.quantity + EPSILON) {
          this.issues.push({
            date: t.date,
            message: `${t.product}: sold ${t.quantity} but only ${holding.quantity} held; the export may miss earlier buys.`,
            missingHistory: t.product,
          })
          // Bought before the export starts, at a price nobody knows: the missing units come in at the sale
          // price, like a transfer, so the sale makes no profit or loss and the return does not jump.
          const missing = quantity - holding.quantity
          const value = (proceeds * missing) / quantity
          holding.quantity += missing
          holding.cost += value
          holding.lots.push({ quantity: missing, unitCost: value / missing })
          this.netInvestedInSecurities += value
          this.netDeposits += value
          broughtIn = value
        }
        const costSold = this.removeCost(holding, quantity)
        const gain = proceeds - costSold
        this.sales.push({
          date: t.date,
          key: holding.key,
          product: t.product,
          ...(holding.isin ? { isin: holding.isin } : {}),
          quantity,
          proceeds,
          cost: costSold,
          gain,
          charges,
        })
        holding.realized += gain
        this.realized += gain
        holding.quantity -= quantity
        if (holding.quantity < EPSILON) {
          holding.quantity = 0
          holding.cost = 0
          holding.lots = []
        }
        holding.lastTradePrice = Math.abs(t.amountEur) / t.quantity
        holding.lastTradeDate = t.date
        this.netInvestedInSecurities -= proceeds
        this.cash += proceeds
        // Units that came in and left on the same day: only the net leaves, so the day's return stays that of the price.
        flows.outflow += proceeds - broughtIn
        break
      }
      case 'split':
        broughtIn = this.applySplit(t)
        flows.inflow += broughtIn
        break
      case 'transferIn': {
        if (!(t.quantity > 0)) break
        // Units arrive from outside at the value the export gives them, else at the market price of
        // that day: they were the investor's already, so their value is money put in, not profit.
        const holding = this.holding(t)
        const value = Math.abs(t.amountEur) || (this.context.priceOf?.(holding, t.date) ?? 0) * t.quantity
        holding.quantity += t.quantity
        holding.cost += value
        holding.lots.push({ quantity: t.quantity, unitCost: value / t.quantity })
        this.netInvestedInSecurities += value
        this.netDeposits += value
        flows.inflow += value
        break
      }
      case 'transferOut': {
        // Units leave without a sale at their market value: that value is money taken out, and the
        // profit made on them so far stays in the result instead of vanishing with the units.
        const holding = this.holding(t)
        const quantity = Math.min(t.quantity, holding.quantity)
        if (t.quantity > holding.quantity + EPSILON) {
          this.issues.push({ date: t.date, message: `${t.product}: sent ${t.quantity} but only ${holding.quantity} held.` })
        }
        const price = this.context.priceOf?.(holding, t.date)
        const cost = this.removeCost(holding, quantity)
        const value = price === undefined ? cost : price * quantity
        holding.realized += value - cost
        this.realized += value - cost
        holding.quantity -= quantity
        if (holding.quantity < EPSILON) {
          holding.quantity = 0
          holding.cost = 0
          holding.lots = []
        }
        this.netInvestedInSecurities -= value
        this.netDeposits -= value
        flows.outflow += value
        break
      }
      case 'dividend': {
        if (!this.options.includeDividends) break
        // Net of the withholding tax, collection costs and conversion costs on the payment that count.
        const amount = Math.abs(t.amountEur) - charges
        this.holding(t).realized += amount
        this.realized += amount
        this.cash += amount
        flows.outflow += amount
        break
      }
      case 'fee':
      case 'tax':
      case 'fx': {
        // A withholding tax booked as its own row (DEGIRO, IBKR, XTB) belongs to the dividend of
        // that day: without dividends it never happened either.
        const dividendTax = t.type === 'tax' && this.dividendDays.has(`${instrumentKey(t)}|${t.date}`)
        const counts =
          t.type === 'fee'
            ? this.options.includeCosts
            : t.type === 'tax'
              ? this.options.includeTaxes && (this.options.includeDividends || !dividendTax)
              : this.options.includeFxCosts
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

    if (this.cashMode && this.fundedFromOutside.has(t.source.broker)) {
      // The money comes from outside and goes back out: the cash of the other brokers stays as it was.
      const change = this.cash - cashBefore
      this.cash -= change
      this.netDeposits -= change
      return flows
    }
    if (this.cashMode) {
      if (t.type === 'deposit') return { inflow: Math.abs(t.amountEur), outflow: 0 }
      if (t.type === 'withdrawal') return { inflow: 0, outflow: Math.abs(t.amountEur) }
      // Securities moving in or out from outside the account are external flows too.
      if (t.type === 'transferIn' || t.type === 'transferOut') return flows
      return { inflow: broughtIn, outflow: 0 }
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
  private applySplit(t: Transaction): number {
    if (!t.split) return 0
    const key = instrumentKey(t)
    const fromKey = t.split.fromIsin ?? key
    const from = this.holdings.get(fromKey)
    if (!from || from.quantity <= EPSILON) {
      this.issues.push({ date: t.date, message: `${t.product}: split for a position that is not held.`, missingHistory: t.product })
      // Held since before the export starts: the units after the split come in at their market value of
      // that day, like a transfer, so the position is not left out of the value.
      const target = this.holding(t, key)
      const value = (this.context.priceOf?.(target, t.date) ?? 0) * t.quantity
      target.quantity += t.quantity
      target.cost += value
      target.lots.push({ quantity: t.quantity, unitCost: value / t.quantity })
      this.netInvestedInSecurities += value
      this.netDeposits += value
      return value
    }
    const share = Math.min(1, t.split.fromQuantity / from.quantity)
    const ratio = t.quantity / t.split.fromQuantity
    const movedCost = from.cost * share
    const movedLots = from.lots.map((lot) => ({ quantity: lot.quantity * share * ratio, unitCost: lot.unitCost / ratio }))
    const lastPrice = from.lastTradePrice
    const lastDate = from.lastTradeDate

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
    if (lastDate !== undefined) target.lastTradeDate = lastDate
    return 0
  }

  /**
   * Sets the cost basis of every open position to `unitValue` per unit, or with `higher` raises it to
   * at least that, lot by lot: the step-up of a capital gains tax that only taxes gains made after a
   * reference date.
   */
  stepUp(unitValue: (holding: Holding) => number | undefined, mode: 'value' | 'higher' = 'higher'): void {
    for (const holding of this.openHoldings()) {
      const value = unitValue(holding)
      if (value === undefined) continue
      for (const lot of holding.lots) lot.unitCost = mode === 'higher' ? Math.max(lot.unitCost, value) : value
      const average = holding.cost / holding.quantity
      holding.cost =
        this.options.costBasis === 'fifo'
          ? holding.lots.reduce((sum, lot) => sum + lot.quantity * lot.unitCost, 0)
          : (mode === 'higher' ? Math.max(average, value) : value) * holding.quantity
    }
  }

  openHoldings(): Holding[] {
    return [...this.holdings.values()].filter((h) => h.quantity > EPSILON)
  }
}

/** Replays all transactions up to and including `date`. */
export function ledgerOn(
  transactions: Transaction[],
  date: string,
  options: EngineOptions,
  cashMode: boolean,
  priceOf?: LedgerContext['priceOf'],
): Ledger {
  const ledger = new Ledger(options, cashMode, { transactions, ...(priceOf ? { priceOf } : {}) })
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
