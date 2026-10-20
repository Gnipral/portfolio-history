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
  ) {
    super(message)
    this.name = 'ImportError'
  }
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
  return adapter.parse(
    recognized.map((d) => d.table),
    context,
  )
}
