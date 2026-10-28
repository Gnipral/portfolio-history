import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { degiroAdapter } from '../import/adapters/degiro/index.ts'
import { SAMPLE_ROWS, table } from '../import/adapters/degiro/fixtures.ts'
import { PortfolioDatabase } from './db.ts'
import type { Transaction } from '../model/transaction.ts'
import { addToPortfolio, hasPortfolio, newTransactions, replacePortfolio } from './portfolio.ts'

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

describe('addToPortfolio', () => {
  it('adds a second broker next to the first', async () => {
    await replacePortfolio(degiroAdapter.parse([table(SAMPLE_ROWS)]), ['a.csv'], database)
    const before = await database.transactions.count()
    const other = degiroAdapter.parse([table(SAMPLE_ROWS.slice(0, 3), undefined, 'b.csv')])
    const second = { ...other, broker: 'Bolero', transactions: other.transactions.map((t) => ({ ...t, id: `bolero:${t.id}`, source: { ...t.source, broker: 'Bolero' } })) }

    expect(await addToPortfolio(second, ['b.csv'], database)).toBe(second.transactions.length)
    expect(await database.transactions.count()).toBe(before + second.transactions.length)
    expect(await database.imports.get('current')).toMatchObject({ broker: 'DEGIRO + Bolero', files: ['a.csv', 'b.csv'] })
  })

  it('skips transactions that an overlapping export repeats', async () => {
    await replacePortfolio(degiroAdapter.parse([table(SAMPLE_ROWS)]), ['a.csv'], database)
    const before = await database.transactions.count()

    expect(await addToPortfolio(degiroAdapter.parse([table(SAMPLE_ROWS, undefined, 'newer.csv')]), ['newer.csv'], database)).toBe(0)
    expect(await database.transactions.count()).toBe(before)
    expect((await database.imports.get('current'))?.broker).toBe('DEGIRO')
  })

  it('starts a portfolio when none is stored', async () => {
    const result = degiroAdapter.parse([table(SAMPLE_ROWS)])
    expect(await addToPortfolio(result, ['a.csv'], database)).toBe(result.transactions.length)
  })
})

describe('newTransactions', () => {
  it('keeps a repeated identical buy beyond the stored count', () => {
    const [buy] = degiroAdapter.parse([table(SAMPLE_ROWS)]).transactions.filter((t) => t.type === 'buy') as [Transaction]
    const stored = [buy, { ...buy, id: 'b' }]
    const incoming = [{ ...buy, id: 'x' }, { ...buy, id: 'y' }, { ...buy, id: 'z' }]
    expect(newTransactions(stored, incoming).map((t) => t.id)).toEqual(['z'])
  })
})
