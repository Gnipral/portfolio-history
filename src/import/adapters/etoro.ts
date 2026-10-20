import type { AssetClass } from '../../model/transaction.ts'
import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { normalizeHeader } from '../parse.ts'
import { Collector, dataRows, detectByHeaders, findHeader, Holdings, parseDateTime, parseMoney, result, type ColumnSpec } from './kit.ts'

/**
 * eToro account statement: the "Account Activity" sheet (or that sheet saved as CSV). Amounts are
 * in the account currency, USD unless the "Account Summary" sheet says otherwise. ISINs come from
 * the "Closed Positions" sheet when it is there. A closing row without units closes the whole position.
 */
const COLUMNS = {
  date: ['date'],
  type: ['type'],
  details: ['details'],
  amount: ['amount'],
  units: ['units'],
  positionId: ['position id'],
  assetType: ['asset type'],
} satisfies ColumnSpec<string>

const ACTIVITY = ['date', 'type', 'details', 'amount', 'units', 'realized equity change', 'position id']

function detect(table: RawTable): number {
  if (detectByHeaders(table, ACTIVITY)) return 0.95
  // The other sheets of the workbook, so their account currency and ISINs reach the parser.
  if (table.rows.slice(0, 6).some((r) => normalizeHeader(r[0] ?? null) === 'username')) return 0.6
  if (detectByHeaders(table, ['position id', 'action', 'units', 'open date', 'close date', 'isin'])) return 0.6
  return 0
}

function assetClass(value: string): AssetClass {
  const v = value.toLowerCase()
  if (v.startsWith('crypto')) return 'crypto'
  if (v === 'etf') return 'etf'
  return v === 'stocks' ? 'stock' : 'unknown'
}

function accountCurrency(tables: RawTable[]): string {
  for (const table of tables) {
    const row = table.rows.find((r) => normalizeHeader(r[0] ?? null) === 'currency')
    const value = row?.[1]
    if (typeof value === 'string' && /^[A-Z]{3}$/.test(value.trim())) return value.trim()
  }
  return 'USD'
}

interface ClosedPosition {
  isin?: string
  units?: number
}

/** Position ID → ISIN and closed units, from the "Closed Positions" sheet. */
function closedPositions(tables: RawTable[]): Map<string, ClosedPosition> {
  const map = new Map<string, ClosedPosition>()
  for (const table of tables) {
    const header = table.rows[0]?.map(normalizeHeader) ?? []
    const id = header.indexOf('position id')
    const isin = header.indexOf('isin')
    const units = header.indexOf('units')
    if (id < 0 || isin < 0) continue
    for (const row of table.rows.slice(1)) {
      if (!row[id]) continue
      const closedUnits = units >= 0 ? parseMoney(row[units] ?? null) : null
      map.set(String(row[id]).trim(), {
        ...(row[isin] ? { isin: String(row[isin]).trim() } : {}),
        ...(closedUnits ? { units: Math.abs(closedUnits) } : {}),
      })
    }
  }
  return map
}

function parseActivity(table: RawTable, currency: string, closed: Map<string, ClosedPosition>, context?: ImportContext) {
  const out = new Collector('etoro', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['date', 'type', 'details', 'amount', 'units'])
  if (!header) return out
  const rows = dataRows(table, header)
    .map((row) => ({ row, at: parseDateTime(row.get('date')) }))
    .sort((a, b) => (a.at && b.at ? `${a.at.date}T${a.at.time}`.localeCompare(`${b.at.date}T${b.at.time}`) : 0))
  const open = new Holdings()

  for (const { row, at } of rows) {
    if (!at) {
      out.issue('error', `Invalid date "${row.text('date')}"`, row.number)
      continue
    }
    const type = row.text('type').toLowerCase()
    const details = row.text('details')
    const ticker = details.includes('/') ? (details.split('/')[0] as string) : ''
    const amount = row.money('amount') ?? 0
    const units = Math.abs(row.money('units') ?? 0)
    const positionId = row.text('positionId')
    const isin = closed.get(positionId)?.isin ?? ''
    const base = {
      at,
      row: row.number,
      product: ticker || 'Cash',
      ...(ticker ? { ticker } : {}),
      ...(isin ? { isin } : {}),
      assetClass: assetClass(row.text('assetType')),
      cashCurrency: currency,
      amount: Math.abs(amount),
      orderId: positionId,
    }

    if (type === 'open position') {
      if (units === 0) continue
      open.change(positionId, units)
      out.add({ ...base, type: 'buy', quantity: units, price: Math.abs(amount) / units })
    } else if (type === 'position closed') {
      // Without units: the closed units from "Closed Positions", else the whole position.
      const quantity = units || closed.get(positionId)?.units || open.get(positionId)
      if (quantity <= 0) {
        out.issue('warning', `Closed position ${positionId} (${details}) without units and without its opening row; skipped.`, row.number)
        continue
      }
      open.change(positionId, -quantity)
      out.add({ ...base, type: 'sell', quantity, price: Math.abs(amount) / quantity })
    } else if (type === 'dividend') {
      out.add({ ...base, type: amount >= 0 ? 'dividend' : 'tax' })
    } else if (type === 'deposit') {
      out.add({ ...base, product: 'Cash', type: 'deposit' })
    } else if (type === 'withdraw request' || type === 'withdrawal') {
      out.add({ ...base, product: 'Cash', type: 'withdrawal' })
    } else if (type.includes('fee')) {
      if (amount !== 0) out.add({ ...base, product: ticker || 'Fees', type: 'fee' })
    } else if (type === 'overnight refund' || type === 'interest payment') {
      out.add({ ...base, product: type === 'interest payment' ? 'Interest' : ticker || 'Refund', type: 'dividend' })
    } else if (type === 'sdrt') {
      out.add({ ...base, type: 'tax' })
    } else {
      out.issue('warning', `Unknown eToro type "${row.text('type')}" skipped.`, row.number)
    }
  }
  return out
}

export const etoroAdapter: BrokerAdapter = {
  id: 'etoro',
  label: 'eToro',
  detect,
  parse(tables, context) {
    const currency = accountCurrency(tables)
    const closed = closedPositions(tables)
    const activity = tables.filter((t) => detectByHeaders(t, ACTIVITY) > 0)
    const outputs = activity.map((t) => parseActivity(t, currency, closed, context))
    if (activity.length === 0) {
      const out = new Collector('etoro', tables[0]?.fileName ?? '')
      out.issue('error', 'No "Account Activity" sheet found in the eToro statement.')
      outputs.push(out)
    }
    return result(
      'eToro',
      outputs,
      { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: true },
      { fxCosts: 'eToro includes currency conversion in the amounts.' },
    )
  },
}
