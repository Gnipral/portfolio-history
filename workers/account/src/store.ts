/** A passkey of an account: only the public key, never a secret. */
export interface StoredCredential {
  id: string
  userId: string
  /** Base64url of the COSE public key. */
  publicKey: string
  counter: number
  transports: string[]
  createdAt: string
}

export interface Challenge {
  challenge: string
  /** Set for a registration: the id the new account gets. */
  userId: string | null
  expiresAt: string
}

/** Everything the Worker keeps; D1 in production, in memory in the tests. */
export interface Store {
  saveChallenge(id: string, challenge: Challenge): Promise<void>
  /** Returns the challenge once and deletes it, so it cannot be replayed. */
  takeChallenge(id: string): Promise<Challenge | null>
  createUser(id: string, createdAt: string): Promise<void>
  addCredential(credential: StoredCredential): Promise<void>
  credential(id: string): Promise<StoredCredential | null>
  updateCounter(id: string, counter: number, usedAt: string): Promise<void>
  createSession(tokenHash: string, userId: string, expiresAt: string): Promise<void>
  session(tokenHash: string): Promise<{ userId: string; expiresAt: string } | null>
  deleteSession(tokenHash: string): Promise<void>
  data(userId: string): Promise<{ body: Uint8Array; updatedAt: string } | null>
  putData(userId: string, body: Uint8Array, updatedAt: string): Promise<void>
  /** The account and everything of it: passkeys, sessions and data. */
  deleteUser(userId: string): Promise<void>
}

/** The part of Cloudflare's D1 binding the Worker uses. */
export interface D1Database {
  prepare(query: string): D1Statement
  batch(statements: D1Statement[]): Promise<unknown>
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T>(): Promise<T | null>
  run(): Promise<unknown>
}

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async saveChallenge(id: string, c: Challenge) {
    // Old challenges go when new ones come: no scheduled cleanup needed.
    await this.db.batch([
      this.db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(new Date().toISOString()),
      this.db.prepare('INSERT INTO challenges (id, challenge, user_id, expires_at) VALUES (?, ?, ?, ?)').bind(id, c.challenge, c.userId, c.expiresAt),
    ])
  }

  async takeChallenge(id: string) {
    const row = await this.db
      .prepare('DELETE FROM challenges WHERE id = ? RETURNING challenge, user_id, expires_at')
      .bind(id)
      .first<{ challenge: string; user_id: string | null; expires_at: string }>()
    return row ? { challenge: row.challenge, userId: row.user_id, expiresAt: row.expires_at } : null
  }

  async createUser(id: string, createdAt: string) {
    await this.db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').bind(id, createdAt).run()
  }

  async addCredential(c: StoredCredential) {
    await this.db
      .prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(c.id, c.userId, c.publicKey, c.counter, JSON.stringify(c.transports), c.createdAt)
      .run()
  }

  async credential(id: string) {
    const row = await this.db
      .prepare('SELECT id, user_id, public_key, counter, transports, created_at FROM credentials WHERE id = ?')
      .bind(id)
      .first<{ id: string; user_id: string; public_key: string; counter: number; transports: string; created_at: string }>()
    if (!row) return null
    return {
      id: row.id,
      userId: row.user_id,
      publicKey: row.public_key,
      counter: row.counter,
      transports: JSON.parse(row.transports) as string[],
      createdAt: row.created_at,
    }
  }

  async updateCounter(id: string, counter: number, usedAt: string) {
    await this.db.prepare('UPDATE credentials SET counter = ?, used_at = ? WHERE id = ?').bind(counter, usedAt, id).run()
  }

  async createSession(tokenHash: string, userId: string, expiresAt: string) {
    await this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, userId, expiresAt).run()
  }

  async session(tokenHash: string) {
    const row = await this.db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .first<{ user_id: string; expires_at: string }>()
    return row ? { userId: row.user_id, expiresAt: row.expires_at } : null
  }

  async deleteSession(tokenHash: string) {
    await this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
  }

  async data(userId: string) {
    const row = await this.db
      .prepare('SELECT body, updated_at FROM data WHERE user_id = ?')
      .bind(userId)
      .first<{ body: ArrayBuffer | number[]; updated_at: string }>()
    if (!row) return null
    const body = row.body instanceof ArrayBuffer ? new Uint8Array(row.body) : Uint8Array.from(row.body)
    return { body, updatedAt: row.updated_at }
  }

  async putData(userId: string, body: Uint8Array, updatedAt: string) {
    await this.db
      .prepare('INSERT INTO data (user_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at')
      .bind(userId, body, updatedAt)
      .run()
  }

  async deleteUser(userId: string) {
    // Explicit deletes: D1 only cascades with foreign keys switched on.
    await this.db.batch([
      this.db.prepare('DELETE FROM data WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM credentials WHERE user_id = ?').bind(userId),
      this.db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ])
  }
}

/** The same store in memory, for the tests. */
export class MemoryStore implements Store {
  challenges = new Map<string, Challenge>()
  users = new Map<string, string>()
  credentials = new Map<string, StoredCredential>()
  sessions = new Map<string, { userId: string; expiresAt: string }>()
  saved = new Map<string, { body: Uint8Array; updatedAt: string }>()

  async saveChallenge(id: string, c: Challenge) {
    this.challenges.set(id, c)
  }
  async takeChallenge(id: string) {
    const c = this.challenges.get(id) ?? null
    this.challenges.delete(id)
    return c
  }
  async createUser(id: string, createdAt: string) {
    this.users.set(id, createdAt)
  }
  async addCredential(c: StoredCredential) {
    this.credentials.set(c.id, c)
  }
  async credential(id: string) {
    return this.credentials.get(id) ?? null
  }
  async updateCounter(id: string, counter: number) {
    const c = this.credentials.get(id)
    if (c) c.counter = counter
  }
  async createSession(tokenHash: string, userId: string, expiresAt: string) {
    this.sessions.set(tokenHash, { userId, expiresAt })
  }
  async session(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash)
  }
  async data(userId: string) {
    return this.saved.get(userId) ?? null
  }
  async putData(userId: string, body: Uint8Array, updatedAt: string) {
    this.saved.set(userId, { body, updatedAt })
  }
  async deleteUser(userId: string) {
    this.users.delete(userId)
    this.saved.delete(userId)
    for (const [id, c] of this.credentials) if (c.userId === userId) this.credentials.delete(id)
    for (const [hash, s] of this.sessions) if (s.userId === userId) this.sessions.delete(hash)
  }
}
