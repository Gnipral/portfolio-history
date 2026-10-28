import { ProviderError, type PriceProvider } from '../market/providers/types.ts'
import { DEMO_PREFIX, demoCloses, demoInstrument } from './demoPrices.ts'

/** Prices of the made-up demo instruments: computed here, no network needed. */
export const demoProvider: PriceProvider = {
  id: 'demo',
  label: 'Demo prices',
  isAvailable: () => true,
  supports: (symbol) => symbol.startsWith(DEMO_PREFIX),
  fetchDaily(symbol, range) {
    const instrument = demoInstrument(symbol)
    if (!instrument) return Promise.reject(new ProviderError('demo', `Unknown demo symbol ${symbol}`))
    return Promise.resolve({ currency: instrument.currency, closes: demoCloses(instrument, range), splits: [] })
  },
}
