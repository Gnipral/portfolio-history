import { msg } from '../../i18n/i18n.ts'

/** Names of the transaction types, for tables and forms. */
export const TYPE_LABELS: Record<string, string> = {
  buy: msg('Buy'),
  sell: msg('Sell'),
  dividend: msg('Dividend'),
  deposit: msg('Deposit'),
  withdrawal: msg('Withdrawal'),
  fee: msg('Fee'),
  tax: msg('Tax'),
  fx: msg('Currency exchange'),
  split: msg('Split'),
  transferIn: msg('Transfer in'),
  transferOut: msg('Transfer out'),
  other: msg('Other'),
}
