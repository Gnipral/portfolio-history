import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTables } from '../../readFile.ts'
import { importTables } from '../../registry.ts'
import { finalHoldings, summarize } from '../../summary.ts'

/**
 * Sanity checks against a real export that is never committed:
 *   DEGIRO_SAMPLE=path/to/Transactions.xlsx npx vitest run privateSample
 * Several files can be given, separated by the OS path delimiter.
 */
const samplePaths = (process.env.DEGIRO_SAMPLE ?? '').split(/[;]/).filter(Boolean)

describe.skipIf(samplePaths.length === 0)('DEGIRO private sample', () => {
  it('imports without errors and with consistent amounts', async () => {
    const tables = (
      await Promise.all(
        samplePaths.map((p) => {
          const data = readFileSync(p)
          return readTables(basename(p), data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        }),
      )
    ).flat()
    const result = importTables(tables)

    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
    for (const t of result.transactions) {
      expect(Number.isFinite(t.totalEur), t.id).toBe(true)
      if (t.type === 'buy' || t.type === 'sell') {
        // total = value - costs - AutoFX, within rounding of the export
        expect(t.totalEur, t.id).toBeCloseTo(t.amountEur - t.costsEur - t.fxCostsEur, 1)
        expect(Math.sign(t.amountEur), t.id).toBe(t.type === 'buy' ? -1 : 1)
      }
    }
    for (const h of finalHoldings(result.transactions)) expect(h.quantity, h.product).toBeGreaterThan(0)

    const summary = summarize(result.transactions)
    console.info(JSON.stringify({ ...summary, issues: result.issues }, null, 2))
  })
})
