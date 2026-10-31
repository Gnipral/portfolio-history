import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { accountAvailable } from '../../account/account.ts'
import { db } from '../../data/db.ts'
import { deleteAllData } from '../../data/portfolio.ts'
import { isDemo } from '../../demo/demoMode.ts'
import { BASE_CURRENCIES, type BaseCurrency } from '../../engine/baseCurrency.ts'
import type { CostBasisMethod } from '../../engine/options.ts'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { benchmarkCatalog } from '../../market/benchmarks.ts'
import { instrumentKey } from '../../market/instruments.ts'
import {
  DEFAULT_SETTINGS,
  saveSettings,
  updateSettings,
  useSettings,
  type AlphaMethod,
  type LaunchRange,
  type Settings,
  type TextSetting,
} from '../../settings/settings.ts'
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
import { AccountSection } from '../components/AccountSection.tsx'
import { BackupSection } from '../components/BackupSection.tsx'
import { BenchmarkSearch } from '../components/BenchmarkSearch.tsx'
import { DemoButton } from '../components/DemoBanner.tsx'
import { Figure, Section } from '../components/Section.tsx'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import './pages.css'
import './settings.css'

const COST_BASIS: { value: CostBasisMethod; label: string; hint: string }[] = [
  { value: 'average', label: t('Average cost'), hint: t('Every unit costs the average purchase price (as most brokers show it).') },
  { value: 'fifo', label: 'FIFO', hint: t('Sales use the oldest units first.') },
]

const ALPHA_METHODS: { value: AlphaMethod; label: string; hint: string }[] = [
  { value: 'arithmetic', label: t('Arithmetic difference'), hint: t('Your yearly return minus that of the benchmark: 8% against 6% is 2%.') },
  { value: 'geometric', label: t('Geometric ratio'), hint: t('How much more one euro grew: 1.08 / 1.06 − 1 is 1.9%.') },
]

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: t('Light') },
  { value: 'dark', label: t('Dark') },
  { value: 'system', label: t('System') },
]

const LAUNCH_RANGES: { value: LaunchRange; label: string }[] = [
  { value: 'ALL', label: t('All') },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: '3Y', label: '3Y' },
]

const SECTIONS: { id: string; title: string }[] = [
  { id: 'display', title: t('Display') },
  { id: 'calculation', title: t('Calculation') },
  { id: 'benchmark', title: t('Benchmark') },
  { id: 'price-sources', title: t('Price sources') },
  { id: 'account', title: t('Account') },
  { id: 'data', title: t('Data') },
  { id: 'demo', title: t('Demo') },
]

function mixTotal(mix: Record<string, number>): number {
  return Object.values(mix).reduce((sum, percent) => sum + percent, 0)
}

/** A row of buttons of which one is chosen, with a label above it and a note under it. */
function Choice<T extends string | number>({
  id,
  label,
  options,
  value,
  onChange,
  note,
}: {
  id: string
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  note?: ReactNode
}) {
  return (
    <div className="field">
      <span className="label-caps" id={id}>
        {label}
      </span>
      <div className="segmented settings-segmented" role="group" aria-labelledby={id}>
        {options.map((option) => (
          <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
      {note && <span className="note">{note}</span>}
    </div>
  )
}

/** One radio per option, each with its name and a line on what it does. */
function RadioList<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string
  name: string
  options: { value: T; label: string; hint: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="field">
      <span className="label-caps">{label}</span>
      <div className="choice-list" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label key={option.value} className={`choice${value === option.value ? ' chosen' : ''}`}>
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
            <span>
              <strong>{option.label}</strong>
              <span className="muted small">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

/** Real figures of what this browser stores: transactions, products, prices and the space it takes. */
function StorageInfo() {
  const counts = useLiveQuery(async () => {
    const [transactions, prices] = await Promise.all([db.transactions.toArray(), db.prices.count()])
    const products = new Set(transactions.filter((tx) => tx.quantity > 0 && (tx.isin || tx.product)).map(instrumentKey)).size
    return { transactions: transactions.length, products, prices }
  })
  const [usage, setUsage] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (!cancelled && estimate.usage !== undefined) setUsage(estimate.usage)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const size = usage === null ? '–' : usage >= 1024 * 1024 ? `${(usage / 1024 / 1024).toFixed(1)} MB` : `${Math.round(usage / 1024)} kB`
  return (
    <div className="figures" role="group" aria-label={t('Stored in this browser')}>
      <Figure label={t('Transactions')} value={counts?.transactions ?? '–'} />
      <Figure label={t('Products')} value={counts?.products ?? '–'} />
      <Figure label={t('Stored prices')} value={counts?.prices ?? '–'} note={t('daily closes')} />
      <Figure label={t('Space used')} value={size} note={t('as the browser reports it')} />
    </div>
  )
}

export function SettingsPage() {
  const stored = useSettings()
  const settings = stored ?? DEFAULT_SETTINGS
  // The price sources are typed: they are saved with their own button, not on every key.
  const [sources, setSources] = useState<Pick<Settings, TextSetting>>(DEFAULT_SETTINGS)
  const [sourcesSaved, setSourcesSaved] = useState(false)
  const [changed, setChanged] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference)
  const [palette, setPalette] = useState<Palette>(readPalette)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [active, setActive] = useState(SECTIONS[0]?.id ?? '')

  useEffect(() => {
    if (stored) setSources(stored)
  }, [stored])

  useEffect(() => {
    const update = () => setTheme(readThemePreference())
    window.addEventListener(THEME_EVENT, update)
    return () => window.removeEventListener(THEME_EVENT, update)
  }, [])

  // The table of contents follows the section in view.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    for (const { id } of SECTIONS) {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [])

  // The header links to #/settings#account: scroll to that section once the page is drawn.
  useEffect(() => {
    const target = window.location.hash.split('#')[2]
    if (target) document.getElementById(target)?.scrollIntoView()
  }, [])

  /** Saves a choice right away, on top of what is stored at that moment. */
  function change(changes: (current: Settings) => Partial<Settings>) {
    void updateSettings(changes).then(() => setChanged(true))
  }

  async function saveSources(event: FormEvent) {
    event.preventDefault()
    setSources(await saveSettings(sources))
    setSourcesSaved(true)
  }

  async function removeEverything() {
    await deleteAllData()
    resetSyncSession()
    setConfirmDelete(false)
    setDeleted(true)
  }

  const catalog = benchmarkCatalog(settings.customBenchmarks)
  const field = (key: TextSetting) => ({
    value: sources[key],
    onChange: (e: { target: { value: string } }) => {
      setSourcesSaved(false)
      setSources({ ...sources, [key]: e.target.value })
    },
  })

  return (
    <div className="page settings-page">
      <header className="page-head">
        <h2>{t('Settings')}</h2>
        <p className="muted">
          {t('Everything is stored in this browser only: the imported transactions, cached prices and exchange rates, and these settings, including API keys.')}
        </p>
      </header>

      <div className="settings-layout">
        <nav className="settings-toc" aria-label={t('Sections')}>
          <ol>
            {SECTIONS.map((section, i) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth' })
                    setActive(section.id)
                  }}
                >
                  <span className="section-number">{String(i + 1).padStart(2, '0')}</span>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
          <p className="small muted" role="status">
            {changed ? t('Saved.') : t('Changes are saved right away.')}
          </p>
        </nav>

        <div className="settings-sections">
          <Section number={1} title={t('Display')} id="display">
            <div className="form-grid">
              <Choice
                id="setting-theme"
                label={t('Theme')}
                options={THEMES}
                value={theme}
                onChange={(next) => {
                  storeThemePreference(next)
                  setTheme(next)
                }}
                note={t('System follows the light or dark setting of this device.')}
              />
              <Choice
                id="setting-decimals"
                label={t('Decimals')}
                options={[
                  { value: 2, label: t('2 decimals') },
                  { value: 4, label: t('4 decimals') },
                ]}
                value={settings.decimals}
                onChange={(decimals) => change(() => ({ decimals }))}
                note={t('Of the amounts on screen. Exports keep two.')}
              />
              <Choice
                id="setting-launch"
                label={t('Default period on launch')}
                options={LAUNCH_RANGES}
                value={settings.launchRange}
                onChange={(launchRange) => change(() => ({ launchRange }))}
                note={t('The period the dashboard and the analysis open on.')}
              />
            </div>
            <RadioList
              label={t('Chart palette')}
              name="palette"
              options={PALETTES.map((p) => ({ value: p.id, label: t(p.label), hint: t(p.description) }))}
              value={palette}
              onChange={(next) => {
                storePalette(next)
                setPalette(next)
              }}
            />
          </Section>

          <Section number={2} title={t('Calculation')} id="calculation">
            <div className="form-grid">
              <div className="field">
                <label className="label-caps" htmlFor="setting-currency">{t('Currency')}</label>
                <select id="setting-currency" aria-describedby="setting-currency-note" value={settings.baseCurrency} onChange={(e) => {
                    const baseCurrency = e.target.value as BaseCurrency
                    change(() => ({ baseCurrency }))
                  }}>
                  {BASE_CURRENCIES.map((code) => (
                    <option key={code}>{code}</option>
                  ))}
                </select>
                <span className="note" id="setting-currency-note">
                  {t('Every amount and return is calculated in this currency, at the ECB rate of each day. Exchange rate changes then count in your result.')}
                </span>
              </div>
              <div className="field">
                <label className="label-caps" htmlFor="setting-risk-free">{t('Risk-free rate (% a year)')}</label>
                <input id="setting-risk-free" aria-describedby="setting-risk-free-note"
                  type="number"
                  min={0}
                  max={20}
                  step={0.1}
                  inputMode="decimal"
                  defaultValue={settings.riskFreeRate}
                  key={stored ? 'loaded' : 'default'}
                  onChange={(e) => {
                    const rate = Number(e.target.value)
                    if (e.target.value !== '' && Number.isFinite(rate) && rate >= 0 && rate <= 20) change(() => ({ riskFreeRate: rate }))
                  }}
                />
                <span className="note" id="setting-risk-free-note">{t('What money earns without risk, for the Sharpe and Sortino ratios. 2.0% by default.')}</span>
              </div>
            </div>
            <RadioList label={t('Cost basis')} name="costBasis" options={COST_BASIS} value={settings.costBasis} onChange={(costBasis) => change(() => ({ costBasis }))} />
            <RadioList label={t('Alpha method')} name="alphaMethod" options={ALPHA_METHODS} value={settings.alphaMethod} onChange={(alphaMethod) => change(() => ({ alphaMethod }))} />
          </Section>

          <Section number={3} title={t('Benchmark')} id="benchmark">
            <div className="form-grid">
              <div className="field">
                <label className="label-caps" htmlFor="setting-benchmark">{t('Compare the portfolio with')}</label>
                <select id="setting-benchmark" aria-describedby="setting-benchmark-note" value={settings.benchmarkId} onChange={(e) => {
                    const benchmarkId = e.target.value
                    change(() => ({ benchmarkId }))
                  }}>
                  <option value="">{t('Nothing')}</option>
                  {catalog.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.symbol})
                    </option>
                  ))}
                </select>
                <span className="note" id="setting-benchmark-note">
                  {t('The dashboard shows what the same deposits and withdrawals, on the same days, would have become in this fund.')}{' '}
                  {t('This is the default; under the chart you can compare with something else for a moment.')}
                </span>
              </div>
              <div className="field">
                <label className="label-caps" htmlFor="setting-second-benchmark">{t('Second benchmark')}</label>
                <select id="setting-second-benchmark" aria-describedby="setting-second-benchmark-note" value={settings.secondBenchmarkId} onChange={(e) => {
                    const secondBenchmarkId = e.target.value
                    change(() => ({ secondBenchmarkId }))
                  }}>
                  <option value="">{t('None')}</option>
                  {catalog
                    .filter((b) => b.id !== settings.benchmarkId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.symbol})
                      </option>
                    ))}
                </select>
                <span className="note" id="setting-second-benchmark-note">{t('Always shown as a second line and a second column wherever a benchmark is shown.')}</span>
              </div>
            </div>

            <div className="field" role="group" aria-label={t('Also show')}>
              <span className="label-caps">{t('Also show')}</span>
              <div className="check-row">
                {catalog
                  .filter((b) => b.id !== settings.benchmarkId)
                  .map((b) => (
                    <label key={b.id} className="radio">
                      <input
                        type="checkbox"
                        checked={settings.extraBenchmarkIds.includes(b.id)}
                        onChange={(e) => {
                          const on = e.target.checked
                          change((current) => {
                            const others = current.extraBenchmarkIds.filter((id) => id !== b.id)
                            return { extraBenchmarkIds: on ? [...others, b.id] : others }
                          })
                        }}
                      />
                      <span>{b.name}</span>
                    </label>
                  ))}
              </div>
            </div>

            <div className="field" role="group" aria-label={t('Own stocks to compare with')}>
              <span className="label-caps">{t('Own stocks to compare with')}</span>
              {settings.customBenchmarks.length > 0 && (
                <table className="table">
                  <tbody>
                    {settings.customBenchmarks.map((b) => (
                      <tr key={b.id}>
                        <td className="num">{b.symbol}</td>
                        <td>{b.name}</td>
                        <td className="row-actions">
                          <button
                            type="button"
                            className="link-button"
                            aria-label={t('Remove {name}', { name: b.name })}
                            onClick={() =>
                              change((current) => ({
                                customBenchmarks: current.customBenchmarks.filter((c) => c.id !== b.id),
                                benchmarkId: current.benchmarkId === b.id ? '' : current.benchmarkId,
                                secondBenchmarkId: current.secondBenchmarkId === b.id ? '' : current.secondBenchmarkId,
                                extraBenchmarkIds: current.extraBenchmarkIds.filter((id) => id !== b.id),
                                benchmarkMix: Object.fromEntries(Object.entries(current.benchmarkMix).filter(([id]) => id !== b.id)),
                              }))
                            }
                          >
                            {t('Remove')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <BenchmarkSearch
                onPick={(benchmark) => {
                  if (catalog.some((b) => b.symbol === benchmark.symbol)) return
                  change((current) => ({ customBenchmarks: [...current.customBenchmarks, benchmark] }))
                }}
              />
            </div>

            <div className="field" role="group" aria-label={t('Benchmark mix')}>
              <span className="label-caps">{t('Own mix')}</span>
              <span className="note">{t('Own mix in percent, shown as one more line when the parts add up to 100')}</span>
              <div className="mix-grid">
                {catalog.map((b) => (
                  <label key={b.id} className="field">
                    <span className="label-caps">{b.symbol}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      inputMode="numeric"
                      value={settings.benchmarkMix[b.id] ?? ''}
                      onChange={(e) => {
                        const percent = Number(e.target.value)
                        change((current) => {
                          const rest = Object.fromEntries(Object.entries(current.benchmarkMix).filter(([id]) => id !== b.id))
                          return { benchmarkMix: percent > 0 ? { ...rest, [b.id]: Math.min(percent, 100) } : rest }
                        })
                      }}
                    />
                  </label>
                ))}
              </div>
              {mixTotal(settings.benchmarkMix) > 0 && mixTotal(settings.benchmarkMix) !== 100 && (
                <span className="note" role="status">
                  {t('The parts add up to {total}%, not 100%: the mix is not shown.', { total: mixTotal(settings.benchmarkMix) })}
                </span>
              )}
            </div>
          </Section>

          <Section number={4} title={t('Price sources')} id="price-sources">
            <p className="muted small">
              {t('Prices come by themselves through the price service of the app: you do not need to fill in anything here.')}{' '}
              {t('Only needed when a product has no price on the Prices page. A source is asked only when the ones above it have no price. Keys are stored in this browser only. Crypto prices come from CoinGecko without a key.')}
            </p>
            <form className="stack" onSubmit={(e) => void saveSources(e)}>
              <div className="form-grid">
                <div className="field">
                  <label className="label-caps" htmlFor="setting-proxy">{t('Price proxy URL')}</label>
                  <input id="setting-proxy" aria-describedby="setting-proxy-note" type="url" placeholder="https://portfolio-history-price-proxy.example.workers.dev" {...field('proxyUrl')} />
                  <span className="note" id="setting-proxy-note">{t('Filled in already. Only change it if you run your own copy (workers/price-proxy in the repository).')}</span>
                </div>
                <div className="field">
                  <label className="label-caps" htmlFor="setting-twelve-data">{t('Twelve Data API key (optional)')}</label>
                  <input id="setting-twelve-data" aria-describedby="setting-twelve-data-note" type="password" autoComplete="off" {...field('twelveDataKey')} />
                  <span className="note" id="setting-twelve-data-note">{t('A free key from twelvedata.com is enough: up to 800 prices a day.')}</span>
                </div>
                <div className="field">
                  <label className="label-caps" htmlFor="setting-alpha-vantage">{t('Alpha Vantage API key (optional)')}</label>
                  <input id="setting-alpha-vantage" aria-describedby="setting-alpha-vantage-note" type="password" autoComplete="off" {...field('alphaVantageKey')} />
                  <span className="note" id="setting-alpha-vantage-note">{t('A free key from alphavantage.co gives 25 prices a day, of the last 100 trading days only: a last resort.')}</span>
                </div>
              </div>
              <div className="actions">
                <button type="submit" className="primary">
                  {t('Save price sources')}
                </button>
                {sourcesSaved && <span role="status">{t('Saved.')}</span>}
              </div>
            </form>
          </Section>

          <Section number={5} title={t('Account')} id="account">
            {accountAvailable() && !isDemo() ? (
              <AccountSection />
            ) : (
              <p className="muted small">
                {isDemo()
                  ? t('The demo never goes to an account. Leave the demo to use your own.')
                  : t('The optional account is not set up for this version of the app. Everything works without one.')}
              </p>
            )}
          </Section>

          <Section number={6} title={t('Data')} id="data">
            <StorageInfo />
            {!isDemo() && <BackupSection />}
            <div className="field">
              <span className="label-caps">{t('Delete all data')}</span>
              {deleted && <p role="status">{t('All data has been deleted from this browser.')}</p>}
              {confirmDelete ? (
                <div className="callout warning" role="alertdialog" aria-label={t('Delete all data')}>
                  <p>
                    <strong>{t('Delete all data?')}</strong>{' '}
                    {t('This removes the portfolio, the price cache and the settings from this browser. It cannot be undone; you can import the export again afterwards.')}
                  </p>
                  <div className="actions">
                    <button type="button" className="danger primary" onClick={() => void removeEverything()}>
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
            </div>
          </Section>

          <Section number={7} title={t('Demo')} id="demo">
            <p className="muted small">
              {isDemo()
                ? t('You are looking at a made-up portfolio with its own settings. Leave the demo to get back to your own data.')
                : t('Look around in a made-up portfolio with prices that need no connection. Your own data is kept apart and stays untouched.')}
            </p>
            <div className="actions">
              <DemoButton />
            </div>
            <p className="muted small">
              <Rich
                text={t('Charts made with <link>TradingView Lightweight Charts</link>.')}
                tags={{ link: (s) => <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">{s}</a> }}
              />
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}
