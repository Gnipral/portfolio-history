import { round, type CloseRow } from './snapshot.ts'

const USER_AGENT = 'Mozilla/5.0 (compatible; portfolio-history-data-snapshot; +https://github.com/Gnipral/portfolio-history)'

async function fetchJson(url: string, attempts = 4): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (response.ok) return await response.json()
      lastError = new Error(`HTTP ${response.status} for ${url}`)
      if (response.status < 500 && response.status !== 429) break
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000))
  }
  throw lastError
}

/** ECB reference rates via Frankfurter, EUR base, inclusive date range. */
export async function fetchFxSeries(
  from: string,
  to: string,
  currencies: string[],
): Promise<Record<string, Record<string, number>>> {
  const url = `https://api.frankfurter.dev/v1/${from}..${to}?base=EUR&symbols=${currencies.join(',')}`
  const body = (await fetchJson(url)) as { rates?: Record<string, Record<string, number>> }
  if (!body.rates) throw new Error('Frankfurter response without rates')
  return body.rates
}

interface YahooChart {
  chart: {
    result?: {
      meta: { gmtoffset: number; currentTradingPeriod?: { regular?: { start: number; end: number } } }
      timestamp?: number[]
      indicators: { quote: { close: (number | null)[] }[]; adjclose?: { adjclose: (number | null)[] }[] }
    }[]
    error?: { description?: string } | null
  }
}

function exchangeDate(timestamp: number, gmtoffset: number): string {
  return new Date((timestamp + gmtoffset) * 1000).toISOString().slice(0, 10)
}

/**
 * Daily closes from Yahoo Finance (server side only: Yahoo does not allow browser CORS requests).
 * The bar of a trading day that is still open is skipped, so only final closes are stored.
 */
export async function fetchDailyCloses(symbol: string, from: string, now: Date = new Date()): Promise<CloseRow[]> {
  const period1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000)
  const period2 = Math.floor(now.getTime() / 1000)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`
  const body = (await fetchJson(url)) as YahooChart
  const result = body.chart.result?.[0]
  if (!result) throw new Error(`Yahoo: no data for ${symbol}: ${body.chart.error?.description ?? 'unknown error'}`)
  return parseYahooCloses(result, now)
}

export function parseYahooCloses(result: NonNullable<YahooChart['chart']['result']>[number], now: Date): CloseRow[] {
  const { gmtoffset, currentTradingPeriod } = result.meta
  const closes = result.indicators.quote[0]?.close ?? []
  const adjusted = result.indicators.adjclose?.[0]?.adjclose ?? []
  const session = currentTradingPeriod?.regular
  const openSessionDate =
    session && now.getTime() / 1000 < session.end ? exchangeDate(session.start, gmtoffset) : null

  const rows: CloseRow[] = []
  ;(result.timestamp ?? []).forEach((timestamp, i) => {
    const close = closes[i]
    if (typeof close !== 'number') return
    const date = exchangeDate(timestamp, gmtoffset)
    if (date === openSessionDate) return
    const adj = adjusted[i]
    rows.push([date, round(close, 4), round(typeof adj === 'number' ? adj : close, 4)])
  })
  return rows
}
