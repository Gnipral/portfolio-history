import type { ComparedPeriod } from '../../../engine/analysis/performance.ts'
import { locale, t } from '../../../i18n/i18n.ts'

const monthName = new Intl.DateTimeFormat(locale(), { month: 'short', timeZone: 'UTC' })
const MONTHS = Array.from({ length: 12 }, (_, i) => monthName.format(new Date(Date.UTC(2026, i, 1))))

/** A return as a signed percentage with two decimals and no % sign, as in the cells of a heatmap. */
const cell = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value * 100).toFixed(2)}`

/** Grayscale shading by size, capped at 10% a month: the sign carries the direction, not a colour. */
function shade(value: number): string {
  const strength = Math.min(1, Math.abs(value) / 0.1)
  return `color-mix(in srgb, var(--text) ${Math.round(strength * 22)}%, var(--surface))`
}

interface Props {
  months: ComparedPeriod[]
  years: ComparedPeriod[]
  /** Advanced: a column with the year's difference against the benchmark. */
  vsBenchmark?: { label: string } | undefined
  /** A second fixed benchmark's yearly difference, keyed by year. */
  vsSecond?: { label: string; byYear: Map<string, number | undefined> } | undefined
}

/** Monthly time-weighted returns: years down, January to December across, and the year's total. */
export function Heatmap({ months, years, vsBenchmark, vsSecond }: Props) {
  const byYear = new Map<string, Map<number, number>>()
  for (const m of months) {
    const row = byYear.get(m.period.slice(0, 4)) ?? new Map<number, number>()
    row.set(Number(m.period.slice(5, 7)) - 1, m.portfolio)
    byYear.set(m.period.slice(0, 4), row)
  }
  return (
    <div className="table-scroll">
      <table className="table heatmap">
        <thead>
          <tr>
            <th>{t('Year')}</th>
            {MONTHS.map((m) => (
              <th key={m} className="num">
                {m}
              </th>
            ))}
            <th className="num heatmap-total">{t('Year total')}</th>
            {vsBenchmark && <th className="num benchmark">{t('vs {name}', { name: vsBenchmark.label })}</th>}
            {vsSecond && <th className="num">{t('vs {name}', { name: vsSecond.label })}</th>}
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const row = byYear.get(year.period)
            return (
              <tr key={year.period}>
                <th scope="row">{year.period}</th>
                {MONTHS.map((m, i) => {
                  const value = row?.get(i)
                  return (
                    <td key={m} className="num" style={value === undefined ? undefined : { background: shade(value) }}>
                      {value === undefined ? '–' : cell(value)}
                    </td>
                  )
                })}
                <td className="num heatmap-total">{cell(year.portfolio)}</td>
                {vsBenchmark && <td className="num benchmark">{year.delta === undefined ? '–' : cell(year.delta)}</td>}
                {vsSecond && <td className="num">{(() => {
                  const delta = vsSecond.byYear.get(year.period)
                  return delta === undefined ? '–' : cell(delta)
                })()}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
