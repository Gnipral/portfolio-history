import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../data/db.ts'
import { degiroAdapter } from '../../import/adapters/degiro/index.ts'
import { SAMPLE_ROWS, table } from '../../import/adapters/degiro/fixtures.ts'
import { loadSettings, saveSettings } from '../../settings/settings.ts'
import { PricesPage } from './PricesPage.tsx'

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.symbols.clear(), db.kv.clear()])
  await db.transactions.bulkAdd(degiroAdapter.parse([table(SAMPLE_ROWS)]).transactions)
})
afterEach(cleanup)

function renderPage() {
  render(
    <MemoryRouter>
      <PricesPage />
    </MemoryRouter>,
  )
}

describe('PricesPage', () => {
  it('switches a product off and on for every figure', async () => {
    renderPage()
    const box = (await screen.findByLabelText('Count EXAMPLE INDUSTRIES CORP')) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    await screen.findByText('not counted')
    const key = (await loadSettings()).excludedInstruments
    expect(key).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Count EXAMPLE INDUSTRIES CORP'))
    await waitFor(async () => expect((await loadSettings()).excludedInstruments).toEqual([]))
  })

  it('lists instruments and asks for a price source when none is set', async () => {
    await saveSettings({ proxyUrl: '' })
    renderPage()
    expect(await screen.findByText('EXAMPLE INDUSTRIES CORP')).toBeTruthy()
    expect(screen.getByText(/No price source is configured yet/)).toBeTruthy()
    expect(screen.getAllByText('No symbol').length).toBeGreaterThan(0)
  })

  it('saves a manual symbol and rejects invalid input', async () => {
    renderPage()
    const row = (await screen.findByText('EXAMPLE INDUSTRIES CORP')).closest('tr') as HTMLElement
    fireEvent.click(row.querySelector('button') as HTMLButtonElement)

    const input = screen.getByLabelText('Symbol for EXAMPLE INDUSTRIES CORP')
    fireEvent.change(input, { target: { value: 'not valid!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Use a Yahoo-style symbol/)).toBeTruthy()

    fireEvent.change(input, { target: { value: 'EXI.DE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('EXI.DE', { selector: 'code' })).toBeTruthy()
    expect(await db.symbols.get('US0000000002')).toMatchObject({ symbol: 'EXI.DE', source: 'manual' })
  })
})
