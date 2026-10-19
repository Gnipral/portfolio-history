/**
 * Daily snapshot of FX rates and benchmark closes into public/data/.
 * Run with: node scripts/snapshot-data.ts
 * Writes the commit message to $COMMIT_MESSAGE_FILE when set (used by the workflow).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCHMARKS, DATA_START, FX_CURRENCIES, FX_FILE, META_FILE, benchmarkFile } from './lib/config.ts'
import {
  addDays,
  closeStats,
  commitMessage,
  fxStats,
  mergeCloses,
  mergeFx,
  serializeBenchmark,
  serializeFx,
  type BenchmarkFile,
  type FileStats,
  type FxFile,
  type MetaFile,
} from './lib/snapshot.ts'
import { fetchDailyCloses, fetchFxSeries } from './lib/sources.ts'

const DATA_DIR = join(import.meta.dirname, '..', 'public', 'data')
const FX_SOURCE = 'European Central Bank reference rates via Frankfurter (api.frankfurter.dev)'
const BENCHMARK_SOURCE = 'Yahoo Finance daily closes'

function readJson<T>(file: string): T | null {
  const path = join(DATA_DIR, file)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null
}

/** Writes only when the content changed; returns whether it did. */
function writeIfChanged(file: string, content: string): boolean {
  const path = join(DATA_DIR, file)
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false
  writeFileSync(path, content)
  return true
}

async function main() {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const changes: Record<string, number> = {}
  const files: Record<string, FileStats> = {}
  const errors: string[] = []

  // FX rates
  const existingFx = readJson<FxFile>(FX_FILE)
  try {
    const sameCurrencies = existingFx?.currencies.join() === FX_CURRENCIES.join()
    const lastFx = sameCurrencies ? Object.keys(existingFx?.rates ?? {}).sort().at(-1) : undefined
    const from = lastFx ? addDays(lastFx, 1) : DATA_START
    const fetched = from <= today ? await fetchFxSeries(from, today, FX_CURRENCIES) : {}
    const { file, added } = mergeFx(sameCurrencies ? existingFx : null, fetched, FX_CURRENCIES, DATA_START, FX_SOURCE)
    writeIfChanged(FX_FILE, serializeFx(file))
    changes['FX rates'] = added
    files[FX_FILE] = fxStats(file)
  } catch (error) {
    errors.push(`FX rates: ${String(error)}`)
    if (existingFx) files[FX_FILE] = fxStats(existingFx)
  }

  // Benchmarks
  for (const benchmark of BENCHMARKS) {
    const name = benchmarkFile(benchmark.id)
    const existing = readJson<BenchmarkFile>(name)
    try {
      const last = existing?.closes.at(-1)?.[0]
      // Re-request a few days back; the merge only appends dates after the last stored one.
      const fetched = await fetchDailyCloses(benchmark.symbol, last ? addDays(last, -5) : DATA_START, now)
      const { closes, added } = mergeCloses(existing?.closes ?? [], fetched)
      const file: BenchmarkFile = { ...benchmark, source: BENCHMARK_SOURCE, closes }
      writeIfChanged(name, serializeBenchmark(file))
      changes[benchmark.symbol] = added
      files[name] = closeStats(closes)
    } catch (error) {
      errors.push(`${benchmark.symbol}: ${String(error)}`)
      if (existing) files[name] = closeStats(existing.closes)
    }
  }

  const meta: MetaFile = {
    lastCheck: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    sources: {
      [FX_FILE]: FX_SOURCE,
      ...Object.fromEntries(BENCHMARKS.map((b) => [benchmarkFile(b.id), `${BENCHMARK_SOURCE} (${b.symbol})`])),
    },
    files,
    errors,
  }
  writeFileSync(join(DATA_DIR, META_FILE), `${JSON.stringify(meta, null, 2)}\n`)

  const message = commitMessage(today, changes, errors)
  if (process.env.COMMIT_MESSAGE_FILE) writeFileSync(process.env.COMMIT_MESSAGE_FILE, message)
  console.log(message)
  for (const error of errors) console.log(`::warning::${error}`)
  if (Object.keys(files).length === 0) process.exit(1)
}

await main()
