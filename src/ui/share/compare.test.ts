import { describe, expect, it } from 'vitest'
import { annualized, compareLink, comparePath, curvePoints, linkData, splitCompare } from './compare.ts'

describe('compare links', () => {
  it('reads the data of share links, compare links and bare data', () => {
    expect(linkData('https://gnipral.github.io/portfolio-history/#/s/abc_D-1 ')).toEqual(['abc_D-1'])
    expect(linkData('https://gnipral.github.io/portfolio-history/#/c/one.two')).toEqual(['one', 'two'])
    expect(linkData('raw-Data_1')).toEqual(['raw-Data_1'])
    expect(linkData('https://example.com/?q=1')).toEqual([])
  })

  it('keeps at most four different cards', () => {
    expect(splitCompare('a.b.a..c.d.e')).toEqual(['a', 'b', 'c', 'd'])
    expect(comparePath(['a', 'a', 'b'])).toBe('/c/a.b')
    expect(compareLink(['a', 'b'])).toBe('https://gnipral.github.io/portfolio-history/#/c/a.b')
  })
})

describe('curvePoints', () => {
  it('spreads the curve from the day before the period to its end', () => {
    const points = curvePoints({ from: '2026-01-02', to: '2026-01-11', curve: [0, 1, 2, 3] })
    expect(points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-04', '2026-01-08', '2026-01-11'])
  })

  it('annualizes periods of a year or more only', () => {
    expect(annualized(0.21, '2024-01-01', '2025-12-31')).toBeCloseTo(0.1, 2)
    expect(annualized(0.05, '2026-01-01', '2026-06-01')).toBeUndefined()
  })
})
