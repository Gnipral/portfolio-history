import { parseDate } from '../parse.ts'
import type { BrokerAdapter, Capabilities, CapabilityReasons, ImportContext, ImportResult, RawTable } from '../types.ts'
import type { DateTime } from '../adapters/kit.ts'

/**
 * Shared building blocks for reading broker PDFs (contract notes and account statements). The PDF
 * text arrives one line per text line, as `readPdf` extracts it. The patterns per broker follow
 * Portfolio Performance's PDF extractors, which are tested on the same kind of text.
 */

export const ISIN = /[A-Z]{2}[A-Z0-9]{9}\d/
export const ISIN_ONLY = /^[A-Z]{2}[A-Z0-9]{9}\d$/

/** A text line and its 1-based number in the document, used as the "row" of the transaction. */
export interface Line {
  text: string
  number: number
}

/** The non-empty lines of a PDF with whitespace collapsed. */
export function textLines(table: RawTable): Line[] {
  return (table.text ?? '')
    .split(/\r?\n/)
    .map((text, i) => ({ text: text.replace(/\s+/g, ' ').trim(), number: i + 1 }))
    .filter((line) => line.text !== '')
}

/**
 * Splits the lines into blocks that each start at a line matching `start`. A block ends before the
 * next start, or before a line matching `end` when given. Lines before the first start are dropped.
 */
export function blocks(lines: Line[], start: RegExp, end?: RegExp): Line[][] {
  const result: Line[][] = []
  let current: Line[] | null = null
  for (const line of lines) {
    if (start.test(line.text)) {
      current = [line]
      result.push(current)
    } else if (current && end?.test(line.text)) {
      current = null
    } else current?.push(line)
  }
  return result
}

/** First match of `pattern` in any line. */
export function find(lines: Line[], pattern: RegExp): RegExpExecArray | null {
  for (const line of lines) {
    const match = pattern.exec(line.text)
    if (match) return match
  }
  return null
}

/** Every match of `pattern`, one per line. */
export function findAll(lines: Line[], pattern: RegExp): RegExpExecArray[] {
  return lines.flatMap((line) => {
    const match = pattern.exec(line.text)
    return match ? [match] : []
  })
}

/** Sum of the amounts in group 1 of every line matching `pattern`. */
export function sum(lines: Line[], pattern: RegExp, locale: NumberLocale): number {
  return findAll(lines, pattern).reduce((total, match) => total + (num(match[1], locale) ?? 0), 0)
}

/** `de` writes 1.234,56 (also Dutch, French, Italian); `en` writes 1,234.56; `ch` writes 1'234.56. */
export type NumberLocale = 'de' | 'en' | 'ch'

/** Parses a number in the given notation; undefined for anything else. */
export function num(text: string | undefined, locale: NumberLocale): number | undefined {
  if (text === undefined) return undefined
  let value = text.replace(/[\s ]/g, '')
  if (locale === 'de') value = value.replace(/\./g, '').replace(',', '.')
  else value = value.replace(/[,']/g, '')
  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) return undefined
  return Number(value)
}

/** `31/12/2025`, `31.12.2025`, `31-12-2025`, `2025-12-31` → `2025-12-31`; `31.12.25` assumes 20xx. */
export function day(text: string | undefined): string | null {
  if (!text) return null
  const short = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/.exec(text)
  return parseDate(short ? `${short[1]}.${short[2]}.20${short[3]}` : text)
}

/** Date with an optional `HH:mm[:ss]` time. */
export function at(date: string | undefined, time?: string): DateTime | null {
  const parsed = day(date)
  if (!parsed) return null
  const hm = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null
  return { date: parsed, time: hm ? `${hm[1]?.padStart(2, '0')}:${hm[2]}` : '00:00' }
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1, janvier: 1, januar: 1, ene: 1, enero: 1, gen: 1, gennaio: 1,
  feb: 2, february: 2, februari: 2, fevrier: 2, février: 2, februar: 2, febrero: 2, febbraio: 2,
  mar: 3, march: 3, mrt: 3, maart: 3, mars: 3, märz: 3, marz: 3, mär: 3, marzo: 3,
  apr: 4, april: 4, avril: 4, abr: 4, abril: 4, aprile: 4,
  may: 5, mei: 5, mai: 5, mayo: 5, mag: 5, maggio: 5,
  jun: 6, june: 6, juni: 6, juin: 6, junio: 6, giu: 6, giugno: 6,
  jul: 7, july: 7, juli: 7, juillet: 7, julio: 7, lug: 7, luglio: 7,
  aug: 8, august: 8, augustus: 8, août: 8, aout: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septembre: 9, septiembre: 9, set: 9, settembre: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, octobre: 10, octubre: 10, ott: 10, ottobre: 10,
  nov: 11, november: 11, novembre: 11, noviembre: 11,
  dec: 12, december: 12, décembre: 12, decembre: 12, dez: 12, dezember: 12, dic: 12, diciembre: 12, dicembre: 12,
}

/** `15 Jan 2025`, `15 januari 2025`, `Jan 15, 2025` → `2025-01-15`. */
export function wordDate(text: string): string | null {
  const dayFirst = /^(\d{1,2})\.? ([\p{L}]+)\.? (\d{4})$/u.exec(text.trim())
  const monthFirst = /^([\p{L}]+)\.? (\d{1,2}),? (\d{4})$/u.exec(text.trim())
  const [d, m, y] = dayFirst ? [dayFirst[1], dayFirst[2], dayFirst[3]] : monthFirst ? [monthFirst[2], monthFirst[1], monthFirst[3]] : []
  const month = m ? MONTHS[m.toLowerCase()] : undefined
  if (!month || !d || !y) return null
  return parseDate(`${y}-${String(month).padStart(2, '0')}-${d.padStart(2, '0')}`)
}

/** Reads the PDFs of one broker. */
export interface PdfReader {
  /** Confidence between 0 and 1 that this PDF text comes from the broker. */
  detect(text: string): number
  parse(tables: RawTable[], context?: ImportContext): ImportResult
}

/**
 * Extends a broker adapter with PDF support: PDF texts go to `reader`, spreadsheets and CSV files to
 * the adapter, and the results are merged, so a statement PDF can be imported next to a CSV export.
 */
export function withPdf(adapter: BrokerAdapter, reader: PdfReader): BrokerAdapter {
  return {
    ...adapter,
    detect: (table) => (table.text === undefined ? adapter.detect(table) : reader.detect(table.text)),
    parse(tables, context) {
      const pdfs = tables.filter((t) => t.text !== undefined)
      const grids = tables.filter((t) => t.text === undefined)
      const results = [...(grids.length ? [adapter.parse(grids, context)] : []), ...(pdfs.length ? [reader.parse(pdfs, context)] : [])]
      return merge(results)
    },
  }
}

function merge(results: ImportResult[]): ImportResult {
  const [first, ...rest] = results as [ImportResult, ...ImportResult[]]
  if (rest.length === 0) return first
  const capabilities = { ...first.capabilities }
  for (const r of rest) for (const key of Object.keys(capabilities) as (keyof Capabilities)[]) capabilities[key] ||= r.capabilities[key]
  const missingReasons: CapabilityReasons = {}
  for (const key of Object.keys(capabilities) as (keyof Capabilities)[]) {
    const reason = results.find((r) => r.missingReasons[key])?.missingReasons[key]
    if (!capabilities[key] && reason) missingReasons[key] = reason
  }
  const transactions = results.flatMap((r) => r.transactions).sort((a, b) => a.dateTime.localeCompare(b.dateTime))
  return { broker: first.broker, transactions, issues: results.flatMap((r) => r.issues), capabilities, missingReasons }
}
