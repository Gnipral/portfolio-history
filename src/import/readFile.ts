import Papa from 'papaparse'
import type { Cell, RawTable } from './types.ts'

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.ods']

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

function trimTrailingEmptyRows(rows: Cell[][]): Cell[][] {
  return rows.filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== ''))
}

export function readCsv(fileName: string, text: string): RawTable[] {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' })
  const rows = parsed.data.map((row) => row.map((cell): Cell => (cell === '' ? null : cell)))
  return [{ fileName, rows: trimTrailingEmptyRows(rows) }]
}

/** Reads every non-empty sheet. Numeric cells stay numbers; date cells become `YYYY-MM-DD` strings. */
export async function readSpreadsheet(fileName: string, data: ArrayBuffer): Promise<RawTable[]> {
  // SheetJS is large; load it only when a spreadsheet is imported.
  const XLSX = await import('xlsx')
  // A Uint8Array view avoids SheetJS mistaking an ArrayBuffer from another realm for text.
  const workbook = XLSX.read(new Uint8Array(data), { type: 'array', cellDates: true })
  const tables: RawTable[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
    const rows = raw.map((row) => row.map(toCell))
    const nonEmpty = trimTrailingEmptyRows(rows)
    if (nonEmpty.length > 0) tables.push({ fileName, sheetName, rows: nonEmpty })
  }
  return tables
}

function toCell(value: unknown): Cell {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  return null
}

export async function readTables(fileName: string, data: ArrayBuffer): Promise<RawTable[]> {
  if (SPREADSHEET_EXTENSIONS.includes(extension(fileName))) return readSpreadsheet(fileName, data)
  return readCsv(fileName, decodeText(data))
}

/** UTF-8, or Windows-1252 for files that are not valid UTF-8 (older Coinbase exports, Excel CSVs). */
export function decodeText(data: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return new TextDecoder('windows-1252').decode(data)
  }
}

export async function readFile(file: File): Promise<RawTable[]> {
  return readTables(file.name, await file.arrayBuffer())
}
