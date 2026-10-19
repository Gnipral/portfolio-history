import type { BrokerAdapter, ImportIssue, ImportResult } from '../../types.ts'
import type { Transaction } from '../../../model/transaction.ts'
import { detectTransactions, parseTransactions } from './transactions.ts'

export const degiroAdapter: BrokerAdapter = {
  id: 'degiro',
  label: 'DEGIRO',
  detect: detectTransactions,
  parse(tables): ImportResult {
    const transactions: Transaction[] = []
    const issues: ImportIssue[] = []
    for (const table of tables) {
      const result = parseTransactions(table)
      transactions.push(...result.transactions)
      issues.push(...result.issues)
    }
    transactions.sort((a, b) => a.dateTime.localeCompare(b.dateTime))

    return {
      broker: 'DEGIRO',
      transactions,
      issues,
      capabilities: { transactionCosts: true, fxCosts: true, taxes: false, dividends: false, deposits: false },
      missingReasons: {
        taxes: 'The DEGIRO Transactions export does not contain taxes such as the Belgian TOB.',
        dividends: 'The DEGIRO Transactions export does not contain dividends.',
        deposits: 'The DEGIRO Transactions export does not contain deposits or withdrawals.',
      },
    }
  },
}
