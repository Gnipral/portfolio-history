import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { leastDifference } from './colorVision.ts'

const css = readFileSync(resolve(__dirname, 'global.css'), 'utf8')

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No block ${selector}`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]))
}

/** Clearly different, with normal vision and with each kind of colour blindness. */
const CLEAR = 20

// The value line and the four benchmark lines share the value pane; gain and loss share the profit pane.
const LINES = ['chart-value', 'series-2', 'series-7', 'series-5', 'series-6']

describe('colour-blind palette', () => {
  for (const [mode, selector] of [
    ['light', "\n[data-palette='colorblind']"],
    ['dark', ":root[data-theme='dark'] [data-palette='colorblind']"],
  ] as const) {
    const colors = tokens(selector)
    const pairs: [string, string][] = [['chart-positive', 'chart-negative'], ['chart-value', 'chart-positive'], ['chart-value', 'chart-negative']]
    LINES.forEach((a, i) => {
      for (const b of LINES.slice(i + 1)) pairs.push([a, b])
    })

    it.each(pairs)(`keeps %s and %s apart for every kind of colour vision (${mode})`, (a, b) => {
      const { difference, vision } = leastDifference(colors[a]!, colors[b]!)
      expect(difference, `${a} ${colors[a]} vs ${b} ${colors[b]}, ${vision}`).toBeGreaterThanOrEqual(CLEAR)
    })

    it(`keeps every line apart from the background (${mode})`, () => {
      for (const line of [...LINES, 'chart-positive', 'chart-negative']) {
        expect(leastDifference(colors[line]!, colors.surface!).difference, line).toBeGreaterThanOrEqual(CLEAR)
      }
    })
  }

  it('is the same in the system dark mode as in the chosen dark theme', () => {
    expect(tokens(":root:not([data-theme='light']) [data-palette='colorblind']")).toEqual(tokens(":root[data-theme='dark'] [data-palette='colorblind']"))
  })
})
