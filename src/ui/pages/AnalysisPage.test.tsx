import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/db.ts'
import { tx } from '../../engine/testing.ts'
import { addDays, localToday } from '../../market/dates.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import { PeriodProvider, usePeriod } from '../period/PeriodProvider.tsx'
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

function renderPage() {
  return render(
    <MemoryRouter>
      <AnalysisPage />
    </MemoryRouter>,
  )
}

const sectionTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)

describe('AnalysisPage', () => {
  it('opens on Performance, and keeps taxes, dividends and sales in their tabs', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Key figures' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Performance' }).getAttribute('aria-selected')).toBe('true')
    // The costs of the Costs tab now sit in Performance: 2 + 2 broker fees, 3.50 + 2.10 TOB.
    expect(screen.getByRole('heading', { name: 'Costs' })).toBeTruthy()
    expect(screen.getAllByText('€9.60').length).toBeGreaterThan(0)
    expect(screen.queryByRole('tab', { name: 'Costs' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Risk' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Taxes' }))
    expect(await screen.findByText('Taxes paid')).toBeTruthy()
    // TOB of the buy and the sale.
    expect(screen.getAllByText('€5.60').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Dividends' }))
    expect(await screen.findByText('Per position')).toBeTruthy()
    expect(screen.getAllByText('€21.00').length).toBeGreaterThan(0)
    // Expected: 3 euros a share gross on the 5 shares left, with the same 30 % tax.
    expect(screen.getByText('Expected in the next 12 months, based on last year')).toBeTruthy()
    expect(screen.getByText(/Calculated from the dividends paid from/)).toBeTruthy()
    expect(screen.getAllByText('€10.50').length).toBeGreaterThan(0)
    expect(screen.getAllByText('€15.00').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Realized' }))
    // 600 - 2 - 2.1 proceeds, minus half of 1005.5 cost.
    expect((await screen.findAllByText('+€93.15')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('tab', { name: 'Planning' }))
    expect(await screen.findByText('Rebalance with your next deposit')).toBeTruthy()
  })
})

describe('AnalysisPage levels', () => {
  it('adds sections and detail level by level, keeping the order', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Key figures' })
    const basic = sectionTitles()
    expect(basic).toEqual(['Key figures', 'Monthly returns', 'Biggest drop', 'Costs', 'Best and worst positions', 'Checks'])
    expect(screen.getByText('Your return per year')).toBeTruthy()
    expect(screen.queryByText('TWR, cumulative')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    const advanced = sectionTitles()
    expect(advanced.length).toBeGreaterThanOrEqual(basic.length)
    expect(advanced[0]).toBe('Key figures')
    expect(screen.getByText('TWR, cumulative')).toBeTruthy()
    expect(screen.getByText('Money-weighted (XIRR)')).toBeTruthy()
    expect(screen.getByText('Contributed return')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Methodology' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expert' }))
    const expert = sectionTitles()
    expect(expert.length).toBeGreaterThan(advanced.length)
    expect(expert).toContain('Rolling 12 months')
    expect(expert.at(-1)).toBe('Methodology')
    expect(screen.getByText('Cost in TWR')).toBeTruthy()
    // Everything Advanced showed is still there, in the same order.
    expect(expert.filter((title) => advanced.includes(title))).toEqual(advanced)
  })

  it('remembers the level chosen last', async () => {
    const first = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Expert' }))
    await waitFor(async () => expect((await db.kv.get('settings'))?.value).toContain('"analysisLevel":"expert"'))
    first.unmount()

    renderPage()
    expect(await screen.findByRole('heading', { name: 'Methodology' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Expert' }).getAttribute('aria-pressed')).toBe('true')
  })
})

/** Stands for the Dashboard: it reads and sets the same shared period. */
function PeriodProbe() {
  const { selection, setRange } = usePeriod([])
  return (
    <div>
      <output aria-label="Dashboard period">{selection.kind === 'range' ? selection.range : 'window'}</output>
      <button type="button" onClick={() => setRange('YTD')}>
        Dashboard YTD
      </button>
    </div>
  )
}

describe('AnalysisPage period', () => {
  it('shares its period with the Dashboard', async () => {
    render(
      <MemoryRouter>
        <PeriodProvider>
          <PeriodProbe />
          <AnalysisPage />
        </PeriodProvider>
      </MemoryRouter>,
    )
    const periods = await screen.findByRole('group', { name: 'Period' })
    fireEvent.click(within(periods).getByRole('button', { name: '1M' }))
    expect(screen.getByLabelText('Dashboard period').textContent).toBe('1M')

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard YTD' }))
    expect(within(screen.getByRole('group', { name: 'Period' })).getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('AnalysisPage tax rules', () => {
  it('switches to the rules of another country and keeps an own change', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: 'Taxes' }))
    const country = (await screen.findByLabelText('Tax rules of')) as HTMLSelectElement
    expect(country.value).toBe('BE')
    expect(screen.getByText(/10.00% on the net gains of a year above an exemption of €10,000, from 2026 on/)).toBeTruthy()

    fireEvent.change(country, { target: { value: 'DE' } })
    expect(await screen.findByText(/26.38% on the net gains of a year above an exemption of €1,000\./)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/Rate \(%\)/), { target: { value: '30' } })
    expect(await screen.findByText(/30.00% on the net gains/)).toBeTruthy()
    expect(screen.getByText('adjusted')).toBeTruthy()
    expect((await db.kv.get('settings'))?.value).toContain('"rate":0.3')
  })
})
