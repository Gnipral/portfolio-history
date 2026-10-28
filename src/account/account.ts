import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { db, type ImportRecord, type PortfolioDatabase } from '../data/db.ts'
import type { Transaction } from '../model/transaction.ts'
import { loadSettings, saveSettings, type NamedPeriod } from '../settings/settings.ts'
import { isDemo } from '../demo/demoMode.ts'
import { t } from '../i18n/i18n.ts'

/**
 * The optional account (workers/account). Everything works without it; with it, the imported
 * portfolio and the saved periods are kept to open again later or on another device. Shown only
 * when the build knows the Worker's address (VITE_ACCOUNT_URL).
 */
export const ACCOUNT_URL: string = (import.meta.env.VITE_ACCOUNT_URL ?? '').replace(/\/+$/, '')

const TOKEN_KEY = 'account-token'
/** When the account's data was last saved from or loaded into this browser: newer data came from elsewhere. */
const KNOWN_KEY = 'account-known-at'

/** Fired on window when signing in or out, so every account control follows. */
export const ACCOUNT_EVENT = 'accountchange'

export function accountAvailable(): boolean {
  return ACCOUNT_URL !== ''
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function readKnown(): string | null {
  try {
    return localStorage.getItem(KNOWN_KEY)
  } catch {
    return null
  }
}

function storeKnown(updatedAt: string | null): void {
  try {
    if (updatedAt) localStorage.setItem(KNOWN_KEY, updatedAt)
    else localStorage.removeItem(KNOWN_KEY)
  } catch {
    // Without storage every save asks first, which is safe.
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(KNOWN_KEY)
    }
  } catch {
    // Without storage the session lasts until the page closes.
  }
  window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT))
}

export class AccountError extends Error {}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readToken()
  const response = await fetch(`${ACCOUNT_URL}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  if (response.status === 401 && token) storeToken(null)
  return response
}

async function callJson<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await call(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const answer = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new AccountError(answer.error ?? t('The account service answered {status}', { status: response.status }))
  return answer
}

/** Creates an account with a new passkey of this device and signs in. */
export async function createAccount(name: string): Promise<void> {
  const { challengeId, options } = await callJson<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/register/options', { name })
  const response = await startRegistration({ optionsJSON: options })
  const { token } = await callJson<{ token: string }>('/register/verify', { challengeId, response })
  storeToken(token)
}

/** Signs in with a passkey made earlier, on this device or one that shares its passkeys. */
export async function signIn(): Promise<void> {
  const { challengeId, options } = await callJson<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/login/options', {})
  const response = await startAuthentication({ optionsJSON: options })
  const { token } = await callJson<{ token: string }>('/login/verify', { challengeId, response })
  storeToken(token)
}

export async function signOut(): Promise<void> {
  await call('/logout', { method: 'POST' }).catch(() => undefined)
  storeToken(null)
}

export async function deleteAccount(): Promise<void> {
  await callJson('/account', undefined, 'DELETE')
  storeToken(null)
}

export async function accountInfo(): Promise<{ dataUpdatedAt: string | null }> {
  return callJson('/me', undefined, 'GET')
}

/** What an account keeps: the import as stored here, and the saved periods. */
export interface SavedData {
  v: 1
  transactions: Transaction[]
  importRecord: ImportRecord | null
  periods: NamedPeriod[]
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = (new Response(bytes).body as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function packData(data: SavedData): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('gzip'))
}

export async function unpackData(bytes: Uint8Array<ArrayBuffer>): Promise<SavedData> {
  const data = JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')))) as SavedData
  if (data.v !== 1 || !Array.isArray(data.transactions) || !Array.isArray(data.periods)) throw new AccountError(t('The saved data could not be read'))
  return data
}

/** Saves the portfolio and periods of this browser to the account; answers when it was saved. */
export async function saveToAccount(database: PortfolioDatabase = db): Promise<string> {
  const [transactions, importRecord, settings] = await Promise.all([database.transactions.toArray(), database.imports.get('current'), loadSettings(database)])
  const body = await packData({ v: 1, transactions, importRecord: importRecord ?? null, periods: settings.periods })
  const response = await call('/data', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body })
  const answer = (await response.json().catch(() => ({}))) as { updatedAt?: string; error?: string }
  if (!response.ok || !answer.updatedAt) throw new AccountError(answer.error ?? t('Saving failed'))
  storeKnown(answer.updatedAt)
  return answer.updatedAt
}

/** Replaces the portfolio and periods of this browser with those of the account. */
export async function loadFromAccount(database: PortfolioDatabase = db): Promise<{ transactions: number }> {
  const response = await call('/data', { method: 'GET' })
  if (response.status === 404) throw new AccountError(t('Nothing is saved in this account yet'))
  if (!response.ok) throw new AccountError(t('Loading failed'))
  const updatedAt = response.headers.get('X-Updated-At')
  const data = await unpackData(new Uint8Array(await response.arrayBuffer()))
  await database.transaction('rw', database.transactions, database.imports, async () => {
    await database.transactions.clear()
    await database.imports.clear()
    await database.transactions.bulkAdd(data.transactions)
    if (data.importRecord) await database.imports.put(data.importRecord)
  })
  await saveSettings({ periods: data.periods }, database)
  storeKnown(updatedAt)
  return { transactions: data.transactions.length }
}

/**
 * When the account holds data that this browser never saved or loaded: saved from another device since.
 * Saving now would replace it, so the app asks first.
 */
export async function newerInAccount(): Promise<string | null> {
  const { dataUpdatedAt } = await accountInfo()
  return dataUpdatedAt && dataUpdatedAt !== readKnown() ? dataUpdatedAt : null
}

/**
 * After a change to the portfolio: keep the account up to date when signed in. Data saved from another
 * device is never replaced unasked: then nothing is saved and the time of that data is returned.
 * Other failures stay quiet; Settings can save again.
 */
export async function saveAfterChange(): Promise<string | null> {
  if (!accountAvailable() || !readToken() || isDemo()) return null
  try {
    const newer = await newerInAccount()
    if (newer) return newer
    await saveToAccount()
  } catch {
    // Offline or signed out: the next save from Settings brings the account up to date.
  }
  return null
}
