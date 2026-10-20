import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { DUTCH_HEADER, SAMPLE_ROWS, table } from './adapters/degiro/fixtures.ts'
import { readSpreadsheet, readTables } from './readFile.ts'
import { ImportError, adapters, importTables } from './registry.ts'
import type { BrokerAdapter } from './types.ts'

function workbookBuffer(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return bytes
}

describe('readSpreadsheet', () => {
  it('reads an XLSX DEGIRO export with numeric cells', async () => {
    const data = workbookBuffer({ Transacties: [DUTCH_HEADER, ...SAMPLE_ROWS] })
    const tables = await readSpreadsheet('Transactions.xlsx', data)
    expect(tables).toHaveLength(1)
    expect(tables[0]?.sheetName).toBe('Transacties')
    const result = importTables(tables)
    expect(result.broker).toBe('DEGIRO')
    expect(result.transactions).toHaveLength(8)
  })

  it('turns real date cells into ISO dates', async () => {
    const data = workbookBuffer({ Sheet1: [['Date'], [new Date(2025, 6, 1)]] })
    const [sheet] = await readSpreadsheet('dates.xlsx', data)
    expect(sheet?.rows[1]?.[0]).toBe('2025-07-01')
  })

  it('chooses the reader by file extension', async () => {
    const csv = new TextEncoder().encode('﻿a,b\n1,2\n').buffer as ArrayBuffer
    expect((await readTables('x.CSV', csv))[0]?.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('importTables', () => {
  it('throws a detailed error for unknown files', () => {
    try {
      importTables([{ fileName: 'bank.csv', rows: [['Date', 'Description', 'Amount']] }])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError)
      expect((error as ImportError).details.join('\n')).toContain('Date, Description, Amount')
    }
  })

  it('throws for an empty selection', () => {
    expect(() => importTables([])).toThrow(ImportError)
  })

  it('ignores unrecognized extra sheets in a recognized workbook', () => {
    const result = importTables([
      table(SAMPLE_ROWS),
      { fileName: 'Transactions.csv', sheetName: 'Notes', rows: [['just some notes']] },
    ])
    expect(result.transactions).toHaveLength(8)
  })

  it('rejects files from different brokers', () => {
    const other: BrokerAdapter = {
      id: 'other',
      label: 'Other broker',
      detect: (t) => (t.rows[0]?.[0] === 'OTHER' ? 1 : 0),
      parse: () => {
        throw new Error('not used')
      },
    }
    expect(() =>
      importTables(
        [table(SAMPLE_ROWS), { fileName: 'other.csv', rows: [['OTHER']] }],
        { candidates: [other, ...adapters] },
      ),
    ).toThrow('same broker')
  })
})

