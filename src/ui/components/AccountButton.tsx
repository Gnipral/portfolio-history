import { Link } from 'react-router'
import { accountAvailable, readToken } from '../../account/account.ts'
import { t } from '../../i18n/i18n.ts'

/** Leads to the account in Settings; only where the optional account service is set up. */
export function AccountButton() {
  if (!accountAvailable()) return null
  const signedIn = readToken() !== null
  return (
    <Link to="/settings#account" className="header-button" title={signedIn ? t('Signed in to your account') : t('Optional account')}>
      {signedIn ? t('Account ✓') : t('Account')}
    </Link>
  )
}
