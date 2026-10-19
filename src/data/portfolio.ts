import type { ImportResult } from '../import/types.ts'
import { db, type ImportRecord, type PortfolioDatabase } from './db.ts'

export async function hasPortfolio(database: PortfolioDatabase = db): Promise<boolean> {
  return (await database.transactions.count()) > 0
}

/** Replaces all imported data in one database transaction, so a failed import keeps the old data. */
export async function replacePortfolio(
  result: ImportResult,
  files: string[],
  database: PortfolioDatabase = db,
  now: Date = new Date(),
): Promise<void> {
  const record: ImportRecord = {
    id: 'current',
    broker: result.broker,
    files,
    importedAt: now.toISOString(),
    capabilities: result.capabilities,
    missingReasons: result.missingReasons,
    issues: result.issues,
  }
  await database.transaction('rw', database.transactions, database.imports, async () => {
    await database.transactions.clear()
    await database.imports.clear()
    await database.transactions.bulkAdd(result.transactions)
    await database.imports.put(record)
  })
}
