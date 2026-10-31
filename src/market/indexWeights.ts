import { fetchJson } from './http.ts'
import { dataUrl } from './staticData.ts'

/** A constituent of the MSCI World ETF, as written by scripts/snapshot-data.ts. */
export interface IndexHolding {
  ticker: string
  name: string
  /** ISO 3166 code of where iShares locates the company. */
  country?: string
  /** Share of the fund, 0 to 1. */
  weight: number
}

export interface IndexWeights {
  asOf: string
  source: string
  holdings: IndexHolding[]
}

export const INDEX_WEIGHTS_FILE = 'msci-world-weights.json'

/**
 * The current MSCI World weights from public/data, or null when the file is missing or unreadable
 * (before the first snapshot that wrote it, or offline before it was cached): the UI then hides the column.
 */
export async function loadIndexWeights(load: (file: string) => Promise<unknown> = (file) => fetchJson(dataUrl(file))): Promise<IndexWeights | null> {
  try {
    const file = (await load(INDEX_WEIGHTS_FILE)) as Partial<IndexWeights> | null
    if (!file || typeof file.asOf !== 'string' || !Array.isArray(file.holdings) || file.holdings.length === 0) return null
    return file as IndexWeights
  } catch {
    return null
  }
}
