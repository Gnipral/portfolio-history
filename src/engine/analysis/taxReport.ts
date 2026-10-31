import type { Sale } from '../ledger.ts'
import type { CapitalGainsResult, CapitalGainsYear } from './capitalGains.ts'
import type { ChargesYear } from './charges.ts'
import type { IncomeRow } from './income.ts'
import { t } from '../../i18n/i18n.ts'
import { csvAmount as amount, type CsvValue, toCsv } from '../../data/csv.ts'

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

/** The report as CSV, in the format of src/data/csv.ts. */
export function taxReportCsv(report: TaxReport, currency = 'EUR'): string {
  const rows: CsvValue[][] = [[t('Tax report {year}', { year: report.year })], [t('All amounts in {currency}', { currency })], []]
  if (report.gains) {
    const g = report.gains
    rows.push([t('Capital gains (estimate)')], [t('Gains'), t('Losses'), t('Net'), t('Earlier losses used'), t('Exemption'), t('Taxable'), t('Estimated tax')])
    rows.push([g.gains, g.losses, g.net, g.lossesCarriedIn, g.exemption, g.taxable, g.tax].map(amount), [])
  }
  if (report.sales.length > 0) {
    rows.push([t('Sales')], [t('Date'), t('Product'), 'ISIN', t('Quantity'), t('Proceeds'), t('Cost basis'), t('Result')])
    for (const s of report.sales) rows.push([s.date, s.product, s.isin ?? '', s.quantity, amount(s.proceeds), amount(s.cost), amount(s.gain)])
    rows.push([])
  }
  if (report.income.length > 0) {
    rows.push([t('Dividends and interest')], [t('Date'), t('Product'), 'ISIN', t('Kind'), t('Gross'), t('Withheld tax'), t('Costs'), t('Net')])
    for (const r of report.income) rows.push([r.date, r.product, r.isin ?? '', r.kind, amount(r.gross), amount(r.taxes), amount(r.costs), amount(r.net)])
    rows.push([])
  }
  if (report.charges) {
    const c = report.charges
    rows.push([t('Costs and taxes paid')], [t('Transaction costs'), t('Currency costs'), t('Stock exchange tax (TOB)'), t('Withheld on income'), t('Other taxes')])
    rows.push([c.transactionCosts, c.fxCosts, c.tradeTaxes, c.incomeTaxes, c.otherTaxes].map(amount))
  }
  return toCsv(rows)
}
