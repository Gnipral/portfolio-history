import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/db.ts'
import { tx } from '../../engine/testing.ts'
import { localToday, addDays } from '../../market/dates.ts'
import { syncMarketData } from '../../market/sync.ts'
import { loadSettings, saveSettings } from '../../settings/settings.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import { formatDate } from '../format.ts'
import { DashboardPage } from './DashboardPage.tsx'

// Canvas charts do not run in jsdom: a stand-in with buttons that hover, leave and click a day.
vi.mock('../dashboard/PortfolioChart.tsx', () => ({
  PortfolioChart: ({ onHover, onPick }: { onHover: (index: number | null) => void; onPick?: (index: number) => void }) => (
    <div>
      <button type="button" onClick={() => onHover(0)}>
        hover first day
      </button>
      <button type="button" onClick={() => onHover(null)}>
        leave chart
      </button>
      <button type="button" onClick={() => onPick?.(0)}>
        click first day
      </button>
    </div>
  ),
}))

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
  localStorage.clear()
  vi.mocked(syncMarketData).mockClear()
  await Promise.all([db.transactions.clear(), db.symbols.clear(), db.prices.clear(), db.coverage.clear(), db.kv.clear(), db.imports.clear()])
})
afterEach(cleanup)

function renderPage() {
  return render(
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

/** The figure in the row of key figures with this label. */
const figure = async (label: string) => (await screen.findByText(label, { selector: '.figure-cell .label-caps' })).closest('.figure-cell') as HTMLElement
const panel = () => within(screen.getByRole('complementary', { name: 'State inspection' }))
/** The portfolio value in the side panel. */
const panelValue = () => panel().getByText('Portfolio value').nextElementSibling?.textContent

describe('DashboardPage', () => {
  it('shows stored prices offline and syncs once the connection is back', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await seed()
    renderPage()
    expect(within(await figure('Portfolio value')).getByText('€1,100.00')).toBeTruthy()
    expect(syncMarketData).not.toHaveBeenCalled()

    onLine.mockReturnValue(true)
    act(() => void window.dispatchEvent(new Event('online')))
    await vi.waitFor(() => expect(syncMarketData).toHaveBeenCalledTimes(1))
    onLine.mockRestore()
  })

  it('asks for an import when there is no data and the welcome flow was seen', async () => {
    localStorage.setItem('portfolio-history:onboarded', '1')
    renderPage()
    expect(await screen.findByText(/No portfolio loaded yet/)).toBeTruthy()
  })

  it('shows the figures of the period and links to missing prices', async () => {
    await seed()
    renderPage()
    expect(within(await figure('Portfolio value')).getByText('€1,100.00')).toBeTruthy()
    expect(within(await figure('Invested capital')).getByText('€1,000.00')).toBeTruthy()
    expect(within(await figure('Total profit')).getByText('+€100.00')).toBeTruthy()
    expect(within(await figure('Time-weighted return')).getByText('+10.00%')).toBeTruthy()
    expect(await screen.findByText(/1 product has no price yet/)).toBeTruthy()
  })

  it('lists the holdings on the playhead day, with a totals row', async () => {
    await seed()
    renderPage()
    expect(await screen.findByRole('heading', { name: `Holdings on ${formatDate(today)}` })).toBeTruthy()
    const table = (await screen.findByRole('columnheader', { name: /Quantity/ })).closest('table') as HTMLElement
    expect(within(table).getAllByText(A).length).toBeGreaterThan(0)
    expect(within(table).getByText('Total')).toBeTruthy()
    expect(within(table).getAllByText('100.00%').length).toBe(2)
  })

  it('leaves out a product switched off on the Prices page', async () => {
    await seed()
    const B = 'XB0000000002'
    await db.transactions.add(tx('buy', start, { isin: B, quantity: 1, amount: 500 }))
    await saveSettings({ excludedInstruments: [B] })
    renderPage()
    const table = (await screen.findByRole('columnheader', { name: /Quantity/ })).closest('table') as HTMLElement
    expect(within(table).getAllByText(A).length).toBeGreaterThan(0)
    expect(within(table).queryByText(B)).toBeNull()
  })

  it('follows the pointer in the side panel, pins a clicked day and unpins it', async () => {
    await seed()
    renderPage()
    await screen.findByRole('complementary', { name: 'State inspection' })
    expect(panelValue()).toBe('€1,100.00')
    expect(panel().queryByRole('button', { name: /Unpin/ })).toBeNull()

    // Hover: the panel follows the day under the pointer, and returns to the playhead when it leaves.
    fireEvent.click(screen.getByRole('button', { name: 'hover first day' }))
    expect(panelValue()).toBe('€1,000.00')
    fireEvent.click(screen.getByRole('button', { name: 'leave chart' }))
    expect(panelValue()).toBe('€1,100.00')

    // Click: the day is pinned, also after the pointer leaves; × puts the playhead back at the end.
    fireEvent.click(screen.getByRole('button', { name: 'click first day' }))
    fireEvent.click(screen.getByRole('button', { name: 'leave chart' }))
    expect(panelValue()).toBe('€1,000.00')
    expect(screen.getByRole('heading', { name: `Holdings on ${formatDate(start)}` })).toBeTruthy()
    fireEvent.click(panel().getByRole('button', { name: /Unpin/ }))
    expect(panelValue()).toBe('€1,100.00')
  })

  it('remembers whether the side panel is open', async () => {
    await seed()
    const { unmount } = renderPage()
    await screen.findByRole('complementary', { name: 'State inspection' })
    fireEvent.click(screen.getByRole('button', { name: 'Side panel' }))
    expect(screen.queryByRole('complementary', { name: 'State inspection' })).toBeNull()
    unmount()
    renderPage()
    await figure('Portfolio value')
    expect(screen.queryByRole('complementary', { name: 'State inspection' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Side panel' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('compares with the benchmark bought with the same money', async () => {
    await seed()
    await db.prices.bulkPut([
      { symbol: 'IWDA.AS', date: start, close: 50 },
      { symbol: 'IWDA.AS', date: today, close: 52.5 },
    ])
    renderPage()
    // 1000 into IWDA at 50 = 20 units, worth 1050 today: +50, +5%
    expect((await screen.findByText(/The same money in IWDA/)).textContent).toContain('+€50.00')
    expect(within(await figure('IWDA, same money')).getByText('+5.00%')).toBeTruthy()
    // The side panel puts the gap next to it: 100 - 50.
    expect(panel().getByText('Alpha / outperformance').nextElementSibling?.textContent).toContain('+€50.00')
  })

  it('compares with another benchmark for now, without changing the default', async () => {
    await seed()
    await db.prices.bulkPut([
      { symbol: 'IWDA.AS', date: start, close: 50 },
      { symbol: 'IWDA.AS', date: today, close: 52.5 },
      { symbol: 'VWCE.DE', date: start, close: 100 },
      { symbol: 'VWCE.DE', date: today, close: 110 },
    ])
    renderPage()
    await screen.findByText(/The same money in IWDA/)
    fireEvent.click(screen.getByRole('button', { name: /Benchmark/ }))
    fireEvent.click(screen.getByRole('button', { name: /VWCE/ }))
    expect((await screen.findByText(/The same money in VWCE/)).textContent).toContain('+€100.00')
    // Only the chart changed: the default in the settings stays IWDA alone.
    expect((await loadSettings()).extraBenchmarkIds).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Back to the default' }))
    await waitFor(() => expect(screen.queryByText(/The same money in VWCE/)).toBeNull())
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
    // 1100 - (1000 + 5)
    expect(within(await figure('Total profit')).getByText('+€95.00')).toBeTruthy()
    // Folded by default, with the count of what is included.
    const row = screen.getByRole('button', { name: /What counts in the result/ })
    expect(row.textContent).toContain('2 of 5 included')
    fireEvent.click(row)
    fireEvent.click(screen.getByLabelText('Transaction costs'))
    await waitFor(async () => expect(within(await figure('Total profit')).getByText('+€100.00')).toBeTruthy())
    expect((screen.getByLabelText('Dividends') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/No dividends in this export/)).toBeTruthy()
  })

  it('switches the chart unit', async () => {
    await seed()
    renderPage()
    await figure('Portfolio value')
    fireEvent.click(screen.getByRole('button', { name: '% TWR' }))
    expect(screen.getByRole('button', { name: '% TWR' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches the quick range of the timeline', async () => {
    await seed()
    renderPage()
    await figure('Portfolio value')
    fireEvent.click(screen.getByRole('button', { name: '1M' }))
    expect(screen.getByRole('button', { name: '1M' }).getAttribute('aria-pressed')).toBe('true')
  })
})
