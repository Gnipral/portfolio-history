import { useState } from 'react'
import { backupFileName, backupNeedsPassword, backupText, collectBackup, readBackup, restoreBackup } from '../../data/backup.ts'
import { resetSyncSession } from '../dashboard/usePortfolio.ts'
import { useAccountSync } from './AccountSync.tsx'
import { t } from '../../i18n/i18n.ts'

function download(content: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Saves the portfolio and settings to a file, and puts them back from one. Works without an account. */
export function BackupSection() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [file, setFile] = useState<{ name: string; text: string; locked: boolean } | null>(null)
  const [filePassword, setFilePassword] = useState('')
  const account = useAccountSync()

  async function save() {
    setBusy(true)
    setStatus('')
    try {
      const data = await collectBackup()
      download(await backupText(data, password), backupFileName())
      setStatus(
        password
          ? t('Backup with {count} transactions downloaded, protected with your password.', { count: data.transactions.length })
          : t('Backup with {count} transactions downloaded.', { count: data.transactions.length }),
      )
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusy(false)
    }
  }

  async function choose(chosen: File | undefined) {
    setStatus('')
    setFile(null)
    setFilePassword('')
    if (!chosen) return
    try {
      const text = await chosen.text()
      setFile({ name: chosen.name, text, locked: backupNeedsPassword(text) })
    } catch (error) {
      setStatus(message(error))
    }
  }

  async function restore() {
    if (!file) return
    setBusy(true)
    setStatus('')
    try {
      const data = await readBackup(file.text, filePassword)
      await restoreBackup(data)
      resetSyncSession()
      account.sync()
      setFile(null)
      setStatus(t('Backup restored: {count} transactions.', { count: data.transactions.length }))
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="backup">
      <legend>{t('Backup')}</legend>
      <p className="muted small">
        {t('Save the portfolio, your ticker choices and these settings to a file, for a new phone or after clearing the browser. Prices and exchange rates are fetched again. The file includes your API keys; add a password to encrypt it.')}
      </p>
      <div className="actions">
        <label className="inline-label">
          {t('Password (optional)')}
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          {t('Download backup')}
        </button>
      </div>
      <label>
        {t('Restore from a backup file')}
        <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
      </label>
      {file && (
        <div className="callout warning" role="alertdialog" aria-label={t('Restore backup')}>
          <p>
            <strong>{t('Replace the portfolio in this browser with {name}?', { name: file.name })}</strong>{' '}
            {t('The transactions, ticker choices and settings here are replaced by those in the backup.')}
          </p>
          {file.locked && (
            <label>
              {t('Password of the backup')}
              <input type="password" autoComplete="current-password" value={filePassword} onChange={(e) => setFilePassword(e.target.value)} />
            </label>
          )}
          <div className="actions">
            <button type="button" className="primary" disabled={busy || (file.locked && !filePassword)} onClick={() => void restore()}>
              {t('Restore')}
            </button>
            <button type="button" onClick={() => setFile(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}
      {account.notice}
      {status && (
        <p className="small" role="status">
          {status}
        </p>
      )}
    </fieldset>
  )
}
