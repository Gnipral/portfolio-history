import { describe, expect, it } from 'vitest'
import type { LoadedBenchmark } from '../../engine/loadInputs.ts'
import { BENCHMARKS } from '../../market/benchmarks.ts'
import { PriceSeries } from '../../market/priceCache.ts'
import { benchmarkLines, mixWeights } from './benchmarkLines.ts'

const loaded: LoadedBenchmark[] = BENCHMARKS.map((info, i) => ({
  info,
  series: PriceSeries.fromPoints(info.symbol, [
    { symbol: info.symbol, date: '2026-01-05', close: 100 },
    { symbol: info.symbol, date: '2026-01-06', close: 100 + 10 * (i + 1) },
  ]),
}))
const days = [
  { date: '2026-01-05', inflow: 1000, outflow: 0 },
  { date: '2026-01-06', inflow: 0, outflow: 0 },
]

describe('benchmarkLines', () => {
  it('shows the main benchmark, the extra ones and a mix that adds up to 100%', () => {
    const lines = benchmarkLines(days, loaded, { benchmarkId: 'iwda', extraBenchmarkIds: ['sxr8'], benchmarkMix: { iwda: 50, vwce: 50 } })
    expect(lines.map((l) => l.label)).toEqual(['IWDA', 'SXR8', 'Mix 50% IWDA / 50% VWCE'])
    // IWDA +10%, VWCE +20%: the mix gains 15%.
    expect(lines[2]?.points.at(-1)?.value).toBeCloseTo(1150, 9)
    expect(new Set(lines.map((l) => l.color)).size).toBe(3)
  })

  it('has no mix when the parts do not add up to 100%', () => {
    expect(mixWeights({ iwda: 60, vwce: 30 }, loaded)).toBeNull()
    expect(benchmarkLines(days, loaded, { benchmarkId: 'iwda', extraBenchmarkIds: [], benchmarkMix: { iwda: 60, vwce: 30 } })).toHaveLength(1)
  })
})
