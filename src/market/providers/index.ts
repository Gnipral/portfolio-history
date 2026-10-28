import { demoProvider } from '../../demo/demoProvider.ts'
import { RequestQueue } from '../queue.ts'
import { alphaVantageProvider } from './alphaVantage.ts'
import { coinGeckoProvider } from './coinGecko.ts'
import { twelveDataProvider } from './twelveData.ts'
import type { PriceProvider } from './types.ts'
import { yahooProxyProvider } from './yahooProxy.ts'

/** Tried in this order; the first available provider that supports the symbol and succeeds wins. */
export const PROVIDERS: PriceProvider[] = [demoProvider, yahooProxyProvider, twelveDataProvider, alphaVantageProvider, coinGeckoProvider]

/** One queue per provider, matching its free-plan rate limit. */
export const PROVIDER_QUEUES: Record<string, RequestQueue> = {
  'yahoo-proxy': new RequestQueue({ concurrency: 3, minIntervalMs: 250 }),
  'twelve-data': new RequestQueue({ concurrency: 1, minIntervalMs: 7_600 }),
  'alpha-vantage': new RequestQueue({ concurrency: 1, minIntervalMs: 1_500 }),
  coingecko: new RequestQueue({ concurrency: 1, minIntervalMs: 2_500 }),
  openfigi: new RequestQueue({ concurrency: 1, minIntervalMs: 2_500 }),
  demo: new RequestQueue({ concurrency: 5, minIntervalMs: 0 }),
}
