interface Props {
  /** The types of asset held at some point. */
  classes: string[]
  /** The types shown; empty: all of them. */
  chosen: string[]
  onChange: (chosen: string[]) => void
}

/** Chips to show only some types of asset in the chart, the numbers and the positions. */
export function AssetFilter({ classes, chosen, onChange }: Props) {
  if (classes.length < 2) return null
  const toggle = (label: string) => {
    const next = chosen.includes(label) ? chosen.filter((c) => c !== label) : [...chosen, label]
    // Every type chosen is the same as no filter.
    onChange(next.length === classes.length ? [] : next)
  }
  return (
    <div className="benchmark-picker" role="group" aria-label="Show">
      <span className="label-caps">Show</span>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={chosen.length === 0} onClick={() => onChange([])}>
          All
        </button>
        {classes.map((label) => (
          <button key={label} type="button" className="chip" aria-pressed={chosen.includes(label)} onClick={() => toggle(label)}>
            {label}
          </button>
        ))}
      </div>
      {chosen.length > 0 && <span className="muted small">Securities only: deposits and cash are left out.</span>}
    </div>
  )
}
