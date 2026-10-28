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
  benchmark: string
  fontMono: string
  /** The chart's own palette: close to the app's, but softer and easier to tell apart. */
  chart: {
    value: string
    invested: string
    positive: string
    negative: string
    zero: string
    grid: string
    separator: string
  }
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
    // Categorical slot 2 (orange): never a status color.
    benchmark: v('--series-2'),
    fontMono: v('--font-mono'),
    chart: {
      value: v('--chart-value'),
      invested: v('--chart-invested'),
      positive: v('--chart-positive'),
      negative: v('--chart-negative'),
      zero: v('--chart-zero'),
      grid: v('--chart-grid'),
      separator: v('--chart-separator'),
    },
  }
}

/** The current theme's CSS variables, updated when the system or manual theme changes. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState(read)

  useEffect(() => {
    const update = () => setColors(read())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener('change', update)
    }
  }, [])

  return colors
}
