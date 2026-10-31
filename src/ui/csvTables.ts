import type { ChargesYear } from '../engine/analysis/charges.ts'
import type { IncomeRow } from '../engine/analysis/income.ts'
import type { Sale } from '../engine/ledger.ts'
import type { Position } from '../engine/positions.ts'
import { csvAmount, type CsvValue } from '../data/csv.ts'
import { t } from '../i18n/i18n.ts'
import type { Transaction } from '../model/transaction.ts'

/**
 * The rows of every table that can be downloaded as CSV, from the raw numbers: exact, also while amounts
 * are hidden on screen. Amounts are in `currency`, which every amount header names.
 */

type Rows = CsvValue[][]

/** A percentage as a number, e.g. 12.34 for 12.34%, so a spreadsheet can calculate with it. */
const percent = (fraction: number) => (fraction * 100).toFixed(2)

export function positionsRows(positions: Position[], currency: string): Rows {
  const total = positions.reduce((sum, p) => sum + p.value, 0)
  const c = `(${currency})`
  return [
    [t('Product'), 'ISIN', t('Symbol'), t('Quantity'), `${t('Average cost')} ${c}`, `${t('Price')} ${c}`, t('Price date'), t('Price source'), `${t('Cost basis')} ${c}`, `${t('Value')} ${c}`, `${t('Profit / loss')} ${c}`, `${t('Return')} (%)`, `${t('Weight')} (%)`],
    ...positions.map((p) => [
      p.product,
      p.isin,
      p.symbol,
      p.quantity,
      csvAmount(p.averageCost),
      p.price === undefined ? undefined : csvAmount(p.price),
      p.priceDate,
      p.priceSource,
      csvAmount(p.costBasis),
      csvAmount(p.value),
      csvAmount(p.pnl),
      percent(p.pnlPercent),
      total > 0 ? percent(p.value / total) : undefined,
    ]),
  ]
}

/** Transactions as stored: their amounts are in EUR, whatever the base currency of the settings. */
export function transactionRows(transactions: Transaction[]): Rows {
  return [
    [t('Date'), t('Type'), t('Product'), 'ISIN', t('Ticker'), t('Kind'), t('Quantity'), t('Price'), t('Currency'), t('Amount (EUR)'), t('Costs (EUR)'), t('Taxes (EUR)'), t('FX costs (EUR)'), t('Net (EUR)'), t('Broker'), t('File')],
    ...transactions.map((tx) => [
      tx.date,
      tx.type,
      tx.product,
      tx.isin,
      tx.ticker,
      tx.assetClass,
      tx.quantity || undefined,
      tx.price || undefined,
      tx.currency,
      csvAmount(tx.amountEur),
      csvAmount(tx.costsEur),
      csvAmount(tx.taxesEur),
      csvAmount(tx.fxCostsEur),
      csvAmount(tx.totalEur),
      tx.source.broker,
      tx.source.file,
    ]),
  ]
}

export function salesRows(sales: Sale[], currency: string): Rows {
  const c = `(${currency})`
  return [
    [t('Date'), t('Product'), 'ISIN', t('Quantity'), `${t('Proceeds')} ${c}`, `${t('Cost basis')} ${c}`, `${t('Charges')} ${c}`, `${t('Result')} ${c}`],
    ...sales.map((s) => [s.date, s.product, s.isin, s.quantity, csvAmount(s.proceeds), csvAmount(s.cost), csvAmount(s.charges), csvAmount(s.gain)]),
  ]
}

export function incomeCsvRows(rows: IncomeRow[], currency: string): Rows {
  const c = `(${currency})`
  return [
    [t('Date'), t('Product'), 'ISIN', t('Kind'), `${t('Gross')} ${c}`, `${t('Withheld tax')} ${c}`, `${t('Costs')} ${c}`, `${t('Net')} ${c}`],
    ...rows.map((r) => [r.date, r.product, r.isin, r.kind, csvAmount(r.gross), csvAmount(r.taxes), csvAmount(r.costs), csvAmount(r.net)]),
  ]
}

export function chargesRows(years: ChargesYear[], currency: string): Rows {
  const c = `(${currency})`
  return [
    [t('Year'), `${t('Transaction costs')} ${c}`, `${t('FX costs')} ${c}`, `${t('Taxes on trades')} ${c}`, `${t('Taxes on income')} ${c}`, `${t('Other taxes')} ${c}`, `${t('Total')} ${c}`],
    ...years.map((y) => [y.year, ...[y.transactionCosts, y.fxCosts, y.tradeTaxes, y.incomeTaxes, y.otherTaxes, y.total].map(csvAmount)]),
  ]
}
