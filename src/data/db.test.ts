import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { PortfolioDatabase } from './db.ts'

const NAME = 'test-upgrade'

afterEach(async () => {
  await Dexie.delete(NAME)
})

describe('database upgrade to version 4', () => {
  it('resets the price coverage but keeps the cached prices', async () => {
    // A browser that last ran version 3
    const old = new Dexie(NAME)
    old.version(3).stores({
      transactions: 'id, date, isin',
      imports: 'id',
      prices: '[symbol+date], symbol',
      coverage: 'symbol',
      fxDays: 'date',
      splits: 'id, symbol',
      kv: 'key',
      symbols: 'key',
    })
    await old.table('coverage').put({ symbol: 'PANW', from: '2024-03-19', to: '2024-08-20', currency: 'USD', source: 'yahoo-proxy', fetchedAt: '' })
    await old.table('prices').put({ symbol: 'PANW', date: '2024-03-19', close: 280 })
    old.close()

    const upgraded = new PortfolioDatabase(NAME)
    expect(await upgraded.coverage.count()).toBe(0)
    expect(await upgraded.prices.count()).toBe(1)
    upgraded.close()
  })
})
