import { Link } from 'react-router'

export function DashboardPage() {
  return (
    <section>
      <h2>Dashboard</h2>
      <p>
        No portfolio loaded yet. <Link to="/import">Import a broker export</Link> to see its history.
      </p>
    </section>
  )
}
