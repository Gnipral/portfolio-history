import type { BrokerAdapter, ImportContext, RawTable } from '../types.ts'
import { Collector, dataRows, detectByHeaders, findHeader, parseDateTime, result, type ColumnSpec, type DateTime } from './kit.ts'
import { coin, conversion, isFiat } from './crypto.ts'

/**
 * Binance transaction history (Statements): one row per balance change. A trade or conversion is
 * several rows with the same time (spend, buy, fee), which are grouped back together.
 */
const COLUMNS = {
  time: ['utc_time'],
  account: ['account'],
  operation: ['operation'],
  coin: ['coin'],
  change: ['change'],
} satisfies ColumnSpec<string>

/** Operations that are one leg of a trade or conversion; their rows are grouped by time. */
const GROUPED = /^(transaction (spend|buy|fee|sold|revenue|related)|buy|sell|fee|binance convert|small assets exchange bnb|token swap|large otc trading|etf subscription|etf redemption)/
const FEE = /fee/
const REWARDS = /interest|reward|airdrop|distribution|launchpool|cashback|rebate|mining|bonus|dividend/
const INTERNAL = /subscription|redemption|transfer between|transfer in|transfer out|staking purchase|savings purchase|main and funding|isolated margin loan/

interface Leg {
  coin: string
  change: number
  fee: boolean
  row: number
}

function detect(table: RawTable): number {
  return detectByHeaders(table, ['utc_time', 'account', 'operation', 'coin', 'change'], 0.95)
}

function parseTable(table: RawTable, context?: ImportContext) {
  const out = new Collector('binance', table.fileName, context)
  const header = findHeader(table, COLUMNS, ['time', 'operation', 'coin', 'change'])
  if (!header) {
    out.issue('error', 'Missing Binance columns.')
    return out
  }
  const groups = new Map<string, { at: DateTime; legs: Leg[] }>()

  for (const row of dataRows(table, header)) {
    // Binance writes UTC without a zone marker.
    const at = parseDateTime(`${row.text('time').replace(' ', 'T')}Z`)
    if (!at) {
      out.issue('error', `Invalid date "${row.text('time')}"`, row.number)
      continue
    }
    const operation = row.text('operation').toLowerCase()
    const symbol = row.text('coin').toUpperCase()
    const change = row.money('change') ?? 0
    if (change === 0) continue

    if (GROUPED.test(operation)) {
      const key = `${row.text('time')}|${row.text('account')}`
      const group = groups.get(key) ?? { at, legs: [] }
      group.legs.push({ coin: symbol, change, fee: FEE.test(operation), row: row.number })
      groups.set(key, group)
    } else if (/deposit|withdraw/.test(operation)) {
      const incoming = change > 0
      if (isFiat(symbol)) {
        out.add({ at, row: row.number, product: 'Cash', type: incoming ? 'deposit' : 'withdrawal', cashCurrency: symbol, amount: change, assetClass: 'cash' })
      } else {
        out.add({ ...coin(symbol, at, row.number), type: incoming ? 'transferIn' : 'transferOut', quantity: change, amount: 0, cashCurrency: 'EUR' })
      }
    } else if (INTERNAL.test(operation)) {
      continue
    } else if (REWARDS.test(operation) && change > 0) {
      if (isFiat(symbol)) out.add({ at, row: row.number, product: 'Bonus', type: 'dividend', cashCurrency: symbol, amount: change, assetClass: 'cash' })
      else out.add({ ...coin(symbol, at, row.number), type: 'buy', quantity: change, amount: 0, cashCurrency: 'EUR' })
    } else {
      out.issue('warning', `Unknown Binance operation "${row.text('operation')}" skipped.`, row.number)
    }
  }

  for (const { at, legs } of groups.values()) bookGroup(out, at, legs)
  return out
}

/** Turns the legs of one trade or conversion into a buy, a sell or a coin-to-coin conversion. */
function bookGroup(out: Collector, at: DateTime, legs: Leg[]): void {
  const row = legs[0]?.row ?? 0
  const net = new Map<string, number>()
  const fees = new Map<string, number>()
  for (const leg of legs) {
    const target = leg.fee ? fees : net
    target.set(leg.coin, (target.get(leg.coin) ?? 0) + leg.change)
  }
  const spent = [...net].filter(([, n]) => n < 0)
  const received = [...net].filter(([, n]) => n > 0)
  if (spent.length !== 1 || received.length !== 1) {
    out.issue('warning', `Trade with ${spent.length} spent and ${received.length} received coins; skipped.`, row)
    return
  }
  const [from, fromAmount] = spent[0] as [string, number]
  const [to, toAmount] = received[0] as [string, number]
  const feeIn = (symbol: string) => Math.abs(fees.get(symbol) ?? 0)
  const fiatFee = [...fees].filter(([symbol]) => isFiat(symbol))

  if (isFiat(from)) {
    const quantity = toAmount - feeIn(to)
    const costs = fiatFee.reduce((sum, [symbol, n]) => sum + out.convert(Math.abs(n), symbol, from, at.date, row), 0)
    out.add({ ...coin(to, at, row), type: 'buy', quantity, price: Math.abs(fromAmount) / toAmount, amount: Math.abs(fromAmount), cashCurrency: from, costs })
  } else if (isFiat(to)) {
    const quantity = Math.abs(fromAmount) + feeIn(from)
    const costs = fiatFee.reduce((sum, [symbol, n]) => sum + out.convert(Math.abs(n), symbol, to, at.date, row), 0)
    out.add({ ...coin(from, at, row), type: 'sell', quantity, price: toAmount / quantity, amount: toAmount, cashCurrency: to, costs })
  } else {
    out.add(conversion(from, Math.abs(fromAmount) + feeIn(from), to, toAmount - feeIn(to), at, row))
  }
}

export const binanceAdapter: BrokerAdapter = {
  id: 'binance',
  label: 'Binance',
  detect,
  parse(tables, context) {
    return result(
      'Binance',
      tables.map((t) => parseTable(t, context)),
      { transactionCosts: true, fxCosts: false, taxes: false, dividends: false, deposits: true },
      {
        fxCosts: 'Crypto exchanges have no currency conversion costs.',
        taxes: 'Binance exports contain no taxes.',
        dividends: 'Earn interest, staking and airdrops are added as free coins, not as dividends.',
      },
    )
  },
}
