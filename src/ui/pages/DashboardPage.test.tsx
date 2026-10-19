import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/db.ts'
import { tx } from '../../engine/testing.ts'
import { localToday, addDays } from '../../market/dates.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import { DashboardPage } from './DashboardPage.tsx'

vi.mock('../../market/sync.ts', () => ({
  syncMarketData: vi.fn(async ({ onProgress }: { onProgress?: (p: unknown) => void }) => {
    onProgress?.({ phase: 'done', done: 1, total: 1, message: 'Done' })
    return { errors: [], problems: { X: 'no price' } }
  }),
}))

const A = 'XA0000000001'
const today = localToday()
const start = addDays(today, -10)

beforeEach(async () => {
  resetSyncSession()
  await Promise.all([db.transactions.clear(), db.symbols.clear(), db.prices.clear(), db.coverage.clear()])
})
afterEach(cleanup)

function renderPage() {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

async function seed() {
  await db.transactions.bulkAdd([tx('buy', start, { isin: A, quantity: 10, amount: 1000 })])
  await db.symbols.put({ key: A, symbol: 'AAA', kind: 'security', source: 'manual', resolvedAt: '' })
  await db.coverage.put({ symbol: 'AAA', from: start, to: today, currency: 'EUR', source: 'test', fetchedAt: '' })
  await db.prices.bulkPut([
    { symbol: 'AAA', date: start, close: 100 },
    { symbol: 'AAA', date: today, close: 110 },
  ])
}

describe('DashboardPage', () => {
  it('asks for an import when there is no data', async () => {
    renderPage()
    expect(await screen.findByText(/No portfolio loaded yet/)).toBeTruthy()
  })

  it('shows the cards for the last day and links to missing prices', async () => {
    await seed()
    renderPage()
    const value = await screen.findByText('Value')
    const card = value.closest('.card') as HTMLElement
    expect(within(card).getByText('€1,100.00')).toBeTruthy()
    const pnl = screen.getByText('Profit / loss').closest('.card') as HTMLElement
    expect(within(pnl).getByText('+€100.00').className).toContain('positive')
    expect(await screen.findByText(/1 product has no price yet/)).toBeTruthy()
  })

  it('moves the selection with the date picker and the slider', async () => {
    await seed()
    renderPage()
    await screen.findByText('Value')
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: start } })
    const card = screen.getByText('Value').closest('.card') as HTMLElement
    expect(within(card).getByText('€1,000.00')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Timeline'), { target: { value: '10' } })
    expect(within(screen.getByText('Value').closest('.card') as HTMLElement).getByText('€1,100.00')).toBeTruthy()
  })

  it('switches the quick range', async () => {
    await seed()
    renderPage()
    await screen.findByText('Value')
    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(screen.getByRole('button', { name: '1M' }).getAttribute('aria-pressed')).toBe('true')
  })
})
