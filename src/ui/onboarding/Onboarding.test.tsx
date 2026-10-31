import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/db.ts'
import { loadSettings } from '../../settings/settings.ts'
import { DashboardPage } from '../pages/DashboardPage.tsx'

vi.mock('../dashboard/PortfolioChart.tsx', () => ({ PortfolioChart: () => null }))

const FLAG = 'portfolio-history:onboarded'

beforeEach(async () => {
  localStorage.clear()
  await Promise.all([db.transactions.clear(), db.kv.clear(), db.imports.clear()])
})
afterEach(cleanup)

function renderDashboard() {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/import" element={<h2>Import page</h2>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Onboarding', () => {
  it('welcomes a first visit without data, step by step', async () => {
    renderDashboard()
    expect(await screen.findByRole('heading', { name: 'See what your portfolio really did' })).toBeTruthy()
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const heading = screen.getByRole('heading', { name: 'Make it yours' })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText('Step 2 of 3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'See what your portfolio really did' })).toBeTruthy()
  })

  it('saves the currency chosen', async () => {
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    fireEvent.change(screen.getByRole('combobox', { name: /Currency/ }), { target: { value: 'USD' } })
    await vi.waitFor(async () => expect((await loadSettings()).baseCurrency).toBe('USD'))
  })

  it('is skipped for good with Skip', async () => {
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    expect(localStorage.getItem(FLAG)).toBe('1')
    expect(await screen.findByText(/No portfolio loaded yet/)).toBeTruthy()
  })

  it('marks itself as seen when a start is chosen', async () => {
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: /Import my broker export/ }))
    expect(localStorage.getItem(FLAG)).toBe('1')
    expect(await screen.findByRole('heading', { name: 'Import page' })).toBeTruthy()
  })

  it('stays away once seen', async () => {
    localStorage.setItem(FLAG, '1')
    renderDashboard()
    expect(await screen.findByText(/No portfolio loaded yet/)).toBeTruthy()
    expect(screen.queryByText('Step 1 of 3')).toBeNull()
  })
})
