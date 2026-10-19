import { describe, expect, it } from 'vitest'
import { normalizeHeader, parseDate, parseNumber, parseTime } from './parse.ts'

describe('parseNumber', () => {
  it.each([
    [12.5, 12.5],
    ['12,5', 12.5],
    ['-1050,00', -1050],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['-936.58593', -936.58593],
    ['1.234.567', 1234567],
    ['1,234,567', 1234567],
    [' 2 500,10 ', 2500.1],
    ['1e-3', 0.001],
  ])('parses %j', (input, expected) => {
    expect(parseNumber(input)).toBeCloseTo(expected, 10)
  })

  it('returns null for blank cells', () => {
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber('  ')).toBeNull()
  })

  it('returns NaN for text', () => {
    expect(parseNumber('abc')).toBeNaN()
    expect(parseNumber('12 EUR')).toBeNaN()
  })
})

describe('parseDate', () => {
  it.each([
    ['15-10-2026', '2026-10-15'],
    ['5/1/2024', '2024-01-05'],
    ['05.01.2024', '2024-01-05'],
    ['2024-01-05', '2024-01-05'],
    ['2024-01-05T13:40:00Z', '2024-01-05'],
  ])('parses %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected)
  })

  it('parses Date objects using local calendar values', () => {
    expect(parseDate(new Date(2025, 6, 1, 17, 1))).toBe('2025-07-01')
  })

  it('rejects impossible dates and other text', () => {
    expect(parseDate('31-02-2024')).toBeNull()
    expect(parseDate('yesterday')).toBeNull()
    expect(parseDate(45000)).toBeNull()
  })
})

describe('parseTime', () => {
  it('parses times and defaults blanks to midnight', () => {
    expect(parseTime('9:05')).toBe('09:05')
    expect(parseTime('21:02:59')).toBe('21:02')
    expect(parseTime(null)).toBe('00:00')
    expect(parseTime('25:00')).toBeNull()
  })
})

describe('normalizeHeader', () => {
  it('ignores case and extra whitespace', () => {
    expect(normalizeHeader('Koers ')).toBe('koers')
    expect(normalizeHeader('  Waarde  EUR')).toBe('waarde eur')
  })
})
