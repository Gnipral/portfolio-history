import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { DEFAULT_OPTIONS } from '../../engine/options.ts'
import type { ChartMode } from '../dashboard/chartData.ts'
import { PortfolioChart } from '../dashboard/PortfolioChart.tsx'
import { SummaryCards } from '../dashboard/SummaryCards.tsx'
import { TimeControls } from '../dashboard/TimeControls.tsx'
import { clampIndex, rangeChange, visibleRange, type RangeKey } from '../dashboard/timeRange.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { formatPercent, formatSignedEur, trendClass } from '../format.ts'

export function DashboardPage() {
  const [options] = useState(DEFAULT_OPTIONS)
  const { transactionCount, series, sync, syncProblems } = usePortfolio(options)
  const [range, setRange] = useState<RangeKey>('ALL')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [mode, setMode] = useState<ChartMode>('eur')

  const points = useMemo(() => series?.points ?? [], [series])
  const dates = useMemo(() => points.map((p) => p.date), [points])
  const visible = useMemo(() => visibleRange(points, range), [points, range])
  const selected = clampIndex(selectedIndex, visible)
  const point = points[selected]
  const change = rangeChange(points, visible.from, visible.to)

  if (transactionCount === undefined) return null
  if (transactionCount === 0) {
    return (
      <section>
        <h2>Dashboard</h2>
        <p>
          No portfolio loaded yet. <Link to="/import">Import a broker export</Link> to see its history.
        </p>
      </section>
    )
  }

  const syncing = sync !== null && sync.phase !== 'done'

  return (
    <section className="stack">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        {syncing && (
          <span className="progress" role="status">
            <progress max={sync.total || 1} value={sync.done} />
            {sync.message}
          </span>
        )}
        <div className="segmented" role="group" aria-label="Chart unit">
          <button type="button" aria-pressed={mode === 'eur'} onClick={() => setMode('eur')}>
            EUR
          </button>
          <button type="button" aria-pressed={mode === 'percent'} onClick={() => setMode('percent')}>
            %
          </button>
        </div>
        {!syncing && syncProblems > 0 && (
          <Link to="/prices" className="small">
            {syncProblems} {syncProblems === 1 ? 'product has' : 'products have'} no price yet
          </Link>
        )}
      </div>

      {!point ? (
        <p role="status">Calculating…</p>
      ) : (
        <>
          <TimeControls
            dates={dates}
            range={range}
            visible={visible}
            selected={selected}
            onRange={(next) => {
              setRange(next)
              setSelectedIndex(null)
            }}
            onSelect={setSelectedIndex}
          />
          <PortfolioChart
            points={points}
            from={visible.from}
            to={visible.to}
            selected={selected}
            mode={mode}
            onHover={setSelectedIndex}
          />
          <p className="muted small">
            {range === 'ALL' ? 'Since the first transaction' : `Last ${range === 'YTD' ? 'year to date' : range}`}:{' '}
            <span className={trendClass(change.pnl)}>{formatSignedEur(change.pnl)}</span>, time-weighted{' '}
            <span className={trendClass(change.twr)}>{formatPercent(change.twr)}</span>
          </p>
          <SummaryCards point={point} cashMode={series?.cashMode ?? false} />
        </>
      )}
    </section>
  )
}
