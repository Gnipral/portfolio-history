import { t } from '../../i18n/i18n.ts'

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
const EYE_OFF = 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.9 3.9M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'

/** Hides every amount and quantity, to show the app to someone without showing what you own. */
export function HideAmountsToggle({ hidden, onChange }: { hidden: boolean; onChange: (hidden: boolean) => void }) {
  return (
    <button
      type="button"
      className="hide-amounts"
      aria-pressed={hidden}
      onClick={() => onChange(!hidden)}
      title={hidden ? t('Amounts are hidden: only percentages and dates are shown') : t('Hide amounts and quantities, e.g. to show the app to someone')}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={hidden ? EYE_OFF : EYE} />
      </svg>
      <span className="hide-amounts-label">{hidden ? t('Show amounts') : t('Hide amounts')}</span>
    </button>
  )
}
