import { Dexie, type EntityTable } from 'dexie'
import type { CapabilityReasons, Capabilities, ImportIssue } from '../import/types.ts'
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

export class PortfolioDatabase extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  imports!: EntityTable<ImportRecord, 'id'>

  constructor(name = 'portfolio-history') {
    super(name)
    this.version(1).stores({
      transactions: 'id, date, isin',
      imports: 'id',
    })
  }
}

export const db = new PortfolioDatabase()
