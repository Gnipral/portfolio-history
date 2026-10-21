import { describe, expect, it } from 'vitest'
import { Collector, fixedRates, parseDateTime, parseMoney } from './kit.ts'

describe('parseMoney', () => {
  it('reads amounts as brokers write them', () => {
    expect(parseMoney('€1,234.56')).toBe(1234.56)
    expect(parseMoney('-EUR 2.50')).toBe(-2.5)
    expect(parseMoney('-€235.00')).toBe(-235)
    expect(parseMoney('$0')).toBe(0)
    expect(parseMoney('(6.97)')).toBe(-6.97)
    expect(parseMoney(' 1 791,84 ')).toBe(1791.84)
    expect(parseMoney('0,76672417')).toBe(0.76672417)
    expect(parseMoney('�3184.30')).toBe(3184.3)
    expect(parseMoney('-')).toBeNull()
    expect(parseMoney('Not available')).toBeNull()
    expect(parseMoney(12)).toBe(12)
  })
})

describe('parseDateTime', () => {
  it('reads the date formats of the supported brokers', () => {
    expect(parseDateTime('20210601;153100')).toEqual({ date: '2021-06-01', time: '15:31' })
    expect(parseDateTime('20250515')).toEqual({ date: '2025-05-15', time: '00:00' })
    expect(parseDateTime('15-Apr-2026')).toEqual({ date: '2026-04-15', time: '00:00' })
    expect(parseDateTime('16-jan-2025')).toEqual({ date: '2025-01-16', time: '00:00' })
    expect(parseDateTime('06/01/2025 10:02:00')).toEqual({ date: '2025-01-06', time: '10:02' })
    expect(parseDateTime('12.04.2024 13:01:45')).toEqual({ date: '2024-04-12', time: '13:01' })
    expect(parseDateTime('2024-03-05 16:02:11.412')).toEqual({ date: '2024-03-05', time: '16:02' })
    expect(parseDateTime('2025-01-10', '09:12:04.000')).toEqual({ date: '2025-01-10', time: '09:12' })
    expect(parseDateTime('not a date')).toBeNull()
  })

  it('converts times with a zone to local time', () => {
    const at = parseDateTime('2025-01-10 09:12:04 UTC')
    const expected = new Date('2025-01-10T09:12:04Z')
    expect(at?.date).toBe(`${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`)
    expect(at?.time).toBe(`${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`)
  })
})

describe('Collector', () => {
  const at = { date: '2026-01-02', time: '10:00' }

  it('converts to EUR and signs amounts from the cash point of view', () => {
    const out = new Collector('test', 'file.csv', fixedRates({ USD: 1.25 }))
    const t = out.add({ type: 'buy', at, row: 2, product: 'X', quantity: 2, price: 50, amount: 100, cashCurrency: 'USD', costs: 2.5 })
    expect(t).toMatchObject({ amountEur: -80, costsEur: 2, totalEur: -82, currency: 'USD', localAmount: -100 })
  })

  it('skips a row and reports it when no rate is known', () => {
    const out = new Collector('test', 'file.csv', fixedRates({}))
    expect(out.add({ type: 'dividend', at, row: 3, product: 'X', amount: 5, cashCurrency: 'JPY' })).toBeUndefined()
    expect(out.issues[0]).toMatchObject({ severity: 'error', row: 3 })
  })

  it('converts between two foreign currencies via EUR', () => {
    const out = new Collector('test', 'file.csv', fixedRates({ USD: 1.25, CHF: 1 }))
    expect(out.convert(10, 'CHF', 'USD', '2026-01-02', 2)).toBeCloseTo(12.5)
  })
})

describe('Collector currencies', () => {
  it('converts an amount in pence (GBp) as pence, not as pounds', () => {
    const out = new Collector('test', 'file', fixedRates({ GBX: 85 }))
    expect(out.toEur(850, 'GBp', '2026-01-02', 2)).toBe(10)
  })
})
