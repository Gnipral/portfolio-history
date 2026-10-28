import type { Position } from '../../engine/positions.ts'
import { language } from '../../i18n/i18n.ts'
import type { Transaction } from '../../model/transaction.ts'
import { instrumentKey } from '../../market/instruments.ts'
import { msg } from '../../i18n/i18n.ts'

/** Categorical slots available for named slices; everything else folds into "Other". */
export const SERIES_SLOTS = 7

export interface Slice {
  key: string
  label: string
  value: number
  share: number
  /** 1-based categorical slot, or 0 for "Other". */
  slot: number
}

/**
 * Gives the instruments with the most money ever invested a fixed color slot, so a product keeps
 * its color on every date, whatever its rank that day.
 */
export function colorSlots(transactions: Transaction[]): Map<string, number> {
  const invested = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'buy' && t.type !== 'transferIn') continue
    const key = instrumentKey(t)
    invested.set(key, (invested.get(key) ?? 0) + Math.abs(t.amountEur))
  }
  const ranked = [...invested].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return new Map(ranked.slice(0, SERIES_SLOTS).map(([key], i) => [key, i + 1]))
}

/** Slices for the open positions: one per slotted instrument, the rest together as "Other". */
export function allocationSlices(positions: Position[], slots: Map<string, number>): Slice[] {
  const total = positions.reduce((sum, p) => sum + Math.max(p.value, 0), 0)
  if (total <= 0) return []
  const slices: Slice[] = []
  let other = 0
  for (const p of positions) {
    if (p.value <= 0) continue
    const slot = slots.get(p.key)
    if (slot) slices.push({ key: p.key, label: p.product, value: p.value, share: p.value / total, slot })
    else other += p.value
  }
  slices.sort((a, b) => a.slot - b.slot)
  if (other > 0) slices.push({ key: 'other', label: msg('Other'), value: other, share: other / total, slot: 0 })
  return slices
}

export type AllocationDimension = 'position' | 'assetClass' | 'currency' | 'country'

export const DIMENSIONS: { key: AllocationDimension; label: string }[] = [
  { key: 'position', label: msg('Position') },
  { key: 'assetClass', label: msg('Type') },
  { key: 'currency', label: msg('Currency') },
  { key: 'country', label: msg('Country (ISIN)') },
]

/** What the allocation can be grouped by, per instrument, taken from its latest buy. */
export interface InstrumentFacts {
  assetClass: string
  currency: string
  country: string
}

const ASSET_CLASSES: Record<string, string> = {
  stock: msg('Stocks'),
  etf: msg('ETFs'),
  fund: msg('Funds'),
  bond: msg('Bonds'),
  crypto: msg('Crypto'),
  cash: msg('Cash'),
  unknown: msg('Other'),
}

const COUNTRIES = new Intl.DisplayNames([language()], { type: 'region' })

/** Country of the ISIN prefix: where the security is registered, e.g. Ireland for most ETFs. */
export function isinCountry(isin: string | undefined): string {
  const code = isin?.slice(0, 2).toUpperCase()
  if (!code || !/^[A-Z]{2}$/.test(code)) return msg('Unknown')
  if (code === 'XS') return msg('International (XS)')
  if (code === 'EU') return msg('European Union')
  try {
    return COUNTRIES.of(code) ?? code
  } catch {
    return code
  }
}

export function instrumentFacts(transactions: Transaction[]): Map<string, InstrumentFacts> {
  const facts = new Map<string, InstrumentFacts>()
  for (const t of [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime))) {
    if (t.type !== 'buy' && t.type !== 'transferIn' && t.type !== 'sell' && t.type !== 'split') continue
    // Pence are pounds for the allocation.
    const currency = t.currency === 'GBX' || t.currency === 'GBp' ? 'GBP' : t.currency
    facts.set(instrumentKey(t), { assetClass: ASSET_CLASSES[t.assetClass] ?? msg('Other'), currency, country: t.assetClass === 'crypto' ? msg('Crypto') : isinCountry(t.isin) })
  }
  return facts
}

/** Slices per group of a dimension, largest first; the largest groups get the color slots. */
export function groupedSlices(
  positions: Position[],
  dimension: Exclude<AllocationDimension, 'position'>,
  facts: Map<string, InstrumentFacts>,
): Slice[] {
  const groups = new Map<string, number>()
  for (const p of positions) {
    if (p.value <= 0) continue
    const label = facts.get(p.key)?.[dimension] ?? msg('Unknown')
    groups.set(label, (groups.get(label) ?? 0) + p.value)
  }
  const total = [...groups.values()].reduce((sum, v) => sum + v, 0)
  if (total <= 0) return []
  const ranked = [...groups].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const slices: Slice[] = ranked.slice(0, SERIES_SLOTS).map(([label, value], i) => ({ key: label, label, value, share: value / total, slot: i + 1 }))
  const other = ranked.slice(SERIES_SLOTS).reduce((sum, [, value]) => sum + value, 0)
  if (other > 0) slices.push({ key: 'other', label: msg('Other'), value: other, share: other / total, slot: 0 })
  return slices
}
