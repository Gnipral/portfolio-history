import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../../i18n/i18n.ts'
import { reportUrl } from './report.ts'

interface Props {
  children: ReactNode
  /** What failed, e.g. "The chart"; the whole page when left out. */
  label?: string | undefined
  /** Clears the error when it changes, e.g. the route or the selected tab. */
  resetKey?: unknown
}

interface State {
  error?: unknown
  resetKey?: unknown
}

/** Shows what went wrong instead of a white screen, with a way out and a way to report it. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { error: undefined, resetKey: props.resetKey }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(this.props.label ?? 'Page', error, info.componentStack)
  }

  override render() {
    const { error } = this.state
    if (error === undefined) return this.props.children
    const { label } = this.props
    const message = error instanceof Error ? error.message : String(error)
    return (
      <div className="callout error error-boundary" role="alert">
        <p>
          <strong>{label ? t('{what} could not be shown.', { what: label }) : t('Something went wrong on this page.')}</strong>{' '}
          {t('Your data is safe; nothing was changed.')}
        </p>
        <p className="muted small">{message}</p>
        <div className="actions">
          {label ? (
            <button type="button" onClick={() => this.setState({ error: undefined })}>
              {t('Try again')}
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              {t('Reload')}
            </button>
          )}
          <a href={reportUrl(error, window.location.hash.slice(1) || '/')} target="_blank" rel="noreferrer">
            {t('Report this problem')}
          </a>
        </div>
        <p className="muted small">{t('The report opens on GitHub with the error and the page, never your portfolio. You see it before you send it.')}</p>
      </div>
    )
  }
}
