import type { ToggleKey } from '../../engine/options.ts'
import type { ToggleState } from './toggles.ts'

/** The include/exclude checkboxes; unavailable ones are disabled with the reason next to them. */
export function ToggleBar({ states, onChange }: { states: ToggleState[]; onChange: (key: ToggleKey, value: boolean) => void }) {
  const unavailable = states.filter((s) => s.disabledReason)
  return (
    <fieldset className="toggle-bar">
      <legend>Include</legend>
      {states.map((state) => (
        <label key={state.key} className={state.disabledReason ? 'disabled' : undefined} title={state.disabledReason}>
          <input
            type="checkbox"
            checked={state.checked}
            disabled={state.disabledReason !== undefined}
            onChange={(e) => onChange(state.key, e.target.checked)}
          />
          {state.label}
        </label>
      ))}
      {unavailable.length > 0 && (
        <details className="toggle-reasons">
          <summary>Why are some options unavailable?</summary>
          <ul>
            {unavailable.map((s) => (
              <li key={s.key}>
                <strong>{s.label}:</strong> {s.disabledReason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </fieldset>
  )
}
