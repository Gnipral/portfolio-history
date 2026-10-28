import type { ToggleKey } from '../../engine/options.ts'
import { t } from '../../i18n/i18n.ts'
import { TOGGLE_GROUPS, type ToggleState } from './toggles.ts'

/**
 * What counts in the result, grouped, with a line on what each option does. An option the export
 * has no data for is disabled, with the reason in place of its description.
 */
export function ToggleBar({ states, onChange }: { states: ToggleState[]; onChange: (key: ToggleKey, value: boolean) => void }) {
  return (
    <fieldset className="toggle-bar">
      <legend>{t('What counts in the result')}</legend>
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
    </fieldset>
  )
}
