import { useRegisterSW } from 'virtual:pwa-register/react'

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
        <span>A new version is available.</span>
        <button type="button" onClick={() => void updateServiceWorker(true)}>
          Reload
        </button>
        <button type="button" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div className="update-banner" role="status">
        <span>Ready to work offline. Your data stays in this browser.</span>
        <button type="button" onClick={() => setOfflineReady(false)}>
          OK
        </button>
      </div>
    )
  }

  return null
}
