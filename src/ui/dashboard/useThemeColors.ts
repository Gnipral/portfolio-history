import { useEffect, useState, type RefObject } from 'react'

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

function read(element?: Element | null): ThemeColors {
  const style = getComputedStyle(element ?? document.documentElement)
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

/**
 * The current theme's CSS variables, updated when the system or manual theme changes. With an
 * element, as that element sees them: a palette set on a block of the page then counts too, and
 * `palette` reads them again when it changes.
 */
export function useThemeColors(element?: RefObject<Element | null>, palette?: string): ThemeColors {
  const [colors, setColors] = useState(() => read())

  useEffect(() => {
    setColors(read(element?.current))
  }, [element, palette])

  useEffect(() => {
    const update = () => setColors(read(element?.current))
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener('change', update)
    }
  }, [element])

  return colors
}
