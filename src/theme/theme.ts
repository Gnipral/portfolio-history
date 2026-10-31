import { msg } from '../i18n/i18n.ts'
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

/** Color palettes of the chart block on the dashboard; the rest of the app keeps the theme's colors. */
export type Palette = 'standard' | 'colorblind' | 'high-contrast'

/** `swatches`: background, value line, gain, loss and a benchmark color, to show in the pickers. */
export const PALETTES: { id: Palette; label: string; description: string; swatches: string[] }[] = [
  { id: 'standard', label: msg('Standard'), description: msg('Grayscale, with the benchmark in red.'), swatches: ['#ffffff', '#141414', '#3a3a38', '#a8a8a5', '#c8102e'] },
  {
    id: 'colorblind',
    label: msg('Colour-blind friendly'),
    description: msg('Blue for gains, orange for losses, and every line clearly apart with red-green and blue-yellow colour blindness.'),
    swatches: ['#10131a', '#eedd88', '#4fb3ff', '#ff9f1c', '#66ccee'],
  },
  {
    id: 'high-contrast',
    label: msg('High contrast'),
    description: msg('Pure black or white, thick bright colors: as readable as it gets.'),
    swatches: ['#000000', '#00e5ff', '#00ff66', '#ff3355', '#ffb000'],
  },
]

const PALETTE_KEY = 'palette'

/** Fired on window when the palette changes, so the chart block and Settings follow. */
export const PALETTE_EVENT = 'palettechange'

export function readPalette(): Palette {
  try {
    const value = localStorage.getItem(PALETTE_KEY)
    if (PALETTES.some((p) => p.id === value)) return value as Palette
  } catch {
    // Storage unavailable: the standard palette.
  }
  return 'standard'
}

export function storePalette(palette: Palette): void {
  try {
    if (palette === 'standard') localStorage.removeItem(PALETTE_KEY)
    else localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    // Not persisted; the choice still applies for this session.
  }
  current = palette
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: palette }))
}

let current: Palette | null = null

/** The chosen palette, read once from storage and then kept up to date. */
export function currentPalette(): Palette {
  current ??= readPalette()
  return current
}
