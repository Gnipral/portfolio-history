import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { cacheSeconds, searchResults, yahooUrl, type Env } from './index.ts'

const env: Env = { ALLOWED_ORIGINS: 'https://gnipral.github.io, http://localhost:5173' }
const ctx = { waitUntil: () => {} }
const ORIGIN = 'https://gnipral.github.io'

function call(path: string, init: RequestInit & { origin?: string | null } = {}) {
  const { origin = ORIGIN, ...rest } = init
  const headers = new Headers(rest.headers)
  if (origin) headers.set('Origin', origin)
  return worker.fetch(new Request(`https://proxy.example.workers.dev${path}`, { ...rest, headers }), env, ctx)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('origin check', () => {
  it('rejects requests from other origins or without origin', async () => {
    expect((await call('/yahoo/chart/AAPL', { origin: 'https://evil.example' })).status).toBe(403)
    expect((await call('/yahoo/chart/AAPL', { origin: null })).status).toBe(403)
  })

  it('answers preflight requests', async () => {
    const response = await call('/openfigi/mapping', { method: 'OPTIONS', origin: 'http://localhost:5173' })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })
})

describe('rate limit', () => {
  it('refuses an address over its limit, before asking Yahoo', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const limited: Env = { ...env, LIMITER: { limit: async ({ key }) => ({ success: key !== '203.0.113.7' }) } }
    const request = new Request('https://proxy.example.workers.dev/yahoo/chart/AAPL', { headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' } })
    const response = await worker.fetch(request, limited, ctx)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(upstream).not.toHaveBeenCalled()
  })
})

describe('/yahoo/chart', () => {
  it('forwards only whitelisted parameters and adds CORS headers', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"chart":{}}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await call('/yahoo/chart/ASML.AS?period1=100&period2=200&interval=1m&extra=x')
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(await response.text()).toBe('{"chart":{}}')
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/ASML.AS?period1=100&period2=200&interval=1d&events=split',
    )
  })

  it('rejects invalid symbols and periods', async () => {
    expect((await call('/yahoo/chart/..%2Fsecret')).status).toBe(400)
    expect((await call('/yahoo/chart/AAPL?period1=abc')).status).toBe(400)
  })

  it('passes upstream errors through with CORS headers', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"chart":{"error":{}}}', { status: 404 }))
    const response = await call('/yahoo/chart/NOPE')
    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
  })

  it('reports network failures as 502', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down')
    })
    expect((await call('/yahoo/chart/AAPL')).status).toBe(502)
  })
})

describe('/openfigi/mapping', () => {
  it('forwards mapping jobs', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('[{"data":[]}]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const body = JSON.stringify([{ idType: 'ID_ISIN', idValue: 'US92537N1081' }])

    const response = await call('/openfigi/mapping', { method: 'POST', body })
    expect(response.status).toBe(200)
    const [url, init = {}] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.openfigi.com/v3/mapping')
    expect(init.body).toBe(body)
    expect(new Headers(init.headers).has('X-OPENFIGI-APIKEY')).toBe(false)
  })

  it('validates the request body', async () => {
    expect((await call('/openfigi/mapping', { method: 'POST', body: 'not json' })).status).toBe(400)
    expect((await call('/openfigi/mapping', { method: 'POST', body: '[]' })).status).toBe(400)
    const tooMany = JSON.stringify(Array.from({ length: 11 }, () => ({ idType: 'ID_ISIN', idValue: 'X' })))
    expect((await call('/openfigi/mapping', { method: 'POST', body: tooMany })).status).toBe(400)
  })
})

describe('helpers', () => {
  it('builds the upstream URL', () => {
    expect(yahooUrl('BRK-B', new URLSearchParams('period1=1&period2=2'))).toContain('/BRK-B?period1=1&period2=2')
    expect(yahooUrl('a b', new URLSearchParams())).toBeNull()
  })

  it('caches finished history longer than recent data', () => {
    const now = 1_800_000_000
    expect(cacheSeconds(String(now - 10 * 86_400), now)).toBe(7 * 86_400)
    expect(cacheSeconds(String(now), now)).toBe(3_600)
    expect(cacheSeconds(null, now)).toBe(3_600)
  })
})

describe('search', () => {
  it('keeps only quotes with a chart, and only the fields the app shows', () => {
    const results = searchResults({
      quotes: [
        { symbol: 'AAPL', longname: 'Apple Inc.', shortname: 'Apple', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
        { symbol: 'IWDA.AS', shortname: 'iShares Core MSCI World', exchDisp: 'Amsterdam', quoteType: 'ETF' },
        { symbol: 'AAPL260116C00200000', shortname: 'An option', quoteType: 'OPTION' },
        { symbol: 'bad symbol!', longname: 'Nope', quoteType: 'EQUITY' },
      ],
    })
    expect(results).toEqual([
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY' },
      { symbol: 'IWDA.AS', name: 'iShares Core MSCI World', exchange: 'Amsterdam', type: 'ETF' },
    ])
    expect(searchResults(null)).toEqual([])
  })

  it('asks Yahoo for the query and answers the trimmed list', async () => {
    const upstream = vi.fn(async () => Response.json({ quotes: [{ symbol: 'ASML.AS', longname: 'ASML Holding N.V.', exchDisp: 'Amsterdam', quoteType: 'EQUITY' }] }))
    vi.stubGlobal('fetch', upstream)
    const response = await call('/yahoo/search?q=asml')
    expect(await response.json()).toEqual({ results: [{ symbol: 'ASML.AS', name: 'ASML Holding N.V.', exchange: 'Amsterdam', type: 'EQUITY' }] })
    expect(String((upstream.mock.calls[0] as unknown[])[0])).toContain('q=asml')
    expect((await call('/yahoo/search?q=')).status).toBe(400)
  })
})
