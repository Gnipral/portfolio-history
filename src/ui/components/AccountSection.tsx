import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  ACCOUNT_EVENT,
  accountAvailable,
  accountInfo,
  accountKeyState,
  createAccount,
  deleteAccount,
  loadFromAccount,
  readToken,
  newerInAccount,
  saveToAccount,
  signIn,
  signOut,
  unlockAccount,
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
  /** Whether this device has the encryption key; null while checking or signed out. */
  const [keyState, setKeyState] = useState<'unlocked' | 'existing' | 'new' | null>(null)

  useEffect(() => {
    setKeyState(null)
    if (!signedIn || !accountAvailable()) return
    accountInfo()
      .then((info) => setSavedAt(info.dataUpdatedAt))
      .catch(() => undefined)
    accountKeyState()
      .then(setKeyState)
      .catch(() => undefined)
  }, [signedIn])

  const unlocked = keyState === 'unlocked'

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
            {t('Everything works without an account. With one, your imported portfolio and saved periods are kept, to open them again later or on another device. You sign in with a passkey: the fingerprint, face or PIN of your device. Your portfolio is encrypted in this browser with an encryption password of your own before it goes to the account: the server cannot read it.')}
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
          {(keyState === 'new' || keyState === 'existing') && (
            <KeyForm
              choosing={keyState === 'new'}
              onUnlocked={() => {
                setKeyState('unlocked')
                setStatus(t('Unlocked: this device can save and load your account.'))
              }}
            />
          )}
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !unlocked}
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
            <button type="button" disabled={busy || !savedAt || !unlocked} onClick={() => setConfirm('load')}>
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

/** At least this long: the password is all that protects the saved portfolio if the server leaks. */
const MIN_PASSWORD = 10

/** Choosing the encryption password, or entering it on another device. */
function KeyForm({ choosing, onUnlocked }: { choosing: boolean; onUnlocked: () => void }) {
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (choosing && password.length < MIN_PASSWORD) return setError(t('Use at least {count} characters.', { count: MIN_PASSWORD }))
    if (choosing && password !== repeat) return setError(t('The two passwords are not the same.'))
    setBusy(true)
    setError('')
    try {
      await unlockAccount(password)
      onUnlocked()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="callout info stack" onSubmit={(e) => void submit(e)} aria-label={choosing ? t('Choose an encryption password') : t('Enter your encryption password')}>
      <p>
        <strong>{choosing ? t('Choose an encryption password') : t('Enter your encryption password')}</strong>{' '}
        {choosing
          ? t('Your portfolio is encrypted with it in this browser before it goes to your account. Nobody can reset it: without it the saved data cannot be opened again. The data on your devices stays.')
          : t('Your account is encrypted with the password you chose on another device. Enter it once on this device to save and load.')}
      </p>
      <label>
        {t('Encryption password')}
        <input type="password" autoComplete={choosing ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {choosing && (
        <label>
          {t('Repeat the password')}
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </label>
      )}
      {error && (
        <p className="error-text small" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !password}>
          {choosing ? t('Set the password') : t('Unlock')}
        </button>
      </div>
    </form>
  )
}
