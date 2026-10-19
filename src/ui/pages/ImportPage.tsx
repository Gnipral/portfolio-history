import { useState, type DragEvent } from 'react'
import { Link } from 'react-router'
import { hasPortfolio, replacePortfolio } from '../../data/portfolio.ts'
import { readFile } from '../../import/readFile.ts'
import { ImportError, importTables } from '../../import/registry.ts'
import type { ImportResult } from '../../import/types.ts'
import { ImportPreview } from '../components/ImportPreview.tsx'

type State =
  | { phase: 'idle' }
  | { phase: 'reading' }
  | { phase: 'error'; message: string; details: string[] }
  | { phase: 'preview'; result: ImportResult; files: string[]; confirmReplace: boolean }
  | { phase: 'saving' }
  | { phase: 'done'; count: number }

const ACCEPT = '.csv,.xlsx,.xls'

export function ImportPage() {
  const [state, setState] = useState<State>({ phase: 'idle' })
  const [dragging, setDragging] = useState(false)

  async function handleFiles(fileList: FileList | null) {
    const files = [...(fileList ?? [])]
    if (files.length === 0) return
    setState({ phase: 'reading' })
    try {
      const tables = (await Promise.all(files.map(readFile))).flat()
      const result = importTables(tables)
      setState({ phase: 'preview', result, files: files.map((f) => f.name), confirmReplace: false })
    } catch (error) {
      if (error instanceof ImportError) setState({ phase: 'error', message: error.message, details: error.details })
      else setState({ phase: 'error', message: 'The file could not be read.', details: [String(error)] })
    }
  }

  async function save(result: ImportResult, files: string[], confirmed: boolean) {
    if (!confirmed && (await hasPortfolio())) {
      setState({ phase: 'preview', result, files, confirmReplace: true })
      return
    }
    setState({ phase: 'saving' })
    try {
      await replacePortfolio(result, files)
      setState({ phase: 'done', count: result.transactions.length })
    } catch (error) {
      setState({ phase: 'error', message: 'Saving the import failed. Your previous data is unchanged.', details: [String(error)] })
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void handleFiles(event.dataTransfer.files)
  }

  return (
    <section className="stack">
      <h2>Import</h2>
      <p className="muted">
        Import the export of one broker. For DEGIRO, select the <strong>Transactions</strong> export (CSV or XLSX).
        Your data is processed and stored only on this device.
      </p>

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
          <span>Drop a CSV or XLSX file here, or click to choose</span>
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
          Imported {state.count} transactions. <Link to="/">Go to the dashboard</Link>
        </div>
      )}

      {state.phase === 'preview' && (
        <>
          <ImportPreview result={state.result} files={state.files} />
          {state.confirmReplace ? (
            <div className="callout warning" role="alertdialog" aria-label="Replace existing data">
              <p>
                <strong>Replace all existing data?</strong> The portfolio currently stored on this device will be
                deleted and replaced by this import.
              </p>
              <div className="actions">
                <button type="button" className="primary" onClick={() => void save(state.result, state.files, true)}>
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
                onClick={() => void save(state.result, state.files, false)}
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
