import { addDays, daysBetween } from '../../market/dates.ts'
import { PUBLIC_URL, type ShareCard } from './shareCard.ts'
import { SHARE_ROUTE } from './shareLink.ts'

/** The route that shows several shared cards in one chart: their link data joined by dots. */
export const COMPARE_ROUTE = '/c/'

/** More lines than this make the chart unreadable. */
export const MAX_COMPARED = 4

const DATA = /^[A-Za-z0-9_-]+$/

/** The card data of a pasted share or compare link (or of the bare data); empty when it is neither. */
export function linkData(text: string): string[] {
  const trimmed = text.trim()
  const share = trimmed.match(new RegExp(`#${SHARE_ROUTE}([A-Za-z0-9_-]+)`))
  if (share) return [share[1] as string]
  const compare = trimmed.match(new RegExp(`#${COMPARE_ROUTE}([A-Za-z0-9_.-]+)`))
  if (compare) return splitCompare(compare[1] as string)
  return DATA.test(trimmed) ? [trimmed] : []
}

export function splitCompare(data: string): string[] {
  return [...new Set(data.split('.').filter((d) => DATA.test(d)))].slice(0, MAX_COMPARED)
}

export function comparePath(datas: string[]): string {
  return `${COMPARE_ROUTE}${[...new Set(datas)].slice(0, MAX_COMPARED).join('.')}`
}

export function compareLink(datas: string[]): string {
  return `${PUBLIC_URL}#${comparePath(datas)}`
}

export interface ComparePoint {
  date: string
  /** Return since the start of the card, in percent. */
  percent: number
}

/**
 * Dates for the points of a card's curve. The curve starts on the day before `from` (its base) and its
 * points are spread evenly over the days until `to`.
 */
export function curvePoints(card: Pick<ShareCard, 'from' | 'to' | 'curve'>): ComparePoint[] {
  const start = addDays(card.from, -1)
  const days = daysBetween(start, card.to)
  const last = Math.max(card.curve.length - 1, 1)
  return card.curve.map((percent, i) => ({ date: addDays(start, Math.round((i / last) * days)), percent }))
}

/** Yearly return from a total return over a period, for periods longer than a year. */
export function annualized(total: number, from: string, to: string): number | undefined {
  const days = daysBetween(from, to)
  return days >= 365 ? (1 + total) ** (365 / days) - 1 : undefined
}
