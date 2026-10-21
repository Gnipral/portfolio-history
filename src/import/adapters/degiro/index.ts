import { degiroPdfTable, detectDegiroPdf } from '../../pdf/degiro.ts'
import type { BrokerAdapter, ImportResult } from '../../types.ts'
import { result } from '../kit.ts'
import { detectAccount, isAccountTable, parseAccount } from './account.ts'
import { detectTransactions, parseTransactions } from './transactions.ts'

/** DEGIRO: the Transactions export, the Account statement, or both together, as CSV, Excel or PDF. */
export const degiroAdapter: BrokerAdapter = {
  id: 'degiro',
  label: 'DEGIRO',
  detect: (table) => (table.text === undefined ? Math.max(detectTransactions(table), detectAccount(table)) : detectDegiroPdf(table.text)),
  parse(allTables, context): ImportResult {
    const tables = allTables.map((t) => (t.text === undefined ? t : degiroPdfTable(t)))
    const accounts = tables.filter(isAccountTable)
    const trades = tables.filter((t) => !isAccountTable(t))
    const outputs = [
      ...trades.map((t) => parseTransactions(t)),
      ...accounts.map((t) => parseAccount(t, { withTrades: trades.length === 0, ...(context ? { context } : {}) })),
    ]
    const hasAccount = accounts.length > 0
    return result(
      'DEGIRO',
      outputs,
      { transactionCosts: true, fxCosts: trades.length > 0, taxes: hasAccount, dividends: hasAccount, deposits: hasAccount },
      {
        ...(trades.length > 0 ? {} : { fxCosts: 'AutoFX costs are only in the DEGIRO Transactions export.' }),
        ...(hasAccount
          ? {}
          : {
              taxes: 'The DEGIRO Transactions export does not contain taxes such as the Belgian TOB. Add the Account statement to include them.',
              dividends: 'The DEGIRO Transactions export does not contain dividends. Add the Account statement to include them.',
              deposits: 'The DEGIRO Transactions export does not contain deposits or withdrawals. Add the Account statement to include them.',
            }),
      },
    )
  },
}
