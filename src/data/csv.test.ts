import { describe, expect, it } from 'vitest'
import { BOM, csvAmount, csvCell, toCsv } from './csv.ts'

describe('csv', () => {
  it('quotes cells with a separator, a quote or a line break', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"')
    expect(csvCell(undefined)).toBe('')
  })

  it('writes numbers with a decimal point, amounts with two decimals', () => {
    expect(csvCell(1.5)).toBe('1.5')
    expect(csvAmount(-12.5)).toBe('-12.50')
    expect(csvAmount(1234.567)).toBe('1234.57')
  })

  it('joins cells with ; and ends every line with CRLF, without a byte order mark', () => {
    const csv = toCsv([
      ['Date', 'Product'],
      ['2026-03-10', 'iShares; World'],
    ])
    expect(csv).toBe('Date;Product\r\n2026-03-10;"iShares; World"\r\n')
    expect(csv.startsWith(BOM)).toBe(false)
    expect(BOM).toBe('﻿')
  })
})
