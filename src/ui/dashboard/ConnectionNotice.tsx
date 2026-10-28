import { formatDate } from '../format.ts'

interface Props {
  /** The browser reports no connection at all. */
  offline: boolean
  /** The price sources were too slow or could not be reached. */
  weak: boolean
  /** Date of the most recent price in use. */
  pricesFrom: string | undefined
}

/** Says plainly that the numbers use the last prices found, and that new ones follow by themselves. */
export function ConnectionNotice({ offline, weak, pricesFrom }: Props) {
  if (!offline && !weak) return null
  return (
    <div className="callout warning connection-notice" role="status">
      <strong>{offline ? 'No internet connection' : 'Weak internet connection'}</strong>
      <p>
        You are seeing the last prices found{pricesFrom ? <>, from <strong>{formatDate(pricesFrom)}</strong></> : ''}. New prices
        are fetched as soon as the connection is stable.
      </p>
    </div>
  )
}
