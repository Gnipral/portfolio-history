import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { DemoButton } from '../components/DemoBanner.tsx'
import { positionSeries } from '../../engine/analysis/positionSeries.ts'
import { db } from '../../data/db.ts'
import { positionsOn } from '../../engine/positions.ts'
import { allocationSlices, colorSlots, DIMENSIONS, groupedSlices, instrumentFacts, type AllocationDimension } from '../dashboard/allocation.ts'
import { BenchmarkPicker } from '../dashboard/BenchmarkPicker.tsx'
import { ConnectionNotice } from '../dashboard/ConnectionNotice.tsx'
import { benchmarkLines } from '../dashboard/benchmarkLines.ts'
import { localToday } from '../../market/dates.ts'
import type { ChartMode } from '../dashboard/chartData.ts'
import { PositionsTable } from '../dashboard/PositionsTable.tsx'
import { profitPeriods } from '../dashboard/profit.ts'
import { ProfitOverview } from '../dashboard/ProfitOverview.tsx'
import { SummaryCards } from '../dashboard/SummaryCards.tsx'
import { TimeControls } from '../dashboard/TimeControls.tsx'
import { clampIndex, rangeChange, visibleRange, type RangeKey } from '../dashboard/timeRange.ts'
import { ToggleBar } from '../dashboard/ToggleBar.tsx'
import { engineOptions, toggleStates } from '../dashboard/toggles.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { DEFAULT_SETTINGS, saveSettings, updateSettings, useSettings } from '../../settings/settings.ts'
import { formatPercent, formatSignedEur, trendClass } from '../format.ts'

// The chart libraries are large; load them only when the dashboard shows data.
const PortfolioChart = lazy(() => import('../dashboard/PortfolioChart.tsx').then((m) => ({ default: m.PortfolioChart })))
const AllocationChart = lazy(() => import('../dashboard/AllocationChart.tsx').then((m) => ({ default: m.AllocationChart })))
const PositionChart = lazy(() => import('../dashboard/PositionChart.tsx').then((m) => ({ default: m.PositionChart })))
const ShareDialog = lazy(() => import('../share/ShareDialog.tsx').then((m) => ({ default: m.ShareDialog })))

export function DashboardPage() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const importRecord = useLiveQuery(() => db.imports.get('current'))
  const capabilities = importRecord?.capabilities
  const options = useMemo(() => engineOptions(settings, capabilities), [settings, capabilities])
  const toggles = toggleStates(settings.toggles, capabilities, importRecord?.missingReasons)
  const { transactionCount, inputs, series, sync, syncProblems, slowConnection, online } = usePortfolio(options)
  const [range, setRange] = useState<RangeKey>('ALL')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [mode, setMode] = useState<ChartMode>('eur')
  const [dimension, setDimension] = useState<AllocationDimension>('position')
  const [positionKey, setPositionKey] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

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
  const { benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown } = settings
  const benchmarks = useMemo(
    () => benchmarkLines(points, inputs?.benchmarks ?? [], { benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown }),
    [inputs, points, benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown],
  )
  const slots = useMemo(() => colorSlots(inputs?.transactions ?? []), [inputs])
  const facts = useMemo(() => instrumentFacts(inputs?.transactions ?? []), [inputs])
  const slices = useMemo(
    () => (dimension === 'position' ? allocationSlices(positions, slots) : groupedSlices(positions, dimension, facts)),
    [positions, slots, facts, dimension],
  )
  const typeSlices = useMemo(() => (sharing ? groupedSlices(positions, 'assetClass', facts) : []), [sharing, positions, facts])
  const selectedPosition = positions.find((p) => p.key === positionKey)
  const history = useMemo(
    () => (inputs && positionKey ? positionSeries(inputs.transactions, inputs.prices, options, positionKey, localToday()) : null),
    [inputs, options, positionKey],
  )

  const periods = useMemo(() => profitPeriods(points, selected), [points, selected])
  const mainBenchmark = benchmarks[0]
  const benchmarkPnl = mainBenchmark?.points[selected]?.pnl
  const lastDate = dates.at(-1)
  const noConnection = !online || slowConnection
  // The most recent market price of the positions held now: how up to date the stored prices are.
  const pricesFrom = useMemo(() => {
    if (!noConnection || !inputs || !lastDate) return undefined
    return positionsOn(inputs.transactions, inputs.prices, options, lastDate)
      .flatMap((p) => (p.priceSource === 'market' && p.priceDate ? [p.priceDate] : []))
      .sort()
      .at(-1)
  }, [noConnection, inputs, options, lastDate])

  if (transactionCount === undefined) return null
  if (transactionCount === 0) {
    return (
      <section>
        <h2>Dashboard</h2>
        <p>
          No portfolio loaded yet. <Link to="/import">Import a broker export</Link> to see its history, or look around in a
          made-up portfolio first.
        </p>
        <DemoButton />
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
        {point && (
          <button type="button" className="share-button" onClick={() => setSharing(true)}>
            Share
          </button>
        )}
      </div>
      <ConnectionNotice offline={!online} weak={slowConnection} pricesFrom={pricesFrom} />

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
              benchmarks={benchmarks}
            />
          </Suspense>
          <BenchmarkPicker settings={settings} lines={benchmarks} onChange={(change) => void updateSettings(change)} />
          <p className="muted small">
            {range === 'ALL' ? 'Since the first transaction' : `Last ${range === 'YTD' ? 'year to date' : range}`}:{' '}
            <span className={trendClass(change.pnl)}>{formatSignedEur(change.pnl)}</span>, time-weighted{' '}
            <span className={trendClass(change.twr)}>{formatPercent(change.twr)}</span>
            {benchmarks.map((line) => {
              const lineChange = rangeChange(line.points, visible.from, visible.to)
              return (
                <span key={line.id}>
                  . The same money in {line.label}:{' '}
                  <span className={trendClass(lineChange.pnl)}>{formatSignedEur(lineChange.pnl)}</span>, time-weighted{' '}
                  <span className={trendClass(lineChange.twr)}>{formatPercent(lineChange.twr)}</span>
                </span>
              )
            })}
          </p>
          <ProfitOverview
            periods={periods}
            date={point.date}
            positions={positions}
            pnl={point.pnl}
            benchmark={mainBenchmark && benchmarkPnl !== undefined ? { label: mainBenchmark.label, pnl: benchmarkPnl } : undefined}
          />
          <SummaryCards point={point} cashMode={series?.cashMode ?? false} />
          <div className="dashboard-grid">
            <div className="panel">
              <h3>Positions</h3>
              <PositionsTable
                positions={positions}
                date={point.date}
                selectedKey={positionKey}
                onSelect={(key) => setPositionKey(key === positionKey ? null : key)}
              />
              {selectedPosition && history && (
                <div className="stack position-detail">
                  <h4>
                    {selectedPosition.product} <span className="muted small">since the first transaction</span>
                  </h4>
                  <Suspense fallback={<div className="chart-wrapper chart-placeholder" />}>
                    <PositionChart points={history.points} trades={history.trades} />
                  </Suspense>
                </div>
              )}
            </div>
            {slices.length > 0 && (
              <div className="panel">
                <div className="panel-header">
                  <h3>Allocation</h3>
                  <div className="segmented" role="group" aria-label="Group the allocation by">
                    {DIMENSIONS.map((d) => (
                      <button key={d.key} type="button" aria-pressed={dimension === d.key} onClick={() => setDimension(d.key)}>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Suspense fallback={null}>
                  <AllocationChart slices={slices} />
                </Suspense>
              </div>
            )}
          </div>
        </>
      )}
      {sharing && point && (
        <Suspense fallback={null}>
          <ShareDialog
            points={points}
            from={visible.from}
            to={selected}
            benchmarks={benchmarks}
            slices={typeSlices}
            positions={positions}
            onClose={() => setSharing(false)}
          />
        </Suspense>
      )}
    </section>
  )
}
