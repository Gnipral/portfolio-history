import { incomeSummary, type TaxReport } from '../../engine/analysis/taxReport.ts'
import { displayCurrency, formatDate, formatEur } from '../format.ts'
import { language, msg, t } from '../../i18n/i18n.ts'

const KIND_LABELS = { dividend: msg('Dividends'), interest: msg('Interest'), bonus: msg('Bonuses and rewards') } as const

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function table(headers: string[], rows: string[][], numericFrom: number): string {
  const cell = (tag: 'th' | 'td', text: string, i: number) => `<${tag}${i >= numericFrom ? ' class="num"' : ''}>${escapeHtml(text)}</${tag}>`
  return `<table><thead><tr>${headers.map((h, i) => cell('th', h, i)).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`)
    .join('')}</tbody></table>`
}

/** A standalone page with the report, to print or save as PDF from the browser. */
export function taxReportHtml(report: TaxReport, rulesLabel: string, generatedOn: string): string {
  const parts: string[] = [`<h1>${escapeHtml(t('Tax report {year}', { year: report.year }))}</h1>`, `<p class="muted">${escapeHtml(t('Portfolio History · made on {date} · all amounts in {currency}', { date: formatDate(generatedOn), currency: displayCurrency() }))}</p>`]
  const g = report.gains
  if (g) {
    parts.push(
      `<h2>${escapeHtml(t('Capital gains (estimate, {rules})', { rules: rulesLabel }))}</h2>`,
      table(
        [t('Gains'), t('Losses'), t('Net'), t('Earlier losses used'), t('Exemption'), t('Taxable'), t('Estimated tax')],
        [[g.gains, g.losses, g.net, g.lossesCarriedIn, g.exemption, g.taxable, g.tax].map((v) => formatEur(v))],
        0,
      ),
    )
  }
  const income = incomeSummary(report)
  if (income.length > 0) {
    parts.push(
      `<h2>${t('Income')}</h2>`,
      table(
        [t('Kind'), t('Payments'), t('Gross'), t('Withheld tax'), t('Net')],
        income.map((s) => [t(KIND_LABELS[s.kind]), String(s.count), formatEur(s.gross), formatEur(s.taxes), formatEur(s.net)]),
        1,
      ),
    )
  }
  const c = report.charges
  if (c) {
    parts.push(
      `<h2>${t('Costs and taxes paid')}</h2>`,
      table(
        [t('Transaction costs'), t('Currency costs'), t('Stock exchange tax (TOB)'), t('Withheld on income'), t('Other taxes')],
        [[c.transactionCosts, c.fxCosts, c.tradeTaxes, c.incomeTaxes, c.otherTaxes].map((v) => formatEur(v))],
        0,
      ),
    )
  }
  if (report.sales.length > 0) {
    parts.push(
      `<h2>${t('Sales')}</h2>`,
      table(
        [t('Date'), t('Product'), 'ISIN', t('Quantity'), t('Proceeds'), t('Cost basis'), t('Result')],
        report.sales.map((s) => [formatDate(s.date), s.product, s.isin ?? '', String(s.quantity), formatEur(s.proceeds), formatEur(s.cost), formatEur(s.gain)]),
        3,
      ),
    )
  }
  if (report.income.length > 0) {
    parts.push(
      `<h2>${t('Dividends and interest')}</h2>`,
      table(
        [t('Date'), t('Product'), 'ISIN', t('Gross'), t('Withheld tax'), t('Net')],
        report.income.map((r) => [formatDate(r.date), r.product, r.isin ?? '', formatEur(r.gross), formatEur(r.taxes), formatEur(r.net)]),
        3,
      ),
    )
  }
  parts.push(
    `<p class="muted">${t('An estimate from the broker exports, not tax advice. Check the amounts against the annual statements of your broker.')}</p>`,
  )
  return `<!doctype html><html lang="${language()}"><head><meta charset="utf-8"><title>${escapeHtml(t('Tax report {year}', { year: report.year }))}</title><style>
body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:2rem}h1{font-size:20px;margin:0}h2{font-size:14px;margin:1.5rem 0 .5rem}
.muted{color:#555}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}
th{background:#f3f3f3}.num{text-align:right;font-variant-numeric:tabular-nums}@page{margin:1.5cm}
</style></head><body>${parts.join('\n')}</body></html>`
}
