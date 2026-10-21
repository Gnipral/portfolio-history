import { simulateBenchmark, simulateMix, type BenchmarkPoint } from '../../engine/benchmark.ts'
import type { LoadedBenchmark } from '../../engine/loadInputs.ts'
import type { Settings } from '../../settings/settings.ts'

/** A benchmark line on the dashboard: one fund, or a mix of them. */
export interface BenchmarkLine {
  id: string
  label: string
  points: BenchmarkPoint[]
  /** CSS variable of its color. */
  color: string
}

interface FlowPoint {
  date: string
  inflow: number
  outflow: number
}

/** Categorical slots for benchmark lines; never cyan or blue, which is the portfolio's own value line. */
const COLORS = ['--series-2', '--series-7', '--series-5', '--series-6']

export function shortLabel(benchmark: LoadedBenchmark): string {
  return benchmark.info.symbol.split('.')[0] ?? benchmark.info.id
}

/** Weights of the mix as fractions, when its percentages add up to 100 and every part has closes. */
export function mixWeights(mix: Record<string, number>, loaded: LoadedBenchmark[]): { benchmark: LoadedBenchmark; weight: number }[] | null {
  const parts = Object.entries(mix).filter(([, percent]) => percent > 0)
  const total = parts.reduce((sum, [, percent]) => sum + percent, 0)
  if (parts.length < 2 || Math.abs(total - 100) > 1e-9) return null
  const resolved = parts.map(([id, percent]) => ({ benchmark: loaded.find((b) => b.info.id === id), weight: percent / 100 }))
  return resolved.every((p) => p.benchmark) ? (resolved as { benchmark: LoadedBenchmark; weight: number }[]) : null
}

type BenchmarkChoice = Pick<Settings, 'benchmarkId' | 'extraBenchmarkIds' | 'benchmarkMix'> & Partial<Pick<Settings, 'benchmarkMixShown'>>

/** The benchmark ids switched on, the main one first. */
export function chosenBenchmarkIds(settings: Pick<Settings, 'benchmarkId' | 'extraBenchmarkIds'>): string[] {
  return [settings.benchmarkId, ...settings.extraBenchmarkIds.filter((id) => id !== settings.benchmarkId)].filter(Boolean)
}

/** Switches one benchmark on or off; the first one left on becomes the main one, none left: no benchmark. */
export function toggleBenchmark(
  settings: Pick<Settings, 'benchmarkId' | 'extraBenchmarkIds'>,
  id: string,
  on: boolean,
): Pick<Settings, 'benchmarkId' | 'extraBenchmarkIds'> {
  const others = chosenBenchmarkIds(settings).filter((chosen) => chosen !== id)
  const ids = on ? [...others, id] : others
  return { benchmarkId: ids[0] ?? '', extraBenchmarkIds: ids.slice(1) }
}

/** The main benchmark, the extra ones and the mix, as chosen in the settings or on the dashboard. */
export function benchmarkLines(days: FlowPoint[], loaded: LoadedBenchmark[], settings: BenchmarkChoice): BenchmarkLine[] {
  const ids = chosenBenchmarkIds(settings)
  const lines: BenchmarkLine[] = ids.flatMap((id) => {
    const benchmark = loaded.find((b) => b.info.id === id)
    return benchmark ? [{ id, label: shortLabel(benchmark), points: simulateBenchmark(days, benchmark.series), color: '' }] : []
  })
  const mix = settings.benchmarkMixShown === false ? null : mixWeights(settings.benchmarkMix, loaded)
  if (mix) {
    lines.push({
      id: 'mix',
      label: `Mix ${mix.map((p) => `${Math.round(p.weight * 100)}% ${shortLabel(p.benchmark)}`).join(' / ')}`,
      points: simulateMix(days, mix.map((p) => ({ prices: p.benchmark.series, weight: p.weight }))),
      color: '',
    })
  }
  return lines.map((line, i) => ({ ...line, color: COLORS[i % COLORS.length] as string }))
}
