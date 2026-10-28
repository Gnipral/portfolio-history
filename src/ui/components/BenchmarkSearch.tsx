import { useEffect, useState } from 'react'
import { t } from '../../i18n/i18n.ts'
import { customBenchmark, type Benchmark } from '../../market/benchmarks.ts'
import { searchSymbols, type SymbolSearchResult } from '../../market/search.ts'
import { DEFAULT_SETTINGS, useSettings } from '../../settings/settings.ts'

/** Wait this long after the last key before searching, so typing a name asks once. */
const DEBOUNCE_MS = 350

/** Finds a stock, ETF, fund or index by name or ticker, to compare the portfolio with. */
export function BenchmarkSearch({ onPick, autoFocus = false }: { onPick: (benchmark: Benchmark) => void; autoFocus?: boolean }) {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SymbolSearchResult[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query.trim()
    setError('')
    if (q.length < 2) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchSymbols(q, settings)
        .then((found) => {
          if (!cancelled) setResults(found)
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e))
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, settings])

  return (
    <div className="benchmark-search stack">
      <input
        type="search"
        aria-label={t('Search a stock, fund or index')}
        placeholder={t('Name or ticker, e.g. Apple or ASML')}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        // Inside the settings form, Enter would save the settings instead of searching.
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault()
        }}
      />
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      {results && results.length === 0 && <p className="muted small">{t('Nothing found.')}</p>}
      {results && results.length > 0 && (
        <ul className="benchmark-results">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onPick(customBenchmark(r))
                  setQuery('')
                }}
              >
                <strong>{r.symbol}</strong> {r.name}
              </button>
              <span className="muted small">{[r.exchange, r.type].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
