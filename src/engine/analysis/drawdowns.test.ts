import { describe, expect, it } from 'vitest'
import { addDays } from '../../market/dates.ts'
import { drawdownEpisodes, underwater } from './drawdowns.ts'
import type { IndexPoint } from './performance.ts'

function daily(levels: number[], start = '2026-01-01'): IndexPoint[] {
  return levels.map((level, i) => ({ date: addDays(start, i), twr: level - 1 }))
}

// Up to 1.2, down 25% to 0.9, back to 1.2 on day 5, a small dip to 1.14 and not back yet.
const own = daily([1, 1.2, 1.0, 0.9, 1.1, 1.2, 1.14, 1.18])
const all = { from: 0, to: own.length - 1 }

describe('underwater', () => {
  it('measures every day against the highest level so far', () => {
    expect(underwater(own, all).map((p) => Number(p.drawdown.toFixed(4)))).toEqual([0, 0, -0.1667, -0.25, -0.0833, 0, -0.05, -0.0167])
  })

  it('starts the high at the level before the period', () => {
    expect(underwater(own, { from: 3, to: 3 })[0]?.drawdown).toBeCloseTo(0.9 / 1.0 - 1)
  })
})

describe('drawdownEpisodes', () => {
  it('lists every fall to its recovery, the open one too, deepest first', () => {
    expect(drawdownEpisodes(own, all)).toEqual([
      { peak: '2026-01-02', trough: '2026-01-04', recovered: '2026-01-06', depth: expect.closeTo(-0.25), days: 4 },
      { peak: '2026-01-06', trough: '2026-01-07', depth: expect.closeTo(-0.05), days: 2 },
    ])
  })

  it('leaves out ripples below the minimum depth', () => {
    expect(drawdownEpisodes(own, all, undefined, 0.1)).toHaveLength(1)
  })

  it('gives the benchmark its deepest fall over the same days', () => {
    // The benchmark peaks at 1.1 on day 2 and falls to 0.88 on day 4: 20%.
    const bench = daily([1, 1, 1.1, 1.0, 0.88, 1.0, 1.0, 1.0])
    const [first, second] = drawdownEpisodes(own, all, bench)
    expect(first?.benchmarkDepth).toBeCloseTo(-0.2)
    expect(second?.benchmarkDepth).toBeCloseTo(0)
  })
})
