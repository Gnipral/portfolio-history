import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/db.ts'
import { tx } from '../../engine/testing.ts'
import { addDays, localToday } from '../../market/dates.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import { AnalysisPage } from './AnalysisPage.tsx'

vi.mock('../analysis/MonthlyIncomeChart.tsx', () => ({ MonthlyIncomeChart: () => null }))
vi.mock('../../market/sync.ts', () => ({ syncMarketData: vi.fn(async () => ({ errors: [], problems: {} })) }))

const A = 'XA0000000001'
const today = localToday()
const start = addDays(today, -40)

beforeEach(async () => {
  resetSyncSession()
  await Promise.all([db.transactions.clear(), db.symbols.clear(), db.prices.clear(), db.coverage.clear(), db.kv.clear(), db.imports.clear()])
  await db.transactions.bulkAdd([
    tx('buy', start, { isin: A, product: 'Alpha', quantity: 10, amount: 1000, costsEur: 2, taxesEur: 3.5 }),
    tx('dividend', addDays(start, 10), { isin: A, product: 'Alpha', amount: 30, taxesEur: 9 }),
    tx('sell', addDays(start, 20), { isin: A, product: 'Alpha', quantity: 5, amount: 600, costsEur: 2, taxesEur: 2.1 }),
  ])
  await db.symbols.put({ key: A, symbol: 'AAA', kind: 'security', source: 'manual', resolvedAt: '' })
  await db.coverage.put({ symbol: 'AAA', from: start, to: today, currency: 'EUR', source: 'test', fetchedAt: '' })
  await db.prices.bulkPut([
    { symbol: 'AAA', date: start, close: 100 },
    { symbol: 'AAA', date: today, close: 130 },
  ])
})
afterEach(cleanup)

describe('AnalysisPage', () => {
  it('shows taxes, dividends, sales, costs and risk', async () => {
    render(
      <MemoryRouter>
        <AnalysisPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Taxes paid')).toBeTruthy()
    // TOB of the buy and the sale.
    expect(screen.getAllByText('€5.60').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Dividends' }))
    expect(await screen.findByText('Per position')).toBeTruthy()
    expect(screen.getAllByText('€21.00').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Realized' }))
    // 600 - 2 - 2.1 proceeds, minus half of 1005.5 cost.
    expect((await screen.findAllByText('+€93.15')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Costs' }))
    expect(await screen.findByText('Paid in total')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Risk' }))
    expect(await screen.findByText('Return per month')).toBeTruthy()
  })
})
