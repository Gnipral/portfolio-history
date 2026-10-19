import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { degiroAdapter } from '../import/adapters/degiro/index.ts'
import { SAMPLE_ROWS, table } from '../import/adapters/degiro/fixtures.ts'
import { PortfolioDatabase } from './db.ts'
import { hasPortfolio, replacePortfolio } from './portfolio.ts'

const database = new PortfolioDatabase('test-portfolio')

afterEach(async () => {
  await database.delete()
  await database.open()
})

describe('replacePortfolio', () => {
  it('stores transactions and import metadata', async () => {
    expect(await hasPortfolio(database)).toBe(false)
    const result = degiroAdapter.parse([table(SAMPLE_ROWS)])
    await replacePortfolio(result, ['Transactions.csv'], database, new Date('2026-10-19T12:00:00Z'))

    expect(await hasPortfolio(database)).toBe(true)
    expect(await database.transactions.count()).toBe(result.transactions.length)
    expect(await database.imports.get('current')).toMatchObject({
      broker: 'DEGIRO',
      files: ['Transactions.csv'],
      importedAt: '2026-10-19T12:00:00.000Z',
    })
  })

  it('replaces all earlier data', async () => {
    await replacePortfolio(degiroAdapter.parse([table(SAMPLE_ROWS)]), ['a.csv'], database)
    await replacePortfolio(degiroAdapter.parse([table(SAMPLE_ROWS.slice(0, 3), undefined, 'b.csv')]), ['b.csv'], database)

    const stored = await database.transactions.toArray()
    expect(stored.every((t) => t.source.file === 'b.csv')).toBe(true)
    expect(stored).toHaveLength(2)
    expect((await database.imports.get('current'))?.files).toEqual(['b.csv'])
  })
})
