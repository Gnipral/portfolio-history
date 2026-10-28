import { useState } from 'react'
import type { ToggleKey } from '../../engine/options.ts'
import { t, tn } from '../../i18n/i18n.ts'
import { TOGGLE_GROUPS, type ToggleState } from './toggles.ts'

/** On a phone the options start folded, so the chart is in view first. */
const PHONE = '(max-width: 700px)'

/**
 * What counts in the result, grouped, with a line on what each option does. An option the export
 * has no data for is disabled, with the reason in place of its description.
 */
export function ToggleBar({ states, onChange }: { states: ToggleState[]; onChange: (key: ToggleKey, value: boolean) => void }) {
  const [open, setOpen] = useState(() => !(typeof window !== 'undefined' && window.matchMedia?.(PHONE).matches))
  const off = states.filter((state) => !state.checked && state.disabledReason === undefined).length

  return (
    <fieldset className={`toggle-bar${open ? '' : ' folded'}`}>
      <legend>
        <button type="button" className="toggle-bar-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
          {t('What counts in the result')}
          <span className="toggle-bar-summary muted small">
            {off === 0 ? t('everything counts') : tn(off, '{count} switched off', '{count} switched off')}
          </span>
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      </legend>
      {open && (
        <>
          <p className="muted small toggle-intro">{t('Switch an item off to leave it out of every number, as if it never happened.')}</p>
          <div className="toggle-groups">
            {TOGGLE_GROUPS.map((group) => (
              <div key={group} className="toggle-group">
                <span className="toggle-group-title">{t(group)}</span>
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
              </div>
            ))}
          </div>
        </>
      )}
    </fieldset>
  )
}
