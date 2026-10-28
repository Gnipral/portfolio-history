import { useState } from 'react'
import type { CapitalGainsResult } from '../../engine/analysis/capitalGains.ts'
import type { ChargesYear } from '../../engine/analysis/charges.ts'
import type { IncomeRow } from '../../engine/analysis/income.ts'
import { reportYears, taxReport, taxReportCsv } from '../../engine/analysis/taxReport.ts'
import { localToday } from '../../market/dates.ts'
import { taxReportHtml } from './taxReportHtml.ts'

interface Props {
  gains: CapitalGainsResult
  income: IncomeRow[]
  charges: ChargesYear[]
  rulesLabel: string
}

function save(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Downloads one year of sales, income and charges, as CSV or as a page to print or save as PDF. */
export function TaxReportPanel({ gains, income, charges, rulesLabel }: Props) {
  const years = reportYears(gains, income, charges)
  const [chosen, setChosen] = useState<string>()
  const year = chosen && years.includes(chosen) ? chosen : years[0]
  if (!year) return null

  const report = () => taxReport(year, gains, income, charges)

  function print() {
    const url = URL.createObjectURL(new Blob([taxReportHtml(report(), rulesLabel, localToday())], { type: 'text/html' }))
    const page = window.open(url)
    // Without a window (pop-ups blocked), download the page instead; it prints from any browser.
    if (page) page.addEventListener('load', () => page.print(), { once: true })
    else save(taxReportHtml(report(), rulesLabel, localToday()), 'text/html', `tax-report-${year}.html`)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="panel">
      <h3>Tax report</h3>
      <p className="muted small">One year of sales, dividends, interest, costs and taxes, to fill in your tax return or hand to an accountant.</p>
      <div className="actions">
        <label className="inline-label">
          Year
          <select value={year} onChange={(e) => setChosen(e.target.value)}>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => save(`﻿${taxReportCsv(report())}`, 'text/csv;charset=utf-8', `tax-report-${year}.csv`)}>
          Download CSV
        </button>
        <button type="button" onClick={print}>
          Print or save as PDF
        </button>
      </div>
    </div>
  )
}
