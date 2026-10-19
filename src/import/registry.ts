import { degiroAdapter } from './adapters/degiro/index.ts'
import type { BrokerAdapter, ImportResult, RawTable } from './types.ts'

/** Every supported broker. Adding a broker means adding its adapter here. */
export const adapters: BrokerAdapter[] = [degiroAdapter]

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
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

function describe(table: RawTable): string {
  return table.sheetName ? `${table.fileName} (sheet "${table.sheetName}")` : table.fileName
}

/**
 * Detects the broker of every table and parses them with that broker's adapter.
 * All recognized tables must come from the same broker; unrecognized sheets in a recognized
 * workbook are ignored, an entirely unrecognized file is an error.
 */
export function importTables(tables: RawTable[], candidates: BrokerAdapter[] = adapters): ImportResult {
  if (tables.length === 0) throw new ImportError('The selected file is empty.')

  const detections = tables.map((t) => detectTable(t, candidates))
  const recognized = detections.filter((d) => d.adapter)
  const files = [...new Set(tables.map((t) => t.fileName))]
  const unrecognizedFiles = files.filter((f) => !recognized.some((d) => d.table.fileName === f))

  if (unrecognizedFiles.length > 0) {
    throw new ImportError(
      'File not recognized as a supported broker export.',
      unrecognizedFiles.flatMap((f) => {
        const table = tables.find((t) => t.fileName === f)
        const header = table?.rows[0]?.filter((c) => c !== null).join(', ') ?? ''
        return [`${f}: no supported broker matched the header row.`, `Header found: ${header || '(empty)'}`]
      }),
    )
  }

  const brokers = [...new Set(recognized.map((d) => d.adapter as BrokerAdapter))]
  if (brokers.length > 1) {
    throw new ImportError(
      'All files must come from the same broker.',
      recognized.map((d) => `${describe(d.table)}: ${d.adapter?.label}`),
    )
  }
  const adapter = brokers[0] as BrokerAdapter
  return adapter.parse(recognized.map((d) => d.table))
}
