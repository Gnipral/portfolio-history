import type { LedgerIssue } from '../../engine/ledger.ts'
import { t } from '../../i18n/i18n.ts'
import { Notice } from '../notices/Notices.tsx'

/**
 * The export starts after some units were bought: their sales and splits are known, their purchases not.
 * The ledger then counts those units at their value of that day; this says so, and how to fix it.
 */
export function MissingHistoryNotice({ issues }: { issues: LedgerIssue[] }) {
  const products = [...new Set(issues.flatMap((issue) => (issue.missingHistory ? [issue.missingHistory] : [])))]
  if (products.length === 0) return null
  return (
    <Notice kind="warning" id={`missing-history:${products.join('|')}`}>
      <strong>{t('Your export does not go back far enough.')}</strong>{' '}
      {t('It contains sales or splits of {products}, but not when you bought them. Those shares count from that day at their value of that moment, without the profit or loss before it.', {
        products: products.join(', '),
      })}{' '}
      {t('For the right figures, export your transactions again from the day you opened your account, and import that file with Replace data.')}
    </Notice>
  )
}
