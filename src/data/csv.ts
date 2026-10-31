import { locale } from '../i18n/i18n.ts'

/**
 * CSV files to open in a spreadsheet: `;` between cells, which Excel in Belgium, the Netherlands and Germany
 * opens in columns. Numbers use the decimal mark of the browser's locale, a comma there and a point in
 * English, so the spreadsheet of the same person reads them as numbers instead of text or dates.
 */

/** An amount, written with two decimals. */
export interface CsvAmount {
  amount: number
}

export type CsvValue = string | number | CsvAmount | undefined

/** A byte order mark, so Excel reads the file as UTF-8 and shows é and € right. */
export const BOM = '﻿'

/** An amount with two decimals, e.g. `-12.50` or `-12,50`. Takes one argument, so it can be passed to map. */
export const csvAmount = (value: number): CsvAmount => ({ amount: value })

/** The decimal mark of the locale: `,` for nl-BE or de-DE, `.` for en. */
export function csvDecimal(forLocale: string = locale()): string {
  return new Intl.NumberFormat(forLocale).formatToParts(1.5).find((part) => part.type === 'decimal')?.value === ',' ? ',' : '.'
}

export function csvCell(value: CsvValue, decimal = '.'): string {
  const text =
    value === undefined
      ? ''
      : typeof value === 'number'
        ? String(value).replace('.', decimal)
        : typeof value === 'object'
          ? value.amount.toFixed(2).replace('.', decimal)
          : value
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Rows to CSV text, every line ended by CRLF; no byte order mark. */
export function toCsv(rows: CsvValue[][], decimal: string = csvDecimal()): string {
  return `${rows.map((row) => row.map((cell) => csvCell(cell, decimal)).join(';')).join('\r\n')}\r\n`
}

/** Hands a file to the browser to save, under `name`. */
export function downloadFile(content: string, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Saves rows as a CSV file with a byte order mark. */
export function downloadCsv(rows: CsvValue[][], name: string): void {
  downloadFile(`${BOM}${toCsv(rows)}`, 'text/csv;charset=utf-8', name)
}
