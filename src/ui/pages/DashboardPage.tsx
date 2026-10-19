import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { db } from '../../data/db.ts'
import { summarize } from '../../import/summary.ts'
import { formatDate } from '../format.ts'

export function DashboardPage() {
  const data = useLiveQuery(async () => ({
    record: await db.imports.get('current'),
    transactions: await db.transactions.toArray(),
  }))

  if (!data) return null

  if (!data.record || data.transactions.length === 0) {
    return (
      <section>
        <h2>Dashboard</h2>
        <p>
          No portfolio loaded yet. <Link to="/import">Import a broker export</Link> to see its history.
        </p>
      </section>
    )
  }

  const summary = summarize(data.transactions)
  return (
    <section className="stack">
      <h2>Dashboard</h2>
      <p className="muted">
        {data.record.broker} import of {formatDate(data.record.importedAt.slice(0, 10))}: {summary.transactionCount}{' '}
        transactions from {summary.firstDate && formatDate(summary.firstDate)} to{' '}
        {summary.lastDate && formatDate(summary.lastDate)}, {summary.openPositions.length} open positions. Charts and
        returns follow in the next milestones.
      </p>
    </section>
  )
}
