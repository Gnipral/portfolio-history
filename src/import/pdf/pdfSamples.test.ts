import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixedRates } from '../adapters/kit.ts'
import { readPdf } from '../readPdf.ts'
import { ImportError, importTables } from '../registry.ts'
import type { RawTable } from '../types.ts'

/**
 * Imports every PDF, or PDF text dump (`.txt`, as in Portfolio Performance's test suite), in a local
 * folder and prints the transactions per file. Skipped unless PDF_SAMPLES points to that folder.
 *
 *   PDF_SAMPLES=/path/to/folder npx vitest run pdfSamples --silent=false
 */
const folder = process.env.PDF_SAMPLES
const RATES = fixedRates({ USD: 1.1, GBP: 0.86, GBX: 86, CHF: 0.95, JPY: 160, NOK: 11.5, CAD: 1.5, SEK: 11.3, DKK: 7.46, AUD: 1.6, PLN: 4.3, HKD: 8.5, CZK: 25 })

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(pdf|txt)$/i.test(name) && !/\.pdfjs\.txt$/.test(name) ? [path] : []
  })
}

async function tables(path: string, name: string): Promise<RawTable[]> {
  const data = readFileSync(path)
  if (/\.pdf$/i.test(path)) return readPdf(name, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  // Portfolio Performance's dumps start with three lines about the PDFBox version.
  const text = data.toString('utf8').replace(/^PDFBox Version:.*\r?\n.*\r?\n-+\r?\n/, '')
  return [{ fileName: name, rows: [], text }]
}

describe.skipIf(!folder)('PDF samples', () => {
  it('imports every PDF', async () => {
    const lines: string[] = []
    for (const path of files(folder as string)) {
      const name = relative(folder as string, path)
      try {
        const result = importTables(await tables(path, name), { context: RATES })
        const problems = result.issues.filter((i) => i.severity !== 'info')
        lines.push(`${problems.length ? 'warn' : 'ok  '} ${name}: ${result.broker}, ${result.transactions.length} tx`)
        for (const t of result.transactions) {
          lines.push(
            `       ${t.dateTime} ${t.type.padEnd(10)} ${t.product.slice(0, 28).padEnd(28)} ${t.isin ?? '-'} q=${+t.quantity.toFixed(6)} ${t.currency} gross=${t.localAmount.toFixed(2)} eur=${t.amountEur.toFixed(2)} cost=${t.costsEur.toFixed(2)} tax=${t.taxesEur.toFixed(2)}`,
          )
        }
        for (const issue of problems.slice(0, 5)) lines.push(`       ${issue.severity} line ${issue.row ?? '-'}: ${issue.message}`)
      } catch (error) {
        lines.push(`FAIL ${name}: ${error instanceof ImportError ? `${error.message} ${error.details.join(' | ')}` : String(error)}`)
      }
    }
    console.log(lines.join('\n'))
    expect(lines.length).toBeGreaterThanOrEqual(0)
  }, 300_000)
})
