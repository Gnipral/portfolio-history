import { useState, type FormEvent } from 'react'
import type { NamedPeriod } from '../../settings/settings.ts'
import { formatDate } from '../format.ts'

interface Props {
  periods: NamedPeriod[]
  /** The saved period open now, if any. */
  openId: string | null
  /** The period shown now: what "Save" stores. `to` is null when it runs up to today. */
  current: { from: string; to: string | null }
  onOpen: (id: string) => void
  onSave: (period: Omit<NamedPeriod, 'id'>) => void
  onRemove: (id: string) => void
}

function describe(period: { from: string; to: string | null }): string {
  return `${formatDate(period.from)} – ${period.to ? formatDate(period.to) : 'today'}`
}

/** Saved periods to open with one click, and the current one to save under a name. */
export function PeriodBar({ periods, openId, current, onOpen, onSave, onRemove }: Props) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSave({ name: trimmed, ...current })
    setNaming(false)
    setName('')
  }

  return (
    <div className="period-bar" role="group" aria-label="Saved periods">
      <span className="label-caps">Periods</span>
      <div className="chips">
        {periods.map((p) => (
          <span key={p.id} className="period-chip">
            <button type="button" className="chip" aria-pressed={p.id === openId} title={describe(p)} onClick={() => onOpen(p.id)}>
              {p.name}
            </button>
            <button type="button" className="period-remove" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => onRemove(p.id)}>
              ×
            </button>
          </span>
        ))}
        {!naming && (
          <button type="button" className="chip period-save" onClick={() => setNaming(true)}>
            + Save this period
          </button>
        )}
      </div>
      {naming && (
        <form className="period-form" onSubmit={save}>
          <input
            autoFocus
            aria-label="Name of the period"
            placeholder="e.g. After the crash"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="muted small">{describe(current)}</span>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Save
          </button>
          <button type="button" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      )}
      {periods.length === 0 && !naming && (
        <span className="muted small">Pick a range or a day, then save it under a name to open it again later.</span>
      )}
    </div>
  )
}
