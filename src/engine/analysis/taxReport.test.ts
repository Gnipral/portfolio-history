import { describe, expect, it } from 'vitest'
import { tx } from '../testing.ts'
import { capitalGainsTax, TAX_PRESETS } from './capitalGains.ts'
import { chargesByYear } from './charges.ts'
import { incomeRows } from './income.ts'
import { incomeSummary, reportYears, taxReport, taxReportCsv } from './taxReport.ts'
import { taxReportHtml } from '../../ui/analysis/taxReportHtml.ts'

const A = 'XA0000000001'
const transactions = [
  tx('buy', '2025-02-03', { isin: A, product: 'Alpha; "Class A"', quantity: 10, price: 100, amount: 1000, taxesEur: 3.5 }),
  tx('dividend', '2025-06-02', { isin: A, product: 'Alpha; "Class A"', amount: 20, taxesEur: 6 }),
  tx('sell', '2026-03-02', { isin: A, product: 'Alpha; "Class A"', quantity: 4, price: 150, amount: 600 }),
  tx('dividend', '2026-04-01', { product: 'Interest', amount: 2 }),
]
const germany = TAX_PRESETS.find((p) => p.id === 'DE')!.rules
const gains = capitalGainsTax(transactions, germany, () => undefined, '2026-10-28')
const income = incomeRows(transactions)
const charges = chargesByYear(transactions)

describe('taxReport', () => {
  it('lists the years with anything to report, newest first', () => {
    expect(reportYears(gains, income, charges)).toEqual(['2026', '2025'])
  })

  it('keeps only the sales, income and charges of the year', () => {
    const report = taxReport('2026', gains, income, charges)
    expect(report.sales).toHaveLength(1)
    expect(report.income.map((r) => r.kind)).toEqual(['interest'])
    expect(report.gains?.net).toBeCloseTo(report.sales[0]!.gain)
    expect(incomeSummary(taxReport('2025', gains, income, charges))).toEqual([{ kind: 'dividend', gross: 20, taxes: 6, net: 14, count: 1 }])
  })

  it('writes CSV with quoted cells where needed', () => {
    const csv = taxReportCsv(taxReport('2025', gains, income, charges))
    expect(csv).toContain('2025-06-02;"Alpha; ""Class A""";XA0000000001;dividend;20.00;6.00;0.00;14.00')
    expect(csv).toContain('Stock exchange tax (TOB)')
    expect(csv).not.toContain('Sales')
  })

  it('escapes product names in the printable page', () => {
    const html = taxReportHtml(taxReport('2026', gains, income, charges), 'Germany', '2026-10-28')
    expect(html).toContain('Alpha; &#34;Class A&#34;')
    expect(html).toContain('Capital gains (estimate, Germany)')
  })
})
