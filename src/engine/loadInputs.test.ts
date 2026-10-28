import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { loadEngineInputs } from './loadInputs.ts'
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
