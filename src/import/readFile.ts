import Papa from 'papaparse'
import { readPdf } from './readPdf.ts'
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

/** Flex Query sections that become a table each, named after their section. */
const FLEX_SECTIONS: Record<string, string> = {
  Trade: 'Trades',
  CashTransaction: 'Cash Transactions',
  CorporateAction: 'Corporate Actions',
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, name: string) => {
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16))
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)))
    return XML_ENTITIES[name] ?? entity
  })
}

/**
 * Interactive Brokers Flex Query XML: one table per section, with the attribute names as header row,
 * so the Flex CSV adapter reads both formats. Several statements (accounts) end up in the same tables.
 */
export function readFlexXml(fileName: string, text: string): RawTable[] {
  const sections = new Map<string, Record<string, string>[]>()
  for (const element of text.matchAll(/<(\w+)\s([^<>]*?)\/?>/g)) {
    const sheetName = FLEX_SECTIONS[element[1] as string]
    if (!sheetName) continue
    const attributes: Record<string, string> = {}
    for (const [, name, value] of (element[2] as string).matchAll(/([\w:.-]+)="([^"]*)"/g)) attributes[name as string] = decodeXml(value as string)
    sections.set(sheetName, [...(sections.get(sheetName) ?? []), attributes])
  }
  if (sections.size === 0) return [{ fileName, rows: [] }]
  return [...sections].map(([sheetName, elements]) => {
    const header = [...new Set(elements.flatMap((e) => Object.keys(e)))]
    const rows = elements.map((e) => header.map((name): Cell => e[name] || null))
    return { fileName, sheetName, rows: [header, ...rows] }
  })
}

export async function readTables(fileName: string, data: ArrayBuffer): Promise<RawTable[]> {
  if (SPREADSHEET_EXTENSIONS.includes(extension(fileName))) return readSpreadsheet(fileName, data)
  if (extension(fileName) === '.xml') return readFlexXml(fileName, decodeText(data))
  if (extension(fileName) === '.pdf') return readPdf(fileName, data)
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
