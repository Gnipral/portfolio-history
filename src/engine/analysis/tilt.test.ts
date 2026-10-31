import { describe, expect, it } from 'vitest'
import { loadIndexWeights, type IndexWeights } from '../../market/indexWeights.ts'
import { activeTilt, normalizeTicker } from './tilt.ts'

const weights: IndexWeights = {
  asOf: '2026-10-29',
  source: 'test',
  holdings: [
    { ticker: 'AAPL', name: 'APPLE', country: 'US', weight: 0.05 },
    { ticker: 'ASML', name: 'ASML HOLDING', country: 'NL', weight: 0.007 },
    { ticker: 'NOVO B', name: 'NOVO NORDISK CLASS B', country: 'DK', weight: 0.0014 },
    // The same ticker in two countries.
    { ticker: 'BN', name: 'DANONE SA', country: 'FR', weight: 0.001 },
    { ticker: 'BN', name: 'BROOKFIELD CORP', country: 'CA', weight: 0.002 },
  ],
}

describe('normalizeTicker', () => {
  it('drops the Yahoo exchange suffix and writes share classes with a space', () => {
    expect(normalizeTicker('NOVO-B.CO', true)).toBe('NOVO B')
    expect(normalizeTicker('BRK-B', true)).toBe('BRK B')
    expect(normalizeTicker('7203.T', true)).toBe('7203')
    expect(normalizeTicker('RCI.B', false)).toBe('RCI B')
  })
})

describe('activeTilt', () => {
  it('compares each stock with its weight in the index; funds and crypto get none', () => {
    const tilts = activeTilt(
      [
        { key: 'US0378331005', isin: 'US0378331005', symbol: 'AAPL', assetClass: 'stock', weight: 0.2 },
        { key: 'NL0010273215', isin: 'NL0010273215', symbol: 'ASML.AS', assetClass: 'stock', weight: 0.001 },
        { key: 'DK0062498333', isin: 'DK0062498333', symbol: 'NOVO-B.CO', assetClass: 'stock', weight: 0.05 },
        { key: 'FR0000120644', isin: 'FR0000120644', symbol: 'BN.PA', assetClass: 'stock', weight: 0.01 },
        { key: 'XX', symbol: 'TINY.AS', assetClass: 'stock', weight: 0.03 },
        { key: 'IE00B4L5Y983', isin: 'IE00B4L5Y983', symbol: 'IWDA.AS', assetClass: 'etf', weight: 0.6 },
        { key: 'BTC', symbol: 'crypto:bitcoin', assetClass: 'crypto', weight: 0.1 },
      ],
      weights,
    )
    expect(tilts).toEqual([
      { key: 'US0378331005', kind: 'stock', indexWeight: 0.05, tilt: expect.closeTo(0.15), inIndex: true },
      { key: 'NL0010273215', kind: 'stock', indexWeight: 0.007, tilt: expect.closeTo(-0.006), inIndex: true },
      { key: 'DK0062498333', kind: 'stock', indexWeight: 0.0014, tilt: expect.closeTo(0.0486), inIndex: true },
      { key: 'FR0000120644', kind: 'stock', indexWeight: 0.001, tilt: expect.closeTo(0.009), inIndex: true },
      { key: 'XX', kind: 'stock', indexWeight: 0, tilt: 0.03, inIndex: false },
      { key: 'IE00B4L5Y983', kind: 'fund' },
      { key: 'BTC', kind: 'other' },
    ])
  })

  it('is null without the index weights, so the column is hidden', () => {
    expect(activeTilt([], null)).toBeNull()
  })
})

describe('loadIndexWeights', () => {
  it('returns the file, or null when it is missing or empty', async () => {
    expect(await loadIndexWeights(async () => weights)).toEqual(weights)
    expect(
      await loadIndexWeights(async () => {
        throw new Error('404')
      }),
    ).toBeNull()
    expect(await loadIndexWeights(async () => ({ asOf: '2026-10-29', source: 'x', holdings: [] }))).toBeNull()
  })
})
