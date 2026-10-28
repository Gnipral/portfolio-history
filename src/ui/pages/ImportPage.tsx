import { useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { saveAfterImport } from '../../account/account.ts'
import { addToPortfolio, hasPortfolio, replacePortfolio } from '../../data/portfolio.ts'
import { loadImportContext } from '../../import/fxContext.ts'
import { readFile } from '../../import/readFile.ts'
import { ImportError, importTables } from '../../import/registry.ts'
import type { ImportResult } from '../../import/types.ts'
import { isDemo } from '../../demo/demoMode.ts'
import { DemoButton } from '../components/DemoBanner.tsx'
import { ImportPreview } from '../components/ImportPreview.tsx'

type State =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'error'; message: string; details: string[] }
  | { phase: 'preview'; result: ImportResult; files: string[]; confirmReplace: boolean }
  | { phase: 'saving' }
  | { phase: 'done'; count: number; skipped: number }

const ACCEPT = '.csv,.xlsx,.xls'

/** Which file to export at each supported broker. */
const BROKERS: [string, string][] = [
  ['DEGIRO', 'Transactions and Account statement (Inbox → Transactions / Account), CSV or XLSX; one or both'],
  ['Bolero', 'Transaction history (Excel)'],
  ['Keytrade Bank', 'Transactions (CSV or Excel)'],
  ['Saxo', 'Transactions (Excel)'],
  ['Interactive Brokers / Lynx', 'Flex Queries: Trades, Cash Transactions and Corporate Actions (CSV)'],
  ['Trade Republic', 'Transaction export (CSV)'],
  ['Trading 212', 'History → Export (CSV)'],
  ['Revolut', 'Trading account statement (CSV)'],
  ['eToro', 'Account statement (Excel)'],
  ['XTB', 'Account history, Cash Operations (CSV or Excel)'],
  ['Bitvavo', 'Transaction history (CSV)'],
  ['Coinbase', 'Transaction history report (CSV)'],
  ['Binance', 'Transaction history statement (CSV or Excel)'],
  ['Kraken', 'Ledgers (CSV)'],
  ['Bitpanda', 'Transaction history (CSV)'],
]

export function ImportPage() {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [dragging, setDragging] = useState(false)

  async function handleFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])]
    if (files.length === 0) return
    setState({ phase: 'reading' })
    try {
      const tables = (await Promise.all(files.map(readFile))).flat()
      const result = importTables(tables, { context: await loadImportContext() })
      setState({ phase: 'preview', result, files: files.map((f) => f.name), confirmReplace: false })
    } catch (error) {
      if (error instanceof ImportError) setState({ phase: 'error', message: error.message, details: error.details })
      else setState({ phase: 'error', message: 'The file could not be read.', details: [String(error)] })
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
      void saveAfterImport()
      setState({ phase: 'done', count, skipped: result.transactions.length - count })
    } catch (error) {
      setState({ phase: 'error', message: 'Saving the import failed. Your previous data is unchanged.', details: [String(error)] })
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
        <h2>Import</h2>
        <div className="callout">
          <p>You are in demo mode. Leave it to import the export of your own broker.</p>
          <div className="actions">
            <DemoButton />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="stack">
      <h2>Import</h2>
      <p className="muted">
        Import the export of one broker; the broker is recognized from the file. Select several files at once when a
        broker splits its history over more files, and import the next broker afterwards to combine them in one
        portfolio. Your data is processed and stored only on this device.
      </p>
      <p className="muted small demo-hint">
        No export at hand? <DemoButton className="link-button" /> with a made-up portfolio.
      </p>
      <details className="supported-brokers">
        <summary>Supported brokers and which file to export</summary>
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
          <span>Drop a CSV, XLSX, XML or PDF file here, or click to choose</span>
        </label>
      )}

      {state.phase === 'reading' && <p role="status">Reading file…</p>}
      {state.phase === 'saving' && <p role="status">Saving…</p>}

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
        </div>
      )}

      {state.phase === 'done' && (
        <div className="callout success" role="status">
          Imported {state.count} transactions.
          {state.skipped > 0 && ` Skipped ${state.skipped} that were already stored.`} <Link to="/">Go to the dashboard</Link>
        </div>
      )}

      {state.phase === 'preview' && (
        <>
          <ImportPreview result={state.result} files={state.files} />
          {state.confirmReplace ? (
            <div className="callout warning" role="alertdialog" aria-label="Add to or replace existing data">
              <p>
                <strong>You already have a portfolio on this device.</strong> Add this import to it, for example a
                second broker or a newer export (transactions that are already stored are skipped), or replace it.
              </p>
              <div className="actions">
                <button type="button" className="primary" onClick={() => void save(state.result, state.files, 'add')}>
                  Add to portfolio
                </button>
                <button type="button" onClick={() => void save(state.result, state.files, 'replace')}>
                  Replace data
                </button>
                <button type="button" onClick={() => setState({ phase: 'idle' })}>
                  Cancel
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
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
