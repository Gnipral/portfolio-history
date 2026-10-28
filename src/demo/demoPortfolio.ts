import type { PortfolioDatabase } from '../data/db.ts'
import { replacePortfolio } from '../data/portfolio.ts'
import { addDays } from '../market/dates.ts'
import { instrumentKey } from '../market/instruments.ts'
import type { Transaction, TransactionType } from '../model/transaction.ts'
import { DEMO_INSTRUMENTS, demoPrice, type DemoInstrument } from './demoPrices.ts'

/** USD per EUR used for the made-up US trades; valuation later uses the real ECB rates. */
const USD_RATE = 1.1

const FIRST_DAY = '2021-03-01'

function instrument(symbol: string): DemoInstrument {
  const found = DEMO_INSTRUMENTS.find((i) => i.symbol === symbol)
  if (!found) throw new Error(`No demo instrument ${symbol}`)
  return found
}

/** The first weekday on or after a date. */
function weekday(date: string): string {
  let day = date
  while ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())) day = addDays(day, 1)
  return day
}

function months(from: string, to: string): string[] {
  const result: string[] = []
  const date = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  while (date.toISOString().slice(0, 10) <= to) {
    result.push(date.toISOString().slice(0, 7))
    date.setUTCMonth(date.getUTCMonth() + 1)
  }
  return result
}

/**
 * A made-up portfolio from March 2021 until `today`: monthly deposits and ETF buys, a few stocks
 * (one in USD, one paying dividends), some crypto, a partial sale and a withdrawal. The same every
 * time, and it grows by itself as the days go by.
 */
export function demoTransactions(today: string): Transaction[] {
  const out: Transaction[] = []
  const add = (type: TransactionType, date: string, fields: Partial<Transaction> & { amountEur: number }) => {
    if (date > today) return
    const costs = (fields.costsEur ?? 0) + (fields.taxesEur ?? 0) + (fields.fxCostsEur ?? 0)
    const n = out.length + 1
    out.push({
      id: `demo:${String(n).padStart(5, '0')}`,
      dateTime: `${date}T10:${String(n % 60).padStart(2, '0')}`,
      date,
      type,
      product: 'CASH',
      assetClass: 'cash',
      quantity: 0,
      price: 0,
      currency: 'EUR',
      localAmount: fields.amountEur,
      costsEur: 0,
      taxesEur: 0,
      fxCostsEur: 0,
      totalEur: fields.amountEur - costs,
      source: { broker: 'demo', file: 'demo', row: n },
      ...fields,
    })
  }
  const trade = (type: 'buy' | 'sell', date: string, symbol: string, quantity: number) => {
    const i = instrument(symbol)
    const price = demoPrice(i, date)
    const local = Math.round(quantity * price * 100) / 100
    const eur = i.currency === 'USD' ? Math.round((local / USD_RATE) * 100) / 100 : local
    const sign = type === 'buy' ? -1 : 1
    add(type, date, {
      product: i.product,
      ...(i.isin ? { isin: i.isin } : {}),
      ticker: i.ticker,
      assetClass: i.assetClass,
      quantity,
      price,
      currency: i.currency,
      ...(i.currency === 'USD' ? { fxRate: USD_RATE, fxCostsEur: Math.round(eur * 0.0025 * 100) / 100 } : {}),
      localAmount: sign * local,
      amountEur: sign * eur,
      costsEur: i.assetClass === 'crypto' ? Math.round(eur * 0.015 * 100) / 100 : 1,
      // Belgian stock exchange tax: 0.12 % on ETFs, 0.35 % on shares.
      taxesEur: i.assetClass === 'crypto' ? 0 : Math.round(eur * (i.assetClass === 'etf' ? 0.0012 : 0.0035) * 100) / 100,
    })
  }
  const buyFor = (date: string, symbol: string, euros: number) => {
    const units = Math.floor(euros / demoPrice(instrument(symbol), date))
    if (units > 0) trade('buy', date, symbol, units)
  }

  add('deposit', FIRST_DAY, { amountEur: 5000 })
  for (const [n, month] of months(FIRST_DAY, today).entries()) {
    if (n > 0) add('deposit', weekday(`${month}-01`), { amountEur: 400 })
    buyFor(weekday(`${month}-05`), 'demo:world', 300)
    if (n % 3 === 1) buyFor(weekday(`${month}-12`), 'demo:europe', 250)
  }

  trade('buy', weekday('2021-06-10'), 'demo:tech', 6)
  trade('buy', weekday('2022-02-15'), 'demo:bank', 40)
  trade('buy', weekday('2022-09-20'), 'demo:tech', 4)
  trade('sell', weekday('2023-11-20'), 'demo:tech', 5)
  trade('buy', '2022-01-15', 'demo:coin', 0.25)
  trade('buy', '2024-03-02', 'demo:coin', 0.1)
  add('withdrawal', weekday('2024-07-01'), { amountEur: -1500 })

  // Demo Bank pays twice a year; 30 % withholding tax is booked as its own row.
  const bank = instrument('demo:bank')
  for (let year = 2022; year <= Number(today.slice(0, 4)); year++) {
    for (const date of [weekday(`${year}-05-10`), weekday(`${year}-11-10`)]) {
      if (date <= weekday('2022-02-15')) continue
      const gross = 40 * 0.6
      const fields = { product: bank.product, isin: bank.isin as string, ticker: bank.ticker, assetClass: bank.assetClass }
      add('dividend', date, { ...fields, amountEur: gross })
      add('tax', date, { ...fields, amountEur: -gross * 0.3 })
    }
  }
  return out.sort((a, b) => a.dateTime.localeCompare(b.dateTime))
}

const SEEDED_KEY = 'demo:seededFor'

/** Fills the demo database once a day, so new months of the made-up portfolio appear by themselves. */
export async function seedDemo(database: PortfolioDatabase, today: string, now: Date = new Date()): Promise<void> {
  if ((await database.kv.get(SEEDED_KEY))?.value === today) return
  const transactions = demoTransactions(today)
  await replacePortfolio(
    {
      broker: 'Demo',
      transactions,
      issues: [],
      capabilities: { transactionCosts: true, fxCosts: true, taxes: true, dividends: true, deposits: true },
      missingReasons: {},
    },
    ['Demo portfolio'],
    database,
    now,
  )
  await database.symbols.bulkPut(
    DEMO_INSTRUMENTS.map((i) => ({
      key: instrumentKey({ product: i.product, ...(i.isin ? { isin: i.isin } : {}) }),
      symbol: i.symbol,
      kind: i.assetClass === 'crypto' ? ('crypto' as const) : ('security' as const),
      source: 'manual' as const,
      name: i.product,
      resolvedAt: now.toISOString(),
    })),
  )
  await database.kv.put({ key: SEEDED_KEY, value: today })
}
