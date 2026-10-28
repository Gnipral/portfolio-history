import { useRegisterSW } from 'virtual:pwa-register/react'
import { t } from '../../i18n/i18n.ts'

/** Asks before activating a new version, so a running import or calculation is never interrupted. */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  if (needRefresh) {
    return (
      <div className="update-banner" role="status">
        <span>{t('A new version is available.')}</span>
        <button type="button" onClick={() => void updateServiceWorker(true)}>
          {t('Reload')}
        </button>
        <button type="button" onClick={() => setNeedRefresh(false)}>
          {t('Later')}
        </button>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div className="update-banner" role="status">
        <span>{t('Ready to work offline. Your data stays in this browser.')}</span>
        <button type="button" onClick={() => setOfflineReady(false)}>
          {t('OK')}
        </button>
      </div>
    )
  }

  return null
}
