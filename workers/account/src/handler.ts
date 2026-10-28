/**
 * Cloudflare Worker for the optional account of the app. Everything in the app works without it;
 * an account keeps the imported portfolio and the saved periods, to open them later or elsewhere.
 *
 *   POST   /register/options   start creating an account with a passkey
 *   POST   /register/verify    finish it; answers a session token
 *   POST   /login/options      start signing in with a passkey
 *   POST   /login/verify       finish it; answers a session token
 *   GET    /me                 the account of the token
 *   POST   /logout             end this session
 *   DELETE /account            delete the account and all of its data
 *   GET    /data               the saved data (compressed by the app), 404 when none
 *   PUT    /data               save the data
 *
 * Only origins in ALLOWED_ORIGINS get an answer. The passkey's relying party is the host name of
 * that origin, so a passkey made on the app's site only works there.
 */
import type { Passkeys } from './passkeys.ts'
import type { D1Database, Store } from './store.ts'

/** Cloudflare's rate limiting binding: at most a set number of calls per key in a period. */
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface Env {
  /** Comma-separated origins, e.g. "https://gnipral.github.io". Local origins go in .dev.vars. */
  ALLOWED_ORIGINS: string
  DB: D1Database
  /** Limits starting and finishing a passkey ceremony per IP address (wrangler.toml). */
  AUTH_LIMITER?: RateLimit
}

export interface Deps {
  store: Store
  passkeys: Passkeys
  now?: () => Date
  /** Whether another passkey ceremony may start from this address; without it, every one may. */
  allow?: (address: string) => Promise<boolean>
}

const CHALLENGE_MS = 5 * 60 * 1000
const SESSION_MS = 90 * 24 * 60 * 60 * 1000
const MAX_JSON_BYTES = 16 * 1024
/** The compressed portfolio; D1 keeps rows up to about 2 MB. */
export const MAX_DATA_BYTES = 1_500_000

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
}

function randomId(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function allowedOrigin(request: Request, allowed: string): string | null {
  const origin = request.headers.get('Origin')
  return origin && allowed.split(',').map((o) => o.trim()).includes(origin) ? origin : null
}

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'X-Updated-At',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(status: number, body: unknown, origin: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } })
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'Too large')
  try {
    const value = JSON.parse(text) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // Falls through to the error below.
  }
  throw new HttpError(400, 'Expected a JSON object')
}

/** The routes, with their store and passkey checks given, so they can be tested. */
export function createHandler({ store, passkeys, now = () => new Date(), allow }: Deps) {
  async function challenge(id: unknown): Promise<{ challenge: string; userId: string | null }> {
    if (typeof id !== 'string') throw new HttpError(400, 'Missing challenge')
    const found = await store.takeChallenge(id)
    if (!found || found.expiresAt < now().toISOString()) throw new HttpError(400, 'The request took too long: try again')
    return found
  }

  async function startSession(userId: string): Promise<string> {
    const token = randomId()
    await store.createSession(await sha256(token), userId, new Date(now().getTime() + SESSION_MS).toISOString())
    return token
  }

  async function signedIn(request: Request): Promise<{ userId: string; tokenHash: string }> {
    const token = /^Bearer ([\w-]{20,100})$/.exec(request.headers.get('Authorization') ?? '')?.[1]
    if (!token) throw new HttpError(401, 'Not signed in')
    const tokenHash = await sha256(token)
    const session = await store.session(tokenHash)
    if (!session) throw new HttpError(401, 'Not signed in')
    if (session.expiresAt < now().toISOString()) {
      await store.deleteSession(tokenHash)
      throw new HttpError(401, 'The session has expired: sign in again')
    }
    return { userId: session.userId, tokenHash }
  }

  async function route(request: Request, origin: string): Promise<Response> {
    const { pathname } = new URL(request.url)
    const rpID = new URL(origin).hostname
    const expiresAt = () => new Date(now().getTime() + CHALLENGE_MS).toISOString()
    const key = `${request.method} ${pathname}`

    // Creating accounts and signing in write to the database without a session: limit them per address,
    // so a script cannot fill the database or use up its daily writes.
    if (allow && (pathname.startsWith('/register/') || pathname.startsWith('/login/'))) {
      if (!(await allow(request.headers.get('CF-Connecting-IP') ?? 'unknown'))) throw new HttpError(429, 'Too many attempts: wait a minute')
    }

    if (key === 'POST /register/options') {
      const body = await readJson(request)
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Portfolio History'
      const userId = randomId(16)
      const options = await passkeys.registrationOptions({ rpID, userID: fromBase64url(userId), userName: name })
      const challengeId = randomId()
      await store.saveChallenge(challengeId, { challenge: options.challenge, userId, expiresAt: expiresAt() })
      return json(200, { challengeId, options }, origin)
    }

    if (key === 'POST /register/verify') {
      const body = await readJson(request)
      const { challenge: expected, userId } = await challenge(body.challengeId)
      if (!userId) throw new HttpError(400, 'Not a registration')
      const credential = await passkeys.verifyRegistration({ response: body.response, challenge: expected, origin, rpID })
      if (!credential) throw new HttpError(400, 'The passkey could not be checked')
      if (await store.credential(credential.id)) throw new HttpError(409, 'This passkey already has an account')
      const createdAt = now().toISOString()
      await store.createUser(userId, createdAt)
      await store.addCredential({
        id: credential.id,
        userId,
        publicKey: base64url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
        createdAt,
      })
      return json(200, { token: await startSession(userId) }, origin)
    }

    if (key === 'POST /login/options') {
      const options = await passkeys.authenticationOptions({ rpID })
      const challengeId = randomId()
      await store.saveChallenge(challengeId, { challenge: options.challenge, userId: null, expiresAt: expiresAt() })
      return json(200, { challengeId, options }, origin)
    }

    if (key === 'POST /login/verify') {
      const body = await readJson(request)
      const { challenge: expected } = await challenge(body.challengeId)
      const id = (body.response as { id?: unknown } | undefined)?.id
      const stored = typeof id === 'string' ? await store.credential(id) : null
      if (!stored) throw new HttpError(401, 'Unknown passkey: create an account first')
      const result = await passkeys.verifyAuthentication({
        response: body.response,
        challenge: expected,
        origin,
        rpID,
        credential: { id: stored.id, publicKey: fromBase64url(stored.publicKey), counter: stored.counter, transports: stored.transports },
      })
      if (!result) throw new HttpError(401, 'The passkey could not be checked')
      await store.updateCounter(stored.id, result.newCounter, now().toISOString())
      return json(200, { token: await startSession(stored.userId) }, origin)
    }

    if (key === 'GET /me') {
      const { userId } = await signedIn(request)
      const data = await store.data(userId)
      return json(200, { userId, dataUpdatedAt: data?.updatedAt ?? null }, origin)
    }

    if (key === 'POST /logout') {
      const { tokenHash } = await signedIn(request)
      await store.deleteSession(tokenHash)
      return json(200, { ok: true }, origin)
    }

    if (key === 'DELETE /account') {
      const { userId } = await signedIn(request)
      await store.deleteUser(userId)
      return json(200, { ok: true }, origin)
    }

    if (key === 'GET /data') {
      const { userId } = await signedIn(request)
      const data = await store.data(userId)
      if (!data) return json(404, { error: 'Nothing saved yet' }, origin)
      return new Response(new Uint8Array(data.body), {
        headers: { 'Content-Type': 'application/octet-stream', 'X-Updated-At': data.updatedAt, 'Cache-Control': 'no-store', ...cors(origin) },
      })
    }

    if (key === 'PUT /data') {
      const { userId } = await signedIn(request)
      if (Number(request.headers.get('Content-Length') ?? 0) > MAX_DATA_BYTES) throw new HttpError(413, 'Too large to save')
      const body = new Uint8Array(await request.arrayBuffer())
      if (body.byteLength === 0) throw new HttpError(400, 'Nothing to save')
      if (body.byteLength > MAX_DATA_BYTES) throw new HttpError(413, 'Too large to save')
      const updatedAt = now().toISOString()
      await store.putData(userId, body, updatedAt)
      return json(200, { updatedAt }, origin)
    }

    throw new HttpError(404, 'Not found')
  }

  return async function handle(request: Request, allowedOrigins: string): Promise<Response> {
    const origin = allowedOrigin(request, allowedOrigins)
    if (!origin) return new Response('Forbidden', { status: 403 })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) })
    try {
      return await route(request, origin)
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message }, origin)
      return json(500, { error: 'Something went wrong' }, origin)
    }
  }
}

