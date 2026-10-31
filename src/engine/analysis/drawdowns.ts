import { daysBetween } from '../../market/dates.ts'
import type { IndexPoint, Window } from './performance.ts'

/** Falls from a high and the way back up, on the time-weighted return so deposits do not count. */

const level = (point: IndexPoint) => 1 + point.twr

export interface UnderwaterPoint {
  date: string
  /** Below the highest level so far in the period, as a negative fraction or 0. */
  drawdown: number
}

/** How far below its previous high the series is on every day of the period; the high starts at the level before it. */
export function underwater(points: IndexPoint[], window: Window): UnderwaterPoint[] {
  const before = window.from > 0 ? points[window.from - 1] : undefined
  let peak = before ? level(before) : 1
  const result: UnderwaterPoint[] = []
  for (let i = window.from; i <= window.to; i++) {
    const point = points[i]
    if (!point) continue
    peak = Math.max(peak, level(point))
    result.push({ date: point.date, drawdown: level(point) / peak - 1 })
  }
  return result
}

export interface DrawdownEpisode {
  /** The last day at the high before the fall. */
  peak: string
  /** The lowest day of the fall. */
  trough: string
  /** The first day back at the high; absent while the episode is still open. */
  recovered?: string
  /** The fall from the peak to the trough, as a negative fraction. */
  depth: number
  /** Days from the peak to the recovery, or to the last day of the period while it is open. */
  days: number
  /**
   * The deepest fall of the benchmark from its own high within the same days (peak to recovery or
   * to the end of the period), as a negative fraction or 0; absent without a benchmark.
   */
  benchmarkDepth?: number
}

/**
 * Every episode from a high to the full recovery in the period, the last one possibly still open,
 * deepest first. `minDepth` (e.g. 0.01) leaves out the ripples of a volatile series.
 */
export function drawdownEpisodes(points: IndexPoint[], window: Window, benchmark?: IndexPoint[], minDepth = 0): DrawdownEpisode[] {
  const startIndex = Math.max(0, window.from - 1)
  const start = points[startIndex]
  if (!start) return []
  let peakIndex = startIndex
  let peakLevel = window.from > 0 ? level(start) : 1
  let troughIndex = -1
  const episodes: DrawdownEpisode[] = []

  const close = (endIndex: number, recovered: boolean) => {
    const peak = points[peakIndex] as IndexPoint
    const trough = points[troughIndex] as IndexPoint
    const end = points[endIndex] as IndexPoint
    const depth = level(trough) / peakLevel - 1
    if (-depth <= minDepth) return
    const episode: DrawdownEpisode = { peak: peak.date, trough: trough.date, depth, days: daysBetween(peak.date, end.date) }
    if (recovered) episode.recovered = end.date
    if (benchmark && benchmark.length > 0) episode.benchmarkDepth = deepestFall(benchmark, peakIndex, endIndex)
    episodes.push(episode)
  }

  for (let i = window.from; i <= window.to; i++) {
    const point = points[i]
    if (!point) continue
    const current = level(point)
    if (current >= peakLevel) {
      if (troughIndex >= 0) close(i, true)
      troughIndex = -1
      peakLevel = current
      peakIndex = i
      continue
    }
    if (troughIndex < 0 || current < level(points[troughIndex] as IndexPoint)) troughIndex = i
  }
  if (troughIndex >= 0) close(window.to, false)
  return episodes.sort((a, b) => a.depth - b.depth)
}

/** The deepest fall of a series from its own running high between two indices, as a negative fraction or 0. */
function deepestFall(points: IndexPoint[], from: number, to: number): number {
  let peak = -Infinity
  let deepest = 0
  for (let i = from; i <= to; i++) {
    const point = points[i]
    if (!point) continue
    peak = Math.max(peak, level(point))
    deepest = Math.min(deepest, level(point) / peak - 1)
  }
  return deepest
}
