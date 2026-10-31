import { useRegisterSW } from 'virtual:pwa-register/react'
import { t } from '../../i18n/i18n.ts'
import { Notice } from '../notices/Notices.tsx'

/** Asks before activating a new version, so a running import or calculation is never interrupted. */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  if (needRefresh) {
    return (
      <Notice
        actions={
          <>
            <button type="button" onClick={() => void updateServiceWorker(true)}>
              {t('Reload')}
            </button>
            <button type="button" onClick={() => setNeedRefresh(false)}>
              {t('Later')}
            </button>
          </>
        }
      >
        {t('A new version is available.')}
      </Notice>
    )
  }

  if (offlineReady) {
    return (
      <Notice
        actions={
          <button type="button" onClick={() => setOfflineReady(false)}>
            {t('OK')}
          </button>
        }
      >
        {t('Ready to work offline. Your data stays in this browser.')}
      </Notice>
    )
  }

  return null
}
