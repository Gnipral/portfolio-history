import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { db, type ImportRecord, type PortfolioDatabase } from '../data/db.ts'
import type { Transaction } from '../model/transaction.ts'
import { loadSettings, saveSettings, type NamedPeriod } from '../settings/settings.ts'
import { isDemo } from '../demo/demoMode.ts'
import { deriveAccountKey, forgetAccountKey, isSealed, newSalt, open, readAccountKey, saltOf, sameSalt, seal, storeAccountKey } from './vault.ts'
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

/** The account's data is encrypted and this device does not have the key yet: the encryption password is needed. */
export class AccountLockedError extends AccountError {}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = readToken()
  const response = await fetch(`${ACCOUNT_URL}${path}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  if (response.status === 401 && token) {
    storeToken(null)
    void forgetAccountKey().catch(() => undefined)
  }
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
  await forgetAccountKey()
  storeToken(token)
}

/** Signs in with a passkey made earlier, on this device or one that shares its passkeys. */
export async function signIn(): Promise<void> {
  const { challengeId, options } = await callJson<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/login/options', {})
  const response = await startAuthentication({ optionsJSON: options })
  const { token } = await callJson<{ token: string }>('/login/verify', { challengeId, response })
  // A key of an earlier account must not encrypt the data of this one.
  await forgetAccountKey()
  storeToken(token)
}

export async function signOut(): Promise<void> {
  await call('/logout', { method: 'POST' }).catch(() => undefined)
  await forgetAccountKey()
  storeToken(null)
}

export async function deleteAccount(): Promise<void> {
  await callJson('/account', undefined, 'DELETE')
  await forgetAccountKey()
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

/** The saved bytes of the account, or null when nothing is saved yet. */
async function fetchSaved(): Promise<{ bytes: Uint8Array<ArrayBuffer>; updatedAt: string | null } | null> {
  const response = await call('/data', { method: 'GET' })
  if (response.status === 404) return null
  if (!response.ok) throw new AccountError(t('Loading failed'))
  return { bytes: new Uint8Array(await response.arrayBuffer()), updatedAt: response.headers.get('X-Updated-At') }
}

/**
 * Whether this device can save and load: `unlocked` with the key stored here, `existing` when the account
 * holds data encrypted with a password chosen before, `new` when a password still has to be chosen.
 */
export async function accountKeyState(database: PortfolioDatabase = db): Promise<'unlocked' | 'existing' | 'new'> {
  if (await readAccountKey(database)) return 'unlocked'
  const saved = await fetchSaved()
  return saved && isSealed(saved.bytes) ? 'existing' : 'new'
}

/**
 * Derives the key from the encryption password and keeps it on this device. With data already encrypted
 * in the account the password must open it; otherwise it becomes the password of the account.
 */
export async function unlockAccount(password: string, database: PortfolioDatabase = db): Promise<void> {
  const saved = await fetchSaved()
  if (saved && isSealed(saved.bytes)) {
    const key = await deriveAccountKey(password, saltOf(saved.bytes))
    if (!(await open(saved.bytes, key.key))) throw new AccountError(t('Wrong encryption password.'))
    await storeAccountKey(key, database)
    return
  }
  await storeAccountKey(await deriveAccountKey(password, newSalt()), database)
}

/** Saves the portfolio and periods of this browser to the account, encrypted; answers when it was saved. */
export async function saveToAccount(database: PortfolioDatabase = db): Promise<string> {
  const key = await readAccountKey(database)
  if (!key) throw new AccountLockedError(t('Enter your encryption password first.'))
  const [transactions, importRecord, settings] = await Promise.all([database.transactions.toArray(), database.imports.get('current'), loadSettings(database)])
  const body = await seal(await packData({ v: 1, transactions, importRecord: importRecord ?? null, periods: settings.periods }), key)
  const response = await call('/data', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body })
  const answer = (await response.json().catch(() => ({}))) as { updatedAt?: string; error?: string }
  if (!response.ok || !answer.updatedAt) throw new AccountError(answer.error ?? t('Saving failed'))
  storeKnown(answer.updatedAt)
  return answer.updatedAt
}

/** Replaces the portfolio and periods of this browser with those of the account. */
export async function loadFromAccount(database: PortfolioDatabase = db): Promise<{ transactions: number }> {
  const saved = await fetchSaved()
  if (!saved) throw new AccountError(t('Nothing is saved in this account yet'))
  const { bytes, updatedAt } = saved
  let plain = bytes
  // Data saved before the encryption is plain; the next save encrypts it.
  if (isSealed(bytes)) {
    const key = await readAccountKey(database)
    if (!key || !sameSalt(key.salt, saltOf(bytes))) throw new AccountLockedError(t('Enter your encryption password first.'))
    const opened = await open(bytes, key.key)
    if (!opened) throw new AccountLockedError(t('Enter your encryption password first.'))
    plain = opened
  }
  const data = await unpackData(plain)
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
 * device is never replaced unasked, and without the encryption key nothing can be saved: then nothing is
 * saved and the answer says why.
 * Other failures stay quiet; Settings can save again.
 */
export async function saveAfterChange(): Promise<{ newer: string } | { locked: true } | null> {
  if (!accountAvailable() || !readToken() || isDemo()) return null
  try {
    if (!(await readAccountKey())) return { locked: true }
    const newer = await newerInAccount()
    if (newer) return { newer }
    await saveToAccount()
  } catch {
    // Offline or signed out: the next save from Settings brings the account up to date.
  }
  return null
}
