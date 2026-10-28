import { useEffect, useState } from 'react'
import { t } from '../../i18n/i18n.ts'
import { THEME_EVENT, nextThemePreference, readThemePreference, storeThemePreference } from '../../theme/theme.ts'

const LABELS = { system: t('System'), light: t('Light'), dark: t('Dark') } as const

export function ThemeToggle() {
  const [preference, setPreference] = useState(readThemePreference)

  useEffect(() => {
    const update = () => setPreference(readThemePreference())
    window.addEventListener(THEME_EVENT, update)
    return () => window.removeEventListener(THEME_EVENT, update)
  }, [])

  function cycle() {
    const next = nextThemePreference(preference)
    storeThemePreference(next)
    setPreference(next)
  }

  return (
    <button type="button" onClick={cycle} title={t('Switch theme')}>
      {t('Theme: {name}', { name: t(LABELS[preference]) })}
    </button>
  )
}
