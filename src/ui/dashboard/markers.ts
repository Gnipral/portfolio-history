import type { Transaction } from '../../model/transaction.ts'

/** What the chart marks on a day: money in, a buy, a sale or a dividend. */
export type MarkerKind = 'deposit' | 'buy' | 'sell' | 'dividend'

export interface DayMarker {
  date: string
  kinds: MarkerKind[]
}

const KIND: Partial<Record<Transaction['type'], MarkerKind>> = {
  deposit: 'deposit',
  buy: 'buy',
  transferIn: 'buy',
  sell: 'sell',
  transferOut: 'sell',
  dividend: 'dividend',
}

export const MARKER_KINDS: MarkerKind[] = ['deposit', 'buy', 'sell', 'dividend']

/** One marker per day, with every kind of transaction on it, oldest day first. */
export function dayMarkers(transactions: readonly Transaction[]): DayMarker[] {
  const days = new Map<string, Set<MarkerKind>>()
  for (const t of transactions) {
    const kind = KIND[t.type]
    if (!kind) continue
    const kinds = days.get(t.date) ?? new Set<MarkerKind>()
    kinds.add(kind)
    days.set(t.date, kinds)
  }
  return [...days]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, kinds]) => ({ date, kinds: MARKER_KINDS.filter((k) => kinds.has(k)) }))
}

/** Every transaction of one day, for the top of the side panel. */
export function transactionsOn(transactions: readonly Transaction[], date: string): Transaction[] {
  return transactions.filter((t) => t.date === date)
}

/** Above this many marked days in the window, only the rare kinds are drawn: a monthly deposit would hide the line. */
export const DENSE_MARKERS = 120

/** The markers within the window; a crowded window keeps only sales and dividends, zooming in shows them all. */
export function markersIn(markers: readonly DayMarker[], from: string, to: string): DayMarker[] {
  const inside = markers.filter((m) => m.date >= from && m.date <= to)
  if (inside.length <= DENSE_MARKERS) return inside
  return inside.flatMap((m) => {
    const kinds = m.kinds.filter((k) => k === 'sell' || k === 'dividend')
    return kinds.length > 0 ? [{ date: m.date, kinds }] : []
  })
}
