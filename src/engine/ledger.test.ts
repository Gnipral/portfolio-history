import { describe, expect, it } from 'vitest'
import { Ledger, ledgerOn } from './ledger.ts'
import { DEFAULT_OPTIONS, type EngineOptions } from './options.ts'
import { tx } from './testing.ts'

const A = 'XA0000000001'
const B = 'XB0000000002'

function replay(transactions: ReturnType<typeof tx>[], options: Partial<EngineOptions> = {}, cashMode = false) {
  const ledger = new Ledger({ ...DEFAULT_OPTIONS, ...options }, cashMode)
  const flows = transactions.map((t) => ledger.apply(t))
  return { ledger, flows, holding: (key: string) => ledger.holdings.get(key) }
}

describe('Ledger: buy only', () => {
  const buy = tx('buy', '2026-01-02', { isin: A, quantity: 10, amount: 1000, costsEur: 2 })

  it('adds quantity and cost including costs', () => {
    const { ledger, flows, holding } = replay([buy])
    expect(holding(A)).toMatchObject({ quantity: 10, cost: 1002, lastTradePrice: 100 })
    expect(ledger.realized).toBe(0)
    expect(ledger.netInvestedInSecurities).toBe(1002)
    expect(flows[0]).toEqual({ inflow: 1002, outflow: 0 })
  })

  it('leaves costs out when the toggle is off', () => {
    expect(replay([buy], { includeCosts: false }).holding(A)?.cost).toBe(1000)
  })

  it('counts FX costs separately', () => {
    const usd = tx('buy', '2026-01-02', { isin: A, quantity: 10, amount: 1000, costsEur: 2, fxCostsEur: 2.5, currency: 'USD' })
    expect(replay([usd]).holding(A)?.cost).toBe(1004.5)
    expect(replay([usd], { includeFxCosts: false }).holding(A)?.cost).toBe(1002)
  })
})

describe('Ledger: partial sell', () => {
  // Two buys: 10 for 1000 + 2 and 10 for 1200 + 2. Total cost 2204, average 110.2.
  // Sell 5 for 750 - 2 = 748 proceeds.
  const trades = [
    tx('buy', '2026-01-02', { isin: A, quantity: 10, amount: 1000, costsEur: 2 }),
    tx('buy', '2026-02-02', { isin: A, quantity: 10, amount: 1200, costsEur: 2 }),
    tx('sell', '2026-03-02', { isin: A, quantity: 5, amount: 750, costsEur: 2 }),
  ]

  it('uses the average cost by default', () => {
    const { ledger, holding, flows } = replay(trades)
    // cost sold = 2204 * 5 / 20 = 551, gain = 748 - 551 = 197
    expect(ledger.realized).toBeCloseTo(197, 10)
    expect(holding(A)).toMatchObject({ quantity: 15 })
    expect(holding(A)?.cost).toBeCloseTo(1653, 10)
    expect(flows[2]).toEqual({ inflow: 0, outflow: 748 })
  })

  it('uses the oldest lots with FIFO', () => {
    const { ledger, holding } = replay(trades, { costBasis: 'fifo' })
    // cost sold = 5 * 100.2 = 501, gain = 748 - 501 = 247
    expect(ledger.realized).toBeCloseTo(247, 10)
    expect(holding(A)?.cost).toBeCloseTo(1703, 10)
  })
})

describe('Ledger: full sell', () => {
  it('realizes the whole gain and clears the position', () => {
    const { ledger, holding } = replay([
      tx('buy', '2026-01-02', { isin: A, quantity: 10, amount: 1000, costsEur: 2 }),
      tx('sell', '2026-03-02', { isin: A, quantity: 10, amount: 1100, costsEur: 2 }),
    ])
    // 1098 - 1002 = 96
    expect(ledger.realized).toBeCloseTo(96, 10)
    expect(holding(A)).toMatchObject({ quantity: 0, cost: 0, realized: 96 })
    expect(ledger.openHoldings()).toEqual([])
    expect(ledger.netInvestedInSecurities).toBeCloseTo(-96, 10)
  })

  it('reports selling more than held', () => {
    const { ledger, holding } = replay([
      tx('buy', '2026-01-02', { isin: A, quantity: 5, amount: 500 }),
      tx('sell', '2026-03-02', { isin: A, quantity: 8, amount: 880 }),
    ])
    expect(holding(A)?.quantity).toBe(0)
    expect(ledger.issues[0]?.message).toMatch(/sold 8 but only 5 held/)
  })
})

describe('Ledger: dividend', () => {
  const trades = [
    tx('buy', '2026-01-02', { isin: A, quantity: 10, amount: 1000 }),
    tx('dividend', '2026-06-01', { isin: A, amount: 30, taxesEur: 9 }),
  ]

  it('adds the dividend net of withholding tax to realized profit', () => {
    const { ledger, flows, holding } = replay(trades)
    expect(ledger.realized).toBe(21)
    expect(holding(A)?.realized).toBe(21)
    expect(flows[1]).toEqual({ inflow: 0, outflow: 21 })
  })

  it('respects the dividend and tax toggles', () => {
    expect(replay(trades, { includeTaxes: false }).ledger.realized).toBe(30)
    expect(replay(trades, { includeDividends: false }).ledger.realized).toBe(0)
  })
})

describe('Ledger: splits', () => {
  it('multiplies the quantity and keeps the cost (4:1)', () => {
    const { holding, ledger } = replay(
      [
        tx('buy', '2025-08-08', { isin: A, quantity: 5, amount: 1825, costsEur: 3.9 }),
        tx('split', '2026-07-02', { isin: A, quantity: 20, split: { ratio: 4, fromQuantity: 5 } }),
        tx('sell', '2026-08-01', { isin: A, quantity: 10, amount: 1000 }),
      ],
      { costBasis: 'fifo' },
    )
    // 20 units at 1828.9 / 20 = 91.445; selling 10 costs 914.45
    expect(holding(A)?.quantity).toBe(10)
    expect(holding(A)?.cost).toBeCloseTo(914.45, 10)
    expect(ledger.realized).toBeCloseTo(1000 - 914.45, 10)
    expect(holding(A)?.lastTradePrice).toBe(100)
  })

  it('moves the position and its cost on an ISIN change', () => {
    const { holding } = replay([
      tx('buy', '2024-01-02', { isin: A, quantity: 600, amount: 75 }),
      tx('split', '2024-01-16', { isin: B, quantity: 15, split: { ratio: 0.025, fromQuantity: 600, fromIsin: A } }),
    ])
    expect(holding(A)?.quantity).toBe(0)
    expect(holding(B)).toMatchObject({ quantity: 15, cost: 75, lastTradePrice: 5 })
  })

  it('reports a split of a position that is not held', () => {
    const { ledger } = replay([tx('split', '2024-01-16', { isin: A, quantity: 4, split: { ratio: 4, fromQuantity: 1 } })])
    expect(ledger.issues).toHaveLength(1)
  })
})

describe('Ledger: deposits and withdrawals', () => {
  const trades = [
    tx('deposit', '2026-01-01', { amount: 1000 }),
    tx('buy', '2026-01-02', { isin: A, quantity: 6, amount: 600, costsEur: 2 }),
    tx('withdrawal', '2026-02-01', { amount: 100 }),
    tx('fee', '2026-03-01', { amount: 5 }),
  ]

  it('tracks cash and uses only deposits and withdrawals as flows in cash mode', () => {
    const { ledger, flows } = replay(trades, {}, true)
    // 1000 - 602 - 100 - 5
    expect(ledger.cash).toBe(293)
    expect(ledger.netDeposits).toBe(900)
    expect(ledger.realized).toBe(-5)
    expect(flows).toEqual([
      { inflow: 1000, outflow: 0 },
      { inflow: 0, outflow: 0 },
      { inflow: 0, outflow: 100 },
      { inflow: 0, outflow: 0 },
    ])
  })

  it('treats buys and fees as flows in securities mode', () => {
    const { flows } = replay(trades)
    expect(flows.map((f) => f.inflow)).toEqual([0, 602, 0, 5])
  })

  it('ignores standalone fees when costs are excluded', () => {
    expect(replay(trades, { includeCosts: false }, true).ledger.realized).toBe(0)
  })
})

describe('Ledger: transfers and free units', () => {
  it('moves units out at their cost basis without realizing a gain', () => {
    const { ledger, flows, holding } = replay([
      tx('buy', '2026-01-02', { isin: A, quantity: 4, amount: 400 }),
      tx('transferOut', '2026-02-02', { isin: A, quantity: 1 }),
    ])
    expect(holding(A)).toMatchObject({ quantity: 3, cost: 300 })
    expect(ledger.realized).toBe(0)
    expect(ledger.netInvestedInSecurities).toBe(300)
    expect(flows[1]).toEqual({ inflow: 0, outflow: 100 })
  })

  it('adds received units at the value given, and counts them as a flow in cash mode', () => {
    const { ledger, flows, holding } = replay([tx('transferIn', '2026-01-02', { isin: A, quantity: 2, amount: 50 })], {}, true)
    expect(holding(A)).toMatchObject({ quantity: 2, cost: 50 })
    expect(ledger.netDeposits).toBe(50)
    expect(flows[0]).toEqual({ inflow: 50, outflow: 0 })
  })

  it('keeps the last trade price when free units arrive', () => {
    const { holding } = replay([
      tx('buy', '2026-01-02', { isin: A, quantity: 1, amount: 100 }),
      tx('buy', '2026-02-02', { isin: A, quantity: 0.01, amount: 0 }),
    ])
    expect(holding(A)).toMatchObject({ quantity: 1.01, cost: 100, lastTradePrice: 100 })
  })
})

describe('ledgerOn', () => {
  it('replays only up to the given date, in date order', () => {
    const trades = [
      tx('sell', '2026-03-02', { isin: A, quantity: 5, amount: 600 }),
      tx('buy', '2026-01-02', { isin: A, quantity: 10, amount: 1000 }),
    ]
    expect(ledgerOn(trades, '2026-02-01', DEFAULT_OPTIONS, false).holdings.get(A)?.quantity).toBe(10)
    expect(ledgerOn(trades, '2026-03-02', DEFAULT_OPTIONS, false).holdings.get(A)?.quantity).toBe(5)
  })
})
