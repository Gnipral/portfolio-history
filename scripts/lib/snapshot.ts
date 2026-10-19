/** Pure helpers for the daily data snapshot: merging, serializing and author rotation. */

export interface FxFile {
  base: 'EUR'
  source: string
  currencies: string[]
  /** Date -> rates in the order of `currencies`; null when the ECB published no rate. */
  rates: Record<string, (number | null)[]>
}

/** [date, close, adjusted close] */
export type CloseRow = [string, number, number]

export interface BenchmarkFile {
  id: string
  name: string
  symbol: string
  currency: string
  source: string
  closes: CloseRow[]
}

export interface FileStats {
  rows: number
  firstDate: string | null
  lastDate: string | null
}

export interface MetaFile {
  lastCheck: string
  sources: Record<string, string>
  files: Record<string, FileStats>
  errors: string[]
}

export interface Author {
  name: string
  username: string
  email: string
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Rounds away floating point noise from data sources so files stay byte-identical across runs. */
export function round(value: number, decimals = 6): number {
  return Number(value.toFixed(decimals))
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Append-only: dates already in the file are never changed, only later dates are added.
 * A different currency list starts a new file (the caller then fetches the full history).
 */
export function mergeFx(
  existing: FxFile | null,
  fetched: Record<string, Record<string, number>>,
  currencies: string[],
  startDate: string,
  source: string,
): { file: FxFile; added: number } {
  const base: FxFile =
    existing && sameList(existing.currencies, currencies)
      ? existing
      : { base: 'EUR', source, currencies, rates: {} }
  const lastDate = Object.keys(base.rates).sort().at(-1) ?? ''
  const rates = { ...base.rates }
  let added = 0
  for (const date of Object.keys(fetched).sort()) {
    if (date <= lastDate || date < startDate) continue
    const day = fetched[date] ?? {}
    rates[date] = currencies.map((c) => (typeof day[c] === 'number' ? round(day[c]) : null))
    added++
  }
  return { file: { ...base, rates }, added }
}

export function mergeCloses(existing: CloseRow[], fetched: CloseRow[]): { closes: CloseRow[]; added: number } {
  const lastDate = existing.at(-1)?.[0] ?? ''
  const seen = new Set<string>()
  const additions = fetched
    .filter(([date]) => date > lastDate && !seen.has(date) && seen.add(date))
    .sort((a, b) => a[0].localeCompare(b[0]))
  return { closes: [...existing, ...additions], added: additions.length }
}

/** JSON with one data row per line, so daily commits show a small, readable diff. */
export function serializeFx(file: FxFile): string {
  const dates = Object.keys(file.rates).sort()
  const rows = dates.map((d) => `    ${JSON.stringify(d)}: ${JSON.stringify(file.rates[d])}`)
  return [
    '{',
    `  "base": ${JSON.stringify(file.base)},`,
    `  "source": ${JSON.stringify(file.source)},`,
    `  "currencies": ${JSON.stringify(file.currencies)},`,
    '  "rates": {',
    rows.join(',\n'),
    '  }',
    '}',
    '',
  ].join('\n')
}

export function serializeBenchmark(file: BenchmarkFile): string {
  const { closes, ...header } = file
  const head = Object.entries(header).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  return ['{', ...head, '  "closes": [', closes.map((r) => `    ${JSON.stringify(r)}`).join(',\n'), '  ]', '}', ''].join(
    '\n',
  )
}

export function fxStats(file: FxFile): FileStats {
  const dates = Object.keys(file.rates).sort()
  return { rows: dates.length, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null }
}

export function closeStats(closes: CloseRow[]): FileStats {
  return { rows: closes.length, firstDate: closes[0]?.[0] ?? null, lastDate: closes.at(-1)?.[0] ?? null }
}

/** Round-robin over the authors by UTC day number, so every author gets regular commits. */
export function pickAuthor<T>(authors: T[], date: Date): T {
  if (authors.length === 0) throw new Error('No authors configured')
  const day = Math.floor(date.getTime() / 86_400_000)
  return authors[day % authors.length] as T
}

export function commitMessage(date: string, changes: Record<string, number>, errors: string[]): string {
  const changed = Object.entries(changes).filter(([, n]) => n > 0)
  const subject =
    changed.length > 0
      ? `data: update FX and benchmark closes for ${date}`
      : `data: record daily check for ${date} (no new market data)`
  const body = [
    ...Object.entries(changes).map(([name, n]) => `- ${name}: ${n > 0 ? `+${n} ${n === 1 ? 'day' : 'days'}` : 'no new data'}`),
    ...errors.map((e) => `- error: ${e}`),
  ]
  return `${subject}\n\n${body.join('\n')}\n`
}
