import type { Transaction, TransactionType } from '../model/transaction.ts'

let counter = 0

/** Builds a transaction for hand-calculated test scenarios. Amounts are in EUR. */
export function tx(
  type: TransactionType,
  date: string,
  fields: Partial<Omit<Transaction, 'type' | 'date'>> & { amount?: number } = {},
): Transaction {
  const { amount = 0, ...rest } = fields
  // Cash point of view: buys, fees, taxes and withdrawals take money out.
  const sign = ['buy', 'fee', 'tax', 'withdrawal'].includes(type) ? -1 : 1
  const amountEur = sign * Math.abs(amount)
  const costsEur = rest.costsEur ?? 0
  const taxesEur = rest.taxesEur ?? 0
  const fxCostsEur = rest.fxCostsEur ?? 0
  counter++
  return {
    id: `test:${String(counter).padStart(6, '0')}`,
    dateTime: `${date}T12:00`,
    date,
    type,
    product: rest.isin ?? 'CASH',
    assetClass: 'stock',
    quantity: 0,
    price: 0,
    currency: 'EUR',
    localAmount: amountEur,
    amountEur,
    costsEur,
    taxesEur,
    fxCostsEur,
    totalEur: amountEur - costsEur - taxesEur - fxCostsEur,
    source: { broker: 'test', file: 'test', row: counter },
    ...rest,
  }
}
