import { enterDemo, isDemo, leaveDemo } from '../../demo/demoMode.ts'
import { t } from '../../i18n/i18n.ts'
import { Notice } from '../notices/Notices.tsx'

/** In the notice strip of every page in demo mode, with the way back to the own data. */
export function DemoBanner() {
  if (!isDemo()) return null
  return (
    <Notice
      actions={
        <button type="button" onClick={leaveDemo}>
          {t('Leave demo')}
        </button>
      }
    >
      <strong>{t('Demo mode:')}</strong> {t('a made-up portfolio. Your own data is kept apart and stays untouched.')}
    </Notice>
  )
}

/** Switches to the demo portfolio, or back to the own data in demo mode. */
export function DemoButton({ className }: { className?: string }) {
  const demo = isDemo()
  return (
    <button type="button" className={className} onClick={demo ? leaveDemo : enterDemo}>
      {demo ? t('Leave demo') : t('Try the demo')}
    </button>
  )
}
