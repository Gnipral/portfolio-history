import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db.ts'
import { checkData, type DataCheck } from '../../engine/dataCheck.ts'
import type { Capabilities } from '../../import/types.ts'
import { t, tn } from '../../i18n/i18n.ts'
import { localToday } from '../../market/dates.ts'
import { DEFAULT_SETTINGS, useSettings } from '../../settings/settings.ts'
import { engineOptions, TOGGLES } from '../dashboard/toggles.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { formatDate, formatEur } from '../format.ts'
import { Section } from '../components/Section.tsx'
import './pages.css'

/** Rows shown per check before "and N more". */
const SHOWN = 6

interface Row {
  id: string
  /** Problems can make a figure wrong; notes only say what the export lacks. */
  level: 'problem' | 'note'
  title: string
  /** Shown when the check found nothing. */
  ok: string
  /** What it means and what to do, shown when it found something. */
  advice?: string
  items: ReactNode[]
  action?: { to: string; label: string }
}

function rows(check: DataCheck, capabilities: Capabilities | undefined, currencyFallback: string | null): Row[] {
  const prices = { to: '/prices', label: t('Open Prices') }
  const missing = capabilities ? TOGGLES.filter((toggle) => !capabilities[toggle.capability]) : []
  return [
    {
      id: 'symbols',
      level: 'problem',
      title: t('Products without a symbol'),
      ok: t('Every product held has a symbol to fetch its prices with.'),
      advice: t('Without a symbol there are no prices: these are valued at their last trade price. Enter a symbol on the Prices page.'),
      items: check.noSymbol.map((f) => f.product),
      action: prices,
    },
    {
      id: 'market-price',
      level: 'problem',
      title: t('Products without a market price'),
      ok: t('Every product held has a market price.'),
      advice: t('The price source has nothing for their symbol, so they are valued at their last trade price. Try another symbol, e.g. of another exchange.'),
      items: check.noMarketPrice.map((f) => f.product),
      action: prices,
    },
    {
      id: 'stale',
      level: 'problem',
      title: t('Prices older than a week'),
      ok: t('The prices of every product held are recent.'),
      advice: t('A product that is no longer traded, or a symbol of a listing that has stopped. Its value stays at that last price.'),
      items: check.stalePrices.map((f) => t('{product}: last price from {date}', { product: f.product, date: formatDate(f.priceDate) })),
      action: prices,
    },
    {
      id: 'mismatch',
      level: 'problem',
      title: t('Prices that do not match your trades'),
      ok: t('Your buys and sells match the market prices of their day.'),
      advice: t('A trade far from the close of its day usually means a wrong symbol, a split the price source does not know, or a price in pence instead of pounds. Check the symbol and the splits.'),
      items: check.pricesNotMatchingTrades.map((m) => (
        <>
          {t('{product}: bought or sold at {trade} on {date}, while the close was {close}', {
            product: m.product,
            trade: formatEur(m.tradePrice),
            date: formatDate(m.date),
            close: formatEur(m.marketPrice),
          })}
          {m.mismatched > 1 && ` (${t('{mismatched} of {checked} trades', { mismatched: m.mismatched, checked: m.checked })})`}
          {m.splitRatio !== undefined && (
            <span className="muted">
              {' · '}
              {m.splitRatio >= 1
                ? t('looks like a {ratio}:1 split', { ratio: m.splitRatio })
                : t('looks like a 1:{ratio} reverse split', { ratio: Math.round(1 / m.splitRatio) })}
            </span>
          )}
        </>
      )),
      action: prices,
    },
    {
      id: 'history',
      level: 'problem',
      title: t('Export starts too late'),
      ok: t('The export contains the purchase of everything it sells.'),
      advice: t('These were sold or split, but their purchase is not in the export. Export again from the day you opened your account and import it with Replace data.'),
      items: check.missingHistory.map((f) => f.product),
      action: { to: '/import', label: t('Open Import') },
    },
    {
      id: 'duplicates',
      level: 'problem',
      title: t('Possibly imported twice'),
      ok: t('No transaction appears in two files.'),
      advice: t('The same transaction is in two files, e.g. the PDF statements and the CSV of one broker. Import one of the two: delete the extra rows on the Transactions page, or import again with Replace data.'),
      items: check.possibleDuplicates.map((d) => t('{product}, {date}: in {files}', { product: d.product, date: formatDate(d.date), files: d.files.join(' and ') })),
      action: { to: '/transactions', label: t('Open Transactions') },
    },
    {
      id: 'ledger',
      level: 'problem',
      title: t('Other problems in the transactions'),
      ok: t('The transactions add up.'),
      items: check.ledgerIssues.map((issue) => `${formatDate(issue.date)}: ${issue.message}`),
      action: { to: '/transactions', label: t('Open Transactions') },
    },
    {
      id: 'currency',
      level: 'problem',
      title: t('Exchange rates of your currency'),
      ok: t('Exchange rates for the currency of the settings are there.'),
      advice: t('Amounts are shown in EUR until the rates are fetched, which happens by itself when there is a connection.'),
      items: currencyFallback ? [t('No rates for {currency} yet', { currency: currencyFallback })] : [],
    },
    {
      id: 'export',
      level: 'note',
      title: t('Not in your export'),
      ok: t('Your export contains costs, taxes, dividends and deposits.'),
      advice: t('These options are off on the dashboard. Import the account statement of your broker too, if it has one, to add them.'),
      items: missing.map((toggle) => t(toggle.label)),
      action: { to: '/import', label: t('Open Import') },
    },
  ]
}

function CheckRow({ row }: { row: Row }) {
  const found = row.items.length > 0
  const state = !found ? 'ok' : row.level
  return (
    <li className={`check check-${state}`}>
      <span className="check-icon" aria-hidden="true">
        {state === 'ok' ? '✓' : state === 'problem' ? '!' : 'i'}
      </span>
      <div className="check-body">
        <strong>
          {row.title}
          {found && <span className="check-count"> · {row.items.length}</span>}
        </strong>
        {!found ? (
          <p className="muted small">{row.ok}</p>
        ) : (
          <>
            {row.advice && <p className="small">{row.advice}</p>}
            <ul className="check-items small">
              {row.items.slice(0, SHOWN).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
              {row.items.length > SHOWN && <li className="muted">{tn(row.items.length - SHOWN, 'and {count} more', 'and {count} more')}</li>}
            </ul>
            {row.action && (
              <Link to={row.action.to} className="small">
                {row.action.label} →
              </Link>
            )}
          </>
        )}
      </div>
    </li>
  )
}

/** The data behind the figures checked in one place: what to fix for the right numbers. */
export function DataCheckPage() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const importRecord = useLiveQuery(() => db.imports.get('current'))
  const capabilities = importRecord?.capabilities
  const options = useMemo(() => engineOptions(settings, capabilities), [settings, capabilities])
  const { transactionCount, inputs, series, currencyFallback } = usePortfolio(options)
  const check = useMemo(
    () => (inputs && series ? checkData({ transactions: inputs.transactions, prices: inputs.prices, options, issues: series.issues, today: localToday() }) : null),
    [inputs, series, options],
  )

  if (transactionCount === undefined) return null
  if (transactionCount === 0) {
    return (
      <section>
        <h2>{t('Data check')}</h2>
        <p>
          {t('No portfolio loaded yet.')} <Link to="/import">{t('Import a broker export')}</Link>
        </p>
      </section>
    )
  }
  if (!check) return <p role="status">{t('Calculating…')}</p>

  const all = rows(check, capabilities, currencyFallback)
  const problems = all.filter((row) => row.level === 'problem' && row.items.length > 0).length
  const ordered = [...all].sort((a, b) => rank(a) - rank(b))

  return (
    <div className="page data-check-page">
      <header className="page-head">
        <h2>{t('Data check')}</h2>
        <p className="muted">{t('The prices, transactions and export behind your figures, checked on every visit. Nothing here changes a figure.')}</p>
      </header>
      <Section number={1} title={t('Checks')} aside={tn(all.length, '{count} check', '{count} checks')}>
        <p role="status">
          {problems === 0
            ? t('Everything checks out: the figures rest on complete data.')
            : tn(problems, '{count} thing to look at for the right figures.', '{count} things to look at for the right figures.')}
        </p>
        <ul className="checks panel">
          {ordered.map((row) => (
            <CheckRow key={row.id} row={row} />
          ))}
        </ul>
      </Section>
    </div>
  )
}

/** Problems first, then notes, then what is fine. */
function rank(row: Row): number {
  if (row.items.length === 0) return 2
  return row.level === 'problem' ? 0 : 1
}
