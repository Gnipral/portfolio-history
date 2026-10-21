import { useMemo } from 'react'
import { belgianCapitalGains, BELGIAN_CGT } from '../../engine/analysis/belgianTax.ts'
import { chargesByYear } from '../../engine/analysis/charges.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { localToday } from '../../market/dates.ts'
import { formatDate, formatEur, formatSignedEur, trendClass } from '../format.ts'
import { SalesTable } from './SalesTable.tsx'

interface Props {
  inputs: EngineInputs
  options: EngineOptions
}

/** Taxes paid per year, and an estimate of the Belgian tax on capital gains from 2026 on. */
export function TaxesSection({ inputs, options }: Props) {
  const charges = useMemo(() => chargesByYear(inputs.transactions), [inputs])
  const gains = useMemo(
    () =>
      belgianCapitalGains(
        inputs.transactions,
        options,
        // The closing price of 31 December 2025; a trade price is no market value.
        (holding, date) => inputs.prices.marketPrice(holding.key, date)?.eur,
        localToday(),
      ),
    [inputs, options],
  )
  const taxed = charges.filter((y) => y.tradeTaxes + y.incomeTaxes + y.otherTaxes > 0)

  return (
    <>
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
          Withheld taxes are the foreign withholding tax and the Belgian withholding tax (roerende voorheffing) together, as the
          broker booked them. Most exports do not tell them apart.
        </p>
      </div>

      <div className="panel">
        <h3>Belgian tax on capital gains (estimate)</h3>
        <p className="muted small">
          From 2026, {BELGIAN_CGT.rate * 100}% on the net gains of a year above an exemption of {formatEur(BELGIAN_CGT.exemption, true)}.
          An unused exemption carries over up to {formatEur(BELGIAN_CGT.carryOverPerYear, true)} a year, to at most{' '}
          {formatEur(BELGIAN_CGT.maxExemption, true)}. What you held on {formatDate(BELGIAN_CGT.referenceDate)} counts at its value
          on that day, or at its purchase price when that is higher, so gains made before 2026 are not taxed. Losses only offset
          gains of the same year.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Year</th>
              <th className="num">Gains</th>
              <th className="num">Losses</th>
              <th className="num">Net</th>
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
                <td className="num">{formatEur(y.exemption)}</td>
                <td className="num">{formatEur(y.taxable)}</td>
                <td className="num">
                  <strong>{formatEur(y.tax)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {gains.withoutReference.length > 0 && (
          <p className="callout warning small">
            No market price on {formatDate(BELGIAN_CGT.referenceDate)} for {gains.withoutReference.join(', ')}: their purchase
            price is used, which can overstate the gain. Add a ticker on the Prices page.
          </p>
        )}
        <p className="muted small">
          An estimate, not tax advice: the exemption is indexed every year, the rules for sales from 2031 on and for some products
          differ, and your tax return is what counts.
        </p>
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
