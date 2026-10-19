import { useState } from 'react'
import { nextThemePreference, readThemePreference, storeThemePreference } from '../../theme/theme.ts'

const LABELS = { system: 'System', light: 'Light', dark: 'Dark' } as const

export function ThemeToggle() {
  const [preference, setPreference] = useState(readThemePreference)

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
