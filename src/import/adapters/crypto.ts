import type { DateTime, Draft } from './kit.ts'

/** Shared rules for the crypto exchanges. */

/** Currencies that are money, not a held asset. */
export const FIAT = new Set(['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'SEK', 'NOK', 'DKK', 'CZK', 'HUF', 'AUD', 'CAD', 'JPY'])

export function isFiat(symbol: string): boolean {
  return FIAT.has(symbol.toUpperCase())
}

/** Draft fields for a coin: the ticker identifies it and CoinGecko finds its prices. */
export function coin(symbol: string, at: DateTime, row: number): Pick<Draft, 'at' | 'row' | 'product' | 'ticker' | 'assetClass'> {
  const ticker = symbol.toUpperCase()
  return { at, row, product: ticker, ticker, assetClass: 'crypto' }
}

/**
 * A conversion from one coin into another without a money value: the position and its cost
 * move to the new coin, like a split with a new identifier, so no profit is realized.
 */
export function conversion(from: string, fromQuantity: number, to: string, toQuantity: number, at: DateTime, row: number): Draft {
  return {
    ...coin(to, at, row),
    type: 'split',
    quantity: toQuantity,
    amount: 0,
    cashCurrency: 'EUR',
    split: { ratio: toQuantity / fromQuantity, fromQuantity, fromIsin: from.toUpperCase() },
  }
}
