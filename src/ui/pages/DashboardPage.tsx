import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { DemoButton } from '../components/DemoBanner.tsx'
import { usePalette } from '../usePalette.ts'
import { positionSeries } from '../../engine/analysis/positionSeries.ts'
import { db } from '../../data/db.ts'
import { positionsOn } from '../../engine/positions.ts'
import { allocationSlices, colorSlots, DIMENSIONS, groupedSlices, instrumentFacts, type AllocationDimension } from '../dashboard/allocation.ts'
import { AssetFilter } from '../dashboard/AssetFilter.tsx'
import { assetClassesOf } from '../dashboard/assetClasses.ts'
import { BenchmarkPicker, type BenchmarkChoice } from '../dashboard/BenchmarkPicker.tsx'
import { benchmarkCatalog } from '../../market/benchmarks.ts'
import { ConnectionNotice } from '../dashboard/ConnectionNotice.tsx'
import { CurrencyNotice } from '../dashboard/CurrencyNotice.tsx'
import { MissingHistoryNotice } from '../dashboard/MissingHistoryNotice.tsx'
import { benchmarkLines, toggleBenchmark } from '../dashboard/benchmarkLines.ts'
import { localToday } from '../../market/dates.ts'
import type { ChartMode } from '../dashboard/chartData.ts'
import { PositionsTable } from '../dashboard/PositionsTable.tsx'
import { profitPeriods } from '../dashboard/profit.ts'
import { ProfitOverview } from '../dashboard/ProfitOverview.tsx'
import { SummaryCards } from '../dashboard/SummaryCards.tsx'
import { TimeControls } from '../dashboard/TimeControls.tsx'
import { PeriodBar } from '../dashboard/PeriodBar.tsx'
import { clampIndex, periodRange, rangeChange, visibleRange, type RangeKey } from '../dashboard/timeRange.ts'
import { ToggleBar } from '../dashboard/ToggleBar.tsx'
import { engineOptions, toggleStates } from '../dashboard/toggles.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { ErrorBoundary } from '../errors/ErrorBoundary.tsx'
import { DEFAULT_SETTINGS, saveSettings, updateSettings, useSettings } from '../../settings/settings.ts'
import { t, tn } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { displayCurrency, formatDate, formatPercent, formatSignedEur, trendClass } from '../format.ts'

// The chart libraries are large; load them only when the dashboard shows data.
const PortfolioChart = lazy(() => import('../dashboard/PortfolioChart.tsx').then((m) => ({ default: m.PortfolioChart })))
const AllocationChart = lazy(() => import('../dashboard/AllocationChart.tsx').then((m) => ({ default: m.AllocationChart })))
const PositionChart = lazy(() => import('../dashboard/PositionChart.tsx').then((m) => ({ default: m.PositionChart })))
const ShareDialog = lazy(() => import('../share/ShareDialog.tsx').then((m) => ({ default: m.ShareDialog })))

export function DashboardPage() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const importRecord = useLiveQuery(() => db.imports.get('current'))
  const capabilities = importRecord?.capabilities
  const baseOptions = useMemo(() => engineOptions(settings, capabilities), [settings, capabilities])
  const toggles = toggleStates(settings.toggles, capabilities, importRecord?.missingReasons)
  const [assetClasses, setAssetClasses] = useState<string[]>([])
  const { transactionCount, allInputs, inputs, options, series, sync, syncProblems, slowConnection, online, currencyFallback } = usePortfolio(
    baseOptions,
    assetClasses,
  )
  const classes = useMemo(() => assetClassesOf(allInputs?.transactions ?? []), [allInputs])
  const [range, setRange] = useState<RangeKey>('ALL')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [mode, setMode] = useState<ChartMode>('eur')
  const [dimension, setDimension] = useState<AllocationDimension>('position')
  const [positionKey, setPositionKey] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const palette = usePalette()

  const points = useMemo(() => series?.points ?? [], [series])
  const dates = useMemo(() => points.map((p) => p.date), [points])
  const [periodId, setPeriodId] = useState<string | null>(null)
  const period = settings.periods.find((p) => p.id === periodId) ?? null
  const visible = useMemo(() => (period ? periodRange(points, period) : visibleRange(points, range)), [points, range, period])
  const selected = clampIndex(selectedIndex, visible)
  const point = points[selected]
  // Up to the day under the pointer, like every other figure on the page; without one, the end of the range.
  const change = rangeChange(points, visible.from, selected)
  const selectedDate = point?.date
  const positions = useMemo(
    () => (inputs && selectedDate ? positionsOn(inputs.transactions, inputs.prices, options, selectedDate) : []),
    [inputs, options, selectedDate],
  )
  // The chart compares with the default of the settings, or for now with another choice made under it.
  const [chartChoice, setChartChoice] = useState<BenchmarkChoice | null>(null)
  const choice: BenchmarkChoice = chartChoice ?? settings
  const { benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown } = choice
  const catalog = useMemo(() => benchmarkCatalog(settings.customBenchmarks), [settings.customBenchmarks])
  const benchmarks = useMemo(
    () => benchmarkLines(points, inputs?.benchmarks ?? [], { benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown }),
    [inputs, points, benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown],
  )
  // Colors from everything ever held, so a position keeps its color with a filter on.
  const slots = useMemo(() => colorSlots(allInputs?.transactions ?? []), [allInputs])
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
        <h2>{t('Dashboard')}</h2>
        <p>
          <Rich
            text={t('No portfolio loaded yet. <link>Import a broker export</link> to see its history, or look around in a made-up portfolio first.')}
            tags={{ link: (s) => <Link to="/import">{s}</Link> }}
          />
        </p>
        <DemoButton />
      </section>
    )
  }

  const syncing = sync !== null && sync.phase !== 'done'

  return (
    <section className="stack">
      <div className="dashboard-header">
        <h2>{t('Dashboard')}</h2>
        {syncing && (
          <span className="progress" role="status">
            <progress max={sync.total || 1} value={sync.done} />
            {sync.message}
          </span>
        )}
        <div className="segmented" role="group" aria-label={t('Chart unit')}>
          <button type="button" aria-pressed={mode === 'eur'} onClick={() => setMode('eur')}>
            {displayCurrency()}
          </button>
          <button type="button" aria-pressed={mode === 'percent'} onClick={() => setMode('percent')}>
            %
          </button>
        </div>
        {!syncing && syncProblems > 0 && (
          <Link to="/prices" className="small">
            {tn(syncProblems, '{count} product has no price yet', '{count} products have no price yet')}
          </Link>
        )}
        {point && (
          <button type="button" className="share-button" onClick={() => setSharing(true)}>
            {t('Share')}
          </button>
        )}
      </div>
      <ConnectionNotice offline={!online} weak={slowConnection} pricesFrom={pricesFrom} />
      <CurrencyNotice currency={currencyFallback} />
      <MissingHistoryNotice issues={series?.issues ?? []} />

      {!point ? (
        <p role="status">{t('Calculating…')}</p>
      ) : (
        <>
          <TimeControls
            dates={dates}
            range={period ? null : range}
            visible={visible}
            selected={selected}
            onRange={(next) => {
              setRange(next)
              setPeriodId(null)
              setSelectedIndex(null)
            }}
            onSelect={setSelectedIndex}
          />
          <PeriodBar
            periods={settings.periods}
            openId={periodId}
            // The shown range up to the selected day; up to today stays open-ended.
            current={{ from: dates[visible.from] ?? point.date, to: selected === dates.length - 1 ? null : point.date }}
            onOpen={(id) => {
              setPeriodId(id)
              setSelectedIndex(null)
            }}
            onSave={(saved) => {
              const id = crypto.randomUUID()
              void updateSettings((current) => ({ periods: [...current.periods, { id, ...saved }] }))
              setPeriodId(id)
              setSelectedIndex(null)
            }}
            onRemove={(id) => {
              void updateSettings((current) => ({ periods: current.periods.filter((p) => p.id !== id) }))
              if (id === periodId) setPeriodId(null)
            }}
          />
          <ToggleBar
            states={toggles}
            onChange={(key, value) => void saveSettings({ toggles: { ...settings.toggles, [key]: value } })}
          />
          {/* The chart, its benchmarks, filter and summary: the block the chart palette colors. */}
          <div className="chart-block stack" data-palette={palette === 'standard' ? undefined : palette}>
            <ErrorBoundary label={t('The chart')}>
              <Suspense fallback={<div className="chart-wrapper chart-placeholder" />}>
                <PortfolioChart
                  points={points}
                  from={visible.from}
                  to={visible.to}
                  selected={selected}
                  mode={mode}
                  onHover={setSelectedIndex}
                  benchmarks={benchmarks}
                  chartStyle={settings.chartStyle}
                  onStyleChange={(change) => void updateSettings((current) => ({ chartStyle: { ...current.chartStyle, ...change } }))}
                />
              </Suspense>
            </ErrorBoundary>
            <BenchmarkPicker
              settings={choice}
              catalog={catalog}
              lines={benchmarks}
              onChange={(change) => setChartChoice((current) => ({ ...(current ?? settings), ...change(current ?? settings) }))}
              onAdd={(benchmark) => {
                // Kept in the list to choose from; switched on in the chart for now.
                if (!catalog.some((b) => b.symbol === benchmark.symbol)) {
                  void updateSettings((current) => ({ customBenchmarks: [...current.customBenchmarks, benchmark] }))
                }
                const id = catalog.find((b) => b.symbol === benchmark.symbol)?.id ?? benchmark.id
                setChartChoice((current) => ({ ...(current ?? settings), ...toggleBenchmark(current ?? settings, id, true) }))
              }}
              temporary={chartChoice !== null}
              onReset={() => setChartChoice(null)}
            />
            <AssetFilter
              classes={classes}
              chosen={assetClasses}
              onChange={(next) => {
                setAssetClasses(next)
                setPositionKey(null)
              }}
            />
            <p className="muted small">
              {period ? period.name : range === 'ALL' ? t('Since the first transaction') : range === 'YTD' ? t('Year to date') : t('Last {range}', { range })}
              {selected < visible.to && ` ${t('up to {date}', { date: formatDate(point.date) })}`}:{' '}
              <span className={trendClass(change.pnl)}>{formatSignedEur(change.pnl)}</span>, {t('time-weighted')}{' '}
              <span className={trendClass(change.twr)}>{formatPercent(change.twr)}</span>
              {benchmarks.map((line) => {
                const lineChange = rangeChange(line.points, visible.from, selected)
                return (
                  <span key={line.id}>
                    . {t('The same money in {name}', { name: line.label })}:{' '}
                    <span className={trendClass(lineChange.pnl)}>{formatSignedEur(lineChange.pnl)}</span>, {t('time-weighted')}{' '}
                    <span className={trendClass(lineChange.twr)}>{formatPercent(lineChange.twr)}</span>
                  </span>
                )
              })}
            </p>
          </div>
          <ProfitOverview
            periods={periods}
            date={point.date}
            positions={positions}
            pnl={point.pnl}
            benchmark={mainBenchmark && benchmarkPnl !== undefined ? { label: mainBenchmark.label, pnl: benchmarkPnl } : undefined}
          />
          <SummaryCards point={point} cashMode={series?.cashMode ?? false} otherAssets={settings.otherAssets} />
          <div className="dashboard-grid">
            <div className="panel">
              <h3>{t('Positions')}</h3>
              {/* Wider than its column on smaller screens: it scrolls instead of running under the allocation. */}
              <div className="table-scroll">
                <PositionsTable
                  positions={positions}
                  date={point.date}
                  selectedKey={positionKey}
                  onSelect={(key) => setPositionKey(key === positionKey ? null : key)}
                />
              </div>
              {selectedPosition && history && (
                <div className="stack position-detail">
                  <h4>
                    {selectedPosition.product} <span className="muted small">{t('since the first transaction')}</span>
                  </h4>
                  <ErrorBoundary label={t('The position chart')} resetKey={positionKey}>
                    <Suspense fallback={<div className="chart-wrapper chart-placeholder" />}>
                      <PositionChart points={history.points} trades={history.trades} />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              )}
            </div>
            {slices.length > 0 && (
              <div className="panel">
                <div className="panel-header">
                  <h3>{t('Allocation')}</h3>
                  <div className="segmented" role="group" aria-label={t('Group the allocation by')}>
                    {DIMENSIONS.map((d) => (
                      <button key={d.key} type="button" aria-pressed={dimension === d.key} onClick={() => setDimension(d.key)}>
                        {t(d.label)}
                      </button>
                    ))}
                  </div>
                </div>
                <ErrorBoundary label={t('The allocation')} resetKey={dimension}>
                  <Suspense fallback={null}>
                    <AllocationChart slices={slices} />
                  </Suspense>
                </ErrorBoundary>
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
