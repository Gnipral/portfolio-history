import type { Sale } from '../ledger.ts'
import type { CapitalGainsResult, CapitalGainsYear } from './capitalGains.ts'
import type { ChargesYear } from './charges.ts'
import type { IncomeRow } from './income.ts'

/** Everything about one calendar year that a tax return asks for, in the base currency. */
export interface TaxReport {
  year: string
  /** The capital gains estimate of the year, when anything was sold under the rules. */
  gains?: CapitalGainsYear
  sales: Sale[]
  income: IncomeRow[]
  charges?: ChargesYear
}

/** Years with any sale, income or charge, newest first. */
export function reportYears(gains: CapitalGainsResult, income: IncomeRow[], charges: ChargesYear[]): string[] {
  const years = new Set([
    ...gains.sales.map((s) => s.date.slice(0, 4)),
    ...income.map((r) => r.date.slice(0, 4)),
    ...charges.filter((c) => c.total > 0).map((c) => c.year),
  ])
  return [...years].sort().reverse()
}

export function taxReport(year: string, gains: CapitalGainsResult, income: IncomeRow[], charges: ChargesYear[]): TaxReport {
  const inYear = (date: string) => date.startsWith(year)
  const yearGains = gains.years.find((y) => y.year === year)
  const yearCharges = charges.find((c) => c.year === year)
  return {
    year,
    ...(yearGains ? { gains: yearGains } : {}),
    sales: gains.sales.filter((s) => inYear(s.date)),
    income: income.filter((r) => inYear(r.date)),
    ...(yearCharges ? { charges: yearCharges } : {}),
  }
}

function sum<T>(rows: T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0)
}

/** Income of the year split by kind, for the summary. */
export function incomeSummary(report: TaxReport) {
  return (['dividend', 'interest', 'bonus'] as const)
    .map((kind) => {
      const rows = report.income.filter((r) => r.kind === kind)
      return { kind, gross: sum(rows, (r) => r.gross), taxes: sum(rows, (r) => r.taxes), net: sum(rows, (r) => r.net), count: rows.length }
    })
    .filter((s) => s.count > 0)
}

const amount = (value: number) => value.toFixed(2)

function csvCell(value: string | number): string {
  const text = String(value)
  return /[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * The report as CSV with `;` between cells, which Excel in Belgium, the Netherlands and Germany opens in
 * columns. Amounts use a decimal point so every spreadsheet reads them as numbers when imported.
 */
export function taxReportCsv(report: TaxReport, currency = 'EUR'): string {
  const rows: (string | number)[][] = [[`Tax report ${report.year}`], [`All amounts in ${currency}`], []]
  if (report.gains) {
    const g = report.gains
    rows.push(['Capital gains (estimate)'], ['Gains', 'Losses', 'Net', 'Earlier losses used', 'Exemption', 'Taxable', 'Estimated tax'])
    rows.push([g.gains, g.losses, g.net, g.lossesCarriedIn, g.exemption, g.taxable, g.tax].map(amount), [])
  }
  if (report.sales.length > 0) {
    rows.push(['Sales'], ['Date', 'Product', 'ISIN', 'Quantity', 'Proceeds', 'Cost basis', 'Result'])
    for (const s of report.sales) rows.push([s.date, s.product, s.isin ?? '', s.quantity, amount(s.proceeds), amount(s.cost), amount(s.gain)])
    rows.push([])
  }
  if (report.income.length > 0) {
    rows.push(['Dividends and interest'], ['Date', 'Product', 'ISIN', 'Kind', 'Gross', 'Withheld tax', 'Costs', 'Net'])
    for (const r of report.income) rows.push([r.date, r.product, r.isin ?? '', r.kind, amount(r.gross), amount(r.taxes), amount(r.costs), amount(r.net)])
    rows.push([])
  }
  if (report.charges) {
    const c = report.charges
    rows.push(['Costs and taxes paid'], ['Transaction costs', 'Currency costs', 'Stock exchange tax (TOB)', 'Withheld on income', 'Other taxes'])
    rows.push([c.transactionCosts, c.fxCosts, c.tradeTaxes, c.incomeTaxes, c.otherTaxes].map(amount))
  }
  return `${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}
