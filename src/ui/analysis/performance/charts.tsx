import { formatDate } from '../../format.ts'

/**
 * Small inline SVG charts for the Performance view, all in one style: thin lines, a zero line, a few
 * labelled gridlines, grayscale with the benchmark in its colour. They scale to the width of their box.
 */

export interface ChartSeries {
  label: string
  points: { date: string; value: number }[]
  /** A CSS colour, e.g. `var(--chart-value)` or `var(--benchmark)`. */
  color: string
  dashed?: boolean
}

const WIDTH = 760
const HEIGHT = 220
const PAD = { top: 12, right: 12, bottom: 24, left: 52 }

/** Round steps for the gridlines between `min` and `max`. */
function ticks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1
  const raw = span / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw
  const first = Math.ceil(min / step) * step
  const result: number[] = []
  for (let v = first; v <= max + step * 1e-9; v += step) result.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return result
}

interface LineChartProps {
  series: ChartSeries[]
  /** Formats a value on the axis, e.g. as a percentage. */
  format: (value: number) => string
  /** Draws the zero line darker, e.g. for alpha around zero. */
  zeroLine?: boolean
  /** Fills the area between the first series and zero, as for an underwater curve. */
  fillFirst?: boolean
  label: string
}

/** A line chart of one or more series on the same dates. */
export function LineChart({ series, format, zeroLine = true, fillFirst = false, label }: LineChartProps) {
  const dates = series[0]?.points.map((p) => p.date) ?? []
  const values = series.flatMap((s) => s.points.map((p) => p.value)).filter(Number.isFinite)
  if (dates.length < 2 || values.length === 0) return <p className="muted small">{label}: –</p>
  let min = Math.min(0, ...values)
  let max = Math.max(0, ...values)
  if (min === max) max = min + 1
  const pad = (max - min) * 0.05
  min -= pad
  max += pad
  const innerW = WIDTH - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const index = new Map(dates.map((d, i) => [d, i]))
  const x = (date: string) => PAD.left + ((index.get(date) ?? 0) / (dates.length - 1)) * innerW
  const y = (value: number) => PAD.top + ((max - value) / (max - min)) * innerH
  const path = (points: ChartSeries['points']) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const grid = ticks(min, max)
  const labelDates = [0, Math.floor((dates.length - 1) / 2), dates.length - 1].map((i) => dates[i] as string)
  const first = series[0]

  return (
    <figure className="perf-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} preserveAspectRatio="none">
        {grid.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(v)} y2={y(v)} className={v === 0 && zeroLine ? 'perf-zero' : 'perf-grid'} />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="perf-axis">
              {format(v)}
            </text>
          </g>
        ))}
        {fillFirst && first && (
          <path d={`${path(first.points)}L${x(first.points.at(-1)?.date ?? '')},${y(0)}L${x(first.points[0]?.date ?? '')},${y(0)}Z`} className="perf-fill" />
        )}
        {series.map((s) => (
          <path key={s.label} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={1.5} strokeDasharray={s.dashed ? '4 3' : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        {labelDates.map((date, i) => (
          <text key={date} x={x(date)} y={HEIGHT - 6} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="perf-axis">
            {formatDate(date)}
          </text>
        ))}
      </svg>
      {series.length > 1 && (
        <figcaption className="perf-legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ borderColor: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' }} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  )
}

export interface WaterfallBar {
  label: string
  /** Signed amount; gains up, charges down. */
  amount: number
  /** The total at the end: drawn from zero. */
  total?: boolean
  /** Shown faded: listed, but not counted in the result. */
  muted?: boolean
}

/** Horizontal waterfall bars: each step starts where the one before ended, the total from zero. */
export function Waterfall({ bars, format }: { bars: WaterfallBar[]; format: (amount: number) => string }) {
  let running = 0
  const spans = bars.map((bar) => {
    if (bar.total) return { bar, from: 0, to: bar.amount }
    const from = running
    if (!bar.muted) running += bar.amount
    return { bar, from, to: bar.muted ? from + bar.amount : running }
  })
  const edges = spans.flatMap((s) => [s.from, s.to])
  const min = Math.min(0, ...edges)
  const max = Math.max(0, ...edges)
  const scale = (v: number) => ((v - min) / (max - min || 1)) * 100
  return (
    <div className="waterfall" role="img" aria-label={bars.map((b) => `${b.label} ${format(b.amount)}`).join(', ')}>
      {spans.map(({ bar, from, to }) => (
        <div key={bar.label} className={`waterfall-row${bar.muted ? ' is-muted' : ''}${bar.total ? ' is-total' : ''}`}>
          <span className="waterfall-label">{bar.label}</span>
          <span className="waterfall-track">
            <span
              className={`waterfall-bar${bar.amount < 0 ? ' is-down' : ''}`}
              style={{ left: `${scale(Math.min(from, to))}%`, width: `${Math.max(0.4, Math.abs(scale(to) - scale(from)))}%` }}
            />
          </span>
          <span className="waterfall-amount num">{format(bar.amount)}</span>
        </div>
      ))}
    </div>
  )
}
