import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ACCOUNT_EVENT,
  accountAvailable,
  accountInfo,
  createAccount,
  deleteAccount,
  loadFromAccount,
  readToken,
  saveToAccount,
  signIn,
  signOut,
} from '../../account/account.ts'
import { isDemo } from '../../demo/demoMode.ts'
import { formatDate } from '../format.ts'

function subscribe(onChange: () => void): () => void {
  window.addEventListener(ACCOUNT_EVENT, onChange)
  return () => window.removeEventListener(ACCOUNT_EVENT, onChange)
}

function message(error: unknown): string {
  // A closed passkey prompt is no error worth showing.
  if (error instanceof Error && error.name === 'NotAllowedError') return 'Cancelled.'
  return error instanceof Error ? error.message : String(error)
}

/** The optional account in Settings: create one or sign in with a passkey, then save or load. */
export function AccountSection() {
  const signedIn = useSyncExternalStore(subscribe, () => readToken() !== null, () => false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState<'load' | 'delete' | null>(null)

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
      <legend>Account (optional)</legend>
      {!signedIn ? (
        <>
          <p className="muted small">
            Everything works without an account. With one, your imported portfolio and saved periods are kept, to open them
            again later or on another device. You sign in with a passkey: the fingerprint, face or PIN of your device, no
            password. Your data goes to the account only when you save it, and is then stored on the app&apos;s server.
          </p>
          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => (await createAccount('Portfolio History'), 'Account created: you are signed in.'))}>
              Create an account
            </button>
            <button type="button" disabled={busy} onClick={() => void run(async () => (await signIn(), 'Signed in.'))}>
              Sign in
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Signed in. {savedAt ? `Last saved on ${formatDate(savedAt.slice(0, 10))}.` : 'Nothing saved yet.'} A new import is saved
            to your account by itself.
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const at = await saveToAccount()
                  setSavedAt(at)
                  return 'Saved to your account.'
                })
              }
            >
              Save to my account
            </button>
            <button type="button" disabled={busy || !savedAt} onClick={() => setConfirm('load')}>
              Load from my account
            </button>
            <button type="button" disabled={busy} onClick={() => void run(async () => (await signOut(), 'Signed out.'))}>
              Sign out
            </button>
            <button type="button" className="danger" disabled={busy} onClick={() => setConfirm('delete')}>
              Delete account
            </button>
          </div>
          {confirm === 'load' && (
            <div className="callout warning" role="alertdialog" aria-label="Load from my account">
              <p>
                <strong>Replace the portfolio in this browser?</strong> The portfolio and periods saved in your account take the
                place of those here.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void run(async () => `Loaded ${(await loadFromAccount()).transactions} transactions from your account.`)}
                >
                  Replace
                </button>
                <button type="button" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {confirm === 'delete' && (
            <div className="callout warning" role="alertdialog" aria-label="Delete account">
              <p>
                <strong>Delete your account?</strong> The account, its passkey and everything saved in it are removed for good.
                The data in this browser stays.
              </p>
              <div className="actions">
                <button type="button" className="danger" onClick={() => void run(async () => (await deleteAccount(), 'Your account is deleted.'))}>
                  Delete for good
                </button>
                <button type="button" onClick={() => setConfirm(null)}>
                  Cancel
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
