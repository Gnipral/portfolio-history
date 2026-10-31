import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { t } from '../../i18n/i18n.ts'
import { indexAtRatio, panWindow, stepPlayhead, trimEnd, trimStart, type DayWindow } from './timeline.ts'
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

type Drag = { kind: 'start' | 'end' | 'body' | 'playhead'; x: number; window: DayWindow; moved: boolean }

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
 * (the period) that also pans as a whole, and a playhead inside it (the day the side panel shows).
 */
export function Timeline({ points, window, playhead, range, onWindow, onPlayhead, onRange }: Props) {
  const strip = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const count = points.length
  const dates = useMemo(() => points.map((p) => p.date), [points])
  const line = useMemo(() => overview(points), [points])
  const first = dates[0] ?? ''
  const last = dates.at(-1) ?? ''

  const ratioAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect()
    return box && box.width > 0 ? (clientX - box.left) / box.width : 0
  }

  function begin(kind: Drag['kind']) {
    return (event: ReactPointerEvent) => {
      event.preventDefault()
      event.stopPropagation()
      ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
      drag.current = { kind, x: event.clientX, window, moved: false }
    }
  }

  function move(event: ReactPointerEvent) {
    const d = drag.current
    const box = strip.current?.getBoundingClientRect()
    if (!d || !box || box.width === 0) return
    const days = Math.round(((event.clientX - d.x) / box.width) * (count - 1))
    if (Math.abs(event.clientX - d.x) > 3) d.moved = true
    if (!d.moved) return
    const index = indexAtRatio(ratioAt(event.clientX), count)
    if (d.kind === 'start') onWindow(trimStart(window, index))
    else if (d.kind === 'end') onWindow(trimEnd(window, index, count))
    else if (d.kind === 'body') onWindow(panWindow(d.window, days, count))
    else onPlayhead(Math.min(window.to, Math.max(window.from, index)))
  }

  function end(event: ReactPointerEvent) {
    const d = drag.current
    drag.current = null
    // A click on the window, without dragging it: the playhead goes there.
    if (d && d.kind === 'body' && !d.moved) onPlayhead(Math.min(window.to, Math.max(window.from, indexAtRatio(ratioAt(event.clientX), count))))
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
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          drag.current = null
        }}
        onPointerDown={(event) => {
          // On the history outside the window: the nearest handle goes there.
          const index = indexAtRatio(ratioAt(event.clientX), count)
          if (index < window.from) onWindow(trimStart(window, index))
          else if (index > window.to) onWindow(trimEnd(window, index, count))
        }}
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
          onPointerDown={begin('body')}
        >
          <span className="timeline-days">{t('{days} days', { days: days.toLocaleString() })}</span>
          <button type="button" className="timeline-handle start" aria-label={t('Start of the period')} onPointerDown={begin('start')} />
          <button type="button" className="timeline-handle end" aria-label={t('End of the period')} onPointerDown={begin('end')} />
        </div>
        <div className="timeline-playhead" data-testid="timeline-playhead" style={{ left: `${pct(playhead, count)}%` }} onPointerDown={begin('playhead')} aria-hidden="true" />
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
