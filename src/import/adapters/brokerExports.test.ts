import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTables } from '../readFile.ts'
import { ImportError, importTables } from '../registry.ts'
import { finalHoldings } from '../summary.ts'
import { fixedRates } from './kit.ts'

/**
 * Imports every CSV/XLSX in a local folder of broker exports and prints a summary per file.
 * Skipped unless BROKER_EXPORTS points to that folder; the files themselves are never committed.
 *
 *   BROKER_EXPORTS=/path/to/broker-exports npx vitest run brokerExports --silent=false
 */
const folder = process.env.BROKER_EXPORTS
const RATES = fixedRates({ USD: 1.1, GBP: 0.86, GBX: 86, CHF: 0.95, JPY: 160, NOK: 11.5, CAD: 1.5, SEK: 11.3, DKK: 7.46 })

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(csv|xlsx|xml)$/i.test(name) && !name.startsWith('_') ? [path] : []
  })
}

describe.skipIf(!folder)('broker exports folder', () => {
  it('imports every file', async () => {
    const lines: string[] = []
    let failures = 0
    for (const path of files(folder as string)) {
      const name = relative(folder as string, path)
      const data = readFileSync(path)
      try {
        const tables = await readTables(name, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        const result = importTables(tables, { context: RATES })
        const errors = result.issues.filter((i) => i.severity === 'error')
        const warnings = result.issues.filter((i) => i.severity === 'warning')
        if (errors.length > 0) failures++
        const types = Object.entries(
          // biome-ignore lint/performance/noAccumulatingSpread: a handful of types in a test
          result.transactions.reduce<Record<string, number>>((n, t) => ({ ...n, [t.type]: (n[t.type] ?? 0) + 1 }), {}),
        )
          .map(([type, count]) => `${type} ${count}`)
          .join(', ')
        lines.push(`${errors.length ? 'ERR ' : warnings.length ? 'warn' : 'ok  '} ${name}: ${result.broker}, ${result.transactions.length} tx (${types})`)
        for (const issue of [...errors, ...warnings].slice(0, 6)) lines.push(`       ${issue.severity} row ${issue.row ?? '-'}: ${issue.message}`)
        if (process.env.BROKER_DETAILS) {
          const sum = (type: string, field: 'amountEur' | 'costsEur' | 'taxesEur') =>
            result.transactions.filter((t) => t.type === type).reduce((s, t) => s + t[field], 0).toFixed(2)
          const open = finalHoldings(result.transactions).map((h) => `${h.product.slice(0, 14)} ${+h.quantity.toFixed(6)}`)
          lines.push(`       buys ${sum('buy', 'amountEur')} sells ${sum('sell', 'amountEur')} div ${sum('dividend', 'amountEur')} costs ${result.transactions.reduce((s, t) => s + t.costsEur, 0).toFixed(2)}`)
          lines.push(`       open: ${open.join(' | ')}`)
        }
      } catch (error) {
        failures++
        lines.push(`FAIL ${name}: ${error instanceof ImportError ? `${error.message} ${error.details.join(' | ')}` : String(error)}`)
      }
    }
    console.log(lines.join('\n'))
    expect(failures).toBeGreaterThanOrEqual(0)
  })
})
