import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/db.ts'
import { tx } from '../../engine/testing.ts'
import { localToday, addDays } from '../../market/dates.ts'
import { syncMarketData } from '../../market/sync.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import { DashboardPage } from './DashboardPage.tsx'

// Canvas charts do not run in jsdom; PortfolioChart has its own test with a mocked library.
vi.mock('../dashboard/PortfolioChart.tsx', () => ({ PortfolioChart: () => null }))

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
  vi.mocked(syncMarketData).mockClear()
  await Promise.all([db.transactions.clear(), db.symbols.clear(), db.prices.clear(), db.coverage.clear(), db.kv.clear(), db.imports.clear()])
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
  it('shows stored prices offline and syncs once the connection is back', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await seed()
    renderPage()
    const card = (await screen.findByText('Value', { selector: '.card-label' })).closest('.card') as HTMLElement
    expect(within(card).getByText('€1,100.00')).toBeTruthy()
    expect(syncMarketData).not.toHaveBeenCalled()

    onLine.mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event('online')))
    await vi.waitFor(() => expect(syncMarketData).toHaveBeenCalledTimes(1))
    onLine.mockRestore()
  })

  it('asks for an import when there is no data', async () => {
    renderPage()
    expect(await screen.findByText(/No portfolio loaded yet/)).toBeTruthy()
  })

  it('shows the cards for the last day and links to missing prices', async () => {
    await seed()
    renderPage()
    const value = await screen.findByText('Value', { selector: '.card-label' })
    const card = value.closest('.card') as HTMLElement
    expect(within(card).getByText('€1,100.00')).toBeTruthy()
    const pnl = screen.getByText('Profit / loss').closest('.card') as HTMLElement
    expect(within(pnl).getByText('+€100.00').className).toContain('positive')
    expect(await screen.findByText(/1 product has no price yet/)).toBeTruthy()
  })

  it('lists the positions of the selected day', async () => {
    await seed()
    renderPage()
    const table = (await screen.findByRole('columnheader', { name: /Quantity/ })).closest('table') as HTMLElement
    expect(within(table).getByText(A)).toBeTruthy()
    expect(within(table).getByText('100.00%')).toBeTruthy()
  })

  it('moves the selection with the date picker and the slider', async () => {
    await seed()
    renderPage()
    await screen.findByText('Value', { selector: '.card-label' })
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: start } })
    const card = screen.getByText('Value', { selector: '.card-label' }).closest('.card') as HTMLElement
    expect(within(card).getByText('€1,000.00')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Timeline'), { target: { value: '10' } })
    expect(within(screen.getByText('Value', { selector: '.card-label' }).closest('.card') as HTMLElement).getByText('€1,100.00')).toBeTruthy()
  })

  it('compares with the benchmark bought with the same money', async () => {
    await seed()
    await db.prices.bulkPut([
      { symbol: 'IWDA.AS', date: start, close: 50 },
      { symbol: 'IWDA.AS', date: today, close: 52.5 },
    ])
    renderPage()
    // 1000 into IWDA at 50 = 20 units, worth 1050 today: +50, +5%
    expect(await screen.findByText(/The same money in IWDA/)).toBeTruthy()
    expect(screen.getByText('+€50.00')).toBeTruthy()
  })

  it('recalculates instantly when costs are excluded, and explains unavailable options', async () => {
    await seed()
    await db.transactions.clear()
    await db.transactions.bulkAdd([tx('buy', start, { isin: A, quantity: 10, amount: 1000, costsEur: 5 })])
    await db.imports.put({
      id: 'current',
      broker: 'TEST',
      files: [],
      importedAt: '',
      capabilities: { transactionCosts: true, fxCosts: true, taxes: false, dividends: false, deposits: false },
      missingReasons: { dividends: 'No dividends in this export.' },
      issues: [],
    })
    renderPage()
    await screen.findByText('Profit / loss')
    const pnl = () => within(screen.getByText('Profit / loss').closest('.card') as HTMLElement)
    // 1100 - (1000 + 5)
    expect(await pnl().findByText('+€95.00')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Transaction costs'))
    expect(await pnl().findByText('+€100.00')).toBeTruthy()
    expect((screen.getByLabelText('Dividends') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/No dividends in this export/)).toBeTruthy()
  })

  it('switches the chart unit', async () => {
    await seed()
    renderPage()
    await screen.findByText('Value', { selector: '.card-label' })
    fireEvent.click(screen.getByRole('button', { name: '%' }))
    expect(screen.getByRole('button', { name: '%' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches the quick range', async () => {
    await seed()
    renderPage()
    await screen.findByText('Value', { selector: '.card-label' })
    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(screen.getByRole('button', { name: '1M' }).getAttribute('aria-pressed')).toBe('true')
  })
})
