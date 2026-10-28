import { useState } from 'react'
import { Link } from 'react-router'
import { saveAfterChange } from '../../account/account.ts'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { formatDate } from '../format.ts'

type Result = Awaited<ReturnType<typeof saveAfterChange>>

/**
 * Saves the portfolio to the account after a change, when signed in. When the account holds data saved
 * from another device, or this device does not have the encryption key yet, nothing is saved and
 * `notice` says so.
 */
export function useAccountSync() {
  const [result, setResult] = useState<Result>(null)
  const sync = () => void saveAfterChange().then(setResult)
  const link = { link: (s: string) => <Link to="/settings">{s}</Link> }
  const notice =
    result === null ? null : (
      <p className="callout warning small" role="status">
        {'newer' in result ? (
          <Rich
            text={t('Not saved to your account: it holds data saved elsewhere on {date}. Choose in <link>Settings</link> which to keep.', {
              date: formatDate(result.newer.slice(0, 10)),
            })}
            tags={link}
          />
        ) : (
          <Rich text={t('Not saved to your account: enter your encryption password in <link>Settings</link> first.')} tags={link} />
        )}
      </p>
    )
  return { sync, notice }
}
