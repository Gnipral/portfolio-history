import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { tx } from '../engine/testing.ts'
import { loadSettings, saveSettings } from '../settings/settings.ts'
import {
  accountKeyState,
  AccountLockedError,
  loadFromAccount,
  newerInAccount,
  packData,
  readToken,
  saveToAccount,
  signOut,
  unlockAccount,
  unpackData,
} from './account.ts'
import { deriveAccountKey, isSealed, newSalt, storeAccountKey } from './vault.ts'

const period = { id: 'p1', name: 'After the crash', from: '2026-03-01', to: null }

describe('account data', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('packs the portfolio and periods small, and unpacks them again', async () => {
    const data = { v: 1 as const, transactions: Array.from({ length: 200 }, (_, i) => tx('buy', '2026-01-02', { isin: `NL${i}`, amount: 100 })), importRecord: null, periods: [period] }
    const packed = await packData(data)
    expect(packed.byteLength).toBeLessThan(JSON.stringify(data).length / 5)
    expect(await unpackData(packed)).toEqual(data)
  })

  /** The account service in memory: what it stores is all the server would see. */
  function stubService() {
    const service = { stored: null as Uint8Array<ArrayBuffer> | null }
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-123')
      if (init.method === 'PUT') {
        service.stored = new Uint8Array(await new Response(init.body).arrayBuffer())
        return Response.json({ updatedAt: '2026-10-28T12:00:00.000Z' })
      }
      expect(url).toBe('/data')
      return service.stored ? new Response(service.stored) : Response.json({ error: 'Nothing saved yet' }, { status: 404 })
    })
    localStorage.setItem('account-token', 'token-123')
    return service
  }

  it('saves this browser encrypted, and loads it into another with the same password only', async () => {
    const service = stubService()
    const here = new PortfolioDatabase('test-account-here')
    await here.transactions.bulkAdd([tx('buy', '2026-01-02', { isin: 'NL0000000001', amount: 100 }), tx('sell', '2026-02-02', { isin: 'NL0000000001', amount: 120 })])
    await saveSettings({ periods: [period] }, here)
    await expect(saveToAccount(here)).rejects.toBeInstanceOf(AccountLockedError)
    expect(await accountKeyState(here)).toBe('new')
    await unlockAccount('correct horse battery', here)
    expect(await saveToAccount(here)).toBe('2026-10-28T12:00:00.000Z')

    // The server holds no readable trace of the portfolio, also not after unzipping.
    const stored = service.stored as Uint8Array<ArrayBuffer>
    expect(isSealed(stored)).toBe(true)
    expect(new TextDecoder('latin1').decode(stored)).not.toContain('NL0000000001')
    await expect(unpackData(stored)).rejects.toThrow()

    const there = new PortfolioDatabase('test-account-there')
    await there.transactions.add(tx('buy', '2020-01-01', { isin: 'OLD', amount: 1 }))
    expect(await accountKeyState(there)).toBe('existing')
    await expect(loadFromAccount(there)).rejects.toBeInstanceOf(AccountLockedError)
    await expect(unlockAccount('wrong password!', there)).rejects.toThrow('Wrong encryption password.')
    await unlockAccount('correct horse battery', there)
    expect(await loadFromAccount(there)).toEqual({ transactions: 2 })
    expect((await there.transactions.toArray()).map((t) => t.isin)).toEqual(['NL0000000001', 'NL0000000001'])
    expect((await loadSettings(there)).periods).toEqual([period])
    await Promise.all([here.delete(), there.delete()])
  })

  it('still loads data saved before the encryption, and encrypts it on the next save', async () => {
    const service = stubService()
    service.stored = await packData({ v: 1, transactions: [tx('deposit', '2026-01-02', { amount: 50 })], importRecord: null, periods: [] })
    const here = new PortfolioDatabase('test-account-legacy')
    expect(await accountKeyState(here)).toBe('new')
    expect(await loadFromAccount(here)).toEqual({ transactions: 1 })
    await unlockAccount('a new password', here)
    await saveToAccount(here)
    expect(isSealed(service.stored)).toBe(true)
    await here.delete()
  })

  it('forgets the session on sign out, and when the service no longer knows it', async () => {
    localStorage.setItem('account-token', 'token-123')
    vi.stubGlobal('fetch', async () => Response.json({ ok: true }))
    await signOut()
    expect(readToken()).toBeNull()

    localStorage.setItem('account-token', 'expired')
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Not signed in' }, { status: 401 }))
    await expect(loadFromAccount(new PortfolioDatabase('test-account-401'))).rejects.toThrow()
    expect(readToken()).toBeNull()
  })

  it('notices data saved from another device since this browser last saved', async () => {
    let savedAt: string | null = '2026-10-01T08:00:00.000Z'
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url === '/me') return Response.json({ userId: 'u', dataUpdatedAt: savedAt })
      if (init.method === 'PUT') {
        savedAt = '2026-10-28T12:00:00.000Z'
        return Response.json({ updatedAt: savedAt })
      }
      throw new Error(`unexpected request ${url}`)
    })
    localStorage.setItem('account-token', 'token-123')
    // Saved before from elsewhere, never from here.
    expect(await newerInAccount()).toBe('2026-10-01T08:00:00.000Z')

    const here = new PortfolioDatabase('test-account-newer')
    await storeAccountKey(await deriveAccountKey('a password', newSalt()), here)
    await saveToAccount(here)
    expect(await newerInAccount()).toBeNull()

    savedAt = '2026-10-29T09:00:00.000Z'
    expect(await newerInAccount()).toBe('2026-10-29T09:00:00.000Z')
    await here.delete()
  })
})
