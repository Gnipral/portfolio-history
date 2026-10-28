import { useState } from 'react'
import { Link } from 'react-router'
import { saveAfterChange } from '../../account/account.ts'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { formatDate } from '../format.ts'

/**
 * Saves the portfolio to the account after a change, when signed in. When the account holds data saved
 * from another device, nothing is replaced and `notice` says so.
 */
export function useAccountSync() {
  const [newer, setNewer] = useState<string | null>(null)
  const sync = () => void saveAfterChange().then(setNewer)
  const notice = newer ? (
    <p className="callout warning small" role="status">
      <Rich
        text={t('Not saved to your account: it holds data saved elsewhere on {date}. Choose in <link>Settings</link> which to keep.', {
          date: formatDate(newer.slice(0, 10)),
        })}
        tags={{ link: (s) => <Link to="/settings">{s}</Link> }}
      />
    </p>
  ) : null
  return { sync, notice }
}
