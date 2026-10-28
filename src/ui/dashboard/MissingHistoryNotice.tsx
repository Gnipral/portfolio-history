import type { LedgerIssue } from '../../engine/ledger.ts'
import { t } from '../../i18n/i18n.ts'

/**
 * The export starts after some units were bought: their sales and splits are known, their purchases not.
 * The ledger then counts those units at their value of that day; this says so, and how to fix it.
 */
export function MissingHistoryNotice({ issues }: { issues: LedgerIssue[] }) {
  const products = [...new Set(issues.flatMap((issue) => (issue.missingHistory ? [issue.missingHistory] : [])))]
  if (products.length === 0) return null
  return (
    <div className="callout warning" role="status">
      <strong>{t('Your export does not go back far enough.')}</strong>
      <p>
        {t('It contains sales or splits of {products}, but not when you bought them. Those shares count from that day at their value of that moment, without the profit or loss before it.', {
          products: products.join(', '),
        })}
      </p>
      <p>{t('For the right figures, export your transactions again from the day you opened your account, and import that file with Replace data.')}</p>
    </div>
  )
}
