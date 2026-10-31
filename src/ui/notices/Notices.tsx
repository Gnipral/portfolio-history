import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n/i18n.ts'

/**
 * Every notice of the app goes in one strip directly under the navigation, one per line: the app's own
 * (offline, demo mode, a new version) and those of a page (missing price history, a currency fallback).
 * A page renders its notices with <Notice>, which puts them in the strip with a portal.
 */

const DISMISSED_KEY = 'portfolio-history:dismissed-notices'

const NoticeHostContext = createContext<HTMLElement | null>(null)

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function storeDismissed(ids: string[]): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(ids))
  } catch {
    // Not remembered: the notice comes back on the next page.
  }
}

/** The strip itself, and the place page notices go; `children` are the app's own notices. */
export function NoticeStrip({ children, host }: { children?: ReactNode; host: (element: HTMLElement | null) => void }) {
  return <div className="notice-strip" ref={host} aria-live="polite" data-testid="notices">{children}</div>
}

export function NoticeHostProvider({ element, children }: { element: HTMLElement | null; children: ReactNode }) {
  return <NoticeHostContext.Provider value={element}>{children}</NoticeHostContext.Provider>
}

interface NoticeProps {
  /** Remembers a dismissal for this session; without it the notice cannot be dismissed. */
  id?: string
  /** `warning` for something that makes a figure wrong; `info` otherwise. */
  kind?: 'info' | 'warning'
  children: ReactNode
  /** Buttons or links at the end of the line. */
  actions?: ReactNode
}

/** One line in the notice strip; rendered in place when there is no strip, as in a page test. */
export function Notice({ id, kind = 'info', children, actions }: NoticeProps) {
  const host = useContext(NoticeHostContext)
  const [dismissed, setDismissed] = useState(() => (id ? readDismissed().includes(id) : false))
  if (dismissed) return null
  const line = (
    <div className={`notice notice-${kind}`} role="status">
      <span className="notice-label">{kind === 'warning' ? t('Check') : t('Note')}</span>
      <div className="notice-text">{children}</div>
      {actions && <div className="notice-actions">{actions}</div>}
      {id && (
        <button
          type="button"
          className="notice-dismiss"
          aria-label={t('Dismiss')}
          onClick={() => {
            storeDismissed([...readDismissed(), id])
            setDismissed(true)
          }}
        >
          ×
        </button>
      )}
    </div>
  )
  return host ? createPortal(line, host) : line
}
