import type { ImportContext } from '../import/types.ts'
import type { AssetClass, Transaction, TransactionType } from '../model/transaction.ts'
import { db, type ImportRecord, type PortfolioDatabase } from './db.ts'
import { msg, t } from '../i18n/i18n.ts'

export const MANUAL_BROKER = 'Manual'

/** The types that can be entered or edited by hand. */
export const EDITABLE_TYPES = ['buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'fee', 'tax'] as const
export type EditableType = (typeof EDITABLE_TYPES)[number]

/** Types that move units of a product; the others only move cash. */
export const TRADE_TYPES: readonly EditableType[] = ['buy', 'sell']

/** What the form asks for. Amounts are positive; the direction follows from `type`. */
export interface ManualInput {
  date: string
  type: EditableType
  product: string
  isin: string
  ticker: string
  assetClass: AssetClass
  /** Units, for buys and sells. */
  quantity: number
  /** Price per unit in `currency`, for buys and sells. */
  price: number
  /** Gross amount in `currency`, for cash types. */
  amount: number
  currency: string
  costsEur: number
  taxesEur: number
}

const OUTGOING: TransactionType[] = ['buy', 'fee', 'tax', 'withdrawal']

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function isEditable(t: Transaction): boolean {
  return (EDITABLE_TYPES as readonly TransactionType[]).includes(t.type)
}

/** The form values of a stored transaction, to edit it. */
export function toInput(t: Transaction): ManualInput {
  return {
    date: t.date,
    type: t.type as EditableType,
    product: t.product,
    isin: t.isin ?? '',
    ticker: t.ticker ?? '',
    assetClass: t.assetClass,
    quantity: t.quantity,
    price: t.price,
    amount: Math.abs(t.localAmount),
    currency: t.currency,
    costsEur: t.costsEur,
    taxesEur: t.taxesEur,
  }
}

/** Why the input cannot be saved, or undefined when it can. */
export function validate(input: ManualInput): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return t('Enter a date.')
  const trade = TRADE_TYPES.includes(input.type)
  if ((trade || input.type === 'dividend') && !input.product.trim() && !input.isin.trim()) return t('Enter a product name or ISIN.')
  if (input.isin.trim() && !/^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(input.isin.trim())) return t('The ISIN is not valid (12 characters, e.g. IE00B4L5Y983).')
  if (trade && !(input.quantity > 0)) return t('Enter a quantity above 0.')
  if (trade && !(input.price >= 0)) return t('Enter a price.')
  if (!trade && !(input.amount > 0)) return t('Enter an amount above 0.')
  if (input.costsEur < 0 || input.taxesEur < 0) return t('Costs and taxes cannot be negative.')
  return undefined
}

/**
 * Builds a transaction from the form, or edits `base` (an imported or earlier manual transaction) and keeps
 * its id and source. Throws when the currency has no EUR rate on that date.
 */
export function buildTransaction(input: ManualInput, context: ImportContext, base?: Transaction): Transaction {
  const trade = TRADE_TYPES.includes(input.type)
  const currency = input.currency.trim().toUpperCase() || 'EUR'
  const gross = trade ? input.quantity * input.price : input.amount
  const grossEur = currency === 'EUR' ? gross : context.toEur(gross, currency, input.date)
  if (grossEur === undefined) throw new Error(`No EUR exchange rate for ${currency} on ${input.date}.`)
  const sign = OUTGOING.includes(input.type) ? -1 : 1
  const amountEur = round(sign * grossEur) || 0
  const isin = input.isin.trim().toUpperCase()
  const ticker = input.ticker.trim().toUpperCase()
  const time = base && base.date === input.date ? base.dateTime.slice(11) : '12:00'
  const { isin: _isin, ticker: _ticker, fxRate: _fxRate, ...kept } = base ?? ({} as Partial<Transaction>)
  return {
    ...kept,
    id: base?.id ?? `manual:${crypto.randomUUID()}`,
    dateTime: `${input.date}T${time}`,
    date: input.date,
    type: input.type,
    product: input.product.trim() || isin || (input.type === 'deposit' || input.type === 'withdrawal' ? 'CASH' : ''),
    ...(isin ? { isin } : {}),
    ...(ticker ? { ticker } : {}),
    assetClass: trade || input.type === 'dividend' ? input.assetClass : 'cash',
    quantity: trade ? input.quantity : 0,
    price: trade ? input.price : 0,
    currency,
    ...(currency !== 'EUR' && grossEur ? { fxRate: Math.abs(gross / grossEur) } : {}),
    localAmount: sign * gross || 0,
    amountEur,
    costsEur: round(input.costsEur),
    taxesEur: round(input.taxesEur),
    fxCostsEur: base?.fxCostsEur ?? 0,
    totalEur: round(amountEur - input.costsEur - input.taxesEur - (base?.fxCostsEur ?? 0)),
    source: base?.source ?? { broker: MANUAL_BROKER, file: '', row: 0 },
  }
}

function manualRecord(current: ImportRecord | undefined, now: Date): ImportRecord {
  if (!current) {
    // Without an import, everything the user enters counts: costs, taxes, dividends and deposits.
    return {
      id: 'current',
      broker: MANUAL_BROKER,
      files: [],
      importedAt: now.toISOString(),
      capabilities: { transactionCosts: true, fxCosts: false, taxes: true, dividends: true, deposits: true },
      missingReasons: { fxCosts: msg('Transactions entered by hand have no separate currency costs.') },
      issues: [],
    }
  }
  const brokers = current.broker.split(' + ')
  return brokers.includes(MANUAL_BROKER) ? current : { ...current, broker: [...brokers, MANUAL_BROKER].join(' + ') }
}

/** Stores a new or edited transaction. */
export async function saveTransaction(t: Transaction, database: PortfolioDatabase = db, now: Date = new Date()): Promise<void> {
  await database.transaction('rw', database.transactions, database.imports, async () => {
    if (t.source.broker === MANUAL_BROKER) await database.imports.put(manualRecord(await database.imports.get('current'), now))
    await database.transactions.put(t)
  })
}

export async function deleteTransaction(id: string, database: PortfolioDatabase = db): Promise<void> {
  await database.transactions.delete(id)
}
