/**
 * CSV files to open in a spreadsheet: `;` between cells, which Excel in Belgium, the Netherlands and Germany
 * opens in columns, and amounts with a decimal point so every spreadsheet reads them as numbers when imported.
 */

export type CsvValue = string | number | undefined

/** A byte order mark, so Excel reads the file as UTF-8 and shows é and € right. */
export const BOM = '﻿'

/** An amount with two decimals, e.g. `-12.50`. */
export const csvAmount = (value: number) => value.toFixed(2)

export function csvCell(value: CsvValue): string {
  const text = value === undefined ? '' : String(value)
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Rows to CSV text, every line ended by CRLF; no byte order mark. */
export function toCsv(rows: CsvValue[][]): string {
  return `${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
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
