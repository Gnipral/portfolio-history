import { Link } from 'react-router'
import { BENCHMARKS } from '../../market/benchmarks.ts'
import type { Settings } from '../../settings/settings.ts'
import { chosenBenchmarkIds, toggleBenchmark, type BenchmarkLine } from './benchmarkLines.ts'

type Choice = Pick<Settings, 'benchmarkId' | 'extraBenchmarkIds' | 'benchmarkMix' | 'benchmarkMixShown'>

interface Props {
  settings: Choice
  /** The lines drawn now, for the color of each switched-on chip. */
  lines: BenchmarkLine[]
  /** Gets the stored choice at the moment of saving, so quick clicks build on each other. */
  onChange: (change: (current: Choice) => Partial<Choice>) => void
}

function mixComplete(mix: Record<string, number>): boolean {
  const parts = Object.values(mix).filter((percent) => percent > 0)
  return parts.length >= 2 && Math.abs(parts.reduce((sum, percent) => sum + percent, 0) - 100) < 1e-9
}

/** Benchmarks to compare with, switched on and off right under the chart. */
export function BenchmarkPicker({ settings, lines, onChange }: Props) {
  const chosen = chosenBenchmarkIds(settings)
  const color = (id: string) => lines.find((line) => line.id === id)?.color
  const mixLine = lines.find((line) => line.id === 'mix')

  return (
    <div className="benchmark-picker" role="group" aria-label="Compare with">
      <span className="label-caps">Compare with</span>
      <div className="chips">
        {BENCHMARKS.map((b) => {
          const on = chosen.includes(b.id)
          const swatch = on ? color(b.id) : undefined
          return (
            <button
              key={b.id}
              type="button"
              className="chip"
              aria-pressed={on}
              title={b.name}
              onClick={() => onChange((current) => toggleBenchmark(current, b.id, !on))}
            >
              <i className="chip-dot" style={swatch ? { background: `var(${swatch})` } : undefined} />
              {b.symbol.split('.')[0]}
            </button>
          )
        })}
        {mixComplete(settings.benchmarkMix) && (
          <button
            type="button"
            className="chip"
            aria-pressed={settings.benchmarkMixShown}
            title={mixLine?.label ?? 'Own mix'}
            onClick={() => onChange((current) => ({ benchmarkMixShown: !current.benchmarkMixShown }))}
          >
            <i className="chip-dot" style={mixLine ? { background: `var(${mixLine.color})` } : undefined} />
            Mix
          </button>
        )}
      </div>
      <Link to="/settings" className="small">
        {mixComplete(settings.benchmarkMix) ? 'Edit mix' : 'Own mix'}
      </Link>
    </div>
  )
}
