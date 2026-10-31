import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DemoButton } from '../components/DemoBanner.tsx'
import { isDemo } from '../../demo/demoMode.ts'
import { isOnboarded } from '../onboarding/onboarded.ts'
import { Onboarding } from '../onboarding/Onboarding.tsx'
import { DownloadCsvButton } from '../components/DownloadCsvButton.tsx'
import { Figure } from '../components/Section.tsx'
import { positionsRows } from '../csvTables.ts'
import { usePalette } from '../usePalette.ts'
import { positionSeries } from '../../engine/analysis/positionSeries.ts'
import { db } from '../../data/db.ts'
import { checkData, problemCount } from '../../engine/dataCheck.ts'
import { positionsOn } from '../../engine/positions.ts'
import { allocationSlices, colorSlots, groupedSlices, instrumentFacts, type AllocationDimension } from '../dashboard/allocation.ts'
import { AllocationBar } from '../dashboard/AllocationBar.tsx'
import { AssetFilter } from '../dashboard/AssetFilter.tsx'
import { assetClassesOf } from '../dashboard/assetClasses.ts'
import { BenchmarkPicker, type BenchmarkChoice } from '../dashboard/BenchmarkPicker.tsx'
import { benchmarkCatalog } from '../../market/benchmarks.ts'
import { ChartToolbar } from '../dashboard/ChartToolbar.tsx'
import { ConnectionNotice } from '../dashboard/ConnectionNotice.tsx'
import { CurrencyNotice } from '../dashboard/CurrencyNotice.tsx'
import { MissingHistoryNotice } from '../dashboard/MissingHistoryNotice.tsx'
import { benchmarkLines, toggleBenchmark } from '../dashboard/benchmarkLines.ts'
import { holdingFacts } from '../dashboard/holdings.ts'
import { InspectionPanel, formatMwr } from '../dashboard/InspectionPanel.tsx'
import { localToday } from '../../market/dates.ts'
import type { ChartMode } from '../dashboard/chartData.ts'
import { dayMarkers, markersIn, transactionsOn } from '../dashboard/markers.ts'
import { periodFigures } from '../dashboard/periodFigures.ts'
import { PositionsTable } from '../dashboard/PositionsTable.tsx'
import { profitPeriods } from '../dashboard/profit.ts'
import { usePanelOpen } from '../dashboard/sidePanel.ts'
import { Timeline } from '../dashboard/Timeline.tsx'
import type { DayWindow } from '../dashboard/timeline.ts'
import { PeriodBar } from '../dashboard/PeriodBar.tsx'
import { rangeChange, rangeDescription } from '../dashboard/timeRange.ts'
import { ToggleBar } from '../dashboard/ToggleBar.tsx'
import { engineOptions, toggleStates } from '../dashboard/toggles.ts'
import { useFullscreen } from '../dashboard/useFullscreen.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { ErrorBoundary } from '../errors/ErrorBoundary.tsx'
import { usePeriod } from '../period/PeriodProvider.tsx'
import { DEFAULT_SETTINGS, saveSettings, updateSettings, useSettings } from '../../settings/settings.ts'
import { t, tn } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { displayCurrency, formatDate, formatEur, formatPercent, formatSignedEur } from '../format.ts'
import '../dashboard/dashboard.css'

// The chart library is large; load it only when the dashboard shows data.
const PortfolioChart = lazy(() => import('../dashboard/PortfolioChart.tsx').then((m) => ({ default: m.PortfolioChart })))
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
  // The first visit without data gets the welcome flow; after that, the plain empty state.
  const [onboarded, setOnboarded] = useState(isOnboarded)
  const [mode, setMode] = useState<ChartMode>('eur')
  const [dimension, setDimension] = useState<AllocationDimension>('assetClass')
  const [positionKey, setPositionKey] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [panelOpen, setPanelOpen] = usePanelOpen()
  const chartBlock = useRef<HTMLDivElement>(null)
  const [expanded, toggleExpanded] = useFullscreen(chartBlock)
  const palette = usePalette()

  const points = useMemo(() => series?.points ?? [], [series])
  const dates = useMemo(() => points.map((p) => p.date), [points])
  const period = usePeriod(points)
  const { visible, selected, pinned, selection } = period
  const shown: DayWindow = { from: visible.from, to: Math.max(visible.from, visible.to) }
  // The day the panel and the chart labels show: under the pointer, else the playhead.
  const inspected = hover !== null && hover >= shown.from && hover <= shown.to ? hover : selected
  const point = points[selected]
  const inspectedPoint = points[inspected]
  const lastIndex = points.length - 1

  const setWindow = (next: DayWindow) => {
    const from = dates[next.from]
    if (!from) return
    period.setWindow(from, next.to >= lastIndex ? null : (dates[next.to] ?? null))
  }
  const setPlayhead = (index: number) => {
    const date = dates[index]
    if (date) period.setPlayhead(date)
  }

  const playheadDate = point?.date
  const positions = useMemo(
    () => (inputs && playheadDate ? positionsOn(inputs.transactions, inputs.prices, options, playheadDate) : []),
    [inputs, options, playheadDate],
  )
  const inspectedDate = inspectedPoint?.date
  const inspectedPositions = useMemo(
    () =>
      inspectedDate === playheadDate ? positions : inputs && inspectedDate ? positionsOn(inputs.transactions, inputs.prices, options, inspectedDate) : [],
    [inspectedDate, playheadDate, positions, inputs, options],
  )
  // The chart compares with the default of the settings, or for now with another choice made in its menu.
  const [chartChoice, setChartChoice] = useState<BenchmarkChoice | null>(null)
  const choice: BenchmarkChoice = chartChoice ?? settings
  const { benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown } = choice
  const catalog = useMemo(() => benchmarkCatalog(settings.customBenchmarks), [settings.customBenchmarks])
  const benchmarks = useMemo(
    () => benchmarkLines(points, inputs?.benchmarks ?? [], { benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown }),
    [inputs, points, benchmarkId, extraBenchmarkIds, benchmarkMix, benchmarkMixShown],
  )
  const mainBenchmark = benchmarks[0]
  // Colours from everything ever held, so a position keeps its colour with a filter on.
  const slots = useMemo(() => colorSlots(allInputs?.transactions ?? []), [allInputs])
  const facts = useMemo(() => instrumentFacts(inputs?.transactions ?? []), [inputs])
  const holdings = useMemo(() => holdingFacts(inputs?.transactions ?? []), [inputs])
  const slices = useMemo(
    () => (dimension === 'position' ? allocationSlices(positions, slots) : groupedSlices(positions, dimension, facts)),
    [positions, slots, facts, dimension],
  )
  const typeSlices = useMemo(() => (sharing ? groupedSlices(positions, 'assetClass', facts) : []), [sharing, positions, facts])
  const history = useMemo(
    () => (inputs && positionKey ? positionSeries(inputs.transactions, inputs.prices, options, positionKey, localToday()) : null),
    [inputs, options, positionKey],
  )
  const allMarkers = useMemo(() => dayMarkers(inputs?.transactions ?? []), [inputs])
  const windowFrom = dates[shown.from] ?? ''
  const windowTo = dates[shown.to] ?? ''
  const markers = useMemo(() => markersIn(allMarkers, windowFrom, windowTo), [allMarkers, windowFrom, windowTo])
  const dayTransactions = useMemo(() => (inputs && inspectedDate ? transactionsOn(inputs.transactions, inspectedDate) : []), [inputs, inspectedDate])

  const totals = useMemo(() => periodFigures(points, shown.from, shown.to, mainBenchmark?.points), [points, shown.from, shown.to, mainBenchmark])
  const inspectedFigures = useMemo(() => periodFigures(points, shown.from, inspected, mainBenchmark?.points), [points, shown.from, inspected, mainBenchmark])
  const profits = useMemo(() => profitPeriods(points, inspected), [points, inspected])
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
  // Over everything held, whatever the filter: the same count as on the Data check page.
  const checkProblems = useMemo(() => {
    if (!allInputs || !series) return undefined
    const check = checkData({ transactions: allInputs.transactions, prices: allInputs.prices, options: baseOptions, issues: series.issues, today: localToday() })
    return problemCount(check) + (currencyFallback ? 1 : 0)
  }, [allInputs, series, baseOptions, currencyFallback])

  if (transactionCount === undefined) return null
  if (transactionCount === 0) {
    if (!onboarded && !isDemo()) return <Onboarding onDone={() => setOnboarded(true)} />
    return (
      <section className="stack">
        <h2>{t('Dashboard')}</h2>
        <p>
          <Rich
            text={t('No portfolio loaded yet. <link>Import a broker export</link> to see its history, or look around in a made-up portfolio first.')}
            tags={{ link: (s) => <Link to="/import">{s}</Link> }}
          />
        </p>
        <div>
          <DemoButton />
        </div>
      </section>
    )
  }

  const syncing = sync !== null && sync.phase !== 'done'
  const savedPeriod = selection.kind === 'window' && selection.savedId ? settings.periods.find((p) => p.id === selection.savedId) : undefined
  const periodName =
    savedPeriod?.name ??
    (selection.kind === 'range'
      ? rangeDescription(selection.range)
      : t('{from} to {to}', { from: formatDate(dates[shown.from] ?? ''), to: formatDate(dates[shown.to] ?? '') }))
  const cash = series?.cashMode && inspectedPoint ? inspectedPoint.value - inspectedPositions.reduce((sum, p) => sum + p.value, 0) : undefined
  // With the panel closed, the legend shows the values of the inspected day instead.
  const legendValues =
    !panelOpen && inspectedPoint
      ? mode === 'eur'
        ? {
            portfolio: formatEur(inspectedPoint.value),
            invested: formatEur(inspectedPoint.invested),
            benchmarks: benchmarks.map((line) => formatEur(line.points[inspected]?.value ?? 0)),
          }
        : {
            portfolio: formatPercent(rangeChange(points, shown.from, inspected).twr),
            benchmarks: benchmarks.map((line) => formatPercent(rangeChange(line.points, shown.from, inspected).twr)),
          }
      : undefined

  return (
    <section className="dashboard">
      <div className="dash-title">
        <h2>{t('Dashboard')}</h2>
        <AssetFilter
          classes={classes}
          chosen={assetClasses}
          onChange={(next) => {
            setAssetClasses(next)
            setPositionKey(null)
          }}
        />
        <div className="dash-title-tools">
          {syncing && (
            <span className="progress" role="status">
              <progress max={sync.total || 1} value={sync.done} />
              {sync.message}
            </span>
          )}
          {!syncing && syncProblems > 0 && (
            <Link to="/prices" className="small">
              {tn(syncProblems, '{count} product has no price yet', '{count} products have no price yet')}
            </Link>
          )}
          {!syncing && checkProblems !== undefined && (
            <Link to="/check" className="small data-check-link">
              {checkProblems > 0 ? tn(checkProblems, 'Data check: {count} to look at', 'Data check: {count} to look at') : t('Data check ✓')}
            </Link>
          )}
          {point && (
            <button type="button" className="share-button" onClick={() => setSharing(true)}>
              {t('Share')}
            </button>
          )}
        </div>
      </div>
      <ConnectionNotice offline={!online} weak={slowConnection} pricesFrom={pricesFrom} />
      <CurrencyNotice currency={currencyFallback} />
      <MissingHistoryNotice issues={series?.issues ?? []} />

      {!point || !totals || !inspectedPoint || !inspectedFigures ? (
        <p role="status">{t('Calculating…')}</p>
      ) : (
        <>
          <div className="figures dash-figures">
            <Figure label={t('Portfolio value')} value={formatEur(totals.value)} note={series?.cashMode ? t('Securities and cash') : t('Securities')} />
            <Figure
              label={t('Invested capital')}
              value={formatEur(totals.invested)}
              note={series?.cashMode ? t('Deposits minus withdrawals') : t('Bought minus sold')}
            />
            <Figure label={t('Total profit')} value={formatSignedEur(totals.pnl)} note={`${formatPercent(totals.pnlPercent)} ${t('of invested')}`} />
            <Figure label={t('Time-weighted return')} value={formatPercent(totals.twr)} note={t('TWR, independent of deposits')} />
            <Figure label={t('Money-weighted return')} value={formatMwr(totals.mwr)} note={t('XIRR')} />
            {mainBenchmark && totals.benchmark && (
              <Figure
                benchmark
                label={t('{name}, same money', { name: mainBenchmark.label })}
                value={formatPercent(totals.benchmark.twr)}
                note={`${formatSignedEur(totals.benchmark.pnl)} · ${formatEur(totals.benchmark.value)}`}
              />
            )}
          </div>
          <p className="dash-summary">
            <span className="label-caps">{t('Summary')}</span> {periodName}: <strong className="figure">{formatSignedEur(totals.pnl)}</strong>,{' '}
            {t('time-weighted')} <strong className="figure">{formatPercent(totals.twr)}</strong>
            {benchmarks.map((line) => {
              const lineChange = rangeChange(line.points, shown.from, shown.to)
              return (
                <span key={line.id}>
                  . {t('The same money in {name}', { name: line.label })}:{' '}
                  <span className={line === mainBenchmark ? 'benchmark figure' : 'figure'}>
                    {formatSignedEur(lineChange.pnl)}, {t('time-weighted')} {formatPercent(lineChange.twr)}
                  </span>
                </span>
              )
            })}
            {totals.alpha && (
              <span>
                . {t('Outperformance')}: <strong className="figure">{formatSignedEur(totals.alpha.pnl)}</strong>
              </span>
            )}
            .
          </p>

          {/* The chart, its benchmarks, the side panel and the timeline: the block the chart palette colours. */}
          <div ref={chartBlock} className={`dash-chart-block${expanded ? ' expanded' : ''}`} data-palette={palette === 'standard' ? undefined : palette}>
            <ChartToolbar
              mode={mode}
              onMode={setMode}
              benchmarks={benchmarks}
              benchmarkPicker={
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
              }
              chartStyle={settings.chartStyle}
              onStyleChange={(change) => void updateSettings((current) => ({ chartStyle: { ...current.chartStyle, ...change } }))}
              panelOpen={panelOpen}
              onPanel={setPanelOpen}
              expanded={expanded}
              onExpand={toggleExpanded}
              values={legendValues}
            />
            <div className={`dash-chart${panelOpen ? ' with-panel' : ''}`}>
              <div className="dash-chart-area">
                <ErrorBoundary label={t('The chart')}>
                  <Suspense fallback={<div className="chart-wrapper chart-placeholder" />}>
                    <PortfolioChart
                      points={points}
                      window={shown}
                      inspected={inspected}
                      mode={mode}
                      benchmarks={benchmarks}
                      chartStyle={settings.chartStyle}
                      markers={markers}
                      onHover={setHover}
                      onPick={setPlayhead}
                      onZoom={setWindow}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
              {panelOpen && (
                <InspectionPanel
                  date={inspectedPoint.date}
                  pinned={pinned && hover === null}
                  onUnpin={() => period.setPlayhead(null)}
                  figures={inspectedFigures}
                  benchmarkLabel={mainBenchmark?.label}
                  periods={profits}
                  positions={inspectedPositions}
                  transactions={dayTransactions}
                  cash={cash}
                  unrealized={inspectedPoint.unrealized}
                  realized={inspectedPoint.realized}
                />
              )}
            </div>
            <Timeline
              points={points}
              window={shown}
              playhead={selected}
              range={selection.kind === 'range' ? selection.range : null}
              onWindow={setWindow}
              onPlayhead={setPlayhead}
              onRange={period.setRange}
            />
            <PeriodBar
              periods={settings.periods}
              openId={selection.kind === 'window' ? (selection.savedId ?? null) : null}
              // The window shown; up to today stays open-ended.
              current={{ from: dates[shown.from] ?? point.date, to: shown.to >= lastIndex ? null : (dates[shown.to] ?? null) }}
              onOpen={(id) => {
                const saved = settings.periods.find((p) => p.id === id)
                if (saved) period.setWindow(saved.from, saved.to, saved.id)
                period.setPlayhead(null)
              }}
              onSave={(saved) => {
                const id = crypto.randomUUID()
                void updateSettings((current) => ({ periods: [...current.periods, { id, ...saved }] }))
                period.setWindow(saved.from, saved.to, id)
              }}
              onRemove={(id) => {
                void updateSettings((current) => ({ periods: current.periods.filter((p) => p.id !== id) }))
              }}
            />
          </div>

          <ToggleBar states={toggles} onChange={(key, value) => void saveSettings({ toggles: { ...settings.toggles, [key]: value } })} />

          {slices.length > 0 && <AllocationBar slices={slices} dimension={dimension} onDimension={setDimension} />}

          <section className="dash-holdings" aria-labelledby="holdings-title">
            <div className="dash-holdings-head">
              <h3 id="holdings-title">{t('Holdings on {date}', { date: formatDate(point.date) })}</h3>
              <span className="label-caps">{tn(positions.length, '{count} open position', '{count} open positions')}</span>
              {positions.length > 0 && (
                <DownloadCsvButton
                  rows={() => positionsRows(positions, inputs?.currency ?? displayCurrency())}
                  name={`positions-${point.date}`}
                  what={t('the positions')}
                />
              )}
            </div>
            <div className="table-scroll">
              <PositionsTable
                positions={positions}
                date={point.date}
                facts={holdings}
                selectedKey={positionKey}
                onSelect={(key) => setPositionKey(key === positionKey ? null : key)}
                detail={() =>
                  history && (
                    <ErrorBoundary label={t('The position chart')} resetKey={positionKey}>
                      <Suspense fallback={<div className="chart-wrapper chart-placeholder" />}>
                        <PositionChart points={history.points} trades={history.trades} />
                      </Suspense>
                    </ErrorBoundary>
                  )
                }
              />
            </div>
            {point.estimated > 0 && (
              <p className="muted small">
                {tn(
                  point.estimated,
                  '{count} position is valued with a trade price or an outdated market price on this date. See Prices.',
                  '{count} positions are valued with a trade price or an outdated market price on this date. See Prices.',
                )}
              </p>
            )}
          </section>
        </>
      )}
      {sharing && point && (
        <Suspense fallback={null}>
          <ShareDialog
            points={points}
            from={shown.from}
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
