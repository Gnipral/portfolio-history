import { useEffect, useState, type FormEvent } from 'react'
import { deleteAllData } from '../../data/portfolio.ts'
import type { CostBasisMethod } from '../../engine/options.ts'
import { BENCHMARKS } from '../../market/benchmarks.ts'
import { DEFAULT_SETTINGS, saveSettings, useSettings, type Settings, type TextSetting } from '../../settings/settings.ts'
import { readThemePreference, storeThemePreference, THEME_EVENT, type ThemePreference } from '../../theme/theme.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'

const COST_BASIS: { value: CostBasisMethod; label: string; hint: string }[] = [
  { value: 'average', label: 'Average cost', hint: 'Every unit costs the average purchase price (as most brokers show it).' },
  { value: 'fifo', label: 'FIFO', hint: 'Sales use the oldest units first.' },
]

export function SettingsPage() {
  const stored = useSettings()
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleted, setDeleted] = useState(false)

  useEffect(() => {
    if (stored) setForm(stored)
  }, [stored])

  useEffect(() => {
    const update = () => setTheme(readThemePreference())
    window.addEventListener(THEME_EVENT, update)
    return () => window.removeEventListener(THEME_EVENT, update)
  }, [])

  async function removeEverything() {
    await deleteAllData()
    resetSyncSession()
    setConfirmDelete(false)
    setDeleted(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setForm(await saveSettings(form))
    setSaved(true)
  }

  const field = (key: TextSetting) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => {
      setSaved(false)
      setForm({ ...form, [key]: e.target.value })
    },
  })

  return (
    <section className="stack">
      <h2>Settings</h2>
      <form className="stack settings-form" onSubmit={(e) => void submit(e)}>
        <fieldset>
          <legend>Price sources</legend>
          <p className="muted small">
            Keys and URLs are stored only in this browser. Prices are fetched from the first source that has them: the
            price proxy, then Twelve Data, then Alpha Vantage. Crypto prices come from CoinGecko without a key.
          </p>
          <label>
            Price proxy URL
            <input type="url" placeholder="https://portfolio-history-price-proxy.example.workers.dev" {...field('proxyUrl')} />
            <span className="muted small">Yahoo Finance prices and ISIN lookup. See workers/price-proxy in the repository.</span>
          </label>
          <label>
            Twelve Data API key
            <input type="password" autoComplete="off" {...field('twelveDataKey')} />
            <span className="muted small">Free plan: 800 requests per day, 8 per minute.</span>
          </label>
          <label>
            Alpha Vantage API key
            <input type="password" autoComplete="off" {...field('alphaVantageKey')} />
            <span className="muted small">Free plan: 25 requests per day, last 100 trading days only.</span>
          </label>
        </fieldset>
        <fieldset>
          <legend>Benchmark</legend>
          <label>
            Compare the portfolio with
            <select {...field('benchmarkId')}>
              {BENCHMARKS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.symbol})
                </option>
              ))}
            </select>
            <span className="muted small">
              The dashboard shows what the same deposits and withdrawals, on the same days, would have become in this fund.
            </span>
          </label>
        </fieldset>
        <fieldset>
          <legend>Calculation</legend>
          <div className="radio-group" role="radiogroup" aria-label="Cost basis">
            {COST_BASIS.map((option) => (
              <label key={option.value} className="radio">
                <input
                  type="radio"
                  name="costBasis"
                  value={option.value}
                  checked={form.costBasis === option.value}
                  onChange={() => {
                    setSaved(false)
                    setForm({ ...form, costBasis: option.value })
                  }}
                />
                <span>
                  {option.label}
                  <span className="muted small"> · {option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="actions">
          <button type="submit" className="primary">
            Save
          </button>
          {saved && <span role="status">Saved.</span>}
        </div>
      </form>

      <div className="stack settings-form">
        <fieldset>
          <legend>Appearance</legend>
          <label>
            Theme
            <select
              value={theme}
              onChange={(e) => {
                const next = e.target.value as ThemePreference
                storeThemePreference(next)
                setTheme(next)
              }}
            >
              <option value="system">Follow the system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Data</legend>
          <p className="muted small">
            Everything is stored in this browser only: the imported transactions, cached prices and exchange rates, and these
            settings, including API keys.
          </p>
          {deleted && <p role="status">All data has been deleted from this browser.</p>}
          {confirmDelete ? (
            <div className="callout warning" role="alertdialog" aria-label="Delete all data">
              <p>
                <strong>Delete all data?</strong> This removes the portfolio, the price cache and the settings from this
                browser. It cannot be undone; you can import the export again afterwards.
              </p>
              <div className="actions">
                <button type="button" className="danger" onClick={() => void removeEverything()}>
                  Delete everything
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
                Delete all data
              </button>
            </div>
          )}
        </fieldset>
      </div>
    </section>
  )
}
