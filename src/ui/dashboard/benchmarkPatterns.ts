import type { LineStyle } from 'lightweight-charts'

/**
 * Every benchmark line has its own pattern besides its colour, so the lines can be told apart without seeing
 * colours. `css` draws the same pattern in the legend. The first one is solid, in the accent colour. The line
 * styles are the numbers of lightweight-charts' LineStyle, so the legend does not load the chart library.
 */
export const BENCHMARK_PATTERNS: { lineStyle: LineStyle; lineWidth: 1 | 2; css: string }[] = [
  { lineStyle: 0 as LineStyle, lineWidth: 2, css: 'linear-gradient(currentColor, currentColor) center / 100% 2px no-repeat' },
  { lineStyle: 3 as LineStyle, lineWidth: 2, css: 'repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 9px)' },
  { lineStyle: 1 as LineStyle, lineWidth: 2, css: 'repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 4px)' },
  { lineStyle: 4 as LineStyle, lineWidth: 2, css: 'repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 6px)' },
]

export function benchmarkPattern(index: number) {
  return BENCHMARK_PATTERNS[index % BENCHMARK_PATTERNS.length]!
}
