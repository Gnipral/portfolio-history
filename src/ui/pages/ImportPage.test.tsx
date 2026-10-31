import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../data/db.ts'
import { ImportPage } from './ImportPage.tsx'

const HEADER =
  'Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID'
const ROW =
  '05-01-2026,16:44,EXAMPLE INDUSTRIES CORP,US0000000002,NSY,XNYS,10,"120,00",USD,"-1200,00",USD,"-1000,00","1,2000","-2,50","-2,00","-1004,50",order-1'
const ROW_2 =
  '06-01-2026,10:00,EXAMPLE INDUSTRIES CORP,US0000000002,NSY,XNYS,5,"121,00",USD,"-605,00",USD,"-500,00","1,2100","-1,25","-2,00","-503,25",order-2'

function chooseFiles(...files: [name: string, content: string][]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: files.map(([name, content]) => new File([content], name, { type: 'text/csv' })) } })
}

function renderPage() {
  render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>,
  )
}

const importButton = (count: number) => screen.findByRole('button', { name: `Import ${count} transactions` })

beforeEach(async () => {
  await db.transactions.clear()
  await db.imports.clear()
})
afterEach(cleanup)

describe('ImportPage', () => {
  it('shows the supported brokers, the demo and manual entry only before anything is imported', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Supported brokers' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try the demo' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Enter transactions by hand' })).toBeTruthy()

    chooseFiles(['Transactions.csv', `${HEADER}\n${ROW}\n`])
    fireEvent.click(await importButton(1))
    await screen.findByText(/Imported 1 transactions/)
    expect(screen.queryByRole('heading', { name: 'Supported brokers' })).toBeNull()
  })

  it('lists every file with its broker, kind, rows and period, and checks the figures', async () => {
    renderPage()
    chooseFiles(['Transactions.csv', `${HEADER}\n${ROW}\n${ROW_2}\n`])

    const row = (await screen.findByText('Transactions.csv')).closest('tr') as HTMLElement
    expect(within(row).getByText('DEGIRO')).toBeTruthy()
    expect(within(row).getByText('Transactions')).toBeTruthy()
    expect(within(row).getByText('2')).toBeTruthy()
    expect(screen.getByText('Transactions parsed')).toBeTruthy()
    expect(screen.getByText(/Dividends: The DEGIRO Transactions export does not contain dividends/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Open positions after import' })).toBeTruthy()
  })

  it('stores a first import without asking, and discards a draft', async () => {
    renderPage()
    chooseFiles(['Transactions.csv', `${HEADER}\n${ROW}\n`])
    await importButton(1)
    expect(screen.getByText(/this import becomes your portfolio/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('button', { name: /Import \d+ transactions/ })).toBeNull()
    expect(await db.transactions.count()).toBe(0)

    chooseFiles(['Transactions.csv', `${HEADER}\n${ROW}\n`])
    fireEvent.click(await importButton(1))
    expect(await screen.findByText(/Imported 1 transactions/)).toBeTruthy()
    expect(await db.transactions.count()).toBe(1)
  })

  it('adds to the stored portfolio by default, skipping what is stored, or replaces it', async () => {
    renderPage()
    chooseFiles(['Transactions.csv', `${HEADER}\n${ROW}\n`])
    fireEvent.click(await importButton(1))
    await screen.findByText(/Imported 1 transactions/)

    // A newer export repeats the first row and adds one: only the new one is added.
    chooseFiles(['Transactions.csv', `${HEADER}\n${ROW}\n${ROW_2}\n`])
    await importButton(2)
    const add = screen.getByRole('radio', { name: /Add to portfolio/ }) as HTMLInputElement
    expect(add.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 transactions' }))
    expect(await screen.findByText(/Imported 1 transactions. Skipped 1 that were already stored./)).toBeTruthy()
    expect(await db.transactions.count()).toBe(2)

    chooseFiles(['Transactions.csv', `${HEADER}\n${ROW}\n`])
    await importButton(1)
    fireEvent.click(screen.getByRole('radio', { name: /Replace data/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 transactions' }))
    expect(await screen.findByText(/Imported 1 transactions\./)).toBeTruthy()
    expect(await db.transactions.count()).toBe(1)
  })

  it('reads files chosen one after the other together, and removes one again', async () => {
    renderPage()
    chooseFiles(['January.csv', `${HEADER}\n${ROW}\n`])
    await importButton(1)
    chooseFiles(['February.csv', `${HEADER}\n${ROW_2}\n`])
    await importButton(2)
    expect(screen.getByText('January.csv')).toBeTruthy()
    expect(screen.getByText('February.csv')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove January.csv' }))
    await importButton(1)
    expect(screen.queryByText('January.csv')).toBeNull()
  })

  it('shows details for an unrecognized file', async () => {
    renderPage()
    chooseFiles(['bank.csv', 'Date,Description,Amount\n01-01-2026,Coffee,-3\n'])
    expect(await screen.findByText('File not recognized as a supported broker export.')).toBeTruthy()
    expect(screen.getByText(/Header found: Date, Description, Amount/)).toBeTruthy()
    expect(screen.getByText('CSV: Date | Description | Amount')).toBeTruthy()
    const report = screen.getByRole('link', { name: 'Report on GitHub' }).getAttribute('href') ?? ''
    expect(new URL(report).searchParams.get('body')).toContain('CSV: Date | Description | Amount')
    expect(report).not.toContain('Coffee')
  })
})
