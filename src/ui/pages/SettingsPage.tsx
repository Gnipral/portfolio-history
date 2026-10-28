import { useEffect, useState, type FormEvent } from 'react'
import { deleteAllData } from '../../data/portfolio.ts'
import { isDemo } from '../../demo/demoMode.ts'
import { AccountSection } from '../components/AccountSection.tsx'
import { BackupSection } from '../components/BackupSection.tsx'
import { DemoButton } from '../components/DemoBanner.tsx'
import { BASE_CURRENCIES, type BaseCurrency } from '../../engine/baseCurrency.ts'
import type { CostBasisMethod } from '../../engine/options.ts'
import { benchmarkCatalog } from '../../market/benchmarks.ts'
import { BenchmarkSearch } from '../components/BenchmarkSearch.tsx'
import { DEFAULT_SETTINGS, saveSettings, useSettings, type Settings, type TextSetting } from '../../settings/settings.ts'
import {
  PALETTES,
  readPalette,
  readThemePreference,
  storePalette,
  storeThemePreference,
  THEME_EVENT,
  type Palette,
  type ThemePreference,
} from '../../theme/theme.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'

const COST_BASIS: { value: CostBasisMethod; label: string; hint: string }[] = [
  { value: 'average', label: t('Average cost'), hint: t('Every unit costs the average purchase price (as most brokers show it).') },
  { value: 'fifo', label: 'FIFO', hint: t('Sales use the oldest units first.') },
]

function mixTotal(mix: Record<string, number>): number {
  return Object.values(mix).reduce((sum, percent) => sum + percent, 0)
}

export function SettingsPage() {
  const stored = useSettings()
  const [form, setForm] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)

  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)
  const [palette, setPalette] = useState<Palette>(readPalette)
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

  const catalog = benchmarkCatalog(form.customBenchmarks)

  const field = (key: TextSetting) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => {
      setSaved(false)
      setForm({ ...form, [key]: e.target.value })
    },
  })

  return (
    <section className="stack">
      <h2>{t('Settings')}</h2>
      <form className="stack settings-form" onSubmit={(e) => void submit(e)}>
        <fieldset>
          <legend>{t('Price sources')}</legend>
          <p className="muted small">
            {t('Prices come by themselves through the price service of the app: you do not need to fill in anything here.')}
          </p>
          <details>
            <summary>{t('Advanced: own price sources')}</summary>
            <p className="muted small">
              {t('Only needed when a product has no price on the Prices page. A source is asked only when the ones above it have no price. Keys are stored in this browser only. Crypto prices come from CoinGecko without a key.')}
            </p>
            <label>
              {t('Price proxy URL')}
              <input type="url" placeholder="https://portfolio-history-price-proxy.example.workers.dev" {...field('proxyUrl')} />
              <span className="muted small">{t('Filled in already. Only change it if you run your own copy (workers/price-proxy in the repository).')}</span>
            </label>
            <label>
              {t('Twelve Data API key (optional)')}
              <input type="password" autoComplete="off" {...field('twelveDataKey')} />
              <span className="muted small">{t('A free key from twelvedata.com is enough: up to 800 prices a day.')}</span>
            </label>
            <label>
              {t('Alpha Vantage API key (optional)')}
              <input type="password" autoComplete="off" {...field('alphaVantageKey')} />
              <span className="muted small">{t('A free key from alphavantage.co gives 25 prices a day, of the last 100 trading days only: a last resort.')}</span>
            </label>
          </details>
        </fieldset>
        <fieldset>
          <legend>{t('Benchmark')}</legend>
          <label>
            {t('Compare the portfolio with')}
            <select {...field('benchmarkId')}>
              <option value="">{t('Nothing')}</option>
              {catalog.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.symbol})
                </option>
              ))}
            </select>
            <span className="muted small">
              {t('The dashboard shows what the same deposits and withdrawals, on the same days, would have become in this fund.')}{' '}
              {t('This is the default; under the chart you can compare with something else for a moment.')}
            </span>
          </label>
          <div className="stack" role="group" aria-label={t('Own stocks to compare with')}>
            <span>{t('Own stocks to compare with')}</span>
            {form.customBenchmarks.length > 0 && (
              <ul className="benchmark-results">
                {form.customBenchmarks.map((b) => (
                  <li key={b.id}>
                    <span>
                      <strong>{b.symbol}</strong> {b.name}
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={t('Remove {name}', { name: b.name })}
                      onClick={() => {
                        setSaved(false)
                        const mix = Object.fromEntries(Object.entries(form.benchmarkMix).filter(([id]) => id !== b.id))
                        setForm({
                          ...form,
                          customBenchmarks: form.customBenchmarks.filter((c) => c.id !== b.id),
                          benchmarkId: form.benchmarkId === b.id ? '' : form.benchmarkId,
                          extraBenchmarkIds: form.extraBenchmarkIds.filter((id) => id !== b.id),
                          benchmarkMix: mix,
                        })
                      }}
                    >
                      {t('Remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <BenchmarkSearch
              onPick={(benchmark) => {
                if (catalog.some((b) => b.symbol === benchmark.symbol)) return
                setSaved(false)
                setForm({ ...form, customBenchmarks: [...form.customBenchmarks, benchmark] })
              }}
            />
          </div>
          <div className="stack" role="group" aria-label={t('Also show')}>
            <span>{t('Also show')}</span>
            {catalog.filter((b) => b.id !== form.benchmarkId).map((b) => (
              <label key={b.id} className="radio">
                <input
                  type="checkbox"
                  checked={form.extraBenchmarkIds.includes(b.id)}
                  onChange={(e) => {
                    setSaved(false)
                    const others = form.extraBenchmarkIds.filter((id) => id !== b.id)
                    setForm({ ...form, extraBenchmarkIds: e.target.checked ? [...others, b.id] : others })
                  }}
                />
                <span>{b.name}</span>
              </label>
            ))}
          </div>
          <div className="stack" role="group" aria-label={t('Benchmark mix')}>
            <span>{t('Own mix in percent, shown as one more line when the parts add up to 100')}</span>
            <div className="mix-grid">
              {catalog.map((b) => (
                <label key={b.id}>
                  {b.symbol}
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    inputMode="numeric"
                    value={form.benchmarkMix[b.id] ?? ''}
                    onChange={(e) => {
                      setSaved(false)
                      const percent = Number(e.target.value)
                      const rest = Object.fromEntries(Object.entries(form.benchmarkMix).filter(([id]) => id !== b.id))
                      setForm({ ...form, benchmarkMix: percent > 0 ? { ...rest, [b.id]: Math.min(percent, 100) } : rest })
                    }}
                  />
                </label>
              ))}
            </div>
            {mixTotal(form.benchmarkMix) > 0 && mixTotal(form.benchmarkMix) !== 100 && (
              <span className="muted small" role="status">
                {t('The parts add up to {total}%, not 100%: the mix is not shown.', { total: mixTotal(form.benchmarkMix) })}
              </span>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t('Calculation')}</legend>
          <label>
            {t('Currency')}
            <select
              value={form.baseCurrency}
              onChange={(e) => {
                setSaved(false)
                setForm({ ...form, baseCurrency: e.target.value as BaseCurrency })
              }}
            >
              {BASE_CURRENCIES.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
            <span className="muted small">
              {t('Every amount and return is calculated in this currency, at the ECB rate of each day. Exchange rate changes then count in your result.')}
            </span>
          </label>
          <div className="radio-group" role="radiogroup" aria-label={t('Cost basis')}>
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
            {t('Save')}
          </button>
          {saved && <span role="status">{t('Saved.')}</span>}
        </div>
      </form>

      <div className="stack settings-form">
        <fieldset>
          <legend>{t('Appearance')}</legend>
          <label>
            {t('Theme')}
            <select
              value={theme}
              onChange={(e) => {
                const next = e.target.value as ThemePreference
                storeThemePreference(next)
                setTheme(next)
              }}
            >
              <option value="system">{t('Follow the system')}</option>
              <option value="light">{t('Light')}</option>
              <option value="dark">{t('Dark')}</option>
            </select>
          </label>
          <div className="palette-picker" role="radiogroup" aria-label={t('Chart colors')}>
            <span>{t('Chart colors')}</span>
            {PALETTES.map((p) => (
              <label key={p.id} className="palette-option">
                <input
                  type="radio"
                  name="palette"
                  value={p.id}
                  checked={palette === p.id}
                  onChange={() => {
                    storePalette(p.id)
                    setPalette(p.id)
                  }}
                />
                <span className="palette-swatches" aria-hidden="true">
                  {p.swatches.map((color) => (
                    <i key={color} style={{ background: color }} />
                  ))}
                </span>
                <span>
                  <strong>{t(p.label)}</strong>
                  <span className="muted small"> {t(p.description)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {!isDemo() && <BackupSection />}

        <AccountSection />

        <fieldset>
          <legend>{t('Demo')}</legend>
          <p className="muted small">
            {isDemo()
              ? t('You are looking at a made-up portfolio with its own settings. Leave the demo to get back to your own data.')
              : t('Look around in a made-up portfolio with prices that need no connection. Your own data is kept apart and stays untouched.')}
          </p>
          <div className="actions">
            <DemoButton />
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('Data')}</legend>
          <p className="muted small">
            {t('Everything is stored in this browser only: the imported transactions, cached prices and exchange rates, and these settings, including API keys.')}
          </p>
          {deleted && <p role="status">{t('All data has been deleted from this browser.')}</p>}
          {confirmDelete ? (
            <div className="callout warning" role="alertdialog" aria-label={t('Delete all data')}>
              <p>
                <strong>{t('Delete all data?')}</strong>{' '}
                {t('This removes the portfolio, the price cache and the settings from this browser. It cannot be undone; you can import the export again afterwards.')}
              </p>
              <div className="actions">
                <button type="button" className="danger" onClick={() => void removeEverything()}>
                  {t('Delete everything')}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
                {t('Delete all data')}
              </button>
            </div>
          )}
        </fieldset>
      </div>
      <p className="muted small credits">
        <Rich
          text={t('Charts made with <link>TradingView Lightweight Charts</link>.')}
          tags={{ link: (s) => <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">{s}</a> }}
        />
      </p>
    </section>
  )
}
