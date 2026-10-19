import { useEffect, useState } from 'react'

export interface ThemeColors {
  bg: string
  surface: string
  border: string
  text: string
  textMuted: string
  accent: string
  positive: string
  negative: string
}

function read(): ThemeColors {
  const style = getComputedStyle(document.documentElement)
  const v = (name: string) => style.getPropertyValue(name).trim()
  return {
    bg: v('--bg'),
    surface: v('--surface'),
    border: v('--border'),
    text: v('--text'),
    textMuted: v('--text-muted'),
    accent: v('--accent'),
    positive: v('--positive'),
    negative: v('--negative'),
  }
}

/** The current theme's CSS variables, updated when the system or manual theme changes. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState(read)

  useEffect(() => {
    const update = () => setColors(read())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener('change', update)
    }
  }, [])

  return colors
}
