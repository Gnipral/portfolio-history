import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
      <ThemeToggle />
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
  it('saves the cost basis method', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: /FIFO/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Saved.')
    expect((await loadSettings()).costBasis).toBe('fifo')
  })

  it('changes the theme and keeps the header toggle in sync', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText('Theme'), { target: { value: 'dark' } })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Theme: Dark' })).toBeTruthy()
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
