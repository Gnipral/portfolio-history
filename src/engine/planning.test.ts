import { describe, expect, it } from 'vitest'
import { fireTarget, project, rebalance } from './planning.ts'

const holdings = [
  { key: 'world', label: 'World', value: 8000 },
  { key: 'em', label: 'Emerging', value: 1000 },
  { key: 'old', label: 'Old stock', value: 1000 },
]

describe('rebalance', () => {
  it('sends a small deposit to what is furthest below target, in proportion', () => {
    // After 1000: total 11000. Wanted: world 8800 (short 800), em 2200 (short 1200), old 0.
    const rows = rebalance(holdings, { world: 0.8, em: 0.2 }, 1000)
    expect(rows.map((r) => Math.round(r.buy))).toEqual([400, 600, 0])
    expect(rows.find((r) => r.key === 'old')?.difference).toBe(-1000)
  })

  it('never spends more than the deposit', () => {
    const rows = rebalance(holdings, { world: 0.5, em: 0.5 }, 20000)
    // After: 30000, wanted 15000 each: world short 7000, em short 14000 = 21000 > 20000, so in proportion.
    expect(rows.reduce((sum, r) => sum + r.buy, 0)).toBeCloseTo(20000)
    // Targets below 100% leave money after every shortfall: it follows the targets.
    const partial = rebalance(holdings.slice(0, 2), { world: 0.4, em: 0.4 }, 10000)
    expect(partial.map((r) => Math.round(r.buy))).toEqual([1700, 8300])
  })

  it('buys nothing without targets', () => {
    expect(rebalance(holdings, {}, 500).every((r) => r.buy === 0)).toBe(true)
  })
})

describe('project', () => {
  it('compounds monthly and adds the monthly amount', () => {
    const rows = project({ start: 10000, monthly: 0, yearlyReturn: 0.06, years: 2, inflation: 0 })
    expect(rows[2]?.value).toBeCloseTo(10000 * 1.06 ** 2)
    const saving = project({ start: 0, monthly: 100, yearlyReturn: 0, years: 3, inflation: 0.02 })
    expect(saving[3]).toMatchObject({ value: 3600, contributed: 3600 })
    expect(saving[3]?.realValue).toBeCloseTo(3600 / 1.02 ** 3)
  })

  it('finds the year the 4% rule is met', () => {
    const rows = project({ start: 100000, monthly: 1000, yearlyReturn: 0.07, years: 40, inflation: 0.02 })
    const fire = fireTarget(rows, 24000)
    expect(fire.target).toBe(600000)
    expect(rows[fire.year! - 1]!.realValue).toBeLessThan(600000)
    expect(rows[fire.year!]!.realValue).toBeGreaterThanOrEqual(600000)
    expect(fireTarget(rows.slice(0, 2), 24000).year).toBeUndefined()
  })
})
