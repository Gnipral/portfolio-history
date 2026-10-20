import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, parseDateTime, result, type ColumnSpec, type DateTime } from './kit.ts'
import { coin, conversion, isFiat } from './crypto.ts'

/**
 * Kraken ledgers.csv: one row per balance change, a trade is two rows with the same refid.
 * Asset codes are normalized (XXBT → BTC, ZEUR → EUR, ETH.S → ETH).
 */
const COLUMNS = {
  refid: ['refid'],
  time: ['time'],
  type: ['type'],
  subtype: ['subtype'],
  asset: ['asset'],
  amount: ['amount'],
  fee: ['fee'],
} satisfies ColumnSpec<string>

const ALIASES: Record<string, string> = { XBT: 'BTC', XDG: 'DOGE' }

export function krakenAsset(code: string): string {
  let asset = code.toUpperCase().replace(/\.(S|M|B|F|P)$/, '').replace(/\d+\.S$/, '')
  if (asset.length === 4 && /^[XZ]/.test(asset)) asset = asset.slice(1)
  return ALIASES[asset] ?? asset
}

interface Leg {
  asset: string
  amount: number
  fee: number
  row: number
}

function detect(table: RawTable): number {
  return detectByHeaders(table, ['txid', 'refid', 'time', 'type', 'aclass', 'asset', 'amount', 'fee'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('kraken', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['refid', 'time', 'type', 'asset', 'amount'])
  if (!header) {
    out.issue('error', 'Missing Kraken columns.')
    return out
  }
  const trades = new Map<string, { at: DateTime; legs: Leg[] }>()

  for (const row of dataRows(table, header)) {
    // Kraken writes UTC without a zone marker.
    const at = parseDateTime(`${row.text('time').replace(' ', 'T')}Z`)
    if (!at) {
      out.issue('error', `Invalid date "${row.text('time')}"`, row.number)
      continue
    }
    const type = row.text('type').toLowerCase()
    const asset = krakenAsset(row.text('asset'))
    const amount = row.money('amount') ?? 0
    const fee = Math.abs(row.money('fee') ?? 0)
    const fiat = isFiat(asset)

    if (type === 'trade' || type === 'spend' || type === 'receive') {
      const group = trades.get(row.text('refid')) ?? { at, legs: [] }
      group.legs.push({ asset, amount, fee, row: row.number })
      trades.set(row.text('refid'), group)
    } else if (type === 'deposit' || type === 'withdrawal') {
      const incoming = amount > 0
      if (fiat) out.add({ at, row: row.number, product: 'Cash', type: incoming ? 'deposit' : 'withdrawal', cashCurrency: asset, amount, costs: fee, assetClass: 'cash' })
      else out.add({ ...coin(asset, at, row.number), type: incoming ? 'transferIn' : 'transferOut', quantity: Math.abs(amount) + (incoming ? -fee : fee), amount: 0, cashCurrency: 'EUR' })
    } else if (type === 'earn' || type === 'staking' || type === 'reward' || type === 'dividend' || type === 'airdrop') {
      // Earn allocations and deallocations only move coins between wallets.
      const subtype = row.text('subtype').toLowerCase()
      if (amount <= 0 || (type === 'earn' && subtype && subtype !== 'reward')) continue
      if (fiat) out.add({ at, row: row.number, product: 'Reward', type: 'dividend', cashCurrency: asset, amount, assetClass: 'cash' })
      else out.add({ ...coin(asset, at, row.number), type: 'buy', quantity: amount - fee, amount: 0, cashCurrency: 'EUR' })
    } else if (type === 'transfer') {
      // Moves between spot and staking wallets keep the coins in the account.
      continue
    } else if (type === 'adjustment') {
      // Delistings remove coins without proceeds; corrections can add money.
      if (fiat) out.add({ at, row: row.number, product: 'Adjustment', type: amount >= 0 ? 'dividend' : 'fee', cashCurrency: asset, amount, assetClass: 'cash' })
      else if (amount < 0) out.add({ ...coin(asset, at, row.number), type: 'sell', quantity: -amount, amount: 0, cashCurrency: 'EUR' })
      else out.add({ ...coin(asset, at, row.number), type: 'buy', quantity: amount, amount: 0, cashCurrency: 'EUR' })
    } else {
      out.issue('warning', `Unknown Kraken type "${row.text('type')}" skipped.`, row.number)
    }
  }

  for (const { at, legs } of trades.values()) {
    const row = legs[0]?.row ?? 0
    const spent = legs.find((l) => l.amount < 0)
    const received = legs.find((l) => l.amount > 0)
    if (!spent || !received || legs.length !== 2) {
      out.issue('warning', 'Trade without exactly one spent and one received asset; skipped.', row)
      continue
    }
    if (isFiat(spent.asset)) {
      const quantity = received.amount - received.fee
      out.add({ ...coin(received.asset, at, row), type: 'buy', quantity, price: -spent.amount / received.amount, amount: -spent.amount, cashCurrency: spent.asset, costs: spent.fee })
    } else if (isFiat(received.asset)) {
      const quantity = -spent.amount + spent.fee
      out.add({ ...coin(spent.asset, at, row), type: 'sell', quantity, price: received.amount / quantity, amount: received.amount, cashCurrency: received.asset, costs: received.fee })
    } else {
      out.add(conversion(spent.asset, -spent.amount + spent.fee, received.asset, received.amount - received.fee, at, row))
    }
  }
  return out
}

export const krakenAdapter: BrokerAdapter = {
  id: 'kraken',
  label: 'Kraken',
  detect,
  parse(tables, context) {
    return result(
      'Kraken',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: false, dividends: false, deposits: true },
      {
        fxCosts: 'Crypto exchanges have no currency conversion costs.',
        taxes: 'Kraken ledgers contain no taxes.',
        dividends: 'Staking rewards are added as free coins, not as dividends.',
      },
    )
  },
}
