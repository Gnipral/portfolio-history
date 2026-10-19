import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../settings/settings.ts'
import { alphaVantageProvider, parseAlphaVantage } from './alphaVantage.ts'
import { coinGeckoProvider, parseMarketChart } from './coinGecko.ts'
import { parseTwelveData, twelveDataProvider, twelveDataUrl } from './twelveData.ts'
import { ProviderError } from './types.ts'
import { parseYahooChart, yahooProxyProvider } from './yahooProxy.ts'

const range = { from: '2026-06-30', to: '2026-07-03' }

describe('Yahoo via proxy', () => {
  // New York: gmtoffset -14400 in summer; bars stamped at the 09:30 open (13:30 UTC).
  const body = {
    chart: {
      result: [
        {
          meta: { currency: 'USD', gmtoffset: -14400 },
          timestamp: [1782826200, 1782912600, 1782999000, 1783085400],
          indicators: { quote: [{ close: [680, 682, null, 171.5] }] },
          events: { splits: { '1782999000': { date: 1782999000, numerator: 4, denominator: 1 } } },
        },
      ],
    },
  }

  it('parses closes and splits in exchange dates', () => {
    expect(parseYahooChart(body, range)).toEqual({
      currency: 'USD',
      closes: [
        { date: '2026-06-30', close: 680 },
        { date: '2026-07-01', close: 682 },
        { date: '2026-07-03', close: 171.5 },
      ],
      splits: [{ date: '2026-07-02', ratio: 4 }],
    })
  })

  it('reports unknown symbols', () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { description: 'No data found' } } }, range)).toThrow(
      ProviderError,
    )
  })

  it('needs the proxy URL', () => {
    expect(yahooProxyProvider.isAvailable(DEFAULT_SETTINGS)).toBe(false)
    expect(yahooProxyProvider.isAvailable({ ...DEFAULT_SETTINGS, proxyUrl: 'https://p.example' })).toBe(true)
    expect(yahooProxyProvider.supports('crypto:bitcoin', 'crypto')).toBe(false)
  })
})

describe('Twelve Data', () => {
  it('builds the request with the MIC for non-US symbols', () => {
    const url = new URL(twelveDataUrl('ASML.AS', range, 'key'))
    expect(url.searchParams.get('symbol')).toBe('ASML')
    expect(url.searchParams.get('mic_code')).toBe('XAMS')
    expect(new URL(twelveDataUrl('AAPL', range, 'key')).searchParams.has('mic_code')).toBe(false)
  })

  it('parses values and errors', () => {
    expect(
      parseTwelveData({
        status: 'ok',
        meta: { currency: 'EUR' },
        values: [
          { datetime: '2026-07-02', close: '925.5' },
          { datetime: '2026-07-01', close: '920' },
        ],
      }),
    ).toEqual({
      currency: 'EUR',
      closes: [
        { date: '2026-07-01', close: 920 },
        { date: '2026-07-02', close: 925.5 },
      ],
      splits: [],
    })
    expect(() => parseTwelveData({ status: 'error', code: 404, message: 'symbol not found' })).toThrow('symbol not found')
  })

  it('supports only symbols with a known exchange', () => {
    expect(twelveDataProvider.supports('ASML.AS', 'security')).toBe(true)
    expect(twelveDataProvider.supports('X.ZZ', 'security')).toBe(true) // ".ZZ" is not a suffix: treated as US ticker
  })
})

describe('Alpha Vantage', () => {
  it('parses the daily series within the range', () => {
    const body = {
      'Time Series (Daily)': {
        '2026-07-02': { '4. close': '10.5' },
        '2026-06-01': { '4. close': '9' },
      },
    }
    expect(parseAlphaVantage(body, range, 'USD').closes).toEqual([{ date: '2026-07-02', close: 10.5 }])
  })

  it('turns plan messages into errors', () => {
    expect(() => parseAlphaVantage({ Information: 'premium endpoint' }, range, 'USD')).toThrow('premium endpoint')
  })

  it('supports US, London and Xetra symbols', () => {
    expect(alphaVantageProvider.supports('AAPL', 'security')).toBe(true)
    expect(alphaVantageProvider.supports('RHM.DE', 'security')).toBe(true)
    expect(alphaVantageProvider.supports('ASML.AS', 'security')).toBe(false)
  })
})

describe('CoinGecko', () => {
  it('keeps the last price of each UTC day', () => {
    const body = {
      prices: [
        [Date.UTC(2026, 6, 1, 0), 100],
        [Date.UTC(2026, 6, 1, 23), 110],
        [Date.UTC(2026, 6, 2, 12), 120],
      ] as [number, number][],
    }
    expect(parseMarketChart(body, range)).toEqual({
      currency: 'EUR',
      closes: [
        { date: '2026-07-01', close: 110 },
        { date: '2026-07-02', close: 120 },
      ],
      splits: [],
    })
  })

  it('handles only crypto symbols', () => {
    expect(coinGeckoProvider.supports('crypto:bitcoin', 'crypto')).toBe(true)
    expect(coinGeckoProvider.supports('AAPL', 'security')).toBe(false)
  })
})
