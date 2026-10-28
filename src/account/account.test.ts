import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { tx } from '../engine/testing.ts'
import { loadSettings, saveSettings } from '../settings/settings.ts'
import { loadFromAccount, packData, readToken, saveToAccount, signOut, unpackData } from './account.ts'

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

  it('saves this browser to the account and loads it into another', async () => {
    let stored: Uint8Array<ArrayBuffer> | null = null
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token-123')
      if (init.method === 'PUT') {
        stored = new Uint8Array(await new Response(init.body).arrayBuffer())
        return Response.json({ updatedAt: '2026-10-28T12:00:00.000Z' })
      }
      expect(url).toBe('/data')
      return stored ? new Response(stored) : Response.json({ error: 'Nothing saved yet' }, { status: 404 })
    })
    localStorage.setItem('account-token', 'token-123')

    const here = new PortfolioDatabase('test-account-here')
    await here.transactions.bulkAdd([tx('buy', '2026-01-02', { isin: 'NL1', amount: 100 }), tx('sell', '2026-02-02', { isin: 'NL1', amount: 120 })])
    await saveSettings({ periods: [period] }, here)
    expect(await saveToAccount(here)).toBe('2026-10-28T12:00:00.000Z')

    const there = new PortfolioDatabase('test-account-there')
    await there.transactions.add(tx('buy', '2020-01-01', { isin: 'OLD', amount: 1 }))
    expect(await loadFromAccount(there)).toEqual({ transactions: 2 })
    expect((await there.transactions.toArray()).map((t) => t.isin)).toEqual(['NL1', 'NL1'])
    expect((await loadSettings(there)).periods).toEqual([period])
    await Promise.all([here.delete(), there.delete()])
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
})
