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
export type Palette = 'standard' | 'colorblind' | 'high-contrast' | 'soft' | 'neon' | 'ocean'

/** `swatches`: background, value line, gain, loss and a benchmark color, to show in the pickers. */
export const PALETTES: { id: Palette; label: string; description: string; swatches: string[] }[] = [
  { id: 'standard', label: msg('Standard'), description: msg('The colors of the app: green for gains, red for losses.'), swatches: ['#14181d', '#5cc8f0', '#3ddc97', '#ff7b7b', '#ffb95f'] },
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
  { id: 'soft', label: msg('Soft'), description: msg('Pastel colors on a calm background: easy on the eyes.'), swatches: ['#1c2026', '#9db6cc', '#8fbf9f', '#c99a96', '#c9b08a'] },
  { id: 'neon', label: msg('Neon'), description: msg('Glowing colors on deep black, in light and dark.'), swatches: ['#07060f', '#00f0ff', '#39ff14', '#ff2079', '#ffe600'] },
  { id: 'ocean', label: msg('Ocean'), description: msg('Deep blues with teal for gains and coral for losses.'), swatches: ['#071a2b', '#4fc3f7', '#2ee6c5', '#ff7b54', '#ffc15e'] },
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
