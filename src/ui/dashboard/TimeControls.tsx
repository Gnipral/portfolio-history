import { RANGES, type RangeKey, type VisibleRange } from './timeRange.ts'

interface Props {
  dates: string[]
  range: RangeKey
  visible: VisibleRange
  selected: number
  onRange: (range: RangeKey) => void
  onSelect: (index: number) => void
}

/** Quick ranges, a timeline slider and a date picker; all three drive the same selected day. */
export function TimeControls({ dates, range, visible, selected, onRange, onSelect }: Props) {
  const first = dates[visible.from] ?? ''
  const last = dates[visible.to] ?? ''

  return (
    <div className="time-controls">
      <div className="segmented" role="group" aria-label="Period">
        {RANGES.map((key) => (
          <button key={key} type="button" aria-pressed={key === range} onClick={() => onRange(key)}>
            {key}
          </button>
        ))}
      </div>
      <input
        className="timeline"
        type="range"
        aria-label="Timeline"
        min={visible.from}
        max={visible.to}
        value={selected}
        onChange={(e) => onSelect(Number(e.target.value))}
      />
      <input
        type="date"
        aria-label="Date"
        min={first}
        max={last}
        value={dates[selected] ?? ''}
        onChange={(e) => {
          const index = dates.indexOf(e.target.value)
          if (index >= 0) onSelect(index)
        }}
      />
    </div>
  )
}
