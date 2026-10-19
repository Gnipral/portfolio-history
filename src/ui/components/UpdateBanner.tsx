import { useRegisterSW } from 'virtual:pwa-register/react'

/** Asks before activating a new version, so a running import or calculation is never interrupted. */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

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
