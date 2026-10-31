import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { enterDemo } from '../../demo/demoMode.ts'
import { BASE_CURRENCIES, type BaseCurrency } from '../../engine/baseCurrency.ts'
import { t } from '../../i18n/i18n.ts'
import { DEFAULT_SETTINGS, saveSettings, useSettings } from '../../settings/settings.ts'
import { readThemePreference, storeThemePreference, type ThemePreference } from '../../theme/theme.ts'
import { markOnboarded } from './onboarded.ts'

const STEPS = 3

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: t('System') },
  { value: 'light', label: t('Light') },
  { value: 'dark', label: t('Dark') },
]

/**
 * The first visit without data: what the app does, the currency and theme, and where to start. Every
 * way out, skip included, marks it as seen; after that an empty portfolio shows the plain empty state.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1)
  const [theme, setTheme] = useState(readThemePreference)
  const currency = (useSettings() ?? DEFAULT_SETTINGS).baseCurrency
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  // Focus follows the step, so a screen reader reads the new one; not on the first render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every change of step
  useEffect(() => {
    if (moved.current) heading.current?.focus()
    moved.current = true
  }, [step])

  function finish(then?: () => void) {
    markOnboarded()
    onDone()
    then?.()
  }

  return (
    <section className="onboarding" aria-labelledby="onboarding-title">
      <div className="onboarding-card">
        <div className="onboarding-top">
          <span className="label-caps">{t('Step {step} of {total}', { step, total: STEPS })}</span>
          <button type="button" className="link-button" onClick={() => finish()}>
            {t('Skip')}
          </button>
        </div>
        <div className="onboarding-dots" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i + 1 <= step ? 'active' : undefined} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h2 id="onboarding-title" ref={heading} tabIndex={-1}>
              {t('See what your portfolio really did')}
            </h2>
            <p className="onboarding-lead">
              {t('Portfolio History rebuilds the value and the profit of your portfolio for every day since your first trade, from the export of your broker. It also shows what the same money would have made in an ETF.')}
            </p>
            <ul className="onboarding-points">
              <li>{t('Runs in your browser: your data stays on this device.')}</li>
              <li>{t('No account needed, and free for personal use.')}</li>
              <li>{t('Works offline once loaded.')}</li>
            </ul>
          </>
        )}

        {step === 2 && (
          <>
            <h2 id="onboarding-title" ref={heading} tabIndex={-1}>
              {t('Make it yours')}
            </h2>
            <p className="muted">{t('Both can be changed later in Settings.')}</p>
            <label className="onboarding-field">
              {t('Currency')}
              <select value={currency} onChange={(e) => void saveSettings({ baseCurrency: e.target.value as BaseCurrency })}>
                {BASE_CURRENCIES.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
              <span className="muted small">{t('Every amount and return is shown in this currency, at the ECB rate of each day.')}</span>
            </label>
            <div className="onboarding-field">
              <span id="onboarding-theme">{t('Theme')}</span>
              <div className="segmented" role="group" aria-labelledby="onboarding-theme">
                {THEMES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={theme === option.value}
                    onClick={() => {
                      storeThemePreference(option.value)
                      setTheme(option.value)
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 id="onboarding-title" ref={heading} tabIndex={-1}>
              {t('Where do you want to start?')}
            </h2>
            <div className="onboarding-choices">
              <button type="button" className="onboarding-choice" onClick={() => finish(enterDemo)}>
                <strong>{t('Try the demo')}</strong>
                <span className="muted small">{t('A made-up portfolio, no file needed. Your own data stays apart.')}</span>
              </button>
              <button type="button" className="onboarding-choice primary-choice" onClick={() => finish(() => navigate('/import'))}>
                <strong>{t('Import my broker export')}</strong>
                <span className="muted small">{t('DEGIRO, Bolero, Trade Republic and more: CSV, Excel or PDF.')}</span>
              </button>
              <button type="button" className="onboarding-choice" onClick={() => finish(() => navigate('/transactions'))}>
                <strong>{t('Enter transactions by hand')}</strong>
                <span className="muted small">{t('For a broker without an export.')}</span>
              </button>
            </div>
          </>
        )}

        <div className="onboarding-nav">
          {step > 1 ? (
            <button type="button" onClick={() => setStep(step - 1)}>
              {t('Back')}
            </button>
          ) : (
            <span />
          )}
          {step < STEPS && (
            <button type="button" className="primary" onClick={() => setStep(step + 1)}>
              {t('Next')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
