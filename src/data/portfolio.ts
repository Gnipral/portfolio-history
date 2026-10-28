import type { Capabilities, CapabilityReasons, ImportResult } from '../import/types.ts'
import type { Transaction } from '../model/transaction.ts'
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

/** Same transaction regardless of the file it came from: an overlapping export of the same broker matches. */
function signature(t: Transaction): string {
  return [t.source.broker, t.date, t.type, t.isin ?? t.product, t.quantity, t.totalEur.toFixed(2)].join('|')
}

/**
 * The transactions of `incoming` that are not stored yet. Matching counts occurrences, so two identical buys
 * on one day stay two buys when a second export repeats them, while a third one is added.
 */
export function newTransactions(stored: Transaction[], incoming: Transaction[]): Transaction[] {
  const ids = new Set(stored.map((t) => t.id))
  const left = new Map<string, number>()
  for (const t of stored) left.set(signature(t), (left.get(signature(t)) ?? 0) + 1)
  return incoming.filter((t) => {
    const key = signature(t)
    const count = left.get(key) ?? 0
    if (count > 0) {
      left.set(key, count - 1)
      return false
    }
    return !ids.has(t.id)
  })
}

function mergeCapabilities(a: ImportRecord, b: ImportResult): Pick<ImportRecord, 'capabilities' | 'missingReasons'> {
  const capabilities = { ...a.capabilities }
  const missingReasons: CapabilityReasons = {}
  for (const key of Object.keys(capabilities) as (keyof Capabilities)[]) {
    capabilities[key] ||= b.capabilities[key]
    const reason = a.missingReasons[key] ?? b.missingReasons[key]
    if (!capabilities[key] && reason) missingReasons[key] = reason
  }
  return { capabilities, missingReasons }
}

function joinBrokers(a: string, b: string): string {
  const brokers = a.split(' + ')
  return brokers.includes(b) ? a : [...brokers, b].join(' + ')
}

/**
 * Adds an import to the stored portfolio, e.g. a second broker or a newer export of the same one.
 * Transactions that are already stored are skipped. Returns how many were added.
 */
export async function addToPortfolio(
  result: ImportResult,
  files: string[],
  database: PortfolioDatabase = db,
  now: Date = new Date(),
): Promise<number> {
  return database.transaction('rw', database.transactions, database.imports, async () => {
    const current = await database.imports.get('current')
    if (!current) {
      await replacePortfolio(result, files, database, now)
      return result.transactions.length
    }
    const added = newTransactions(await database.transactions.toArray(), result.transactions)
    await database.transactions.bulkAdd(added)
    await database.imports.put({
      ...current,
      ...mergeCapabilities(current, result),
      broker: joinBrokers(current.broker, result.broker),
      files: [...current.files, ...files.filter((f) => !current.files.includes(f))],
      importedAt: now.toISOString(),
      issues: [...current.issues, ...result.issues],
    })
    return added.length
  })
}

/** Deletes the portfolio, the cached market data and the settings (including API keys) from this browser. */
export async function deleteAllData(database: PortfolioDatabase = db): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    await Promise.all(database.tables.map((table) => table.clear()))
  })
}
