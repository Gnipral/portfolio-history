import { describe, expect, it } from 'vitest'
import { BOM, csvAmount, csvCell, csvDecimal, toCsv } from './csv.ts'

describe('csv', () => {
  it('quotes cells with a separator, a quote or a line break', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"')
    expect(csvCell(undefined)).toBe('')
  })

  it('writes numbers and amounts with the decimal mark asked for, amounts with two decimals', () => {
    expect(csvCell(1.5)).toBe('1.5')
    expect(csvCell(csvAmount(-12.5))).toBe('-12.50')
    expect(csvCell(csvAmount(1234.567))).toBe('1234.57')
    expect(csvCell(1.5, ',')).toBe('1,5')
    expect(csvCell(csvAmount(-12.5), ',')).toBe('-12,50')
  })

  it('takes the decimal mark of the locale', () => {
    expect(csvDecimal('nl-BE')).toBe(',')
    expect(csvDecimal('de-DE')).toBe(',')
    expect(csvDecimal('en-US')).toBe('.')
  })

  it('joins cells with ; and ends every line with CRLF, without a byte order mark', () => {
    const csv = toCsv(
      [
        ['Date', 'Product', 'Value'],
        ['2026-03-10', 'iShares; World', csvAmount(1000.5)],
      ],
      ',',
    )
    expect(csv).toBe('Date;Product;Value\r\n2026-03-10;"iShares; World";1000,50\r\n')
    expect(csv.startsWith(BOM)).toBe(false)
    expect(BOM).toBe('﻿')
  })
})
