import { binanceAdapter } from './adapters/binance.ts'
import { bitpandaAdapter } from './adapters/bitpanda.ts'
import { bitvavoAdapter } from './adapters/bitvavo.ts'
import { boleroAdapter } from './adapters/bolero.ts'
import { coinbaseAdapter } from './adapters/coinbase.ts'
import { degiroAdapter } from './adapters/degiro/index.ts'
import { etoroAdapter } from './adapters/etoro.ts'
import { interactiveBrokersAdapter } from './adapters/interactiveBrokers.ts'
import { keytradeAdapter } from './adapters/keytrade.ts'
import { krakenAdapter } from './adapters/kraken.ts'
import { revolutAdapter } from './adapters/revolut.ts'
import { saxoAdapter } from './adapters/saxo.ts'
import { tradeRepublicAdapter } from './adapters/tradeRepublic.ts'
import { trading212Adapter } from './adapters/trading212.ts'
import { xtbAdapter } from './adapters/xtb.ts'
import type { BrokerAdapter, ImportContext, ImportResult, RawTable } from './types.ts'
import { t } from '../i18n/i18n.ts'

/** Every supported broker. Adding a broker means adding its adapter here. */
export const adapters: BrokerAdapter[] = [
  degiroAdapter,
  boleroAdapter,
  keytradeAdapter,
  saxoAdapter,
  interactiveBrokersAdapter,
  tradeRepublicAdapter,
  trading212Adapter,
  revolutAdapter,
  etoroAdapter,
  xtbAdapter,
  bitvavoAdapter,
  coinbaseAdapter,
  binanceAdapter,
  krakenAdapter,
  bitpandaAdapter,
]

const MIN_CONFIDENCE = 0.5

export interface Detection {
  table: RawTable
  adapter: BrokerAdapter | null
  confidence: number
}

export function detectTable(table: RawTable, candidates: BrokerAdapter[] = adapters): Detection {
  let best: Detection = { table, adapter: null, confidence: 0 }
  for (const adapter of candidates) {
    const confidence = adapter.detect(table)
    if (confidence > best.confidence) best = { table, adapter, confidence }
  }
  return best.confidence >= MIN_CONFIDENCE ? best : { table, adapter: null, confidence: best.confidence }
}

export class ImportError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
    /** What can be shared to get a file supported: file types and header rows only, no transactions. */
    readonly report?: string,
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

/**
 * The header row of every unrecognized spreadsheet, to report a missing broker without sharing the
 * export. File names are left out (they can hold an account number), and so are PDFs: their first
 * line is often a name or an address rather than a header.
 */
function unsupportedReport(tables: RawTable[]): string | undefined {
  const sheets = tables.filter((table) => table.text === undefined)
  if (sheets.length === 0) return undefined
  return sheets
    .map((table) => {
      const type = table.fileName.split('.').pop()?.toUpperCase() ?? '?'
      const sheet = table.sheetName ? `, sheet "${table.sheetName}"` : ''
      return `${type}${sheet}: ${likelyHeader(table.rows)?.join(' | ') ?? '(no header row found)'}`
    })
    .join('\n')
}

/**
 * The first of the top rows that looks like a header: at least three cells, all text without digits.
 * Preamble lines above it (account holder, account number, period) and data rows are never taken.
 */
function likelyHeader(rows: RawTable['rows']): string[] | undefined {
  for (const row of rows.slice(0, 20)) {
    const cells = row.filter((c) => c !== null && String(c).trim() !== '').map((c) => String(c).trim())
    if (cells.length >= 3 && cells.every((c) => typeof c === 'string' && !/\d/.test(c))) return cells
  }
  return undefined
}

function describe(table: RawTable): string {
  return table.sheetName ? `${table.fileName} (sheet "${table.sheetName}")` : table.fileName
}

export interface ImportOptions {
  /** Exchange rates for brokers that report amounts in other currencies than EUR. */
  context?: ImportContext
  candidates?: BrokerAdapter[]
}

/**
 * Detects the broker of every table and parses them with that broker's adapter.
 * All recognized tables must come from the same broker; unrecognized sheets in a recognized
 * workbook are ignored, an entirely unrecognized file is an error.
 */
export function importTables(tables: RawTable[], { context, candidates = adapters }: ImportOptions = {}): ImportResult {
  if (tables.length === 0) throw new ImportError(t('The selected file is empty.'))

  const detections = tables.map((t) => detectTable(t, candidates))
  const recognized = detections.filter((d) => d.adapter)
  const files = [...new Set(tables.map((t) => t.fileName))]
  const unrecognizedFiles = files.filter((f) => !recognized.some((d) => d.table.fileName === f))

  if (unrecognizedFiles.length > 0) {
    throw new ImportError(
      t('File not recognized as a supported broker export.'),
      unrecognizedFiles.flatMap((f) => {
        const table = tables.find((t) => t.fileName === f)
        if (table?.text !== undefined) {
          const start = table.text.split('\n').find((line) => line.trim())?.trim() ?? ''
          return [`${f}: ${t('no supported broker recognized this PDF.')}`, t('First line: {text}', { text: start || t('(no text: a scanned PDF cannot be read)') })]
        }
        const header = table?.rows[0]?.filter((c) => c !== null).join(', ') ?? ''
        return [`${f}: ${t('no supported broker matched the header row.')}`, t('Header found: {text}', { text: header || t('(empty)') })]
      }),
      unsupportedReport(tables.filter((table) => unrecognizedFiles.includes(table.fileName))),
    )
  }

  const brokers = [...new Set(recognized.map((d) => d.adapter as BrokerAdapter))]
  if (brokers.length > 1) {
    throw new ImportError(
      t('All files must come from the same broker.'),
      recognized.map((d) => `${describe(d.table)}: ${d.adapter?.label}`),
    )
  }
  const adapter = brokers[0] as BrokerAdapter
  return adapter.parse(
    recognized.map((d) => d.table),
    context,
  )
}
