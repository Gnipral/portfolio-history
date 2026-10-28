import type { SymbolRecord } from '../market/types.ts'
import type { Transaction } from '../model/transaction.ts'
import { loadSettings, saveSettings, type Settings } from '../settings/settings.ts'
import { db, type ImportRecord, type PortfolioDatabase } from './db.ts'

const APP = 'portfolio-history'
const ITERATIONS = 600_000

/** Everything that cannot be fetched again: the portfolio, the ticker choices and the settings. */
export interface BackupData {
  transactions: Transaction[]
  importRecord: ImportRecord | null
  symbols: SymbolRecord[]
  settings: Settings
}

interface PlainFile {
  app: typeof APP
  v: 1
  createdAt: string
  data: BackupData
}

interface EncryptedFile {
  app: typeof APP
  v: 1
  createdAt: string
  encrypted: { salt: string; iv: string; iterations: number; data: string }
}

export class BackupError extends Error {}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function collectBackup(database: PortfolioDatabase = db): Promise<BackupData> {
  const [transactions, importRecord, symbols, settings] = await Promise.all([
    database.transactions.toArray(),
    database.imports.get('current'),
    database.symbols.toArray(),
    loadSettings(database),
  ])
  return { transactions, importRecord: importRecord ?? null, symbols, settings }
}

/** The backup as file text; with a password the data is encrypted with AES-GCM. */
export async function backupText(data: BackupData, password = '', now = new Date()): Promise<string> {
  const createdAt = now.toISOString()
  if (!password) return JSON.stringify({ app: APP, v: 1, createdAt, data } satisfies PlainFile)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, ITERATIONS)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)))
  const encrypted = { salt: toBase64(salt), iv: toBase64(iv), iterations: ITERATIONS, data: toBase64(new Uint8Array(cipher)) }
  return JSON.stringify({ app: APP, v: 1, createdAt, encrypted } satisfies EncryptedFile)
}

/** Whether a backup file needs a password; throws when it is no backup of this app. */
export function backupNeedsPassword(text: string): boolean {
  return 'encrypted' in parseFile(text)
}

function parseFile(text: string): PlainFile | EncryptedFile {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    throw new BackupError('This is not a Portfolio History backup.')
  }
  if (typeof file !== 'object' || file === null || (file as { app?: unknown }).app !== APP) throw new BackupError('This is not a Portfolio History backup.')
  if ((file as { v?: unknown }).v !== 1) throw new BackupError('This backup was made by a newer version of the app. Reload to update first.')
  return file as PlainFile | EncryptedFile
}

export async function readBackup(text: string, password = ''): Promise<BackupData> {
  const file = parseFile(text)
  let data: BackupData
  if ('encrypted' in file) {
    if (!password) throw new BackupError('This backup is protected with a password.')
    const { salt, iv, iterations, data: cipher } = file.encrypted
    try {
      const key = await deriveKey(password, fromBase64(salt), iterations)
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(cipher))
      data = JSON.parse(new TextDecoder().decode(plain)) as BackupData
    } catch {
      throw new BackupError('Wrong password.')
    }
  } else {
    data = file.data
  }
  if (!Array.isArray(data?.transactions) || !Array.isArray(data.symbols) || typeof data.settings !== 'object') {
    throw new BackupError('The backup is damaged.')
  }
  return data
}

/** Replaces the portfolio, ticker choices and settings of this browser; cached prices and rates stay. */
export async function restoreBackup(data: BackupData, database: PortfolioDatabase = db): Promise<void> {
  await database.transaction('rw', database.transactions, database.imports, database.symbols, async () => {
    await Promise.all([database.transactions.clear(), database.imports.clear(), database.symbols.clear()])
    await database.transactions.bulkAdd(data.transactions)
    if (data.importRecord) await database.imports.put(data.importRecord)
    await database.symbols.bulkPut(data.symbols)
  })
  await saveSettings(data.settings, database)
}

export function backupFileName(now = new Date()): string {
  return `portfolio-history-backup-${now.toISOString().slice(0, 10)}.json`
}
