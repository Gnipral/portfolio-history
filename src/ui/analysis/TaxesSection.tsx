import { useMemo } from 'react'
import { capitalGainsTax, isAdjusted, presetOf, type CapitalGainsRules } from '../../engine/analysis/capitalGains.ts'
import { chargesByYear } from '../../engine/analysis/charges.ts'
import { incomeRows } from '../../engine/analysis/income.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import { localToday } from '../../market/dates.ts'
import { displayCurrency, formatDate, formatEur, formatPercent, formatSignedEur, trendClass } from '../format.ts'
import { t } from '../../i18n/i18n.ts'
import { SalesTable } from './SalesTable.tsx'
import { TaxReportPanel } from './TaxReportPanel.tsx'
import { TaxRulesForm } from './TaxRulesForm.tsx'

interface Props {
  inputs: EngineInputs
  rules: CapitalGainsRules
  onRulesChange: (rules: CapitalGainsRules) => void
}

/** The chosen rules in one sentence or two, so the result can be checked against them. */
function describe(rules: CapitalGainsRules): string {
  if (rules.rate === 0) return t('No tax on realized gains under these rules.')
  const rate = formatPercent(rules.rate, false)
  const parts = [
    rules.yearlyExemption > 0
      ? t('{rate} on the net gains of a year above an exemption of {exemption}', { rate, exemption: formatEur(rules.yearlyExemption, true) })
      : t('{rate} on the net gains of a year', { rate }),
  ]
  parts[0] += rules.firstTaxedYear ? `${t(', from {year} on', { year: rules.firstTaxedYear })}.` : '.'
  if (rules.exemptionCarryOver > 0) {
    parts.push(
      t('An unused exemption carries over up to {amount} a year, to at most {max}.', {
        amount: formatEur(rules.exemptionCarryOver, true),
        max: formatEur(rules.maxExemption, true),
      }),
    )
  }
  if (rules.referenceDate) {
    const date = formatDate(rules.referenceDate)
    parts.push(
      rules.stepUp === 'higher'
        ? t('What you held on {date} counts at its value of that day, or at its purchase price when that is higher.', { date })
        : t('What you held on {date} counts at its value of that day.', { date }),
    )
  }
  parts.push(
    rules.lossCarryForwardYears === 0
      ? t('Losses only offset gains of the same year.')
      : rules.lossCarryForwardYears >= 99
        ? t('Losses offset gains of later years.')
        : t('Losses offset gains of later years for {years} years.', { years: rules.lossCarryForwardYears }),
  )
  parts.push(rules.costBasis === 'fifo' ? t('Units sold are matched first in, first out.') : t('Units sold are matched at their average purchase price.'))
  return parts.join(' ')
}

/** Taxes paid per year, and an estimate of the tax on capital gains under the rules of a country. */
export function TaxesSection({ inputs, rules, onRulesChange }: Props) {
  const charges = useMemo(() => chargesByYear(inputs.transactions), [inputs])
  const income = useMemo(() => incomeRows(inputs.transactions), [inputs])
  const gains = useMemo(
    () =>
      capitalGainsTax(
        inputs.transactions,
        rules,
        // The closing price of the reference date; a trade price is no market value.
        (holding, date) => inputs.prices.marketPrice(holding.key, date)?.eur,
        localToday(),
      ),
    [inputs, rules],
  )
  const taxed = charges.filter((y) => y.tradeTaxes + y.incomeTaxes + y.otherTaxes > 0)
  const preset = presetOf(rules)

  return (
    <>
      <TaxReportPanel gains={gains} income={income} charges={charges} rulesLabel={isAdjusted(rules) ? t('{name}, adjusted', { name: t(preset.label) }) : t(preset.label)} />
      <div className="panel">
        <h3>{t('Taxes paid')}</h3>
        {taxed.length === 0 ? (
          <p className="muted">{t('The export contains no taxes.')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('Year')}</th>
                <th className="num">{t('Stock exchange tax (TOB)')}</th>
                <th className="num">{t('Withheld on dividends and interest')}</th>
                <th className="num">{t('Other')}</th>
                <th className="num">{t('Total')}</th>
              </tr>
            </thead>
            <tbody>
              {taxed.map((y) => (
                <tr key={y.year}>
                  <td>{y.year}</td>
                  <td className="num">{formatEur(y.tradeTaxes)}</td>
                  <td className="num">{formatEur(y.incomeTaxes)}</td>
                  <td className="num">{formatEur(y.otherTaxes)}</td>
                  <td className="num">{formatEur(y.tradeTaxes + y.incomeTaxes + y.otherTaxes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          {t('Withheld taxes are the foreign and the domestic withholding tax together, as the broker booked them. Most exports do not tell them apart.')}
        </p>
      </div>

      <div className="panel">
        <h3>{t('Tax on capital gains (estimate)')}</h3>
        {displayCurrency() !== 'EUR' && (
          <p className="callout warning small">
            {t('Amounts are in {currency}. The tax rules below count in EUR: switch the currency back to EUR in Settings for a tax estimate.', { currency: displayCurrency() })}
          </p>
        )}
        <TaxRulesForm rules={rules} onChange={onRulesChange} />
        <p className="muted small">{describe(rules)}</p>
        {gains.years.length === 0 ? (
          <p className="muted">{t('No taxed sales yet.')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('Year')}</th>
                <th className="num">{t('Gains')}</th>
                <th className="num">{t('Losses')}</th>
                <th className="num">{t('Net')}</th>
                {rules.lossCarryForwardYears > 0 && <th className="num">{t('Earlier losses used')}</th>}
                <th className="num">{t('Exemption')}</th>
                <th className="num">{t('Taxable')}</th>
                <th className="num">{t('Estimated tax')}</th>
              </tr>
            </thead>
            <tbody>
              {gains.years.map((y) => (
                <tr key={y.year}>
                  <td>{y.year}</td>
                  <td className="num positive">{formatEur(y.gains)}</td>
                  <td className="num negative">{formatEur(y.losses)}</td>
                  <td className={`num ${trendClass(y.net)}`}>{formatSignedEur(y.net)}</td>
                  {rules.lossCarryForwardYears > 0 && <td className="num">{formatEur(y.lossesCarriedIn)}</td>}
                  <td className="num">{formatEur(y.exemption)}</td>
                  <td className="num">{formatEur(y.taxable)}</td>
                  <td className="num">
                    <strong>{formatEur(y.tax)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rules.referenceDate && gains.withoutReference.length > 0 && (
          <p className="callout warning small">
            {t('No market price on {date} for {products}: their purchase price is used, which can make the gain look larger. Add a ticker on the Prices page.', { date: formatDate(rules.referenceDate), products: gains.withoutReference.join(', ') })}
          </p>
        )}
        <ul className="muted small">
          {!isAdjusted(rules) && preset.notes.map((note) => <li key={note}>{t(note)}</li>)}
          <li>{t('An estimate, not tax advice: rates and exemptions change, and your tax return is what counts.')}</li>
        </ul>
        {gains.sales.length > 0 && (
          <>
            <h4>{t('Sales counted')}</h4>
            <SalesTable sales={gains.sales} />
          </>
        )}
      </div>
    </>
  )
}
