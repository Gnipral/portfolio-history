import { db, type PortfolioDatabase } from '../data/db.ts'

/**
 * End-to-end encryption of what the account keeps. The browser encrypts the portfolio with a key derived
 * from the user's encryption password before it leaves; the server only ever sees these sealed bytes:
 *
 *   "PHE1" · salt (16 bytes) · iv (12 bytes) · AES-GCM ciphertext
 *
 * The salt travels with the data, so another device derives the same key from the same password.
 */
const MAGIC = new TextEncoder().encode('PHE1')
const SALT_BYTES = 16
const IV_BYTES = 12
const ITERATIONS = 600_000
const KEY_ID = 'account-key'

/** The key of the account on this device, with the salt it was derived with. */
export interface AccountKey {
  key: CryptoKey
  salt: Uint8Array<ArrayBuffer>
}

/** A key that cannot be exported, even by a script on the page: it can only encrypt and decrypt. */
export async function deriveAccountKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<AccountKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  return { key, salt }
}

export function newSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES))
}

export function isSealed(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length + SALT_BYTES + IV_BYTES && MAGIC.every((b, i) => bytes[i] === b)
}

export function saltOf(sealed: Uint8Array): Uint8Array<ArrayBuffer> {
  return sealed.slice(MAGIC.length, MAGIC.length + SALT_BYTES)
}

export function sameSalt(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}

export async function seal(plain: Uint8Array<ArrayBuffer>, { key, salt }: AccountKey): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(MAGIC.length + SALT_BYTES + IV_BYTES + cipher.length)
  out.set(MAGIC, 0)
  out.set(salt, MAGIC.length)
  out.set(iv, MAGIC.length + SALT_BYTES)
  out.set(cipher, MAGIC.length + SALT_BYTES + IV_BYTES)
  return out
}

/** The plain bytes, or null when the key does not fit (a wrong password, or data changed on the way). */
export async function open(sealed: Uint8Array<ArrayBuffer>, key: CryptoKey): Promise<Uint8Array<ArrayBuffer> | null> {
  const start = MAGIC.length + SALT_BYTES
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(start, start + IV_BYTES) }, key, sealed.slice(start + IV_BYTES))
    return new Uint8Array(plain)
  } catch {
    return null
  }
}

/** Kept in IndexedDB as a CryptoKey object: the browser stores it without ever revealing its bytes. */
export async function readAccountKey(database: PortfolioDatabase = db): Promise<AccountKey | null> {
  const row = await database.secrets.get(KEY_ID)
  return row ? { key: row.key, salt: row.salt } : null
}

export async function storeAccountKey(key: AccountKey, database: PortfolioDatabase = db): Promise<void> {
  await database.secrets.put({ id: KEY_ID, ...key })
}

export async function forgetAccountKey(database: PortfolioDatabase = db): Promise<void> {
  await database.secrets.delete(KEY_ID)
}
