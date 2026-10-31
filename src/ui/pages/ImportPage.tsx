import { useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { addToPortfolio, hasPortfolio, replacePortfolio } from '../../data/portfolio.ts'
import { loadImportContext } from '../../import/fxContext.ts'
import { readFile } from '../../import/readFile.ts'
import { ImportError, importTables } from '../../import/registry.ts'
import type { ImportResult } from '../../import/types.ts'
import { isDemo } from '../../demo/demoMode.ts'
import { useAccountSync } from '../components/AccountSync.tsx'
import { DemoButton } from '../components/DemoBanner.tsx'
import { ImportPreview } from '../components/ImportPreview.tsx'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'

type State =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'error'; message: string; details: string[]; report?: string | undefined }
  | { phase: 'preview'; result: ImportResult; files: string[]; confirmReplace: boolean }
  | { phase: 'saving' }
  | { phase: 'done'; count: number; skipped: number }

const ACCEPT = '.csv,.xlsx,.xls'

const ISSUES_URL = 'https://github.com/Gnipral/portfolio-history/issues/new'

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

export function ImportPage() {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [dragging, setDragging] = useState(false)
  const account = useAccountSync()

  async function handleFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])]
    if (files.length === 0) return
    setState({ phase: 'reading' })
    try {
      const tables = (await Promise.all(files.map(readFile))).flat()
      const result = importTables(tables, { context: await loadImportContext() })
      setState({ phase: 'preview', result, files: files.map((f) => f.name), confirmReplace: false })
    } catch (error) {
      if (error instanceof ImportError) setState({ phase: 'error', message: error.message, details: error.details, report: error.report })
      else setState({ phase: 'error', message: t('The file could not be read.'), details: [String(error)] })
    }
  }

  async function save(result: ImportResult, files: string[], mode: 'ask' | 'add' | 'replace') {
    if (mode === 'ask' && (await hasPortfolio())) {
      setState({ phase: 'preview', result, files, confirmReplace: true })
      return
    }
    setState({ phase: 'saving' })
    try {
      let count = result.transactions.length
      if (mode === 'add') count = await addToPortfolio(result, files)
      else await replacePortfolio(result, files)
      account.sync()
      setState({ phase: 'done', count, skipped: result.transactions.length - count })
    } catch (error) {
      setState({ phase: 'error', message: t('Saving the import failed. Your previous data is unchanged.'), details: [String(error)] })
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void handleFiles(event.dataTransfer.files)
  }

  // An import in demo mode would land in the demo database: import into the own data instead.
  if (isDemo()) {
    return (
      <section className="stack">
        <h2>{t('Import')}</h2>
        <div className="callout">
          <p>{t('You are in demo mode. Leave it to import the export of your own broker.')}</p>
          <div className="actions">
            <DemoButton />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="stack">
      <h2>{t('Import')}</h2>
      <p className="muted">
        {t('Import the export of one broker; the broker is recognized from the file. Select several files at once when a broker splits its history over more files, and import the next broker afterwards to combine them in one portfolio. Your data is processed and stored only on this device. Once loaded, the app works offline: turn off Wi-Fi and import to check.')}
      </p>
      <p className="muted small demo-hint">
        <Rich
          text={t('No export at hand? <demo></demo> with a made-up portfolio, or <link>enter transactions by hand</link>.')}
          tags={{ demo: () => <DemoButton className="link-button" />, link: (s) => <Link to="/transactions">{s}</Link> }}
        />
      </p>
      <details className="supported-brokers">
        <summary>{t('Supported brokers and which file to export')}</summary>
        <ul>
          {BROKERS.map(([broker, file]) => (
            <li key={broker}>
              <strong>{broker}:</strong> {file}
            </li>
          ))}
        </ul>
      </details>

      {(state.phase === 'idle' || state.phase === 'error' || state.phase === 'done') && (
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
              void handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <span>{t('Drop a CSV, XLSX, XML or PDF file here, or click to choose')}</span>
        </label>
      )}

      {state.phase === 'reading' && <p role="status">{t('Reading file…')}</p>}
      {state.phase === 'saving' && <p role="status">{t('Saving…')}</p>}

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

      {state.phase === 'preview' && (
        <>
          <ImportPreview result={state.result} files={state.files} />
          {state.confirmReplace ? (
            <div className="callout warning" role="alertdialog" aria-label={t('Add to or replace existing data')}>
              <p>
                <strong>{t('You already have a portfolio on this device.')}</strong>{' '}
                {t('Add this import to it, for example a second broker or a newer export (transactions that are already stored are skipped), or replace it.')}
              </p>
              <div className="actions">
                <button type="button" className="primary" onClick={() => void save(state.result, state.files, 'add')}>
                  {t('Add to portfolio')}
                </button>
                <button type="button" onClick={() => void save(state.result, state.files, 'replace')}>
                  {t('Replace data')}
                </button>
                <button type="button" onClick={() => setState({ phase: 'idle' })}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={state.result.transactions.length === 0}
                onClick={() => void save(state.result, state.files, 'ask')}
              >
                Import {state.result.transactions.length} transactions
              </button>
              <button type="button" onClick={() => setState({ phase: 'idle' })}>
                {t('Cancel')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
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
      <p className="small">
        {t('Is your broker missing? Share only the column headers below: no transactions, amounts or names. Check them first.')}
      </p>
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
