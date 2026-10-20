import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { normalizeHeader } from '../parse.ts'
import { Collector, dataRows, findHeader, guessAssetClass, headerSet, parseDateTime, result, type ColumnSpec, type Row } from './kit.ts'

/**
 * Interactive Brokers (and Lynx) Flex Query CSV: Trades, Cash Transactions and Corporate Actions.
 * The user picks the columns, so every lookup is by name and most columns are optional.
 */
const COLUMNS = {
  currency: ['currencyprimary', 'currency'],
  assetClass: ['assetclass'],
  symbol: ['symbol'],
  description: ['description'],
  isin: ['isin'],
  exchange: ['listingexchange'],
  tradeDate: ['tradedate'],
  dateTime: ['datetime', 'date/time'],
  settleDate: ['settledate'],
  reportDate: ['reportdate'],
  side: ['buy/sell'],
  quantity: ['quantity'],
  tradePrice: ['tradeprice'],
  tradeMoney: ['trademoney'],
  proceeds: ['proceeds'],
  commission: ['ibcommission'],
  commissionCurrency: ['ibcommissioncurrency'],
  type: ['type'],
  amount: ['amount'],
  value: ['value'],
  orderId: ['iborderid', 'tradeid'],
} satisfies ColumnSpec<string>
type Key = keyof typeof COLUMNS

type Kind = 'trades' | 'cash' | 'corporate'

function kindOf(table: RawTable): Kind | null {
  for (const set of headerSet(table, 3)) {
    if (set.has('buy/sell') && set.has('tradeprice')) return 'trades'
    if (set.has('type') && set.has('amount') && set.has('settledate')) return 'cash'
    if (set.has('type') && set.has('quantity') && set.has('description') && set.has('reportdate')) return 'corporate'
  }
  return null
}

function detect(table: RawTable): number {
  return kindOf(table) ? 0.9 : 0
}

/** `AAPL(US0378331005) CASH DIVIDEND ...` → `US0378331005` */
function isinFrom(row: Row<Key>): string {
  return row.text('isin') || /\(([A-Z]{2}[A-Z0-9]{9}\d)\)/.exec(row.text('description'))?.[1] || ''
}

function productOf(row: Row<Key>): string {
  return row.text('symbol').replace(/\.OLD$/, '') || /^([^(\s]+)\(/.exec(row.text('description'))?.[1] || isinFrom(row)
}

function parseTrades(out: Collector, table: RawTable) {
  const header = findHeader(table, COLUMNS, ['side', 'quantity', 'tradePrice'], 3)
  if (!header) return
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('dateTime')) ?? parseDateTime(row.get('tradeDate'))
    if (!at) {
      out.issue('error', 'Invalid trade date.', row.number)
      continue
    }
    const isin = isinFrom(row)
    const assetClass = row.text('assetClass').toUpperCase()
    // Currency conversions are trades without an ISIN (asset class CASH, symbol EUR.USD).
    if (assetClass === 'CASH' || (!isin && !row.text('symbol')) || /^[A-Z]{3}\.[A-Z]{3}$/.test(row.text('symbol'))) {
      out.issue('info', 'Currency conversion skipped.', row.number)
      continue
    }
    const quantity = Math.abs(row.money('quantity') ?? 0)
    const price = row.money('tradePrice') ?? 0
    if (quantity === 0) continue
    const currency = row.text('currency') || 'USD'
    const commission = Math.abs(row.money('commission') ?? 0)
    const costs = out.convert(commission, row.text('commissionCurrency') || currency, currency, at.date, row.number)
    const buy = row.text('side').toUpperCase().startsWith('BUY')
    out.add({
      type: buy ? 'buy' : 'sell',
      at,
      row: row.number,
      product: row.text('description') || productOf(row),
      ...(isin ? { isin } : {}),
      ...(row.text('symbol') ? { ticker: row.text('symbol') } : {}),
      ...(row.text('exchange') ? { exchange: row.text('exchange') } : {}),
      assetClass: assetClass === 'BOND' ? 'bond' : assetClass === 'FUND' ? 'fund' : guessAssetClass(row.text('description')),
      quantity,
      price,
      amount: Math.abs(row.money('tradeMoney') ?? quantity * price),
      cashCurrency: currency,
      costs,
      orderId: row.text('orderId'),
    })
  }
}

function parseCash(out: Collector, table: RawTable) {
  const header = findHeader(table, COLUMNS, ['type', 'amount'], 3)
  if (!header) return
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('settleDate')) ?? parseDateTime(row.get('dateTime')) ?? parseDateTime(row.get('reportDate'))
    if (!at) {
      out.issue('error', 'Invalid date.', row.number)
      continue
    }
    const type = normalizeHeader(row.get('type'))
    const amount = row.money('amount') ?? 0
    const isin = isinFrom(row)
    const base = { at, row: row.number, product: productOf(row) || 'Cash', ...(isin ? { isin } : {}), cashCurrency: row.text('currency') || 'USD', amount }
    if (type === 'deposits/withdrawals') out.add({ ...base, product: 'Cash', type: amount >= 0 ? 'deposit' : 'withdrawal' })
    else if (type === 'dividends' || type === 'payment in lieu of dividends') out.add({ ...base, type: 'dividend' })
    else if (type === 'withholding tax') {
      if (amount <= 0) out.add({ ...base, type: 'tax' })
      else out.add({ ...base, product: 'Tax refund', isin: '', type: 'dividend' })
    } else if (type === 'broker interest received' || type === 'bond interest received') out.add({ ...base, product: 'Interest', isin: '', type: 'dividend' })
    else if (type.includes('fee') || type.includes('interest paid') || type.includes('commission')) {
      out.add({ ...base, product: 'Fees', isin: '', type: amount <= 0 ? 'fee' : 'dividend' })
    } else out.issue('warning', `Unknown cash transaction type "${row.text('type')}" skipped.`, row.number)
  }
}

/**
 * Splits: a forward split is one row with the units added; a reverse split or ISIN change is a
 * pair (old ISIN negative, new ISIN positive). The ratio is in the description: `SPLIT 1 FOR 8`.
 */
function parseCorporate(out: Collector, table: RawTable) {
  const header = findHeader(table, COLUMNS, ['type', 'quantity', 'description'], 3)
  if (!header) return
  let pendingOld: { isin: string; quantity: number; date: string } | null = null
  for (const row of dataRows(table, header)) {
    const at = parseDateTime(row.get('dateTime')) ?? parseDateTime(row.get('reportDate'))
    if (!at) {
      out.issue('error', 'Invalid date.', row.number)
      continue
    }
    const quantity = row.money('quantity') ?? 0
    const isin = isinFrom(row)
    const description = row.text('description')
    const ratioMatch = /SPLIT (\d+(?:\.\d+)?) FOR (\d+(?:\.\d+)?)/i.exec(description)
    // `... (GE, GENERAL ELECTRIC CO, US3696043013)` names the product at the end.
    const name = /\([^,()]+, ([^()]+), [A-Z]{2}[A-Z0-9]{9}\d\)$/.exec(description)?.[1]
    const base = { at, row: row.number, product: name ?? productOf(row), ...(isin ? { isin } : {}), cashCurrency: row.text('currency') || 'USD', amount: 0 }
    if (quantity < 0 && ratioMatch) {
      pendingOld = { isin, quantity: -quantity, date: at.date }
    } else if (quantity > 0 && pendingOld && pendingOld.date === at.date) {
      const split = { ratio: quantity / pendingOld.quantity, fromQuantity: pendingOld.quantity, ...(pendingOld.isin !== isin ? { fromIsin: pendingOld.isin } : {}) }
      out.add({ ...base, type: 'split', quantity, split })
      pendingOld = null
    } else if (quantity > 0 && ratioMatch) {
      const ratio = Number(ratioMatch[1]) / Number(ratioMatch[2])
      if (ratio <= 1) {
        out.issue('warning', `Split "${description}" without the matching removal row; skipped.`, row.number)
        continue
      }
      const before = quantity / (ratio - 1)
      out.add({ ...base, type: 'split', quantity: before * ratio, split: { ratio, fromQuantity: before } })
    } else if (quantity > 0) {
      // Spin-offs and stock dividends: free units.
      out.add({ ...base, type: 'buy', quantity })
    } else if (quantity < 0) {
      const proceeds = Math.abs(row.money('proceeds') ?? row.money('amount') ?? 0)
      out.add({ ...base, type: 'sell', quantity: -quantity, price: proceeds / -quantity, amount: proceeds })
    }
  }
}

export const interactiveBrokersAdapter: BrokerAdapter = {
  id: 'interactive-brokers',
  label: 'Interactive Brokers',
  detect,
  parse(tables, context?: ImportContext) {
    const outputs = tables.map((table) => {
      const out = new Collector('ibkr', table.fileName, context)
      const kind = kindOf(table)
      if (kind === 'trades') parseTrades(out, table)
      else if (kind === 'cash') parseCash(out, table)
      else if (kind === 'corporate') parseCorporate(out, table)
      return out
    })
    const kinds = new Set(tables.map(kindOf))
    return result(
      'Interactive Brokers',
      outputs,
      { transactionCosts: true, fxCosts: false, taxes: kinds.has('cash'), dividends: kinds.has('cash'), deposits: kinds.has('cash') },
      {
        fxCosts: 'Interactive Brokers books currency conversions as separate trades; their cost is in the commission.',
        ...(kinds.has('cash')
          ? {}
          : {
              taxes: 'Add the Cash Transactions Flex Query to include withholding taxes.',
              dividends: 'Add the Cash Transactions Flex Query to include dividends.',
              deposits: 'Add the Cash Transactions Flex Query to include deposits and withdrawals.',
            }),
      },
    )
  },
}
