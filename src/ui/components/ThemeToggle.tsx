import { useEffect, useState } from 'react'
import { THEME_EVENT, nextThemePreference, readThemePreference, storeThemePreference } from '../../theme/theme.ts'

const LABELS = { system: 'System', light: 'Light', dark: 'Dark' } as const

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
    <button type="button" onClick={cycle} title="Switch theme">
      Theme: {LABELS[preference]}
    </button>
  )
}
