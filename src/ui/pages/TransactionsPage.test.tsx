import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../data/db.ts'
import { TransactionsPage } from './TransactionsPage.tsx'

function renderPage() {
  render(
    <MemoryRouter>
      <TransactionsPage />
    </MemoryRouter>,
  )
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(async () => {
  await db.transactions.clear()
  await db.imports.clear()
})
afterEach(cleanup)

describe('TransactionsPage', () => {
  it('adds, edits and deletes a transaction by hand', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add transaction' }))
    fill('Date', '2026-03-02')
    fill('Product', 'Example World ETF')
    fill('Quantity', '4')
    fill('Price per unit', '25')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    const row = (await screen.findByText('Example World ETF')).closest('tr')!
    expect(within(row).getByText('Manual')).toBeTruthy()
    expect((await db.transactions.toArray())[0]).toMatchObject({ totalEur: -100, quantity: 4 })

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    fill('Quantity', '5')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('button', { name: 'Add transaction' })
    expect((await db.transactions.toArray())[0]).toMatchObject({ totalEur: -125, quantity: 5 })

    fireEvent.click(screen.getByRole('button', { name: /^Delete Buy Example World ETF/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await db.transactions.count()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /^Delete Buy Example World ETF/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await screen.findByText(/import a broker export/)
    expect(await db.transactions.count()).toBe(0)
  })

  it('explains what is missing', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add transaction' }))
    fill('Product', 'Example')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a quantity above 0.')
  })
})
