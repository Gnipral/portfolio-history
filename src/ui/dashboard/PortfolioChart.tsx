import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BenchmarkLine } from './benchmarkLines.ts'
import type { DailyPoint } from '../../engine/series.ts'
import { DEFAULT_CHART_STYLE, type ChartStyle } from '../../settings/settings.ts'
import { PALETTES, readPalette, storePalette, type Palette } from '../../theme/theme.ts'
import { formatDate, formatEur, formatPercent } from '../format.ts'
import { chartData, type ChartMode } from './chartData.ts'
import { useThemeColors } from './useThemeColors.ts'

interface Props {
  points: DailyPoint[]
  from: number
  to: number
  selected: number
  mode: ChartMode
  onHover: (index: number) => void
  benchmarks?: BenchmarkLine[]
  /** How the chart is drawn; changed in the chart's own menu. */
  chartStyle?: ChartStyle
  onStyleChange?: (change: Partial<ChartStyle>) => void
}

interface ChartRefs {
  chart: IChartApi
  main: ISeriesApi<'Area'>
  secondary: ISeriesApi<'Line'>
  benchmarks: ISeriesApi<'Line'>[]
  /** Only in EUR mode; removing it also removes its pane. */
  pnl: ISeriesApi<'Baseline'> | null
  /** The 0 line: on the profit in EUR, on the return in percent; none in EUR without the profit pane. */
  zero: { line: IPriceLine; on: ISeriesApi<'Area'> | ISeriesApi<'Baseline'> } | null
}

function pnlColors({ chart }: ReturnType<typeof useThemeColors>) {
  return {
    topLineColor: chart.positive,
    topFillColor1: `${chart.positive}40`,
    topFillColor2: `${chart.positive}08`,
    bottomLineColor: chart.negative,
    bottomFillColor1: `${chart.negative}08`,
    bottomFillColor2: `${chart.negative}40`,
  }
}

function zeroLine({ chart }: ReturnType<typeof useThemeColors>) {
  return { price: 0, color: chart.zero, lineWidth: 2 as const, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }
}

/** Keeps 0 in view on the profit scale, so the 0 line never sits on the edge or out of sight. */
function withZero(base: () => AutoscaleInfo | null): AutoscaleInfo | null {
  const info = base()
  if (!info?.priceRange) return info
  const { minValue, maxValue } = info.priceRange
  return { ...info, priceRange: { minValue: Math.min(0, minValue), maxValue: Math.max(0, maxValue) } }
}

/** The profit pane: about a quarter of the chart, never smaller than 130px. */
function profitHeight(chartHeight: number): number {
  return Math.max(130, Math.round(chartHeight * 0.28))
}

/** Element full screen where the browser has it (not on iPhone); otherwise the chart fills the window. */
function canFullscreen(element: HTMLElement | null): boolean {
  return Boolean(element?.requestFullscreen && document.fullscreenEnabled)
}

/** The value of a CSS color variable such as `--series-2`; lightweight-charts needs the color itself. */
function cssColor(variable: string | undefined): string {
  return variable ? getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || '#888' : '#888'
}

/** Value and profit over time with a crosshair that follows, and drives, the selected day. */
export function PortfolioChart({
  points,
  from,
  to,
  selected,
  mode,
  onHover,
  benchmarks = [],
  chartStyle = DEFAULT_CHART_STYLE,
  onStyleChange,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const refs = useRef<ChartRefs | null>(null)
  const colors = useThemeColors()
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const benchmarkPoints = useMemo(() => benchmarks.map((b) => b.points), [benchmarks])
  const data = useMemo(() => chartData(points, from, to, mode, benchmarkPoints), [points, from, to, mode, benchmarkPoints])
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover
  const fromRef = useRef(from)
  fromRef.current = from
  const benchmarksRef = useRef(benchmarks)
  benchmarksRef.current = benchmarks
  // The divider between the value and the profit pane: over the plot area only, never over the
  // price axis and its labels. Null without the profit pane.
  const [divider, setDivider] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  // The bar above the chart moves it down: the divider over the panes moves along.
  useEffect(() => {
    requestAnimationFrame(measurePanes)
  }, [styleOpen])

  function measurePanes() {
    const r = refs.current
    const top = r?.pnl ? r.chart.panes()[0]?.getHeight() : undefined
    const element = container.current
    if (!r?.pnl || top === undefined || !element) {
      setDivider(null)
      return
    }
    // Relative to the wrapper: the legend bar above the chart is part of the offset.
    const width = Math.max(0, element.clientWidth - r.pnl.priceScale().width())
    setDivider({ top: element.offsetTop + top, left: element.offsetLeft, width })
  }

  function toggleExpanded() {
    const element = wrapper.current
    if (expanded && !document.fullscreenElement) {
      setExpanded(false)
    } else if (canFullscreen(element)) {
      if (document.fullscreenElement) void document.exitFullscreen()
      // Refused (no user gesture, an iframe without permission): fill the window instead.
      else element?.requestFullscreen().catch(() => setExpanded(true))
    } else {
      setExpanded((value) => !value)
    }
  }
  const toggleRef = useRef(toggleExpanded)
  toggleRef.current = toggleExpanded

  // Full screen as in a video player: the button, F to toggle, Esc to leave.
  useEffect(() => {
    const onChange = () => setExpanded(document.fullscreenElement === wrapper.current && wrapper.current !== null)
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable="true"]')
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) toggleRef.current()
      else if (e.key === 'Escape' && !document.fullscreenElement) setExpanded(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // Create the chart once.
  useEffect(() => {
    if (!container.current) return
    const chart = createChart(container.current, {
      autoSize: true,
      // The app is in English, whatever the browser language.
      localization: { locale: 'en-GB' },
      crosshair: { mode: CrosshairMode.Magnet },
      layout: { fontSize: 13, panes: { enableResize: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
    })
    const main = chart.addSeries(AreaSeries, { lineWidth: 3, priceLineVisible: false })
    // Room under the value for the divider label.
    main.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.12 } })
    const secondary = chart.addSeries(LineSeries, { lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false })
    refs.current = { chart, main, secondary, benchmarks: [], pnl: null, zero: null }
    // A new size (full screen, rotation): refit the days to the width and grow the profit pane along.
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const r = refs.current
            if (r?.pnl) r.chart.panes()[1]?.setHeight(profitHeight(container.current?.clientHeight ?? 0))
            chart.timeScale().fitContent()
            requestAnimationFrame(measurePanes)
          })
    resize?.observe(container.current)

    const handleMove = (param: MouseEventParams<Time>) => {
      if (param.time === undefined || param.logical === undefined) return
      hoverRef.current(fromRef.current + Math.round(param.logical))
    }
    chart.subscribeCrosshairMove(handleMove)
    return () => {
      resize?.disconnect()
      chart.unsubscribeCrosshairMove(handleMove)
      chart.remove()
      refs.current = null
    }
  }, [])

  // Theme colors.
  useEffect(() => {
    const r = refs.current
    if (!r) return
    r.chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: colors.surface },
        textColor: colors.textMuted,
        ...(colors.fontMono ? { fontFamily: colors.fontMono } : {}),
        // The divider is drawn over the plot area; the chart's own 1px separator stays quiet.
        panes: { separatorColor: colors.chart.grid, separatorHoverColor: colors.chart.grid },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.chart.grid } },
    })
    const fill = chartStyle.fill
    r.main.applyOptions({
      lineColor: colors.chart.value,
      topColor: fill ? `${colors.chart.value}40` : 'transparent',
      bottomColor: fill ? `${colors.chart.value}04` : 'transparent',
    })
    r.secondary.applyOptions({ color: colors.chart.invested })
    r.pnl?.applyOptions(pnlColors(colors))
    r.zero?.line.applyOptions(zeroLine(colors))
  }, [colors, chartStyle.fill])

  // Data and mode.
  useEffect(() => {
    const r = refs.current
    if (!r) return
    const percent = mode === 'percent'
    const format = percent ? (v: number) => `${v.toFixed(1)}%` : (v: number) => formatEur(v, true)
    r.chart.applyOptions({ localization: { locale: 'en-GB', priceFormatter: format } })
    r.main.setData(data.main)
    r.secondary.setData(data.secondary)
    r.secondary.applyOptions({ visible: chartStyle.invested })
    // Log only for values: a return in percent goes through 0 and below.
    r.main.priceScale().applyOptions({ mode: chartStyle.log && !percent ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
    // One line per benchmark, in the pane of the value.
    while (r.benchmarks.length > data.benchmarks.length) r.chart.removeSeries(r.benchmarks.pop() as ISeriesApi<'Line'>)
    while (r.benchmarks.length < data.benchmarks.length) {
      r.benchmarks.push(r.chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0))
    }
    r.benchmarks.forEach((line, i) => {
      line.applyOptions({ color: cssColor(benchmarksRef.current[i]?.color) })
      line.setData(data.benchmarks[i] ?? [])
    })
    // The 0 line moves with the pane it belongs to; it is made again below.
    if (r.zero) r.zero.on.removePriceLine(r.zero.line)
    r.zero = null
    const profitPane = !percent && chartStyle.profitPane
    if (!profitPane && r.pnl) {
      r.chart.removeSeries(r.pnl)
      r.pnl = null
    } else if (profitPane) {
      if (!r.pnl) {
        const options = {
          baseValue: { type: 'price' as const, price: 0 },
          lineWidth: 3 as const,
          priceLineVisible: false,
          autoscaleInfoProvider: withZero,
          ...pnlColors(colorsRef.current),
        }
        r.pnl = r.chart.addSeries(BaselineSeries, options, 1)
        r.chart.panes()[1]?.setHeight(profitHeight(container.current?.clientHeight ?? 0))
        // Room above the curve for the pane label, and the 0 line clear of the time axis.
        r.pnl.priceScale().applyOptions({ scaleMargins: { top: 0.25, bottom: 0.1 } })
      }
      r.pnl.setData(data.pnl)
      r.zero = { line: r.pnl.createPriceLine(zeroLine(colorsRef.current)), on: r.pnl }
    }
    if (percent) r.zero = { line: r.main.createPriceLine(zeroLine(colorsRef.current)), on: r.main }
    r.chart.timeScale().fitContent()
    requestAnimationFrame(measurePanes)
  }, [data, mode, colors, chartStyle.invested, chartStyle.log, chartStyle.profitPane])

  // Show the crosshair on the selected day when it is chosen with the slider or date picker.
  useEffect(() => {
    const r = refs.current
    const point = data.main[selected - from]
    if (r && point) r.chart.setCrosshairPosition(point.value, point.time, r.main)
  }, [data, selected, from])

  const point = points[selected]
  const benchmarkLegend = benchmarks.map((b, i) => ({
    label: b.label,
    color: b.color,
    text: mode === 'eur' ? formatEur(b.points[selected]?.value ?? 0) : formatPercent((data.benchmarks[i]?.[selected - from]?.value ?? 0) / 100),
  }))
  return (
    <div ref={wrapper} className={`chart-wrapper${expanded ? ' expanded' : ''}`}>
      <div className="chart-top">
        {point && (
          <div className="chart-legend" aria-live="polite">
            <strong>{formatDate(point.date)}</strong>
            {mode === 'eur' ? (
              <>
                <span>
                  <i className="swatch main" /> Value {formatEur(point.value)}
                </span>
                {chartStyle.invested && (
                  <span>
                    <i className="swatch secondary" /> Invested {formatEur(point.invested)}
                  </span>
                )}
                {benchmarkLegend.map((b) => (
                  <span key={b.label}>
                    <i className="swatch" style={{ background: `var(${b.color})` }} /> {b.label} {b.text}
                  </span>
                ))}
                {chartStyle.profitPane && (
                  <span>
                    <i className="swatch pnl" /> Profit {formatEur(point.pnl)}
                  </span>
                )}
              </>
            ) : (
              <>
                <span>
                  <i className="swatch main" /> Time-weighted {formatPercent((data.main[selected - from]?.value ?? 0) / 100)}
                </span>
                {benchmarkLegend.map((b) => (
                  <span key={b.label}>
                    <i className="swatch" style={{ background: `var(${b.color})` }} /> {b.label} {b.text}
                  </span>
                ))}
                {from === 0 && chartStyle.invested && (
                  <span>
                    <i className="swatch secondary" /> Simple {formatPercent(point.simpleReturn)}
                  </span>
                )}
              </>
            )}
          </div>
        )}
        {onStyleChange && (
          <button
            type="button"
            className="chart-expand chart-style-button"
            aria-expanded={styleOpen}
            aria-label="Chart style"
            title="Chart style and colors"
            onClick={() => setStyleOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
              <circle cx="16" cy="6" r="2" />
              <circle cx="10" cy="12" r="2" />
              <circle cx="18" cy="18" r="2" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="chart-expand"
          onClick={toggleExpanded}
          aria-pressed={expanded}
          aria-label={expanded ? 'Exit full screen' : 'Full screen'}
          title={expanded ? 'Exit full screen (F)' : 'Full screen (F)'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={expanded ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
          </svg>
        </button>
      </div>
      {onStyleChange && styleOpen && (
        <StylePanel chartStyle={chartStyle} percent={mode === 'percent'} onChange={onStyleChange} onClose={() => setStyleOpen(false)} />
      )}
      {mode === 'eur' && divider !== null && (
        <div className="pane-divider" style={{ top: divider.top, left: divider.left, width: divider.width }}>
          <span className="pane-label">Profit / loss</span>
        </div>
      )}
      <div ref={container} className="chart" data-testid="portfolio-chart" />
    </div>
  )
}

/**
 * The ways to draw the chart, in a bar between the legend and the chart: it covers nothing, so every
 * change shows at once. The colors are the app's palette, the same as in Settings.
 */
function StylePanel({
  chartStyle,
  percent,
  onChange,
  onClose,
}: {
  chartStyle: ChartStyle
  percent: boolean
  onChange: (change: Partial<ChartStyle>) => void
  onClose: () => void
}) {
  const [palette, setPalette] = useState<Palette>(readPalette)
  const option = (key: keyof ChartStyle, label: string, eurOnly = false) => (
    <button
      type="button"
      className="chip"
      aria-pressed={chartStyle[key]}
      disabled={eurOnly && percent}
      title={eurOnly && percent ? 'Only in EUR' : undefined}
      onClick={() => onChange({ [key]: !chartStyle[key] })}
    >
      {label}
    </button>
  )
  return (
    <div className="chart-style-panel" role="group" aria-label="Chart style">
      <div className="chart-style-row">
        <span className="label-caps">Show</span>
        <div className="chips">
          {option('fill', 'Fill under the value')}
          {option('invested', percent ? 'Simple return' : 'Invested capital')}
          {option('profitPane', 'Profit / loss pane', true)}
          {option('log', 'Logarithmic scale', true)}
        </div>
      </div>
      <div className="chart-style-row">
        <span className="label-caps">Colors</span>
        <div className="chips" role="radiogroup" aria-label="Colors">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              className="chip"
              aria-checked={palette === p.id}
              aria-pressed={palette === p.id}
              title={p.description}
              onClick={() => {
                storePalette(p.id)
                setPalette(p.id)
              }}
            >
              <span className="palette-swatches" aria-hidden="true">
                {p.swatches.slice(0, 3).map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="chart-style-close" onClick={onClose}>
        Done
      </button>
    </div>
  )
}
