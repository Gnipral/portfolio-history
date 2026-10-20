import type { Transaction } from '../model/transaction.ts'

export type Cell = string | number | boolean | null

/** One sheet or CSV file as a grid of cells. Row 0 is the header row. */
export interface RawTable {
  fileName: string
  sheetName?: string
  rows: Cell[][]
}

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ImportIssue {
  severity: IssueSeverity
  message: string
  file?: string
  /** 1-based row number as shown in a spreadsheet (header = row 1). */
  row?: number
}

/** Which kinds of data the imported files contain; drives which toggles are available. */
export interface Capabilities {
  transactionCosts: boolean
  fxCosts: boolean
  taxes: boolean
  dividends: boolean
  deposits: boolean
}

export type CapabilityReasons = Partial<Record<keyof Capabilities, string>>

export interface ImportResult {
  broker: string
  transactions: Transaction[]
  issues: ImportIssue[]
  capabilities: Capabilities
  /** Explanation for every capability that is false. */
  missingReasons: CapabilityReasons
}

/** What an adapter may need besides the files: exchange rates for exports without EUR amounts. */
export interface ImportContext {
  /** Converts an amount to EUR at the ECB rate of `date`; undefined when the rate is unknown. */
  toEur(amount: number, currency: string, date: string): number | undefined
}

export interface BrokerAdapter {
  id: string
  label: string
  /** Confidence between 0 and 1 that this table comes from this broker. */
  detect(table: RawTable): number
  parse(tables: RawTable[], context?: ImportContext): ImportResult
}
