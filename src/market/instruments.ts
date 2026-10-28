import type { AssetClass, Transaction } from '../model/transaction.ts'
import type { DateRange } from './types.ts'

/** Something that was held at some point and needs prices for that period. */
export interface Instrument {
  /** ISIN, or the product name when there is no ISIN. */
  key: string
  isin?: string
  ticker?: string
  product: string
  brokerExchange?: string
  assetClass: AssetClass
  kind: 'security' | 'crypto'
  /** Period with prices needed: first acquisition until the position was closed, or until today. */
  range: DateRange
  open: boolean
}

const EPSILON = 1e-9

export function instrumentKey(t: Pick<Transaction, 'isin' | 'product'>): string {
  return t.isin ?? t.product
}

export function deriveInstruments(transactions: Transaction[], today: string): Instrument[] {
  const instruments = new Map<string, Instrument & { quantity: number }>()
  const ordered = [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))

  const touch = (t: Transaction, key: string) => {
    let instrument = instruments.get(key)
    if (!instrument) {
      instrument = {
        key,
        ...(t.isin ? { isin: t.isin } : {}),
        product: t.product,
        assetClass: t.assetClass,
        kind: t.assetClass === 'crypto' ? 'crypto' : 'security',
        range: { from: t.date, to: t.date },
        open: false,
        quantity: 0,
      }
      instruments.set(key, instrument)
    }
    if (t.ticker) instrument.ticker = t.ticker
    if (t.exchange) instrument.brokerExchange = t.exchange
    instrument.product = t.product
    return instrument
  }

  for (const t of ordered) {
    const key = instrumentKey(t)
    if (t.type === 'buy' || t.type === 'transferIn') touch(t, key).quantity += t.quantity
    // Never below zero, as in the ledger: units sold beyond those bought were bought before the export starts.
    else if (t.type === 'sell' || t.type === 'transferOut') {
      const instrument = touch(t, key)
      instrument.quantity = Math.max(0, instrument.quantity - t.quantity)
    }
    else if (t.type === 'split' && t.split) {
      const from = instruments.get(t.split.fromIsin ?? key)
      if (from) from.quantity = Math.max(0, from.quantity - t.split.fromQuantity)
      touch(t, key).quantity += t.quantity
      if (from && from.key !== key) from.range.to = t.date
    } else continue
    const instrument = instruments.get(key)
    if (instrument) instrument.range.to = t.date
  }

  return [...instruments.values()]
    .map(({ quantity, ...instrument }) => {
      const open = quantity > EPSILON
      return { ...instrument, open, range: { from: instrument.range.from, to: open ? today : instrument.range.to } }
    })
    .sort((a, b) => Number(b.open) - Number(a.open) || a.product.localeCompare(b.product))
}
