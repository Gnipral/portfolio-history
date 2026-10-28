import { useMemo } from 'react'
import { capitalGainsTax, isAdjusted, presetOf, type CapitalGainsRules } from '../../engine/analysis/capitalGains.ts'
import { chargesByYear } from '../../engine/analysis/charges.ts'
import { incomeRows } from '../../engine/analysis/income.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import { localToday } from '../../market/dates.ts'
import { formatDate, formatEur, formatPercent, formatSignedEur, trendClass } from '../format.ts'
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
  if (rules.rate === 0) return 'No tax on realized gains under these rules.'
  const parts = [
    `${formatPercent(rules.rate, false)} on the net gains of a year${rules.yearlyExemption > 0 ? ` above an exemption of ${formatEur(rules.yearlyExemption, true)}` : ''}${rules.firstTaxedYear ? `, from ${rules.firstTaxedYear} on` : ''}.`,
  ]
  if (rules.exemptionCarryOver > 0) {
    parts.push(`An unused exemption carries over up to ${formatEur(rules.exemptionCarryOver, true)} a year, to at most ${formatEur(rules.maxExemption, true)}.`)
  }
  if (rules.referenceDate) {
    parts.push(
      `What you held on ${formatDate(rules.referenceDate)} counts at its value of that day${rules.stepUp === 'higher' ? ', or at its purchase price when that is higher' : ''}.`,
    )
  }
  parts.push(
    rules.lossCarryForwardYears === 0
      ? 'Losses only offset gains of the same year.'
      : `Losses offset gains of later years${rules.lossCarryForwardYears >= 99 ? '' : ` for ${rules.lossCarryForwardYears} years`}.`,
  )
  parts.push(`Units sold are matched ${rules.costBasis === 'fifo' ? 'first in, first out' : 'at their average purchase price'}.`)
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
      <TaxReportPanel gains={gains} income={income} charges={charges} rulesLabel={isAdjusted(rules) ? `${preset.label}, adjusted` : preset.label} />
      <div className="panel">
        <h3>Taxes paid</h3>
        {taxed.length === 0 ? (
          <p className="muted">The export contains no taxes.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Stock exchange tax (TOB)</th>
                <th className="num">Withheld on dividends and interest</th>
                <th className="num">Other</th>
                <th className="num">Total</th>
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
          Withheld taxes are the foreign and the domestic withholding tax together, as the broker booked them. Most exports do not
          tell them apart.
        </p>
      </div>

      <div className="panel">
        <h3>Tax on capital gains (estimate)</h3>
        <TaxRulesForm rules={rules} onChange={onRulesChange} />
        <p className="muted small">{describe(rules)}</p>
        {gains.years.length === 0 ? (
          <p className="muted">No taxed sales yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Gains</th>
                <th className="num">Losses</th>
                <th className="num">Net</th>
                {rules.lossCarryForwardYears > 0 && <th className="num">Earlier losses used</th>}
                <th className="num">Exemption</th>
                <th className="num">Taxable</th>
                <th className="num">Estimated tax</th>
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
            No market price on {formatDate(rules.referenceDate)} for {gains.withoutReference.join(', ')}: their purchase price is
            used, which can make the gain look larger. Add a ticker on the Prices page.
          </p>
        )}
        <ul className="muted small">
          {!isAdjusted(rules) && preset.notes.map((note) => <li key={note}>{note}</li>)}
          <li>An estimate, not tax advice: rates and exemptions change, and your tax return is what counts.</li>
        </ul>
        {gains.sales.length > 0 && (
          <>
            <h4>Sales counted</h4>
            <SalesTable sales={gains.sales} />
          </>
        )}
      </div>
    </>
  )
}
