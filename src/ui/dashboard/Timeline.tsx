import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../../i18n/i18n.ts'
import { grabAt, indexAtRatio, PLAYHEAD_REACH, stepPlayhead, trimEnd, trimStart, type DayWindow, type Grab } from './timeline.ts'
import { RANGES, rangeDescription, type RangeKey } from './timeRange.ts'

interface Props {
  /** One per calendar day of the whole history, with the value for the overview line. */
  points: readonly { date: string; value: number }[]
  window: DayWindow
  playhead: number
  /** The quick range shown, or null for a window set by hand. */
  range: RangeKey | null
  onWindow: (window: DayWindow) => void
  onPlayhead: (index: number) => void
  onRange: (range: RangeKey) => void
}

const CURSORS: Record<Grab, string> = { start: 'ew-resize', end: 'ew-resize', playhead: 'col-resize' }

/** Days of the window as a share of the strip, in percent. */
const pct = (index: number, count: number) => (count > 1 ? (index / (count - 1)) * 100 : 0)

/** The overview line of the whole history, in a 1000×40 box. */
function overview(points: readonly { value: number }[]): string {
  if (points.length < 2) return ''
  const step = Math.max(1, Math.floor(points.length / 400))
  let max = 0
  let min = Number.POSITIVE_INFINITY
  for (const p of points) {
    max = Math.max(max, p.value)
    min = Math.min(min, p.value)
  }
  const span = max - min || 1
  const parts: string[] = []
  for (let i = 0; i < points.length; i += step) parts.push(`${((i / (points.length - 1)) * 1000).toFixed(1)},${(38 - ((points[i]!.value - min) / span) * 34).toFixed(1)}`)
  return parts.join(' ')
}

/**
 * The timeline under the chart, as in a video editor: the whole history with a window of two trim handles
 * (the period, which does not move as a whole) and a playhead inside it (the day the side panel shows).
 * Every press goes to the strip, which decides what it takes hold of (see grabAt): the playhead has a
 * margin on either side, and a press elsewhere in the window brings it there.
 */
export function Timeline({ points, window, playhead, range, onWindow, onPlayhead, onRange }: Props) {
  const strip = useRef<HTMLDivElement>(null)
  const drag = useRef<Grab | null>(null)
  const count = points.length
  const dates = useMemo(() => points.map((p) => p.date), [points])
  const line = useMemo(() => overview(points), [points])
  const first = dates[0] ?? ''
  const last = dates.at(-1) ?? ''

  const ratioAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect()
    return box && box.width > 0 ? (clientX - box.left) / box.width : 0
  }

  /** What a press at `clientX` would take hold of. */
  const grabbing = (clientX: number): Grab | null => {
    const box = strip.current?.getBoundingClientRect()
    return box && box.width > 0 ? grabAt(clientX - box.left, box.width, count, window, playhead) : null
  }

  /** Moves what is held to the day under `clientX`. */
  function follow(kind: Grab, clientX: number) {
    const index = indexAtRatio(ratioAt(clientX), count)
    if (kind === 'start') onWindow(trimStart(window, index))
    else if (kind === 'end') onWindow(trimEnd(window, index, count))
    else if (index !== playhead) onPlayhead(Math.min(window.to, Math.max(window.from, index)))
  }

  function press(event: ReactPointerEvent<HTMLDivElement>) {
    const kind = grabbing(event.clientX)
    if (!kind) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = kind
    // A handle pressed outside the window jumps there; the playhead comes to a press that was not within reach.
    const index = indexAtRatio(ratioAt(event.clientX), count)
    const box = strip.current?.getBoundingClientRect()
    const headOff = box ? Math.abs(event.clientX - box.left - (pct(playhead, count) / 100) * box.width) : 0
    if ((kind === 'start' && index < window.from) || (kind === 'end' && index > window.to)) follow(kind, event.clientX)
    else if (kind === 'playhead' && headOff > PLAYHEAD_REACH) follow(kind, event.clientX)
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current) {
      follow(drag.current, event.clientX)
      return
    }
    // Not dragging: the cursor says what a press would take hold of.
    const kind = grabbing(event.clientX)
    event.currentTarget.style.cursor = kind ? CURSORS[kind] : ''
  }

  function release() {
    drag.current = null
  }

  // ←/→ move the playhead a day, with Shift a month; on the page itself, not while typing.
  const keyState = useRef({ dates, playhead, window, onPlayhead })
  keyState.current = { dates, playhead, window, onPlayhead }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      const onPage = target === document.body || (target instanceof Element && target.closest('.dash-chart, .timeline'))
      if (!onPage || (target instanceof Element && target.closest('input, select, textarea, [contenteditable="true"]'))) return
      const s = keyState.current
      event.preventDefault()
      s.onPlayhead(stepPlayhead(s.dates, s.playhead, event.key === 'ArrowLeft' ? -1 : 1, event.shiftKey, s.window))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const dateInput = (label: string, value: string, onPick: (index: number) => void) => (
    <label className="timeline-date">
      <span className="label-caps">{label}</span>
      <input
        type="date"
        aria-label={label}
        min={first}
        max={last}
        value={value}
        onChange={(e) => {
          const index = dates.indexOf(e.target.value)
          if (index >= 0) onPick(index)
        }}
      />
    </label>
  )

  const days = window.to - window.from + 1

  return (
    <div className="timeline">
      <div className="timeline-dates">
        {dateInput(t('From'), dates[window.from] ?? '', (index) => onWindow(trimStart(window, index)))}
        <span aria-hidden="true">—</span>
        {dateInput(t('To'), dates[window.to] ?? '', (index) => onWindow(trimEnd(window, index, count)))}
      </div>
      <div
        ref={strip}
        className="timeline-strip"
        role="slider"
        tabIndex={0}
        aria-label={t('Playhead')}
        aria-valuemin={window.from}
        aria-valuemax={window.to}
        aria-valuenow={playhead}
        aria-valuetext={dates[playhead]}
        onPointerDown={press}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <svg className="timeline-line" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={line} />
        </svg>
        <div className="timeline-shade" style={{ left: 0, width: `${pct(window.from, count)}%` }} />
        <div className="timeline-shade" style={{ left: `${pct(window.to, count)}%`, right: 0 }} />
        <div
          className="timeline-window"
          data-testid="timeline-window"
          style={{ left: `${pct(window.from, count)}%`, width: `${pct(window.to, count) - pct(window.from, count)}%` }}
        >
          <span className="timeline-days">{t('{days} days', { days: days.toLocaleString() })}</span>
          <span className="timeline-handle start" aria-hidden="true" />
          <span className="timeline-handle end" aria-hidden="true" />
        </div>
        <div className="timeline-playhead" data-testid="timeline-playhead" style={{ left: `${pct(playhead, count)}%` }} aria-hidden="true" />
      </div>
      <div className="segmented segmented-small timeline-presets" role="group" aria-label={t('Period')}>
        {RANGES.map((key) => (
          <button key={key} type="button" aria-pressed={key === range} title={rangeDescription(key)} onClick={() => onRange(key)}>
            {key === 'ALL' ? t('All') : t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}
