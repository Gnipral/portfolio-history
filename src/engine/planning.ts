/** A holding as the rebalancing sees it: what it is worth now. */
export interface Holding {
  key: string
  label: string
  value: number
}

export interface RebalanceRow {
  key: string
  label: string
  value: number
  /** Share of the portfolio now, 0..1. */
  share: number
  /** Wanted share, 0..1. */
  target: number
  /** What to buy with the new money, never negative. */
  buy: number
  /** What to buy (positive) or sell (negative) to reach the targets exactly, with the new money included. */
  difference: number
  /** Share after buying `buy`. */
  shareAfter: number
}

/**
 * How to spend `deposit` so the portfolio comes as close as possible to the target shares without selling:
 * the money goes to the holdings furthest below their target, in proportion to their shortfall.
 * `targets` are fractions per key; holdings without one have target 0.
 */
export function rebalance(holdings: Holding[], targets: Record<string, number>, deposit: number): RebalanceRow[] {
  const total = holdings.reduce((sum, h) => sum + Math.max(h.value, 0), 0)
  const after = total + Math.max(deposit, 0)
  const wanted = (h: Holding) => (targets[h.key] ?? 0) * after
  const shortfalls = holdings.map((h) => Math.max(wanted(h) - h.value, 0))
  const shortfall = shortfalls.reduce((sum, s) => sum + s, 0)
  // Shortfalls larger than the deposit are filled in proportion; a deposit larger than all shortfalls
  // fills them and spreads the rest by target.
  const extra = Math.max(deposit - shortfall, 0)
  const targetSum = holdings.reduce((sum, h) => sum + (targets[h.key] ?? 0), 0)
  return holdings.map((h, i) => {
    const target = targets[h.key] ?? 0
    const fill = shortfall > 0 ? (shortfalls[i] as number) * Math.min(deposit / shortfall, 1) : 0
    const buy = Math.max(fill + (targetSum > 0 ? (extra * target) / targetSum : 0), 0)
    return {
      key: h.key,
      label: h.label,
      value: h.value,
      share: total > 0 ? h.value / total : 0,
      target,
      buy,
      difference: wanted(h) - h.value,
      shareAfter: after > 0 ? (h.value + buy) / after : 0,
    }
  })
}

export interface ProjectionInput {
  /** Value of the portfolio today, in EUR. */
  start: number
  /** Added at the end of every month. */
  monthly: number
  /** Expected return per year, e.g. 0.06. */
  yearlyReturn: number
  years: number
  /** Yearly inflation; the result is also given in today's money. */
  inflation: number
}

export interface ProjectionYear {
  /** Years from now, 0 = today. */
  year: number
  value: number
  /** Start value plus everything added so far. */
  contributed: number
  /** `value` in today's money. */
  realValue: number
}

/** Value at the end of every year, compounding monthly. */
export function project(input: ProjectionInput): ProjectionYear[] {
  const monthlyReturn = (1 + input.yearlyReturn) ** (1 / 12) - 1
  const rows: ProjectionYear[] = [{ year: 0, value: input.start, contributed: input.start, realValue: input.start }]
  let value = input.start
  let contributed = input.start
  for (let year = 1; year <= input.years; year++) {
    for (let month = 0; month < 12; month++) {
      value = value * (1 + monthlyReturn) + input.monthly
      contributed += input.monthly
    }
    rows.push({ year, value, contributed, realValue: value / (1 + input.inflation) ** year })
  }
  return rows
}

/**
 * The portfolio that pays `yearlySpending` forever at `withdrawalRate` (the 4% rule: 25 times the yearly
 * spending), and the first year in which the projection reaches it in today's money.
 */
export function fireTarget(rows: ProjectionYear[], yearlySpending: number, withdrawalRate = 0.04): { target: number; year?: number } {
  const target = yearlySpending / withdrawalRate
  const reached = rows.find((r) => r.realValue >= target)
  return reached ? { target, year: reached.year } : { target }
}
