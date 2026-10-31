/** The constituents of the MSCI World ETF (IWDA) and their weights, for the over/underweight column in Analysis. */

export interface IndexHolding {
  ticker: string
  name: string
  /** ISO 3166 code of the iShares "Location", when it maps to one. */
  country?: string
  /** Share of the fund, 0 to 1. */
  weight: number
}

export interface IndexWeightsFile {
  /** `YYYY-MM-DD` of the holdings file. */
  asOf: string
  source: string
  /** Equities only, largest first. */
  holdings: IndexHolding[]
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }

/** Splits one CSV line with quoted cells, as iShares writes them. */
function cells(line: string): string[] {
  const result: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (char === ',' && !quoted) {
      result.push(cell)
      cell = ''
    } else cell += char
  }
  result.push(cell)
  return result.map((c) => c.trim())
}

/** `8,577,602,742.18` → 8577602742.18; a dash or text is NaN. */
function amount(text: string | undefined): number {
  return Number((text ?? '').replaceAll(',', ''))
}

/** `29/Oct/2026` → `2026-10-29`. */
function isoDate(text: string): string | undefined {
  const match = /^(\d{1,2})\/([A-Z][a-z]{2})\/(\d{4})$/.exec(text.trim())
  const month = match && MONTHS[match[2] as string]
  return match && month ? `${match[3]}-${month}-${(match[1] as string).padStart(2, '0')}` : undefined
}

let countryCodes: Map<string, string> | undefined

/** Names iShares writes differently from the runtime's region names. */
const COUNTRY_ALIASES: Record<string, string> = { 'hong kong': 'HK', macau: 'MO', 'korea (south)': 'KR', taiwan: 'TW' }

/** English country name → ISO code, from the region names the runtime knows. */
function countryCode(name: string): string | undefined {
  if (!countryCodes) {
    countryCodes = new Map()
    const names = new Intl.DisplayNames(['en'], { type: 'region' })
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b)
        try {
          const label = names.of(code)
          if (label && label !== code) countryCodes.set(label.toLowerCase(), code)
        } catch {
          // Not a region code.
        }
      }
    }
  }
  const key = name.trim().toLowerCase()
  return COUNTRY_ALIASES[key] ?? countryCodes.get(key)
}

/**
 * Parses the "Download holdings" CSV of an iShares fund: a few lines of preamble with the date, a
 * header row, then one row per holding. Only equities are kept; their weight is taken from the market
 * value over the total of every row, which is more precise than the rounded "Weight (%)" column.
 */
export function parseIsharesHoldings(csv: string, source: string): IndexWeightsFile {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/)
  const dateLine = lines.find((line) => line.startsWith('Fund Holdings as of'))
  const asOf = dateLine ? isoDate(cells(dateLine)[1] ?? '') : undefined
  if (!asOf) throw new Error('iShares holdings: no "Fund Holdings as of" date')
  const headerIndex = lines.findIndex((line) => line.startsWith('Ticker,'))
  if (headerIndex < 0) throw new Error('iShares holdings: no header row')
  const header = cells(lines[headerIndex] as string)
  const column = (name: string) => {
    const index = header.indexOf(name)
    if (index < 0) throw new Error(`iShares holdings: no "${name}" column`)
    return index
  }
  const [ticker, name, assetClass, marketValue, location] = ['Ticker', 'Name', 'Asset Class', 'Market Value', 'Location'].map(column) as number[]

  const rows = lines
    .slice(headerIndex + 1)
    .map(cells)
    .filter((row) => row.length >= header.length && row[ticker as number])
  const total = rows.reduce((sum, row) => sum + Math.max(0, amount(row[marketValue as number]) || 0), 0)
  if (!(total > 0)) throw new Error('iShares holdings: no market values')

  const holdings = rows
    .filter((row) => row[assetClass as number] === 'Equity')
    .map((row) => {
      const country = countryCode(row[location as number] ?? '')
      return {
        ticker: row[ticker as number] as string,
        name: row[name as number] as string,
        ...(country ? { country } : {}),
        weight: Number((Math.max(0, amount(row[marketValue as number]) || 0) / total).toFixed(8)),
      }
    })
    .filter((h) => h.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker))
  if (holdings.length === 0) throw new Error('iShares holdings: no equities')
  return { asOf, source, holdings }
}

/** One holding per line, so a daily commit shows a readable diff. */
export function serializeIndexWeights(file: IndexWeightsFile): string {
  return [
    '{',
    `  "asOf": ${JSON.stringify(file.asOf)},`,
    `  "source": ${JSON.stringify(file.source)},`,
    '  "holdings": [',
    file.holdings.map((h) => `    ${JSON.stringify(h)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n')
}
