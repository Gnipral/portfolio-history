import { useState } from 'react'
import { Link } from 'react-router'
import { t } from '../../i18n/i18n.ts'
import type { Benchmark } from '../../market/benchmarks.ts'
import type { Settings } from '../../settings/settings.ts'
import { BenchmarkSearch } from '../components/BenchmarkSearch.tsx'
import { chosenBenchmarkIds, toggleBenchmark, type BenchmarkLine } from './benchmarkLines.ts'

export type BenchmarkChoice = Pick<Settings, 'benchmarkId' | 'extraBenchmarkIds' | 'benchmarkMix' | 'benchmarkMixShown'>

interface Props {
  /** What the chart compares with now. */
  settings: BenchmarkChoice
  /** Every benchmark there is to choose from: the built-in ones and the stocks added with the search. */
  catalog: Benchmark[]
  /** The lines drawn now, for the color of each switched-on chip. */
  lines: BenchmarkLine[]
  /** Gets the choice at the moment of the click, so quick clicks build on each other. */
  onChange: (change: (current: BenchmarkChoice) => Partial<BenchmarkChoice>) => void
  /** A stock found with the search: added to the catalog and switched on. */
  onAdd: (benchmark: Benchmark) => void
  /** The chart shows another choice than the default of the settings; `onReset` goes back to it. */
  temporary: boolean
  onReset: () => void
}

function mixComplete(mix: Record<string, number>): boolean {
  const parts = Object.values(mix).filter((percent) => percent > 0)
  return parts.length >= 2 && Math.abs(parts.reduce((sum, percent) => sum + percent, 0) - 100) < 1e-9
}

/** Benchmarks to compare with, switched on and off right under the chart, for now; the default is in Settings. */
export function BenchmarkPicker({ settings, catalog, lines, onChange, onAdd, temporary, onReset }: Props) {
  const [searching, setSearching] = useState(false)
  const chosen = chosenBenchmarkIds(settings)
  const color = (id: string) => lines.find((line) => line.id === id)?.color
  const mixLine = lines.find((line) => line.id === 'mix')

  return (
    <div className="benchmark-picker" role="group" aria-label={t('Compare with')}>
      <span className="label-caps">{t('Compare with')}</span>
      <div className="chips">
        {catalog.map((b) => {
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
            title={mixLine?.label ?? t('Own mix')}
            onClick={() => onChange((current) => ({ benchmarkMixShown: !current.benchmarkMixShown }))}
          >
            <i className="chip-dot" style={mixLine ? { background: `var(${mixLine.color})` } : undefined} />
            {t('Mix')}
          </button>
        )}
        <button type="button" className="chip" aria-expanded={searching} onClick={() => setSearching(!searching)}>
          + {t('Other stock')}
        </button>
      </div>
      {temporary ? (
        <button type="button" className="link-button small" onClick={onReset}>
          {t('Back to the default')}
        </button>
      ) : (
        <Link to="/settings" className="small">
          {t('Default and mix')}
        </Link>
      )}
      <details className="benchmark-method small">
        <summary>{t('How is this compared?')}</summary>
        <p className="muted">
          {t("IWDA, VWCE and SXR8 are accumulating ETFs quoted in EUR: their dividends are reinvested inside the fund, so the price already includes them. Every euro you put in buys the benchmark on the same day; every euro you take out sells it. Broker fees and taxes such as the Belgian TOB are left out, so a real account would end slightly lower. Another base currency or a stock you add is converted at the ECB rate of the day.")}
        </p>
      </details>
      {searching && (
        <div className="benchmark-picker-search">
          <BenchmarkSearch
            autoFocus
            onPick={(benchmark) => {
              onAdd(benchmark)
              setSearching(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
