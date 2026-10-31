import { t } from '../../i18n/i18n.ts'
import { useTotalValue } from '../dashboard/PortfolioProvider.tsx'
import { formatEur } from '../format.ts'

/** Today's total value of the portfolio, as on the dashboard with the settings' options. */
export function HeaderValue() {
  const value = useTotalValue()
  if (value === undefined) return null
  return (
    <div className="header-value">
      <span className="label-caps">{t('Total value')}</span>
      <span className="figure">{formatEur(value)}</span>
    </div>
  )
}
