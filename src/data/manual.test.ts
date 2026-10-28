import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { degiroAdapter } from '../import/adapters/degiro/index.ts'
import { SAMPLE_ROWS, table } from '../import/adapters/degiro/fixtures.ts'
import { PortfolioDatabase } from './db.ts'
import { buildTransaction, deleteTransaction, saveTransaction, toInput, validate, type ManualInput } from './manual.ts'
import { addToPortfolio, replacePortfolio } from './portfolio.ts'

const database = new PortfolioDatabase('test-manual')
const eur = { toEur: (amount: number) => amount }
const usd = { toEur: (amount: number, currency: string) => (currency === 'USD' ? amount / 1.25 : undefined) }

const BUY: ManualInput = {
  date: '2026-03-02',
  type: 'buy',
  product: 'iShares Core MSCI World',
  isin: 'ie00b4l5y983',
  ticker: '',
  assetClass: 'etf',
  quantity: 10,
  price: 100,
  amount: 0,
  currency: 'EUR',
  costsEur: 1,
  taxesEur: 1.2,
}

afterEach(async () => {
  await database.delete()
  await database.open()
})

describe('buildTransaction', () => {
  it('makes a buy with signed amounts', () => {
    const t = buildTransaction(BUY, eur)
    expect(t).toMatchObject({ type: 'buy', isin: 'IE00B4L5Y983', quantity: 10, amountEur: -1000, totalEur: -1002.2, source: { broker: 'Manual' } })
    expect(t.id).toMatch(/^manual:/)
  })

  it('converts another currency at the rate of that day', () => {
    const t = buildTransaction({ ...BUY, type: 'dividend', amount: 50, currency: 'usd', costsEur: 0, taxesEur: 6 }, usd)
    expect(t).toMatchObject({ currency: 'USD', localAmount: 50, amountEur: 40, totalEur: 34, quantity: 0, fxRate: 1.25 })
  })

  it('fails without a rate', () => {
    expect(() => buildTransaction({ ...BUY, currency: 'CHF' }, usd)).toThrow('No EUR exchange rate for CHF')
  })

  it('keeps id, source and order of an edited import', () => {
    const imported = degiroAdapter.parse([table(SAMPLE_ROWS)]).transactions.find((t) => t.type === 'buy')!
    const edited = buildTransaction({ ...toInput(imported), quantity: imported.quantity + 1 }, usd, imported)
    expect(edited).toMatchObject({ id: imported.id, source: imported.source, dateTime: imported.dateTime, quantity: imported.quantity + 1 })
  })
})

describe('validate', () => {
  it('asks for what is missing', () => {
    expect(validate(BUY)).toBeUndefined()
    expect(validate({ ...BUY, quantity: 0 })).toBe('Enter a quantity above 0.')
    expect(validate({ ...BUY, isin: 'nope' })).toMatch(/ISIN is not valid/)
    expect(validate({ ...BUY, type: 'deposit', product: '', isin: '', amount: 0 })).toBe('Enter an amount above 0.')
  })
})

describe('saveTransaction', () => {
  it('starts a portfolio from hand-entered transactions', async () => {
    await saveTransaction(buildTransaction({ ...BUY, type: 'deposit', amount: 2000 }, eur), database)
    await saveTransaction(buildTransaction(BUY, eur), database)
    expect(await database.transactions.count()).toBe(2)
    expect(await database.imports.get('current')).toMatchObject({ broker: 'Manual', capabilities: { deposits: true } })
  })

  it('adds Manual to an imported portfolio and survives a later import', async () => {
    await replacePortfolio(degiroAdapter.parse([table(SAMPLE_ROWS)]), ['a.csv'], database)
    const manual = buildTransaction(BUY, eur)
    await saveTransaction(manual, database)
    expect((await database.imports.get('current'))?.broker).toBe('DEGIRO + Manual')

    await addToPortfolio(degiroAdapter.parse([table(SAMPLE_ROWS, undefined, 'b.csv')]), ['b.csv'], database)
    expect(await database.transactions.get(manual.id)).toBeTruthy()
    await deleteTransaction(manual.id, database)
    expect(await database.transactions.get(manual.id)).toBeUndefined()
  })
})
