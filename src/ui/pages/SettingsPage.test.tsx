import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../data/db.ts'
import { tx } from '../../engine/testing.ts'
import { loadSettings } from '../../settings/settings.ts'
import { ThemeToggle } from '../components/ThemeToggle.tsx'
import { SettingsPage } from './SettingsPage.tsx'

function renderPage() {
  render(
    <MemoryRouter>
      <div data-testid="header">
        <ThemeToggle />
      </div>
      <SettingsPage />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
afterEach(cleanup)

describe('SettingsPage', () => {
  it('has numbered sections with a table of contents', async () => {
    renderPage()
    const toc = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(toc).getAllByRole('link').map((a) => a.textContent)).toEqual([
      '01Display',
      '02Calculation',
      '03Benchmark',
      '04Price sources',
      '05Account',
      '06Data',
      '07Demo',
    ])
    expect(document.getElementById('account')).toBeTruthy()
  })

  it('saves a choice right away: cost basis, alpha method, decimals and launch period', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /FIFO/ }))
    await waitFor(async () => expect((await loadSettings()).costBasis).toBe('fifo'))
    fireEvent.click(screen.getByRole('radio', { name: /Geometric ratio/ }))
    await waitFor(async () => expect((await loadSettings()).alphaMethod).toBe('geometric'))
    fireEvent.click(screen.getByRole('button', { name: '4 decimals' }))
    await waitFor(async () => expect((await loadSettings()).decimals).toBe(4))
    fireEvent.click(within(screen.getByRole('group', { name: 'Default period on launch' })).getByRole('button', { name: 'YTD' }))
    await waitFor(async () => expect((await loadSettings()).launchRange).toBe('YTD'))
  })

  it('saves the risk-free rate and a second benchmark', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Risk-free rate (% a year)'), { target: { value: '3.5' } })
    await waitFor(async () => expect((await loadSettings()).riskFreeRate).toBe(3.5))
    const second = screen.getByLabelText('Second benchmark') as HTMLSelectElement
    const option = [...second.options].find((o) => o.value !== '')?.value ?? ''
    fireEvent.change(second, { target: { value: option } })
    await waitFor(async () => expect((await loadSettings()).secondBenchmarkId).toBe(option))
  })

  it('saves the price sources with their own button', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Twelve Data API key (optional)'), { target: { value: ' key ' } })
    expect((await loadSettings()).twelveDataKey).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Save price sources' }))
    await waitFor(async () => expect((await loadSettings()).twelveDataKey).toBe('key'))
  })

  it('changes the theme and keeps the header toggle in sync', async () => {
    renderPage()
    await screen.findByRole('navigation', { name: 'Sections' })
    const header = screen.getByTestId('header')
    const page = screen.getAllByRole('group', { name: 'Theme' }).find((group) => !header.contains(group)) as HTMLElement
    fireEvent.click(within(page).getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(within(header).getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows what this browser stores', async () => {
    await db.transactions.add(tx('buy', '2026-01-01', { isin: 'X', quantity: 1, amount: 10 }))
    renderPage()
    const storage = await screen.findByRole('group', { name: 'Stored in this browser' })
    await waitFor(() => expect(within(storage).getAllByText('1').length).toBeGreaterThanOrEqual(2))
  })

  it('deletes all data only after confirmation', async () => {
    await db.transactions.add(tx('buy', '2026-01-01', { isin: 'X', quantity: 1, amount: 10 }))
    await db.kv.put({ key: 'settings', value: JSON.stringify({ twelveDataKey: 'secret' }) })
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Delete all data' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await db.transactions.count()).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Delete all data' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect(await screen.findByText('All data has been deleted from this browser.')).toBeTruthy()
    expect(await db.transactions.count()).toBe(0)
    expect(await db.kv.count()).toBe(0)
  })
})
