import { Dexie, type EntityTable, type Table } from 'dexie'
import type { CapabilityReasons, Capabilities, ImportIssue } from '../import/types.ts'
import type { FxDay, PriceCoverage, PricePoint, SplitEvent, SymbolRecord } from '../market/types.ts'
import type { Transaction } from '../model/transaction.ts'

/** Metadata of the import currently loaded. There is at most one, with id `current`. */
export interface ImportRecord {
  id: 'current'
  broker: string
  files: string[]
  importedAt: string
  capabilities: Capabilities
  missingReasons: CapabilityReasons
  issues: ImportIssue[]
}

/** Small key/value records such as the time of the last FX check. */
export interface KeyValue {
  key: string
  value: string
}

export class PortfolioDatabase extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  imports!: EntityTable<ImportRecord, 'id'>
  prices!: Table<PricePoint, [string, string]>
  coverage!: EntityTable<PriceCoverage, 'symbol'>
  fxDays!: EntityTable<FxDay, 'date'>
  splits!: EntityTable<SplitEvent, 'id'>
  kv!: EntityTable<KeyValue, 'key'>
  symbols!: EntityTable<SymbolRecord, 'key'>

  constructor(name = 'portfolio-history') {
    super(name)
    this.version(1).stores({
      transactions: 'id, date, isin',
      imports: 'id',
    })
    // Market data is cached separately from the import and survives a new import.
    this.version(2).stores({
      prices: '[symbol+date], symbol',
      coverage: 'symbol',
      fxDays: 'date',
      splits: 'id, symbol',
      kv: 'key',
    })
    this.version(3).stores({
      symbols: 'key',
    })
    // Prices cached before splits after a sold position were fetched (#27) lack those splits.
    // Resetting the coverage makes the next update fetch every range once more; cached closes stay.
    this.version(4)
      .stores({})
      .upgrade((tx) => tx.table('coverage').clear())
  }
}

export const db = new PortfolioDatabase()
