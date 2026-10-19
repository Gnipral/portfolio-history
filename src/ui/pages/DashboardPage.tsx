import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { simulateBenchmark } from '../../engine/benchmark.ts'
import { db } from '../../data/db.ts'
import { positionsOn } from '../../engine/positions.ts'
import { allocationSlices, colorSlots } from '../dashboard/allocation.ts'
import type { ChartMode } from '../dashboard/chartData.ts'
import { PositionsTable } from '../dashboard/PositionsTable.tsx'
import { SummaryCards } from '../dashboard/SummaryCards.tsx'
import { TimeControls } from '../dashboard/TimeControls.tsx'
import { clampIndex, rangeChange, visibleRange, type RangeKey } from '../dashboard/timeRange.ts'
import { ToggleBar } from '../dashboard/ToggleBar.tsx'
import { engineOptions, toggleStates } from '../dashboard/toggles.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { DEFAULT_SETTINGS, saveSettings, useSettings } from '../../settings/settings.ts'
import { formatPercent, formatSignedEur, trendClass } from '../format.ts'

// The chart libraries are large; load them only when the dashboard shows data.
const PortfolioChart = lazy(() => import('../dashboard/PortfolioChart.tsx').then((m) => ({ default: m.PortfolioChart })))
const AllocationChart = lazy(() => import('../dashboard/AllocationChart.tsx').then((m) => ({ default: m.AllocationChart })))

export function DashboardPage() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const importRecord = useLiveQuery(() => db.imports.get('current'))
  const capabilities = importRecord?.capabilities
  const options = useMemo(() => engineOptions(settings, capabilities), [settings, capabilities])
  const toggles = toggleStates(settings.toggles, capabilities, importRecord?.missingReasons)
  const { transactionCount, inputs, series, sync, syncProblems } = usePortfolio(options)
  const [range, setRange] = useState<RangeKey>('ALL')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [mode, setMode] = useState<ChartMode>('eur')

  const points = useMemo(() => series?.points ?? [], [series])
  const dates = useMemo(() => points.map((p) => p.date), [points])
  const visible = useMemo(() => visibleRange(points, range), [points, range])
  const selected = clampIndex(selectedIndex, visible)
  const point = points[selected]
  const change = rangeChange(points, visible.from, visible.to)
  const selectedDate = point?.date
  const positions = useMemo(
    () => (inputs && selectedDate ? positionsOn(inputs.transactions, inputs.prices, options, selectedDate) : []),
    [inputs, options, selectedDate],
  )
  const benchmark = useMemo(
    () =>
      inputs?.benchmark
        ? {
            label: inputs.benchmark.info.symbol.split('.')[0] ?? inputs.benchmark.info.id,
            points: simulateBenchmark(points, inputs.benchmark.series),
          }
        : undefined,
    [inputs, points],
  )
  const benchmarkChange = benchmark ? rangeChange(benchmark.points, visible.from, visible.to) : undefined
  const slots = useMemo(() => colorSlots(inputs?.transactions ?? []), [inputs])
  const slices = useMemo(() => allocationSlices(positions, slots), [positions, slots])

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
          <ToggleBar
            states={toggles}
            onChange={(key, value) => void saveSettings({ toggles: { ...settings.toggles, [key]: value } })}
          />
          <Suspense fallback={<div className="chart-wrapper chart-placeholder" />}>
            <PortfolioChart
              points={points}
              from={visible.from}
              to={visible.to}
              selected={selected}
              mode={mode}
              onHover={setSelectedIndex}
              {...(benchmark ? { benchmark } : {})}
            />
          </Suspense>
          <p className="muted small">
            {range === 'ALL' ? 'Since the first transaction' : `Last ${range === 'YTD' ? 'year to date' : range}`}:{' '}
            <span className={trendClass(change.pnl)}>{formatSignedEur(change.pnl)}</span>, time-weighted{' '}
            <span className={trendClass(change.twr)}>{formatPercent(change.twr)}</span>
            {benchmark && benchmarkChange && (
              <>
                . The same money in {benchmark.label}:{' '}
                <span className={trendClass(benchmarkChange.pnl)}>{formatSignedEur(benchmarkChange.pnl)}</span>, time-weighted{' '}
                <span className={trendClass(benchmarkChange.twr)}>{formatPercent(benchmarkChange.twr)}</span>
              </>
            )}
          </p>
          <SummaryCards point={point} cashMode={series?.cashMode ?? false} />
          <div className="dashboard-grid">
            <div className="panel">
              <h3>Positions</h3>
              <PositionsTable positions={positions} date={point.date} />
            </div>
            {slices.length > 0 && (
              <div className="panel">
                <h3>Allocation</h3>
                <Suspense fallback={null}>
                  <AllocationChart slices={slices} />
                </Suspense>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
