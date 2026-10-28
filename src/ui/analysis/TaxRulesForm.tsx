import { isAdjusted, presetOf, TAX_PRESETS, type CapitalGainsRules } from '../../engine/analysis/capitalGains.ts'
import { t, tn } from '../../i18n/i18n.ts'

interface Props {
  rules: CapitalGainsRules
  onChange: (rules: CapitalGainsRules) => void
}

/** A number field that keeps empty input as 0. */
function NumberField({ label, value, step, hint, onChange }: { label: string; value: number; step: number; hint?: string; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" min={0} step={step} inputMode="decimal" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  )
}

/** Country choice and every rule of the capital gains tax estimate, all adjustable. */
export function TaxRulesForm({ rules, onChange }: Props) {
  const set = (changes: Partial<CapitalGainsRules>) => onChange({ ...rules, ...changes })
  const preset = presetOf(rules)
  const adjusted = isAdjusted(rules)

  return (
    <div className="stack settings-form tax-rules">
      <label>
        {t('Tax rules of')}
        <select value={preset.id} onChange={(e) => onChange((TAX_PRESETS.find((p) => p.id === e.target.value) ?? preset).rules)}>
          {TAX_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.label)}
            </option>
          ))}
        </select>
      </label>
      <details open={rules.country === 'custom' || adjusted}>
        <summary>
          {t('Adjust the rules')}
          {adjusted && <span className="badge warning">{t('adjusted')}</span>}
        </summary>
        <div className="tax-rules-grid">
          <NumberField
            label={t('Rate (%)')}
            value={Math.round(rules.rate * 100_000) / 1000}
            step={0.1}
            hint={t('Including surcharges such as a solidarity surcharge')}
            onChange={(percent) => set({ rate: percent / 100 })}
          />
          <NumberField label={t('Yearly exemption (EUR)')} value={rules.yearlyExemption} step={100} onChange={(v) => set({ yearlyExemption: v, maxExemption: Math.max(rules.maxExemption, v) })} />
          <NumberField
            label={t('Unused exemption carried over per year (EUR)')}
            value={rules.exemptionCarryOver}
            step={100}
            onChange={(v) => set({ exemptionCarryOver: v })}
          />
          <NumberField
            label={t('Highest exemption with carry-over (EUR)')}
            value={rules.maxExemption}
            step={100}
            onChange={(v) => set({ maxExemption: Math.max(v, rules.yearlyExemption) })}
          />
          <label>
            {t('Losses offset later gains')}
            <select value={rules.lossCarryForwardYears} onChange={(e) => set({ lossCarryForwardYears: Number(e.target.value) })}>
              <option value={0}>{t('No, only in the same year')}</option>
              {[1, 3, 5, 6, 10].map((years) => (
                <option key={years} value={years}>
                  {tn(years, 'For {count} year', 'For {count} years')}
                </option>
              ))}
              <option value={99}>{t('Without limit')}</option>
            </select>
          </label>
          <label>
            {t('Units sold')}
            <select value={rules.costBasis} onChange={(e) => set({ costBasis: e.target.value as CapitalGainsRules['costBasis'] })}>
              <option value="average">{t('Average purchase price')}</option>
              <option value="fifo">{t('First in, first out (FIFO)')}</option>
            </select>
          </label>
          <NumberField
            label={t('Taxed from year (0 = always)')}
            value={rules.firstTaxedYear ?? 0}
            step={1}
            onChange={(v) => set({ firstTaxedYear: v >= 1900 ? Math.round(v) : null })}
          />
          <label>
            {t('Gains before this date are not taxed')}
            <input type="date" value={rules.referenceDate ?? ''} onChange={(e) => set({ referenceDate: e.target.value || null })} />
            <span className="muted small">{t('What you held then counts at its market value of that day')}</span>
          </label>
          <label>
            {t('Value on that date')}
            <select value={rules.stepUp} disabled={!rules.referenceDate} onChange={(e) => set({ stepUp: e.target.value as CapitalGainsRules['stepUp'] })}>
              <option value="higher">{t('Only when higher than the purchase price')}</option>
              <option value="value">{t('Always, also when lower')}</option>
            </select>
          </label>
          <label className="radio">
            <input type="checkbox" checked={rules.deductCharges} onChange={(e) => set({ deductCharges: e.target.checked })} />
            <span>{t('Costs and taxes on trades lower the gain')}</span>
          </label>
        </div>
        {adjusted && rules.country !== 'custom' && (
          <button type="button" onClick={() => onChange(preset.rules)}>
            {t('Back to the rules of {name}', { name: t(preset.label) })}
          </button>
        )}
      </details>
    </div>
  )
}
