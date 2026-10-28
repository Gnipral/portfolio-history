import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ACCOUNT_EVENT,
  accountAvailable,
  accountInfo,
  createAccount,
  deleteAccount,
  loadFromAccount,
  readToken,
  newerInAccount,
  saveToAccount,
  signIn,
  signOut,
} from '../../account/account.ts'
import { isDemo } from '../../demo/demoMode.ts'
import { formatDate } from '../format.ts'
import { t } from '../../i18n/i18n.ts'

function subscribe(onChange: () => void): () => void {
  window.addEventListener(ACCOUNT_EVENT, onChange)
  return () => window.removeEventListener(ACCOUNT_EVENT, onChange)
}

function message(error: unknown): string {
  // A closed passkey prompt is no error worth showing.
  if (error instanceof Error && error.name === 'NotAllowedError') return t('Cancelled.')
  return error instanceof Error ? error.message : String(error)
}

/** The optional account in Settings: create one or sign in with a passkey, then save or load. */
export function AccountSection() {
  const signedIn = useSyncExternalStore(subscribe, () => readToken() !== null, () => false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState<'load' | 'delete' | null>(null)
  /** Data saved from another device, found when saving: replacing it needs a yes. */
  const [newer, setNewer] = useState<string | null>(null)

  useEffect(() => {
    if (!signedIn || !accountAvailable()) return
    accountInfo()
      .then((info) => setSavedAt(info.dataUpdatedAt))
      .catch(() => undefined)
  }, [signedIn])

  // The demo has its own made-up data: nothing of it belongs in an account.
  if (!accountAvailable() || isDemo()) return null

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setStatus('')
    try {
      setStatus(await work())
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <fieldset className="account">
      <legend>{t('Account (optional)')}</legend>
      {!signedIn ? (
        <>
          <p className="muted small">
            {t("Everything works without an account. With one, your imported portfolio and saved periods are kept, to open them again later or on another device. You sign in with a passkey: the fingerprint, face or PIN of your device, no password. Your data goes to the account only when you save it, and is then stored on the app's server.")}
          </p>
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => (await createAccount('Portfolio History'), t('Account created: you are signed in.')))}>
              {t('Create an account')}
            </button>
            <button type="button" disabled={busy} onClick={() => void run(async () => (await signIn(), t('Signed in.')))}>
              {t('Sign in')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            {t('Signed in.')} {savedAt ? t('Last saved on {date}.', { date: formatDate(savedAt.slice(0, 10)) }) : t('Nothing saved yet.')}{' '}
            {t('A new import is saved to your account by itself.')}
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const found = await newerInAccount()
                  if (found) {
                    setNewer(found)
                    return ''
                  }
                  setSavedAt(await saveToAccount())
                  return t('Saved to your account.')
                })
              }
            >
              {t('Save to my account')}
            </button>
            <button type="button" disabled={busy || !savedAt} onClick={() => setConfirm('load')}>
              {t('Load from my account')}
            </button>
            <button type="button" disabled={busy} onClick={() => void run(async () => (await signOut(), t('Signed out.')))}>
              {t('Sign out')}
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => setConfirm('delete')}>
              {t('Delete account')}
            </button>
          </div>
          {newer && (
            <div className="callout warning" role="alertdialog" aria-label={t('Replace the data in your account?')}>
              <p>
                <strong>{t('Replace the data in your account?')}</strong>{' '}
                {t('It was saved from another device or browser on {date}, after this browser last saved or loaded it.', { date: formatDate(newer.slice(0, 10)) })}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setNewer(null)
                    void run(async () => {
                      setSavedAt(await saveToAccount())
                      return t('Saved to your account.')
                    })
                  }}
                >
                  {t('Replace it with this browser')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewer(null)
                    setConfirm('load')
                  }}
                >
                  {t('Load it here instead')}
                </button>
                <button type="button" onClick={() => setNewer(null)}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
          {confirm === 'load' && (
            <div className="callout warning" role="alertdialog" aria-label={t('Load from my account')}>
              <p>
                <strong>{t('Replace the portfolio in this browser?')}</strong>{' '}
                {t('The portfolio and periods saved in your account take the place of those here.')}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void run(async () => t('Loaded {count} transactions from your account.', { count: (await loadFromAccount()).transactions }))}
                >
                  {t('Replace')}
                </button>
                <button type="button" onClick={() => setConfirm(null)}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
          {confirm === 'delete' && (
            <div className="callout warning" role="alertdialog" aria-label={t('Delete account')}>
              <p>
                <strong>{t('Delete your account?')}</strong>{' '}
                {t('The account, its passkey and everything saved in it are removed for good. The data in this browser stays.')}
              </p>
              <div className="actions">
                <button type="button" className="danger" onClick={() => void run(async () => (await deleteAccount(), t('Your account is deleted.')))}>
                  {t('Delete for good')}
                </button>
                <button type="button" onClick={() => setConfirm(null)}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {status && (
        <p className="small" role="status">
          {status}
        </p>
      )}
    </fieldset>
  )
}
