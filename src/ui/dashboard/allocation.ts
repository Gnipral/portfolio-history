import type { Position } from '../../engine/positions.ts'
import type { Transaction } from '../../model/transaction.ts'
import { instrumentKey } from '../../market/instruments.ts'

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
    if (t.type !== 'buy') continue
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
  if (other > 0) slices.push({ key: 'other', label: 'Other', value: other, share: other / total, slot: 0 })
  return slices
}
