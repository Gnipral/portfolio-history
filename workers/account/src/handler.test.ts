import { describe, expect, it } from 'vitest'
import { createHandler, MAX_DATA_BYTES } from './handler.ts'
import type { Passkeys } from './passkeys.ts'
import { MemoryStore } from './store.ts'

const ORIGIN = 'https://gnipral.github.io'
const ALLOWED = `${ORIGIN},http://localhost:5173`

/**
 * Stands in for a device: a "response" is valid when it echoes the challenge it was given, and a
 * passkey's id is chosen by the test.
 */
const fakePasskeys: Passkeys = {
  registrationOptions: async () => ({ challenge: `reg-${crypto.randomUUID()}` }),
  verifyRegistration: async ({ response, challenge, rpID }) => {
    const r = response as { id: string; challenge: string }
    return r.challenge === challenge && rpID === 'gnipral.github.io' ? { id: r.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] } : null
  },
  authenticationOptions: async () => ({ challenge: `auth-${crypto.randomUUID()}` }),
  verifyAuthentication: async ({ response, challenge, credential }) => {
    const r = response as { id: string; challenge: string }
    return r.challenge === challenge && r.id === credential.id ? { newCounter: credential.counter + 1 } : null
  },
}

function setup(now = () => new Date('2026-10-28T12:00:00Z')) {
  const store = new MemoryStore()
  const handle = createHandler({ store, passkeys: fakePasskeys, now })
  const call = (method: string, path: string, { body, token, origin = ORIGIN }: { body?: unknown; token?: string; origin?: string } = {}) =>
    handle(
      new Request(`https://account.example${path}`, {
        method,
        headers: {
          Origin: origin,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body instanceof Uint8Array ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body) }),
      }),
      ALLOWED,
    )

  async function register(id = 'passkey-1'): Promise<string> {
    const start = (await (await call('POST', '/register/options', { body: { name: 'Tibo' } })).json()) as { challengeId: string; options: { challenge: string } }
    const done = await call('POST', '/register/verify', { body: { challengeId: start.challengeId, response: { id, challenge: start.options.challenge } } })
    return ((await done.json()) as { token: string }).token
  }

  async function login(id = 'passkey-1'): Promise<Response> {
    const start = (await (await call('POST', '/login/options', { body: {} })).json()) as { challengeId: string; options: { challenge: string } }
    return call('POST', '/login/verify', { body: { challengeId: start.challengeId, response: { id, challenge: start.options.challenge } } })
  }

  return { store, call, register, login }
}

describe('account worker', () => {
  it('answers only the app, and preflights with CORS', async () => {
    const { call } = setup()
    expect((await call('GET', '/me', { origin: 'https://evil.example' })).status).toBe(403)
    const preflight = await call('OPTIONS', '/data')
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Authorization')
  })

  it('creates an account with a passkey and signs in with it later', async () => {
    const { store, call, register, login } = setup()
    const token = await register()
    expect(token).toMatch(/^[\w-]{40,}$/)
    // Only a hash of the token is kept.
    expect([...store.sessions.keys()][0]).not.toBe(token)
    const me = (await (await call('GET', '/me', { token })).json()) as { userId: string; dataUpdatedAt: null }
    expect(me.dataUpdatedAt).toBeNull()

    const signedIn = await login()
    expect(signedIn.status).toBe(200)
    expect(store.credentials.get('passkey-1')?.counter).toBe(1)
    const second = ((await signedIn.json()) as { token: string }).token
    expect(((await (await call('GET', '/me', { token: second })).json()) as { userId: string }).userId).toBe(me.userId)
  })

  it('refuses a wrong answer, a used challenge and an unknown passkey', async () => {
    const { call, register, login } = setup()
    const start = (await (await call('POST', '/register/options', { body: {} })).json()) as { challengeId: string; options: { challenge: string } }
    const wrong = await call('POST', '/register/verify', { body: { challengeId: start.challengeId, response: { id: 'x', challenge: 'other' } } })
    expect(wrong.status).toBe(400)
    // The challenge is gone after one try, even a failed one.
    const replay = await call('POST', '/register/verify', { body: { challengeId: start.challengeId, response: { id: 'x', challenge: start.options.challenge } } })
    expect(replay.status).toBe(400)

    await register('passkey-1')
    expect((await login('passkey-2')).status).toBe(401)
  })

  it('lets a challenge expire', async () => {
    let time = new Date('2026-10-28T12:00:00Z').getTime()
    const { call } = setup(() => new Date(time))
    const start = (await (await call('POST', '/login/options', { body: {} })).json()) as { challengeId: string; options: { challenge: string } }
    time += 6 * 60 * 1000
    const late = await call('POST', '/login/verify', { body: { challengeId: start.challengeId, response: { id: 'x', challenge: start.options.challenge } } })
    expect(late.status).toBe(400)
  })

  it('keeps the data of the signed-in account only, and limits its size', async () => {
    const { call, register } = setup()
    const alice = await register('a')
    const bob = await register('b')
    expect((await call('GET', '/data', { token: alice })).status).toBe(404)
    expect((await call('PUT', '/data', { token: alice, body: new Uint8Array([7, 8, 9]) })).status).toBe(200)

    const saved = await call('GET', '/data', { token: alice })
    expect([...new Uint8Array(await saved.arrayBuffer())]).toEqual([7, 8, 9])
    expect(saved.headers.get('X-Updated-At')).toBe('2026-10-28T12:00:00.000Z')
    expect((await call('GET', '/data', { token: bob })).status).toBe(404)

    expect((await call('PUT', '/data', { token: alice, body: new Uint8Array(MAX_DATA_BYTES + 1) })).status).toBe(413)
    expect((await call('GET', '/data')).status).toBe(401)
    expect((await call('GET', '/data', { token: 'not-a-real-token-at-all-000' })).status).toBe(401)
  })

  it('signs out, expires sessions and deletes the whole account', async () => {
    let time = new Date('2026-10-28T12:00:00Z').getTime()
    const { store, call, register } = setup(() => new Date(time))
    const token = await register()
    await call('PUT', '/data', { token, body: new Uint8Array([1]) })

    expect((await call('POST', '/logout', { token })).status).toBe(200)
    expect((await call('GET', '/me', { token })).status).toBe(401)

    const fresh = await register('passkey-2')
    time += 91 * 24 * 60 * 60 * 1000
    expect((await call('GET', '/me', { token: fresh })).status).toBe(401)

    time = new Date('2026-10-28T12:00:00Z').getTime()
    const last = await register('passkey-3')
    expect((await call('DELETE', '/account', { token: last })).status).toBe(200)
    expect(store.credentials.has('passkey-3')).toBe(false)
    // The expired session went when it was used; the others by logout and by the deletion.
    expect(store.sessions.size).toBe(0)
  })
})

describe('simpleWebAuthn', () => {
  it('asks for a discoverable passkey of the app, with a fresh challenge', async () => {
    const { simpleWebAuthn } = await import('./passkeys.ts')
    const a = (await simpleWebAuthn.registrationOptions({ rpID: 'gnipral.github.io', userID: new Uint8Array(16), userName: 'Tibo' })) as {
      challenge: string
      rp: { id: string; name: string }
      authenticatorSelection: { residentKey: string }
    }
    const b = await simpleWebAuthn.registrationOptions({ rpID: 'gnipral.github.io', userID: new Uint8Array(16), userName: 'Tibo' })
    expect(a.rp).toEqual({ id: 'gnipral.github.io', name: 'Portfolio History' })
    expect(a.authenticatorSelection.residentKey).toBe('required')
    expect(a.challenge).not.toBe(b.challenge)
  })

  it('rejects an answer that is not a passkey answer', async () => {
    const { simpleWebAuthn } = await import('./passkeys.ts')
    expect(await simpleWebAuthn.verifyRegistration({ response: { id: 'x' }, challenge: 'c', origin: ORIGIN, rpID: 'gnipral.github.io' })).toBeNull()
  })
})

describe('rate limit', () => {
  it('refuses passkey requests beyond the limit of an address, and leaves the rest alone', async () => {
    let left = 2
    const handle = createHandler({ store: new MemoryStore(), passkeys: fakePasskeys, allow: async () => left-- > 0 })
    const post = (path: string) =>
      handle(new Request(`https://account.example${path}`, { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' }, body: '{}' }), ALLOWED)
    expect((await post('/login/options')).status).toBe(200)
    expect((await post('/login/options')).status).toBe(200)
    const refused = await post('/register/options')
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: 'Too many attempts: wait a minute' })
    expect((await post('/me')).status).toBe(404)
  })
})
