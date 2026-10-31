import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { formatDate } from '../format.ts'
import { Notice } from '../notices/Notices.tsx'

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
    <Notice kind="warning" id={offline ? 'offline' : 'weak-connection'}>
      <strong>{offline ? t('No internet connection') : t('Weak internet connection')}</strong>{' '}
      {pricesFrom ? (
        <Rich text={t('You are seeing the last prices found, from <b>{date}</b>.', { date: formatDate(pricesFrom) })} tags={{ b: (s) => <strong>{s}</strong> }} />
      ) : (
        t('You are seeing the last prices found.')
      )}{' '}
      {t('New prices are fetched as soon as the connection is stable.')}
    </Notice>
  )
}
