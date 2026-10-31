import { useEffect, useState } from 'react'
import { t } from '../../i18n/i18n.ts'
import { THEME_EVENT, readThemePreference, storeThemePreference, type ThemePreference } from '../../theme/theme.ts'

const CHOICES: { id: ThemePreference; label: string }[] = [
  { id: 'light', label: t('Light') },
  { id: 'dark', label: t('Dark') },
  { id: 'system', label: t('System') },
]

/** Light, dark, or the setting of the device; the same choice as in Settings. */
export function ThemeToggle() {
  const [preference, setPreference] = useState(readThemePreference)

  useEffect(() => {
    const update = () => setPreference(readThemePreference())
    window.addEventListener(THEME_EVENT, update)
    return () => window.removeEventListener(THEME_EVENT, update)
  }, [])

  return (
    <div className="segmented segmented-small" role="group" aria-label={t('Theme')}>
      {CHOICES.map((choice) => (
        <button
          key={choice.id}
          type="button"
          aria-pressed={preference === choice.id}
          onClick={() => {
            storeThemePreference(choice.id)
            setPreference(choice.id)
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}
