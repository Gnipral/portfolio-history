/**
 * The timeline under the chart works like a video editor: a window over the whole history with a trim handle at
 * each end, a body that pans, and a playhead inside it. These are its moves, on day indices.
 */

export interface DayWindow {
  from: number
  to: number
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The day under a point of the strip, as a fraction 0..1 of its width. */
export function indexAtRatio(ratio: number, count: number): number {
  return clamp(Math.round(ratio * (count - 1)), 0, Math.max(0, count - 1))
}

/** The start handle moved to `index`: never past the end, and at least one day before it. */
export function trimStart(window: DayWindow, index: number): DayWindow {
  return { from: clamp(index, 0, Math.max(0, window.to - 1)), to: window.to }
}

/** The end handle moved to `index`: never before the start, and never past the last day. */
export function trimEnd(window: DayWindow, index: number, count: number): DayWindow {
  return { from: window.from, to: clamp(index, Math.min(window.from + 1, count - 1), count - 1) }
}

/** The window moved by `delta` days as a whole, keeping its length, within the history. */
export function panWindow(window: DayWindow, delta: number, count: number): DayWindow {
  const length = window.to - window.from
  const from = clamp(window.from + delta, 0, Math.max(0, count - 1 - length))
  return { from, to: from + length }
}

/** The window the chart shows after a zoom, as whole days within the history. */
export function windowFromRange(from: number, to: number, count: number): DayWindow {
  const start = clamp(Math.round(from), 0, Math.max(0, count - 1))
  return { from: start, to: clamp(Math.round(to), Math.min(start + 1, count - 1), count - 1) }
}

/** The same day one month earlier or later, e.g. 31 Mar → 28 Feb; `dates` has one entry per calendar day. */
function monthStep(dates: readonly string[], index: number, direction: 1 | -1): number {
  const date = dates[index]
  if (!date) return index
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const target = new Date(Date.UTC(year, month - 1 + direction, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return index + Math.round((target.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000)
}

/** The playhead moved a day (or with `month` a month) back or forward, kept inside the window. */
export function stepPlayhead(dates: readonly string[], index: number, direction: 1 | -1, month: boolean, window: DayWindow): number {
  const next = month ? monthStep(dates, index, direction) : index + direction
  return clamp(next, window.from, window.to)
}
