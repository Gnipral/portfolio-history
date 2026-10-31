import { useState } from 'react'
import type { ToggleKey } from '../../engine/options.ts'
import { t } from '../../i18n/i18n.ts'
import { TOGGLE_GROUPS, type ToggleState } from './toggles.ts'

/**
 * What counts in the result: one thin row, folded by default, with the count of what is included. Unfolded,
 * the options by group with a line on what each does; an option the export has no data for is disabled,
 * with the reason in place of its description.
 */
export function ToggleBar({ states, onChange }: { states: ToggleState[]; onChange: (key: ToggleKey, value: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const included = states.filter((state) => state.checked).length
  const total = states.length

  return (
    <div className={`result-toggles${open ? ' open' : ''}`}>
      <button type="button" className="result-toggles-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="label-caps">{t('What counts in the result')}</span>
        <span className="result-toggles-summary">
          {included === total ? t('All {total} included', { total }) : t('{included} of {total} included', { included, total })}
        </span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="result-toggles-body">
          <p className="muted small">{t('Switch an item off to leave it out of every number, as if it never happened.')}</p>
          <div className="toggle-groups">
            {TOGGLE_GROUPS.map((group) => (
              <fieldset key={group} className="toggle-group">
                <legend className="label-caps">{t(group)}</legend>
                {states
                  .filter((state) => state.group === group)
                  .map((state) => (
                    <label key={state.key} className={`toggle${state.disabledReason ? ' disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={state.checked}
                        disabled={state.disabledReason !== undefined}
                        onChange={(e) => onChange(state.key, e.target.checked)}
                        aria-labelledby={`${state.key}-label`}
                        aria-describedby={`${state.key}-description`}
                      />
                      <span>
                        <span className="toggle-label" id={`${state.key}-label`}>
                          {t(state.label)}
                        </span>
                        <span className="toggle-description" id={`${state.key}-description`}>
                          {t(state.disabledReason ?? state.description)}
                        </span>
                      </span>
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
