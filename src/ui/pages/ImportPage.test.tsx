import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../data/db.ts'
import { ImportPage } from './ImportPage.tsx'

const HEADER =
  'Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID'
const ROW =
  '05-01-2026,16:44,EXAMPLE INDUSTRIES CORP,US0000000002,NSY,XNYS,10,"120,00",USD,"-1200,00",USD,"-1000,00","1,2000","-2,50","-2,00","-1004,50",order-1'

function chooseFile(name: string, content: string) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File([content], name, { type: 'text/csv' })] } })
}

function renderPage() {
  render(
    <MemoryRouter>
      <ImportPage />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await db.transactions.clear()
  await db.imports.clear()
})
afterEach(cleanup)

describe('ImportPage', () => {
  it('previews and stores a DEGIRO export', async () => {
    renderPage()
    chooseFile('Transactions.csv', `${HEADER}\n${ROW}\n`)

    expect(await screen.findByText('DEGIRO')).toBeTruthy()
    expect(screen.getByText(/Dividends: The DEGIRO Transactions export does not contain dividends/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 transactions' }))

    expect(await screen.findByText(/Imported 1 transactions/)).toBeTruthy()
    expect(await db.transactions.count()).toBe(1)
  })

  it('asks whether to add to or replace existing data', async () => {
    renderPage()
    chooseFile('Transactions.csv', `${HEADER}\n${ROW}\n`)
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 transactions' }))
    await screen.findByText(/Imported 1 transactions/)

    chooseFile('Transactions.csv', `${HEADER}\n${ROW}\n`)
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 transactions' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add to portfolio' }))
    expect(await screen.findByText(/Imported 0 transactions. Skipped 1 that were already stored./)).toBeTruthy()
    expect(await db.transactions.count()).toBe(1)

    chooseFile('Transactions.csv', `${HEADER}
${ROW}
`)
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 transactions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace data' }))
    expect(await screen.findByText(/Imported 1 transactions./)).toBeTruthy()
  })

  it('shows details for an unrecognized file', async () => {
    renderPage()
    chooseFile('bank.csv', 'Date,Description,Amount\n01-01-2026,Coffee,-3\n')
    expect(await screen.findByText('File not recognized as a supported broker export.')).toBeTruthy()
    expect(screen.getByText(/Header found: Date, Description, Amount/)).toBeTruthy()
  })
})
