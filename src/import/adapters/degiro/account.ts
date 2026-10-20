import type { Transaction } from '../../../model/transaction.ts'
import { cellText, normalizeHeader, parseNumber } from '../../parse.ts'
import type { Cell, ImportContext, ImportIssue, RawTable } from '../../types.ts'
import { Collector, dataRows, findHeader, guessAssetClass, parseDateTime, type ColumnSpec, type Draft } from '../kit.ts'

/**
 * DEGIRO "Account" statement (Rekeningoverzicht), in Dutch, English or Portuguese. The description
 * decides the type. With a Transactions export in the same import, only what that export lacks is
 * taken from here: dividends, dividend tax, stock exchange tax, deposits, withdrawals, interest and
 * fees outside orders. On its own, the trades are read from the descriptions as well.
 */
const COLUMNS = {
  date: ['datum', 'date', 'data'],
  time: ['tijd', 'time', 'hora'],
  product: ['product', 'produto'],
  isin: ['isin'],
  description: ['omschrijving', 'description', 'descrição', 'descricao'],
  fx: ['fx', 't.'],
  change: ['mutatie', 'change', 'mudança', 'mudanca'],
  orderId: ['order id', 'order-id', 'id da ordem'],
} satisfies ColumnSpec<string>

export function detectAccount(table: RawTable): number {
  const header = findHeader(table, COLUMNS, ['date', 'product', 'isin', 'description', 'change'], 3)
  return header ? 0.9 : 0
}

/**
 * `Koop 30 @ 22,5 EUR`, `PRODUCTWIJZIGING : Verkoop 500 @ 0 EUR`, and in older or other-language
 * statements `Buy 5 HP Inc@21.31 USD (US40434L1052)` or `Compra 1 VANGUARD S&P500@77,3 EUR (...)`.
 */
const TRADE =
  /^(?:([a-zà-ÿ -]+?)\s*:\s*)?(koop|verkoop|buy|sell|compra|venda|achat|vente|kauf|verkauf)\s+(\d[\d.,  ]*?)(?:\s+[^@]+?)?\s*@\s*([\d.,]+)\s*([A-Z]{3})/i
const SELL = /^(verkoop|sell|venda|vente|verkauf)$/i
const FEE =
  /transactiekosten|transaction (and\/or third party )?fees?|comiss|custos? de transa|frais|aansluitingskosten|connection fee|conectividade|corporate action kosten|corporate action fee|kosten|fee/i
const DIVIDEND_TAX = /dividendbelasting|dividend tax|imposto sobre dividendo|imp[oô]ts? sur dividende|quellensteuer/i
const DIVIDEND = /dividend|dividendo|fondsuitkering|fund distribution|kapitaalterugbetaling|capital return/i
const STOCK_TAX = /transactiebelasting|financial transaction tax|beurstaks|stock exchange tax|imposto|taxe sur les transactions/i
const WITHDRAWAL = /withdrawal|terugstorting|opname|levantamento|retrait|retirada/i
const DEPOSIT = /storting|deposit|depósito|ideal|sofort|bancontact|ingreso|versement|einzahlung/i
const INTEREST = /interest|rente|juros|intérêts/i
const INCOME = /courtesy|compensatie|compensation|bonus/i
const IGNORED =
  /valuta (creditering|debitering)|fx (credit|debit)|divisa|devises|cash sweep|geldmarktfonds|money market|fonds mon[ée]taires|overboeking (van|naar) uw geldrekening|reservation|reservering/i

interface Row {
  number: number
  at: { date: string; time: string }
  product: string
  isin: string
  description: string
  currency: string
  amount: number
  orderId: string
}

function readRows(table: RawTable, out: Collector): Row[] {
  const header = findHeader(table, COLUMNS, ['date', 'product', 'isin', 'description', 'change'], 3)
  if (!header) {
    out.issue('error', 'Missing DEGIRO account statement columns.')
    return []
  }
  const changeIndex = header.columns.change as number
  // The amount sits in the unnamed column right after the currency of "Mutatie"/"Change".
  const amountOf = (cells: Cell[]) => parseNumber(cells[changeIndex + 1] ?? null)
  const rows: Row[] = []
  for (const row of dataRows(table, header)) {
    // A long order ID can wrap onto a row of its own; it carries nothing else.
    if (!row.text('date') && !row.text('description')) continue
    const at = parseDateTime(row.get('date'), row.get('time'))
    if (!at) {
      out.issue('error', `Invalid date "${row.text('date')}"`, row.number)
      continue
    }
    rows.push({
      number: row.number,
      at,
      product: row.text('product'),
      isin: row.text('isin').toUpperCase(),
      description: row.text('description'),
      currency: cellText(row.get('change')).toUpperCase(),
      amount: amountOf(row.cells) ?? Number.NaN,
      orderId: row.text('orderId'),
    })
  }
  return rows
}

export function parseAccount(
  table: RawTable,
  { withTrades, context }: { withTrades: boolean; context?: ImportContext },
): { transactions: Transaction[]; issues: ImportIssue[] } {
  const out = new Collector('degiro', table.fileName, context)
  const rows = readRows(table, out)

  // Fees booked under an order belong to that trade (only used when trades come from this file).
  const orderFees = new Map<string, { amount: number; currency: string }>()
  for (const row of rows) {
    if (row.orderId && FEE.test(row.description) && !TRADE.test(row.description) && Number.isFinite(row.amount)) {
      const fee = orderFees.get(row.orderId)
      orderFees.set(row.orderId, { amount: (fee?.amount ?? 0) + Math.abs(row.amount), currency: row.currency })
    }
  }
  // Corporate actions book the old line as a sell and the new one as a buy, without money, in either order.
  const corporateSells: { row: Row; quantity: number; label: string; paired: boolean }[] = []
  for (const row of rows) {
    const trade = TRADE.exec(row.description)
    if (trade?.[1] && !(Math.abs(row.amount) > 0) && SELL.test(trade[2] as string)) {
      corporateSells.push({ row, quantity: parseNumber(trade[3] as string) ?? 0, label: trade[1].toLowerCase(), paired: false })
    }
  }

  // Oldest first.
  for (const row of [...rows].reverse()) {
    const { description } = row
    const base = {
      at: row.at,
      row: row.number,
      product: row.product || 'Cash',
      ...(row.isin && !/^NLFLATEX/.test(row.isin) ? { isin: row.isin } : {}),
      assetClass: guessAssetClass(row.product),
      cashCurrency: row.currency || 'EUR',
      amount: Number.isFinite(row.amount) ? row.amount : 0,
      orderId: row.orderId,
    } satisfies Partial<Draft>
    const trade = TRADE.exec(description)

    if (trade) {
      if (!withTrades) continue
      const label = (trade[1] ?? '').toLowerCase()
      const quantity = parseNumber(trade[3] as string) ?? 0
      const price = parseNumber(trade[4] as string) ?? 0
      const sell = SELL.test(trade[2] as string)
      if (quantity === 0) continue
      if (label && !(Math.abs(row.amount) > 0)) {
        if (sell) continue
        const old = corporateSells.find((s) => !s.paired && s.row.at.date === row.at.date && s.quantity > 0)
        if (old) {
          old.paired = true
          out.add({
            ...base,
            type: 'split',
            quantity,
            amount: 0,
            split: { ratio: quantity / old.quantity, fromQuantity: old.quantity, ...(old.row.isin !== row.isin ? { fromIsin: old.row.isin } : {}) },
          })
        } else {
          // Stock dividend or spin-off: free units.
          out.add({ ...base, type: 'buy', quantity, price: 0, amount: 0, currency: trade[5] as string })
        }
        continue
      }
      const fee = row.orderId ? orderFees.get(row.orderId) : undefined
      if (fee) orderFees.delete(row.orderId)
      const costs = fee ? out.convert(fee.amount, fee.currency, base.cashCurrency, row.at.date, row.number) : 0
      out.add({ ...base, type: sell ? 'sell' : 'buy', quantity, price, currency: trade[5] as string, amount: Math.abs(row.amount) || quantity * price, costs })
      continue
    }

    if (!Number.isFinite(row.amount) || row.amount === 0) continue
    if (IGNORED.test(description)) continue
    if (DIVIDEND_TAX.test(description)) out.add({ ...base, type: row.amount < 0 ? 'tax' : 'dividend' })
    else if (DIVIDEND.test(description)) out.add({ ...base, type: row.amount >= 0 ? 'dividend' : 'tax' })
    else if (STOCK_TAX.test(description)) out.add({ ...base, type: 'tax' })
    else if (FEE.test(description)) {
      // Fees of an order are in the Transactions export, or were added to the trade above.
      if (row.orderId) continue
      out.add({ ...base, product: row.product || 'Fees', type: row.amount < 0 ? 'fee' : 'dividend' })
    } else if (WITHDRAWAL.test(description)) out.add({ ...base, product: 'Cash', type: 'withdrawal' })
    else if (DEPOSIT.test(description)) out.add({ ...base, product: 'Cash', type: 'deposit' })
    else if (INTEREST.test(description)) out.add({ ...base, product: 'Interest', type: row.amount >= 0 ? 'dividend' : 'fee' })
    else if (INCOME.test(description)) out.add({ ...base, product: 'DEGIRO', type: row.amount >= 0 ? 'dividend' : 'fee' })
    else out.issue('warning', `Unknown DEGIRO description "${description}" skipped.`, row.number)
  }

  if (withTrades) {
    for (const sell of corporateSells.filter((s) => !s.paired)) {
      out.issue('warning', `${sell.label}: ${sell.row.product} removed without a matching new line; skipped.`, sell.row.number)
    }
  }
  return out
}

/** Whether a table looks like the Account statement rather than the Transactions export. */
export function isAccountTable(table: RawTable): boolean {
  return table.rows.slice(0, 3).some((row) => row.map(normalizeHeader).some((h) => COLUMNS.description.includes(h)))
}
