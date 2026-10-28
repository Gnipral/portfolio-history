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
  applyPalette(readPalette())
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  return current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'
}

/** Color palettes on top of the light or dark theme. */
export type Palette = 'standard' | 'colorblind' | 'high-contrast' | 'soft'

/** `swatches`: gain, loss, value line and two series colors, to show in the picker. */
export const PALETTES: { id: Palette; label: string; description: string; swatches: string[] }[] = [
  { id: 'standard', label: 'Standard', description: 'Green for gains, red for losses.', swatches: ['#0e8345', '#c5221f', '#1170a6', '#d97706', '#4f46e5'] },
  {
    id: 'colorblind',
    label: 'Colour-blind friendly',
    description: 'Blue for gains, orange for losses, and colors that stay apart with red-green colour blindness.',
    swatches: ['#0072b2', '#c75400', '#7a3f9d', '#e69f00', '#56b4e9'],
  },
  {
    id: 'high-contrast',
    label: 'High contrast',
    description: 'Darker text and lines, stronger colors: easier to read.',
    swatches: ['#006b2d', '#b00000', '#00509e', '#d97706', '#4f46e5'],
  },
  {
    id: 'soft',
    label: 'Soft',
    description: 'Calmer colors and less contrast: easier on the eyes.',
    swatches: ['#3f8f62', '#b9635d', '#5a8db0', '#d4a056', '#8085c9'],
  },
]

const PALETTE_KEY = 'palette'

export function readPalette(): Palette {
  try {
    const value = localStorage.getItem(PALETTE_KEY)
    if (PALETTES.some((p) => p.id === value)) return value as Palette
  } catch {
    // Storage unavailable: the standard palette.
  }
  return 'standard'
}

/** `standard` removes the attribute, so the theme's own colors apply. */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement
  if (palette === 'standard') root.removeAttribute('data-palette')
  else root.setAttribute('data-palette', palette)
}

export function storePalette(palette: Palette): void {
  try {
    if (palette === 'standard') localStorage.removeItem(PALETTE_KEY)
    else localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    // Not persisted; the choice still applies for this session.
  }
  applyPalette(palette)
}
