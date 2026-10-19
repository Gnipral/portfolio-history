import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_SETTINGS, saveSettings, useSettings, type Settings } from '../../settings/settings.ts'

export function SettingsPage() {
  const stored = useSettings()
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (stored) setForm(stored)
  }, [stored])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setForm(await saveSettings(form))
    setSaved(true)
  }

  const field = (key: keyof Settings) => ({
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
        <div className="actions">
          <button type="submit" className="primary">
            Save
          </button>
          {saved && <span role="status">Saved.</span>}
        </div>
      </form>
    </section>
  )
}
