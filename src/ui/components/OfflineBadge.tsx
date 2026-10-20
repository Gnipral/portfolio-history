import { useOnline } from '../useOnline.ts'

/** Shown in the header while offline: the app keeps working on stored prices, new prices wait for a connection. */
export function OfflineBadge() {
  if (useOnline()) return null
  return (
    <span className="offline-badge" role="status" title="Showing stored prices. New prices are fetched when the connection is back.">
      Offline
    </span>
  )
}
