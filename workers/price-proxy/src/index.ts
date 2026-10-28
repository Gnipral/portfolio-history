/**
 * Cloudflare Worker that lets the browser app reach two APIs without CORS support:
 *
 *   GET  /yahoo/chart/:symbol?period1=…&period2=…   Yahoo Finance daily chart (closes and splits)
 *   POST /openfigi/mapping                         OpenFIGI ISIN → ticker mapping
 *   GET  /yahoo/search?q=…                         Yahoo Finance symbol search (stocks, ETFs, funds, indices)
 *
 * Only requests from ALLOWED_ORIGINS get CORS headers. Nothing is logged or stored apart from
 * Cloudflare's edge cache of the upstream responses.
 */

export interface Env {
  /** Comma-separated origins, e.g. "https://gnipral.github.io". Local origins go in .dev.vars. */
  ALLOWED_ORIGINS: string
  /**
   * Limits requests per IP address (wrangler.toml). The Origin check only keeps other web pages out; a
   * script can send any Origin, so this keeps the proxy from being used as a free one.
   */
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> }
  /** Optional OpenFIGI key (higher rate limit), set with `wrangler secret put OPENFIGI_API_KEY`. */
  OPENFIGI_API_KEY?: string
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const YAHOO_SEARCH = 'https://query2.finance.yahoo.com/v1/finance/search'
/** Kinds of quote that have a daily chart to compare with. */
const SEARCH_TYPES = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'])
const OPENFIGI_MAPPING = 'https://api.openfigi.com/v3/mapping'
const USER_AGENT = 'Mozilla/5.0 (compatible; portfolio-history-proxy; +https://github.com/Gnipral/portfolio-history)'
const SYMBOL = /^[A-Za-z0-9.^=_-]{1,20}$/
const MAX_FIGI_BODY_BYTES = 8 * 1024
const MAX_FIGI_JOBS = 10

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  return allowed.includes(origin) ? origin : null
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(status: number, body: unknown, origin: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...extra },
  })
}

/** Builds the upstream Yahoo URL from whitelisted parameters only. */
export function yahooUrl(symbol: string, params: URLSearchParams): string | null {
  if (!SYMBOL.test(symbol)) return null
  const period1 = params.get('period1') ?? '0'
  const period2 = params.get('period2') ?? String(Math.floor(Date.now() / 1000))
  if (!/^\d{1,11}$/.test(period1) || !/^\d{1,11}$/.test(period2)) return null
  const query = new URLSearchParams({ period1, period2, interval: '1d', events: 'split' })
  return `${YAHOO_CHART}${encodeURIComponent(symbol)}?${query}`
}

/** History that ended more than two days ago does not change; recent data is cached for an hour. */
export function cacheSeconds(period2: string | null, nowSeconds: number): number {
  const end = Number(period2 ?? nowSeconds)
  return nowSeconds - end > 2 * 86_400 ? 7 * 86_400 : 3_600
}

async function cachedFetch(
  cacheKey: string,
  upstream: () => Promise<Response>,
  ttlSeconds: number,
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = typeof caches === 'undefined' ? undefined : (caches as unknown as { default: Cache }).default
  const key = new Request(cacheKey)
  const hit = await cache?.match(key)
  if (hit) return hit
  const response = await upstream()
  if (response.ok && cache) {
    const stored = new Response(response.clone().body, response)
    stored.headers.set('Cache-Control', `public, max-age=${ttlSeconds}`)
    ctx.waitUntil(cache.put(key, stored))
  }
  return response
}

async function handleYahoo(url: URL, origin: string, ctx: ExecutionContext): Promise<Response> {
  const symbol = decodeURIComponent(url.pathname.slice('/yahoo/chart/'.length))
  const upstreamUrl = yahooUrl(symbol, url.searchParams)
  if (!upstreamUrl) return json(400, { error: 'Invalid symbol or period' }, origin)

  const ttl = cacheSeconds(url.searchParams.get('period2'), Math.floor(Date.now() / 1000))
  const response = await cachedFetch(
    upstreamUrl,
    () => fetch(upstreamUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }),
    ttl,
    ctx,
  )
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

export interface SearchResult {
  symbol: string
  name: string
  exchange: string
  type: string
}

/** Only the fields the app shows, of the kinds of quote it can chart. */
export function searchResults(body: unknown): SearchResult[] {
  const quotes = (body as { quotes?: unknown[] } | null)?.quotes
  if (!Array.isArray(quotes)) return []
  return quotes.flatMap((q) => {
    const quote = q as Record<string, unknown>
    const symbol = typeof quote.symbol === 'string' ? quote.symbol : ''
    const type = typeof quote.quoteType === 'string' ? quote.quoteType : ''
    if (!SYMBOL.test(symbol) || !SEARCH_TYPES.has(type)) return []
    const name = [quote.longname, quote.shortname, symbol].find((n): n is string => typeof n === 'string' && n.trim() !== '') as string
    const exchange = typeof quote.exchDisp === 'string' ? quote.exchDisp : typeof quote.exchange === 'string' ? quote.exchange : ''
    return [{ symbol, name: name.slice(0, 80), exchange: exchange.slice(0, 40), type }]
  })
}

async function handleSearch(url: URL, origin: string, ctx: ExecutionContext): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim()
  if (query.length < 1 || query.length > 50) return json(400, { error: 'Search for 1 to 50 characters' }, origin)
  const upstreamUrl = `${YAHOO_SEARCH}?${new URLSearchParams({ q: query, quotesCount: '10', newsCount: '0', listsCount: '0' })}`
  const response = await cachedFetch(
    upstreamUrl,
    () => fetch(upstreamUrl, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }),
    86_400,
    ctx,
  )
  if (!response.ok) return json(502, { error: `Search failed (${response.status})` }, origin)
  return json(200, { results: searchResults(await response.json()) }, origin)
}

async function handleOpenFigi(request: Request, env: Env, origin: string): Promise<Response> {
  const body = await request.text()
  if (body.length > MAX_FIGI_BODY_BYTES) return json(413, { error: 'Request too large' }, origin)
  let jobs: unknown
  try {
    jobs = JSON.parse(body)
  } catch {
    return json(400, { error: 'Invalid JSON' }, origin)
  }
  if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > MAX_FIGI_JOBS) {
    return json(400, { error: `Send 1 to ${MAX_FIGI_JOBS} mapping jobs` }, origin)
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.OPENFIGI_API_KEY) headers['X-OPENFIGI-APIKEY'] = env.OPENFIGI_API_KEY
  const response = await fetch(OPENFIGI_MAPPING, { method: 'POST', headers, body: JSON.stringify(jobs) })
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = allowedOrigin(request, env)
    if (!origin) return new Response('Forbidden', { status: 403 })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
    if (env.LIMITER && !(await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success) {
      return json(429, { error: 'Too many requests: wait a minute' }, origin, { 'Retry-After': '60' })
    }

    const url = new URL(request.url)
    try {
      if (request.method === 'GET' && url.pathname.startsWith('/yahoo/chart/')) return await handleYahoo(url, origin, ctx)
      if (request.method === 'GET' && url.pathname === '/yahoo/search') return await handleSearch(url, origin, ctx)
      if (request.method === 'POST' && url.pathname === '/openfigi/mapping') return await handleOpenFigi(request, env, origin)
      return json(404, { error: 'Not found' }, origin)
    } catch (error) {
      return json(502, { error: `Upstream request failed: ${String(error)}` }, origin)
    }
  },
}
