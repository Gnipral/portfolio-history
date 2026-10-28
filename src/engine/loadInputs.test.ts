import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { loadEngineInputs } from './loadInputs.ts'
import { customBenchmark } from '../market/benchmarks.ts'
import { tx } from './testing.ts'

const database = new PortfolioDatabase('test-load-inputs')

afterEach(async () => {
  await database.delete()
  await database.open()
})

describe('loadEngineInputs', () => {
  it('stays in EUR while no rate of the base currency is stored', async () => {
    await database.transactions.add(tx('deposit', '2026-01-02', { amount: 1000 }))
    const inputs = await loadEngineInputs(database, [], 'USD')
    expect(inputs.currency).toBe('EUR')
    expect(inputs.transactions[0]?.amountEur).toBe(1000)
  })

  it('converts once a rate is stored', async () => {
    await database.transactions.add(tx('deposit', '2026-01-02', { amount: 1000 }))
    await database.fxDays.put({ date: '2026-01-02', rates: { USD: 1.2 } })
    const inputs = await loadEngineInputs(database, [], 'USD')
    expect(inputs.currency).toBe('USD')
    expect(inputs.transactions[0]?.amountEur).toBeCloseTo(1200)
  })
})

describe('loadEngineInputs: a stock added to compare with', () => {
  it('turns its dollar closes into euros at the rate of each day', async () => {
    await database.transactions.add(tx('deposit', '2026-01-02', { amount: 1000 }))
    await database.fxDays.bulkPut([
      { date: '2026-01-02', rates: { USD: 1.25 } },
      { date: '2026-01-05', rates: { USD: 1.0 } },
    ])
    await database.prices.bulkPut([
      { symbol: 'AAPL', date: '2026-01-02', close: 250 },
      { symbol: 'AAPL', date: '2026-01-05', close: 250 },
    ])
    await database.coverage.put({ symbol: 'AAPL', from: '2026-01-02', to: '2026-01-05', currency: 'USD', source: 'test', fetchedAt: '' })
    const inputs = await loadEngineInputs(database, [customBenchmark({ symbol: 'AAPL', name: 'Apple Inc.' })])
    expect(inputs.benchmarks[0]?.series.closes).toEqual([200, 250])
  })
})
