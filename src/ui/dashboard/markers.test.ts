import { describe, expect, it } from 'vitest'
import { addDays } from '../../market/dates.ts'
import { tx } from '../../engine/testing.ts'
import { DENSE_MARKERS, dayMarkers, markersIn, transactionsOn } from './markers.ts'

describe('markers', () => {
  it('marks each day once, with every kind of transaction on it', () => {
    const transactions = [
      tx('deposit', '2026-01-05', { amount: 1000 }),
      tx('buy', '2026-01-05', { isin: 'A', quantity: 1, amount: 900 }),
      tx('dividend', '2026-02-01', { isin: 'A', amount: 5 }),
      tx('fee', '2026-02-01', { amount: 1 }),
      tx('sell', '2026-03-01', { isin: 'A', quantity: 1, amount: 950 }),
    ]
    expect(dayMarkers(transactions)).toEqual([
      { date: '2026-01-05', kinds: ['deposit', 'buy'] },
      { date: '2026-02-01', kinds: ['dividend'] },
      { date: '2026-03-01', kinds: ['sell'] },
    ])
    expect(transactionsOn(transactions, '2026-02-01').map((t) => t.type)).toEqual(['dividend', 'fee'])
  })

  it('keeps the markers of the window, and only sales and dividends when it is crowded', () => {
    const days = Array.from({ length: DENSE_MARKERS + 10 }, (_, i) => ({ date: addDays('2020-01-01', i * 7), kinds: i === 3 ? (['buy', 'dividend'] as const) : (['deposit', 'buy'] as const) }))
    const markers = days.map((d) => ({ date: d.date, kinds: [...d.kinds] }))
    expect(markersIn(markers, '2020-01-01', '2020-01-15').map((m) => m.date)).toEqual(['2020-01-01', '2020-01-08', '2020-01-15'])
    expect(markersIn(markers, '2000-01-01', '2030-01-01')).toEqual([{ date: addDays('2020-01-01', 21), kinds: ['dividend'] }])
  })
})
