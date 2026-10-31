import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db.ts'
import { localToday } from '../../market/dates.ts'
import { deriveInstruments, type Instrument } from '../../market/instruments.ts'
import { CRYPTO_PREFIX } from '../../market/providers/coinGecko.ts'
import { isValidSymbol } from '../../market/symbols.ts'
import { addManualSplit, clearSymbol, setManualSymbol, syncMarketData, type SyncProgress, type SyncReport } from '../../market/sync.ts'
import type { PriceCoverage, SymbolRecord } from '../../market/types.ts'
import { loadSettings, updateSettings, useSettings } from '../../settings/settings.ts'
import { formatDate } from '../format.ts'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'

export function PricesPage() {
  const settings = useSettings()
  const excluded = settings?.excludedInstruments ?? []
  const data = useLiveQuery(async () => {
    const [transactions, symbols, coverage, splits] = await Promise.all([
      db.transactions.toArray(),
      db.symbols.toArray(),
      db.coverage.toArray(),
      db.splits.toArray(),
    ])
    return {
      transactions,
      instruments: deriveInstruments(transactions, localToday()),
      symbols: new Map(symbols.map((s) => [s.key, s])),
      coverage: new Map(coverage.map((c) => [c.symbol, c])),
      splits: splits.sort((a, b) => a.date.localeCompare(b.date)),
    }
  })
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [report, setReport] = useState<SyncReport | null>(null)

  if (!data || !settings) return null
  if (data.instruments.length === 0) {
    return (
      <section>
        <h2>{t('Prices')}</h2>
        <p>
          No portfolio loaded yet. <Link to="/import">{t('Import a broker export')}</Link> first.
        </p>
      </section>
    )
  }

  const noSource = !settings.proxyUrl && !settings.twelveDataKey && !settings.alphaVantageKey
  const running = progress !== null && progress.phase !== 'done'

  async function update() {
    setReport(null)
    const result = await syncMarketData({
      database: db,
      transactions: data?.transactions ?? [],
      settings: await loadSettings(),
      today: localToday(),
      now: new Date(),
      onProgress: setProgress,
    })
    setReport(result)
  }

  return (
    <section className="stack">
      <h2>{t('Prices')}</h2>
      <p className="muted">
        {t('Daily closing prices are fetched once and stored on this device. Only the symbol is sent to price sources, never quantities or amounts.')}
      </p>
      <p className="small">
        <Link to="/check">{t('Data check')} →</Link> {t('lists what can make a figure wrong, such as a wrong symbol or a missing split.')}
      </p>
      <p className="muted small">{t('Switch a product off under Counts to leave it out of every figure, the chart and the analysis, as if you never traded it.')}</p>

      {noSource && (
        <div className="callout warning">
          <Rich
            text={t('No price source is configured yet. Add the price proxy URL or an API key in <link>Settings</link>. You can still enter symbols manually.')}
            tags={{ link: (s) => <Link to="/settings">{s}</Link> }}
          />
        </div>
      )}

      <div className="actions">
        <button type="button" className="primary" disabled={running} onClick={() => void update()}>
          {running ? t('Updating…') : t('Update prices')}
        </button>
        {progress && (
          <span className="progress" role="status">
            <progress max={progress.total || 1} value={progress.phase === 'done' ? progress.total || 1 : progress.done} />
            {progress.message}
          </span>
        )}
      </div>

      {report && report.errors.length > 0 && (
        <div className="callout warning">
          <ul>
            {report.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <table className="table">
        <thead>
          <tr>
            <th>{t('Counts')}</th>
            <th>{t('Product')}</th>
            <th>ISIN</th>
            <th>{t('Symbol')}</th>
            <th>{t('Prices')}</th>
            <th>{t('Status')}</th>
          </tr>
        </thead>
        <tbody>
          {data.instruments.map((instrument) => (
            <InstrumentRow
              key={instrument.key}
              instrument={instrument}
              record={data.symbols.get(instrument.key)}
              coverage={coverageFor(data.symbols.get(instrument.key), data.coverage)}
              problem={report?.problems[instrument.key]}
              counted={!excluded.includes(instrument.key)}
              onCountedChange={(on) =>
                void updateSettings((current) => ({
                  excludedInstruments: on
                    ? current.excludedInstruments.filter((key) => key !== instrument.key)
                    : [...current.excludedInstruments.filter((key) => key !== instrument.key), instrument.key],
                }))
              }
            />
          ))}
        </tbody>
      </table>

      <ManualSplits symbols={[...data.symbols.values()].flatMap((s) => (s.symbol ? [s.symbol] : []))} splits={data.splits} />
    </section>
  )
}

function coverageFor(record: SymbolRecord | undefined, coverage: Map<string, PriceCoverage>) {
  return record?.symbol ? coverage.get(record.symbol) : undefined
}

function InstrumentRow({
  instrument,
  record,
  coverage,
  problem,
  counted,
  onCountedChange,
}: {
  instrument: Instrument
  record: SymbolRecord | undefined
  coverage: PriceCoverage | undefined
  problem: string | undefined
  counted: boolean
  onCountedChange: (counted: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    const symbol = value.trim()
    const crypto = symbol.startsWith(CRYPTO_PREFIX)
    if (!crypto && !isValidSymbol(symbol)) {
      setError(t('Use a Yahoo-style symbol such as ASML.AS, or crypto:<coingecko id>.'))
      return
    }
    await setManualSymbol(db, instrument.key, symbol, crypto ? 'crypto' : 'security', new Date())
    setEditing(false)
  }

  const needed = `${formatDate(instrument.range.from)} – ${instrument.open ? t('today') : formatDate(instrument.range.to)}`
  const status = problem ?? record?.error ?? (coverage ? 'OK' : record?.symbol ? t('Not fetched yet') : t('No symbol'))

  return (
    <tr className={counted ? undefined : 'excluded'}>
      <td>
        <input
          type="checkbox"
          checked={counted}
          aria-label={t('Count {name}', { name: instrument.product })}
          onChange={(e) => onCountedChange(e.target.checked)}
        />
      </td>
      <td>
        {instrument.product}
        {!counted && <span className="badge warning">{t('not counted')}</span>}
        {!instrument.open && <span className="muted small"> ({t('closed')})</span>}
      </td>
      <td>{instrument.isin}</td>
      <td>
        {editing ? (
          <form className="inline-form" onSubmit={(e) => void save(e)}>
            <input aria-label={t('Symbol for {name}', { name: instrument.product })} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
            <button type="submit">{t('Save')}</button>
            <button type="button" onClick={() => setEditing(false)}>
              {t('Cancel')}
            </button>
            {error && <span className="small error-text">{error}</span>}
          </form>
        ) : (
          <>
            <code>{record?.symbol ?? '–'}</code>
            {record?.source === 'manual' && <span className="badge info">{t('manual')}</span>}{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setValue(record?.symbol ?? '')
                setError('')
                setEditing(true)
              }}
            >
              {t('Edit')}
            </button>
            {record?.source === 'manual' && (
              <button type="button" className="link-button" onClick={() => void clearSymbol(db, instrument.key)}>
                {t('Reset')}
              </button>
            )}
          </>
        )}
      </td>
      <td className="small">
        <div>{t('Needed: {range}', { range: needed })}</div>
        {coverage && (
          <div className="muted">
            {t('Cached: {range}', { range: `${formatDate(coverage.from)} – ${formatDate(coverage.to)} (${coverage.currency}, ${coverage.source})` })}
          </div>
        )}
      </td>
      <td className="small">{status}</td>
    </tr>
  )
}

function ManualSplits({ symbols, splits }: { symbols: string[]; splits: { id: string; symbol: string; date: string; ratio: number; source: string }[] }) {
  const [symbol, setSymbol] = useState('')
  const [date, setDate] = useState('')
  const [ratio, setRatio] = useState('')

  async function add(event: FormEvent) {
    event.preventDefault()
    const value = Number(ratio.replace(',', '.'))
    if (!symbol || !date || !(value > 0)) return
    await addManualSplit(db, symbol, date, value)
    setRatio('')
  }

  return (
    <details>
      <summary>{t('Splits ({count})', { count: splits.length })}</summary>
      <p className="muted small">
        {t('Splits come from the price source when available. Add one manually if a price chart jumps on a split date. Ratio = new shares per old share (4 for a 4:1 split, 0.1 for a 1:10 reverse split).')}
      </p>
      {splits.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('Symbol')}</th>
              <th>{t('Date')}</th>
              <th className="num">{t('Ratio')}</th>
              <th>{t('Source')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => (
              <tr key={s.id}>
                <td>{s.symbol}</td>
                <td>{formatDate(s.date)}</td>
                <td className="num">{s.ratio}</td>
                <td>{s.source}</td>
                <td>
                  {s.source === 'manual' && (
                    <button type="button" className="link-button" onClick={() => void db.splits.delete(s.id)}>
                      {t('Delete')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="inline-form" onSubmit={(e) => void add(e)}>
        <select aria-label={t('Symbol')} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          <option value="">{t('Symbol…')}</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input aria-label={t('Split date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input aria-label={t('Ratio')} inputMode="decimal" placeholder={t('Ratio')} value={ratio} onChange={(e) => setRatio(e.target.value)} />
        <button type="submit">{t('Add split')}</button>
      </form>
    </details>
  )
}
