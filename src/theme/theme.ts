export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

/** Fired on window when the preference changes, so every theme control shows the same value. */
export const THEME_EVENT = 'themechange'

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // Storage can be unavailable (private mode); fall back to the system setting.
  }
  return 'system'
}

/** `system` removes the attribute so the CSS media query decides. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', preference)
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Not persisted; the choice still applies for this session.
  }
  applyTheme(preference)
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: preference }))
}

export function applyStoredTheme(): void {
  applyTheme(readThemePreference())
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
}
