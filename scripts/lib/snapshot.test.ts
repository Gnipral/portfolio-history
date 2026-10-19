import { describe, expect, it } from 'vitest'
import {
  addDays,
  commitMessage,
  mergeCloses,
  mergeFx,
  pickAuthor,
  serializeBenchmark,
  serializeFx,
  type CloseRow,
  type FxFile,
} from './snapshot.ts'
import { parseYahooCloses } from './sources.ts'

const SOURCE = 'test'

describe('mergeFx', () => {
  const existing: FxFile = {
    base: 'EUR',
    source: SOURCE,
    currencies: ['GBP', 'USD'],
    rates: { '2026-10-15': [0.86, 1.17], '2026-10-16': [0.861, 1.171] },
  }

  it('appends only dates after the last stored date', () => {
    const { file, added } = mergeFx(
      existing,
      {
        '2026-10-16': { GBP: 0.9, USD: 1.2 }, // revised value for a stored date: ignored
        '2026-10-19': { GBP: 0.862, USD: 1.1723456789 },
      },
      ['GBP', 'USD'],
      '2010-01-01',
      SOURCE,
    )
    expect(added).toBe(1)
    expect(file.rates['2026-10-16']).toEqual([0.861, 1.171])
    expect(file.rates['2026-10-19']).toEqual([0.862, 1.172346])
  })

  it('stores null for a currency without a rate', () => {
    const { file } = mergeFx(existing, { '2026-10-19': { USD: 1.17 } }, ['GBP', 'USD'], '2010-01-01', SOURCE)
    expect(file.rates['2026-10-19']).toEqual([null, 1.17])
  })

  it('starts over when the currency list changes', () => {
    const { file, added } = mergeFx(existing, { '2026-10-15': { USD: 1.17, CHF: 0.93 } }, ['CHF', 'USD'], '2010-01-01', SOURCE)
    expect(added).toBe(1)
    expect(Object.keys(file.rates)).toEqual(['2026-10-15'])
    expect(file.currencies).toEqual(['CHF', 'USD'])
  })

  it('skips dates before the start date', () => {
    const { file } = mergeFx(null, { '2009-12-31': { USD: 1.44 }, '2010-01-04': { USD: 1.4389 } }, ['USD'], '2010-01-01', SOURCE)
    expect(Object.keys(file.rates)).toEqual(['2010-01-04'])
  })
})

describe('mergeCloses', () => {
  const existing: CloseRow[] = [
    ['2026-10-15', 130, 130],
    ['2026-10-16', 131, 131],
  ]

  it('appends new dates in order and ignores overlap and duplicates', () => {
    const { closes, added } = mergeCloses(existing, [
      ['2026-10-16', 999, 999],
      ['2026-10-20', 133, 133],
      ['2026-10-19', 132, 132],
      ['2026-10-19', 132, 132],
    ])
    expect(added).toBe(2)
    expect(closes.map((r) => r[0])).toEqual(['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20'])
    expect(closes[1]).toEqual(['2026-10-16', 131, 131])
  })
})

describe('serialization', () => {
  it('writes one row per line and is deterministic', () => {
    const fx: FxFile = { base: 'EUR', source: SOURCE, currencies: ['USD'], rates: { '2026-10-16': [1.17], '2026-10-15': [1.16] } }
    const text = serializeFx(fx)
    expect(text).toBe(serializeFx(JSON.parse(text) as FxFile))
    expect(text).toContain('    "2026-10-15": [1.16],\n    "2026-10-16": [1.17]\n')
    expect(JSON.parse(text)).toEqual({ ...fx, rates: { '2026-10-15': [1.16], '2026-10-16': [1.17] } })
  })

  it('writes benchmark closes as parseable JSON', () => {
    const file = { id: 'iwda', name: 'n', symbol: 'IWDA.AS', currency: 'EUR', source: SOURCE, closes: [['2026-10-16', 1, 1]] as CloseRow[] }
    expect(JSON.parse(serializeBenchmark(file))).toEqual(file)
  })
})

describe('parseYahooCloses', () => {
  // Amsterdam is UTC+2 in summer: gmtoffset 7200. Bars are stamped at the 09:00 local open.
  const result = {
    meta: {
      gmtoffset: 7200,
      currentTradingPeriod: { regular: { start: Date.UTC(2026, 9, 19, 7) / 1000, end: Date.UTC(2026, 9, 19, 15, 30) / 1000 } },
    },
    timestamp: [Date.UTC(2026, 9, 15, 7) / 1000, Date.UTC(2026, 9, 16, 7) / 1000, Date.UTC(2026, 9, 19, 7) / 1000],
    indicators: { quote: [{ close: [130.5500030517578, null, 131.1] }], adjclose: [{ adjclose: [130.5500030517578, null, 131.1] }] },
  }

  it('converts timestamps to exchange dates, rounds and skips empty bars', () => {
    const rows = parseYahooCloses(result, new Date(Date.UTC(2026, 9, 19, 21, 30)))
    expect(rows).toEqual([
      ['2026-10-15', 130.55, 130.55],
      ['2026-10-19', 131.1, 131.1],
    ])
  })

  it('skips the bar of a session that is still open', () => {
    const rows = parseYahooCloses(result, new Date(Date.UTC(2026, 9, 19, 12)))
    expect(rows.map((r) => r[0])).toEqual(['2026-10-15'])
  })
})

describe('pickAuthor', () => {
  const authors = ['A', 'B', 'C']

  it('rotates one author per UTC day', () => {
    const day = (iso: string) => pickAuthor(authors, new Date(`${iso}T21:30:00Z`))
    const picks = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map(day)
    expect(new Set(picks.slice(0, 3)).size).toBe(3)
    expect(picks[3]).toBe(picks[0])
  })

  it('is stable within a day', () => {
    expect(pickAuthor(authors, new Date('2026-10-19T00:00:01Z'))).toBe(pickAuthor(authors, new Date('2026-10-19T23:59:59Z')))
  })
})

describe('commitMessage', () => {
  it('describes new data', () => {
    expect(commitMessage('2026-10-19', { 'FX rates': 1, 'IWDA.AS': 0 }, [])).toBe(
      'data: update FX and benchmark closes for 2026-10-19\n\n- FX rates: +1 day\n- IWDA.AS: no new data\n',
    )
  })

  it('describes a day without market data', () => {
    expect(commitMessage('2026-10-18', { 'FX rates': 0 }, ['IWDA.AS: HTTP 429'])).toMatch(
      /^data: record daily check for 2026-10-18 \(no new market data\)\n\n- FX rates: no new data\n- error: IWDA.AS: HTTP 429\n$/,
    )
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
