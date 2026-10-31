import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db.ts'
import { addToPortfolio, replacePortfolio } from '../../data/portfolio.ts'
import { isDemo } from '../../demo/demoMode.ts'
import { loadImportContext } from '../../import/fxContext.ts'
import { readFile } from '../../import/readFile.ts'
import { ImportError, importTables } from '../../import/registry.ts'
import { summarize } from '../../import/summary.ts'
import type { Capabilities, ImportResult } from '../../import/types.ts'
import { t, tn } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { useAccountSync } from '../components/AccountSync.tsx'
import { DemoButton } from '../components/DemoBanner.tsx'
import { Figure, Section } from '../components/Section.tsx'
import { TYPE_LABELS } from '../components/transactionLabels.ts'
import { formatDate, formatQuantity, formatStoredEur } from '../format.ts'
import { fileRows, importCheck } from './importOverview.ts'
import './pages.css'
import './import.css'

type Phase =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'error'; message: string; details: string[]; report?: string | undefined }
  | { phase: 'preview'; result: ImportResult }
  | { phase: 'saving' }
  | { phase: 'done'; count: number; skipped: number }

type Mode = 'add' | 'replace'

const ACCEPT = '.csv,.xlsx,.xls,.xml,.pdf'

const ISSUES_URL = 'https://github.com/Gnipral/portfolio-history/issues/new'

/** Transactions in the preview before "Show all". */
const FIRST = 8

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  transactionCosts: t('Transaction costs'),
  fxCosts: t('Currency conversion costs'),
  taxes: t('Taxes'),
  dividends: t('Dividends'),
  deposits: t('Deposits and withdrawals'),
}

/** Which file to export at each supported broker. */
const BROKERS: [string, string][] = [
  ['DEGIRO', t('Transactions and Account statement (Inbox → Transactions / Account), CSV or XLSX; one or both')],
  ['Bolero', t('Transaction history (Excel)')],
  ['Keytrade Bank', t('Transactions (CSV or Excel)')],
  ['Saxo', t('Transactions (Excel)')],
  ['Interactive Brokers / Lynx', t('Flex Queries: Trades, Cash Transactions and Corporate Actions (CSV)')],
  ['Trade Republic', t('Transaction export (CSV)')],
  ['Trading 212', t('History → Export (CSV)')],
  ['Revolut', t('Trading account statement (CSV)')],
  ['eToro', t('Account statement (Excel)')],
  ['XTB', t('Account history, Cash Operations (CSV or Excel)')],
  ['Bitvavo', t('Transaction history (CSV)')],
  ['Coinbase', t('Transaction history report (CSV)')],
  ['Binance', t('Transaction history statement (CSV or Excel)')],
  ['Kraken', t('Ledgers (CSV)')],
  ['Bitpanda', t('Transaction history (CSV)')],
]

const period = (first: string | null, last: string | null) => (first ? `${formatDate(first)} – ${formatDate(last ?? first)}` : '–')

export function ImportPage() {
  const [state, setState] = useState<Phase>({ phase: 'idle' })
  // The files of the draft: choosing more adds them, so a broker's history in several files is read together.
  const [files, setFiles] = useState<File[]>([])
  const [mode, setMode] = useState<Mode>('add')
  const [dragging, setDragging] = useState(false)
  const stored = useLiveQuery(() => db.transactions.count())
  const account = useAccountSync()
  const hasData = (stored ?? 0) > 0

  async function read(chosen: File[]) {
    setFiles(chosen)
    if (chosen.length === 0) {
      setState({ phase: 'idle' })
      return
    }
    setState({ phase: 'reading' })
    try {
      const tables = (await Promise.all(chosen.map(readFile))).flat()
      const result = importTables(tables, { context: await loadImportContext() })
      setMode('add')
      setState({ phase: 'preview', result })
    } catch (error) {
      if (error instanceof ImportError) setState({ phase: 'error', message: error.message, details: error.details, report: error.report })
      else setState({ phase: 'error', message: t('The file could not be read.'), details: [String(error)] })
    }
  }

  function addFiles(list: FileList | null) {
    const chosen = [...(list ?? [])]
    if (chosen.length === 0) return
    // Files of a draft in preview stay; a file chosen again replaces the earlier one of that name.
    const kept = state.phase === 'preview' ? files.filter((f) => !chosen.some((c) => c.name === f.name)) : []
    void read([...kept, ...chosen])
  }

  function discard() {
    setFiles([])
    setState({ phase: 'idle' })
  }

  async function save(result: ImportResult) {
    const names = files.map((f) => f.name)
    const add = hasData && mode === 'add'
    setState({ phase: 'saving' })
    try {
      let count = result.transactions.length
      if (add) count = await addToPortfolio(result, names)
      else await replacePortfolio(result, names)
      account.sync()
      setFiles([])
      setState({ phase: 'done', count, skipped: result.transactions.length - count })
    } catch (error) {
      setState({ phase: 'error', message: t('Saving the import failed. Your previous data is unchanged.'), details: [String(error)] })
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  // An import in demo mode would land in the demo database: import into the own data instead.
  if (isDemo()) {
    return (
      <div className="page import-page">
        <header className="page-head">
          <h2>{t('Import')}</h2>
        </header>
        <Section number={1} title={t('Files')}>
          <div className="panel">
            <p>{t('You are in demo mode. Leave it to import the export of your own broker.')}</p>
            <div className="actions">
              <DemoButton />
            </div>
          </div>
        </Section>
      </div>
    )
  }

  const preview = state.phase === 'preview' ? state.result : null
  const rows = preview ? fileRows(preview, files.map((f) => f.name)) : []
  // Shown only before anything has been imported: the way in for a first visit.
  const firstTime = stored === 0 && !preview
  let number = 0
  const next = () => ++number

  return (
    <div className={`page import-page${preview ? ' has-bottom-bar' : ''}`}>
      <header className="page-head">
        <h2>{t('Import')}</h2>
        <p className="muted">
          {t('Import the export of one broker; the broker is recognized from the file. Select several files at once when a broker splits its history over more files, and import the next broker afterwards to combine them in one portfolio. Your data is processed and stored only on this device. Once loaded, the app works offline: turn off Wi-Fi and import to check.')}
        </p>
      </header>

      <Section number={next()} title={t('Files')} aside={preview ? tn(files.length, '{count} file', '{count} files') : undefined}>
        <div className="import-files">
          <div className="import-files-list">
            {rows.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('File')}</th>
                    <th>{t('Broker')}</th>
                    <th>{t('Kind')}</th>
                    <th className="num">{t('Rows')}</th>
                    <th>{t('Period')}</th>
                    <th aria-label={t('Actions')} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name}>
                      <td className="file-name">{row.name}</td>
                      <td>{preview?.broker}</td>
                      <td>{t(row.kind)}</td>
                      <td className="num">
                        {row.rows}
                        {row.unread > 0 && <span className="muted"> · {tn(row.unread, '{count} unread', '{count} unread')}</span>}
                      </td>
                      <td className="num">{period(row.first, row.last)}</td>
                      <td className="row-actions">
                        <button type="button" className="link" aria-label={t('Remove {name}', { name: row.name })} onClick={() => void read(files.filter((f) => f.name !== row.name))}>
                          {t('Remove')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="import-empty panel">
                {state.phase === 'reading' ? (
                  <p role="status">{t('Reading file…')}</p>
                ) : state.phase === 'saving' ? (
                  <p role="status">{t('Saving…')}</p>
                ) : (
                  <p className="muted">{t('No file chosen yet. Every file is read in this browser; nothing is uploaded.')}</p>
                )}
              </div>
            )}
          </div>
          <label
            className={`dropzone${dragging ? ' dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <span className="label-caps">{preview ? t('Add more files') : t('Choose files')}</span>
            <span>{t('Drop a CSV, XLSX, XML or PDF file here, or click to choose')}</span>
          </label>
        </div>

        {state.phase === 'error' && (
          <div className="callout error" role="alert">
            <strong>{state.message}</strong>
            {state.details.length > 0 && (
              <ul>
                {state.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            {state.report && <ReportUnsupported report={state.report} />}
          </div>
        )}

        {state.phase === 'done' && (
          <div className="callout success" role="status">
            {t('Imported {count} transactions.', { count: state.count })}
            {state.skipped > 0 && ` ${t('Skipped {count} that were already stored.', { count: state.skipped })}`}{' '}
            <Rich
              text={t('<home>Go to the dashboard</home> or <list>check the transactions</list>')}
              tags={{ home: (s) => <Link to="/">{s}</Link>, list: (s) => <Link to="/transactions">{s}</Link> }}
            />
          </div>
        )}
        {state.phase === 'done' && account.notice}
      </Section>

      {firstTime && <FirstImport number={next()} />}

      {preview && (
        <>
          <CheckSection number={next()} result={preview} />
          <PreviewSection number={next()} result={preview} />
          <Section number={next()} title={t('Add or replace')}>
            {hasData ? (
              <div className="choice-list" role="radiogroup" aria-label={t('Add to or replace existing data')}>
                <label className={`choice${mode === 'add' ? ' chosen' : ''}`}>
                  <input type="radio" name="import-mode" checked={mode === 'add'} onChange={() => setMode('add')} />
                  <span>
                    <strong>{t('Add to portfolio')}</strong>
                    <span className="muted small">
                      {t('Adds this import to the portfolio on this device, for example a second broker or a newer export. Transactions that are already stored are skipped.')}
                    </span>
                  </span>
                </label>
                <label className={`choice${mode === 'replace' ? ' chosen' : ''}`}>
                  <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  <span>
                    <strong>{t('Replace data')}</strong>
                    <span className="muted small">{t('Removes the transactions stored now and keeps only this import. Settings and prices stay.')}</span>
                  </span>
                </label>
              </div>
            ) : (
              <p className="muted">{t('Nothing is stored on this device yet: this import becomes your portfolio.')}</p>
            )}
          </Section>

          <div className="bottom-bar" role="region" aria-label={t('Import')}>
            <span className="small">
              {tn(preview.transactions.length, '{count} transaction ready to import', '{count} transactions ready to import')}
              {hasData && ` · ${mode === 'add' ? t('added to the portfolio') : t('replacing the portfolio')}`}
            </span>
            <div className="actions">
              <button type="button" onClick={discard}>
                {t('Discard')}
              </button>
              <button type="button" className="primary" disabled={preview.transactions.length === 0} onClick={() => void save(preview)}>
                {t('Import {count} transactions', { count: preview.transactions.length })}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** What the parser found, as numbers: transactions, the cash flow, fees and taxes, rows it could not read. */
function CheckSection({ number, result }: { number: number; result: ImportResult }) {
  const check = importCheck(result)
  return (
    <Section number={number} title={t('Check')} aside={t('From the parser')}>
      <div className="figures">
        <Figure label={t('Transactions parsed')} value={check.transactions} note={tn(summarize(result.transactions).productCount, '{count} product', '{count} products')} />
        <Figure
          label={t('Net cash flow')}
          value={`${check.netCashFlow > 0 ? '+' : ''}${formatStoredEur(check.netCashFlow)}`}
          note={check.netDeposits !== 0 ? t('Deposits − withdrawals: {amount}', { amount: formatStoredEur(check.netDeposits) }) : t('No deposits in this export')}
        />
        <Figure label={t('Fees found')} value={formatStoredEur(check.fees)} note={tn(check.charged, 'on {count} transaction', 'on {count} transactions')} />
        <Figure label={t('TOB and taxes found')} value={formatStoredEur(check.tradeTaxes + check.otherTaxes)} note={t('TOB {tob} · other {other}', { tob: formatStoredEur(check.tradeTaxes), other: formatStoredEur(check.otherTaxes) })} />
        <Figure label={t('Unread rows / warnings')} value={`${check.unread} / ${check.warnings}`} note={check.unread > 0 ? t('Unread rows are skipped') : t('Every row was read')} />
      </div>
      <p className="muted small">{t('Amounts in EUR, as the export books them.')}</p>
    </Section>
  )
}

/** The first transactions, what is missing or could not be read, and the positions after the import. */
function PreviewSection({ number, result }: { number: number; result: ImportResult }) {
  const [all, setAll] = useState(false)
  const summary = summarize(result.transactions)
  const ordered = [...result.transactions].sort((a, b) => b.dateTime.localeCompare(a.dateTime))
  const shown = all ? ordered : ordered.slice(0, FIRST)
  const missing = (Object.keys(CAPABILITY_LABELS) as (keyof Capabilities)[]).filter((k) => !result.capabilities[k])
  const errors = result.issues.filter((i) => i.severity === 'error')

  return (
    <Section number={number} title={t('Preview')} aside={t('Newest first')}>
      <div className="stack">
        <h4 className="label-caps">{t('Transactions')}</h4>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{t('Type')}</th>
                <th>{t('Product')}</th>
                <th className="num">{t('Quantity')}</th>
                <th className="num">{t('Price')}</th>
                <th className="num">{t('Amount (EUR)')}</th>
                <th className="num">{t('Costs (EUR)')}</th>
                <th className="num">{t('Taxes (EUR)')}</th>
                <th className="num">{t('Net (EUR)')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((tx) => (
                <tr key={tx.id}>
                  <td className="date">{tx.date}</td>
                  <td>{t(TYPE_LABELS[tx.type] ?? tx.type)}</td>
                  <td>
                    {tx.product}
                    {tx.isin && <span className="cell-note">{tx.isin}</span>}
                  </td>
                  <td className="num">{tx.quantity ? formatQuantity(tx.quantity) : '–'}</td>
                  <td className="num">{tx.price ? `${formatQuantity(tx.price)} ${tx.currency}` : '–'}</td>
                  <td className="num">{formatStoredEur(tx.amountEur)}</td>
                  <td className="num">{formatStoredEur(tx.costsEur + tx.fxCostsEur)}</td>
                  <td className="num">{formatStoredEur(tx.taxesEur)}</td>
                  <td className="num">{formatStoredEur(tx.totalEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-foot small muted">
          <span>{t('{shown} of {total} transactions', { shown: shown.length, total: ordered.length })}</span>
          {ordered.length > FIRST && (
            <button type="button" className="link" onClick={() => setAll(!all)}>
              {all ? t('Show fewer') : t('Show all')}
            </button>
          )}
        </div>
      </div>

      <div className="import-preview-grid">
        <div className="stack">
          <h4 className="label-caps">{t('Warnings')}</h4>
          {missing.length === 0 && result.issues.length === 0 ? (
            <p className="muted small">{t('Nothing missing, and every row was read.')}</p>
          ) : (
            <>
              {missing.length > 0 && (
                <div className="callout info">
                  <strong>{t('Not in this export')}</strong>
                  <ul>
                    {missing.map((k) => (
                      <li key={k}>
                        {CAPABILITY_LABELS[k]}: {result.missingReasons[k] ?? t('not available.')}
                      </li>
                    ))}
                  </ul>
                  <span className="muted small">{t('The related options will be disabled.')}</span>
                </div>
              )}
              {errors.length > 0 && (
                <p className="small" role="alert">
                  <strong>{tn(errors.length, '{count} row could not be read and will be skipped.', '{count} rows could not be read and will be skipped.')}</strong>
                </p>
              )}
              {result.issues.length > 0 && (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('Type')}</th>
                        <th>{t('File')}</th>
                        <th className="num">{t('Row')}</th>
                        <th>{t('Message')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.issues.map((issue, i) => (
                        <tr key={i}>
                          <td className="label-caps">{issue.severity}</td>
                          <td>{issue.file}</td>
                          <td className="num">{issue.row ?? ''}</td>
                          <td>{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
        <div className="stack">
          <h4 className="label-caps">{t('Open positions after import')}</h4>
          {summary.openPositions.length === 0 ? (
            <p className="muted small">{t('No open positions after the last transaction.')}</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th>ISIN</th>
                  <th className="num">{t('Quantity')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.openPositions.map((p) => (
                  <tr key={p.isin || p.product}>
                    <td>{p.product}</td>
                    <td className="num">{p.isin}</td>
                    <td className="num">{formatQuantity(p.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Section>
  )
}

/** The way in before anything is imported: which file to export, the demo, entering by hand, a missing broker. */
function FirstImport({ number }: { number: number }) {
  return (
    <Section number={number} title={t('Supported brokers')} aside={t('Which file to export')}>
      <table className="table">
        <thead>
          <tr>
            <th>{t('Broker')}</th>
            <th>{t('File to export')}</th>
          </tr>
        </thead>
        <tbody>
          {BROKERS.map(([broker, file]) => (
            <tr key={broker}>
              <td>{broker}</td>
              <td>{file}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="import-ways">
        <div className="panel">
          <span className="label-caps">{t('No export at hand?')}</span>
          <p className="small">{t('Look around in a made-up portfolio first. Your own data is kept apart.')}</p>
          <DemoButton />
        </div>
        <div className="panel">
          <span className="label-caps">{t('A broker without an export?')}</span>
          <p className="small">{t('Enter its transactions by hand, or correct a row that is missing.')}</p>
          <Link to="/transactions" className="button">
            {t('Enter transactions by hand')}
          </Link>
        </div>
        <div className="panel">
          <span className="label-caps">{t('Broker missing?')}</span>
          <p className="small">
            {t('Drop its export anyway: a file no broker recognizes shows only its column headers, with a button to copy them and a link to report it. No transactions, amounts or names are shared.')}
          </p>
        </div>
      </div>
    </Section>
  )
}

/** The header rows of a file no broker recognized, to share so the broker can be added without anyone posting an export. */
function ReportUnsupported({ report }: { report: string }) {
  const [copied, setCopied] = useState(false)
  const fence = '```'
  const body = `Broker and export: \n\nColumn headers:\n${fence}\n${report}\n${fence}\n`
  const issue = `${ISSUES_URL}?${new URLSearchParams({ title: 'Export not recognized', body })}`

  async function copy() {
    await navigator.clipboard.writeText(report)
    setCopied(true)
  }

  return (
    <div className="report-unsupported">
      <p className="small">{t('Is your broker missing? Share only the column headers below: no transactions, amounts or names. Check them first.')}</p>
      <pre>{report}</pre>
      <div className="actions">
        <button type="button" onClick={() => void copy()}>
          {copied ? t('Copied') : t('Copy the headers')}
        </button>
        <a href={issue} target="_blank" rel="noreferrer">
          {t('Report on GitHub')}
        </a>
      </div>
    </div>
  )
}
