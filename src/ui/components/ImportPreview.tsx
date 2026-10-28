import { summarize } from '../../import/summary.ts'
import type { Capabilities, ImportResult } from '../../import/types.ts'
import { formatDate } from '../format.ts'
import { t } from '../../i18n/i18n.ts'

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  transactionCosts: t('Transaction costs'),
  fxCosts: t('Currency conversion costs'),
  taxes: t('Taxes'),
  dividends: t('Dividends'),
  deposits: t('Deposits and withdrawals'),
}

export function ImportPreview({ result, files }: { result: ImportResult; files: string[] }) {
  const summary = summarize(result.transactions)
  const errors = result.issues.filter((i) => i.severity === 'error')
  const missing = (Object.keys(CAPABILITY_LABELS) as (keyof Capabilities)[]).filter((k) => !result.capabilities[k])

  return (
    <div className="stack">
      <div className="cards">
        <div className="card">
          <span className="card-label">{t('Broker')}</span>
          <span className="card-value">{result.broker}</span>
          <span className="muted small">{files.join(', ')}</span>
        </div>
        <div className="card">
          <span className="card-label">{t('Transactions')}</span>
          <span className="card-value">{summary.transactionCount}</span>
        </div>
        <div className="card">
          <span className="card-label">{t('Period')}</span>
          <span className="card-value small-value">
            {summary.firstDate ? `${formatDate(summary.firstDate)} – ${formatDate(summary.lastDate ?? summary.firstDate)}` : '–'}
          </span>
        </div>
        <div className="card">
          <span className="card-label">{t('Products / open positions')}</span>
          <span className="card-value">
            {summary.productCount} / {summary.openPositions.length}
          </span>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="callout error" role="alert">
          <strong>
            {errors.length} {errors.length === 1 ? 'row' : 'rows'} could not be read and will be skipped.
          </strong>
        </div>
      )}

      {missing.length > 0 && (
        <div className="callout info">
          <strong>{t('Not in this export')}</strong>
          <ul>
            {missing.map((k) => (
              <li key={k}>
                {CAPABILITY_LABELS[k]}: {result.missingReasons[k] ?? 'not available.'}
              </li>
            ))}
          </ul>
          <span className="muted small">{t('The related options will be disabled.')}</span>
        </div>
      )}

      {summary.openPositions.length > 0 && (
        <details open>
          <summary>{t('Open positions after the last transaction')}</summary>
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
                  <td>{p.isin}</td>
                  <td className="num">{p.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {result.issues.length > 0 && (
        <details open={errors.length > 0}>
          <summary>Import notes ({result.issues.length})</summary>
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
                  <td>
                    <span className={`badge ${issue.severity}`}>{issue.severity}</span>
                  </td>
                  <td>{issue.file}</td>
                  <td className="num">{issue.row ?? ''}</td>
                  <td>{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
