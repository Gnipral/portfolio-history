import { t } from '../../i18n/i18n.ts'

/** Says that the amounts are still in EUR because no exchange rate of the chosen currency is stored yet. */
export function CurrencyNotice({ currency }: { currency: string | null }) {
  if (!currency) return null
  return (
    <p className="callout warning small" role="status">
      {t('No exchange rates for {currency} yet: amounts are shown in EUR until they are fetched.', { currency })}
    </p>
  )
}
