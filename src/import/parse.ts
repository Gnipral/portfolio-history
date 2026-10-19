import type { Cell } from './types.ts'

/** Lowercase, trim and collapse whitespace so header lookups ignore cosmetic differences. */
export function normalizeHeader(value: Cell): string {
  return String(value ?? '')
    .replace(/ /g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function isBlank(value: Cell): boolean {
  return value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * Parses numbers written in European (`1.234,56`) or English (`1,234.56`) notation.
 * With a single separator type: one occurrence is the decimal separator, several are thousands separators.
 * Returns `null` for blank cells and `NaN` for text that is not a number.
 */
export function parseNumber(value: Cell): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return Number.NaN
  if (value === null) return null
  let text = value.replace(/[\s ']/g, '')
  if (text === '') return null

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    text = text.split(thousands).join('').replace(decimal, '.')
  } else if (lastComma >= 0) {
    text = text.split(',').length > 2 ? text.split(',').join('') : text.replace(',', '.')
  } else if (lastDot >= 0 && text.split('.').length > 2) {
    text = text.split('.').join('')
  }

  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text) ? Number(text) : Number.NaN
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isValidDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * Parses `DD-MM-YYYY`, `DD/MM/YYYY`, `DD.MM.YYYY`, `YYYY-MM-DD` and Date objects into `YYYY-MM-DD`.
 * Day-first is assumed for the European brokers this app targets.
 */
export function parseDate(value: Cell | Date): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value !== 'string') return null
  const text = value.trim()

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)
  if (match) {
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
    return isValidDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null
  }
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text)
  if (match) {
    const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
    return isValidDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null
  }
  return null
}

/** Parses `HH:mm` or `HH:mm:ss` into `HH:mm`. Blank input gives `00:00`. */
export function parseTime(value: Cell | Date): string | null {
  if (value instanceof Date) return `${pad(value.getHours())}:${pad(value.getMinutes())}`
  if (isBlank(value as Cell)) return '00:00'
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim())
  if (!match) return null
  const [h, m] = [Number(match[1]), Number(match[2])]
  return h < 24 && m < 60 ? `${pad(h)}:${pad(m)}` : null
}

export function cellText(value: Cell): string {
  return value === null ? '' : String(value).trim()
}
