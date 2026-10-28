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
  type LogicalRange,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BenchmarkLine } from './benchmarkLines.ts'
import type { DailyPoint } from '../../engine/series.ts'
import { DEFAULT_CHART_STYLE, type ChartStyle } from '../../settings/settings.ts'
import { PALETTES, storePalette } from '../../theme/theme.ts'
import { usePalette } from '../usePalette.ts'
import { locale, t } from '../../i18n/i18n.ts'
import { displayCurrency, formatDate, formatEur, formatPercent } from '../format.ts'
import { chartData, type ChartMode } from './chartData.ts'
import { ZOOM_OPTIONS, ZOOM_TIME_SCALE } from './chartZoom.ts'
import { fullHex, useThemeColors } from './useThemeColors.ts'

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

/** A name and value next to a line, at the selected day. */
interface PointLabel {
  key: string
  /** Pixels from the top of the chart. */
  y: number
  pane: 0 | 1
  color: string
  text: string
  x?: number
  left?: number
  top?: number
  /** Left of the point instead of right of it. */
  flip?: boolean
}

/** Height a label needs, so two lines close together get labels that do not cover each other. */
const LABEL_HEIGHT = 20

/**
 * Keeps every label at the height of its own point. Labels go right of the point (left near the right edge);
 * one that would cover another on that side goes to the other side, and only when both sides are taken is it
 * moved down, as little as needed.
 */
export function spreadLabels(labels: PointLabel[], preferLeft = false): PointLabel[] {
  const out: PointLabel[] = []
  for (const pane of [0, 1] as const) {
    const placed: { y: number; flip: boolean }[] = []
    const free = (y: number, flip: boolean) => placed.every((p) => p.flip !== flip || Math.abs(p.y - y) >= LABEL_HEIGHT)
    for (const label of labels.filter((l) => l.pane === pane).sort((a, b) => a.y - b.y)) {
      let y = label.y
      let flip = preferLeft
      if (!free(y, flip)) flip = !flip
      if (!free(y, flip)) {
        flip = preferLeft
        while (!free(y, flip)) y += 1
      }
      placed.push({ y, flip })
      out.push({ ...label, y, flip })
    }
  }
  return out
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

/**
 * Every benchmark line has its own pattern besides its color, and its name on the price axis, so
 * the lines can be told apart without seeing colors. `css` draws the same pattern in the legend.
 */
const BENCHMARK_PATTERNS = [
  { lineStyle: LineStyle.LargeDashed, lineWidth: 2, css: 'repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 9px)' },
  { lineStyle: LineStyle.Dotted, lineWidth: 2, css: 'repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 4px)' },
  { lineStyle: LineStyle.SparseDotted, lineWidth: 2, css: 'repeating-linear-gradient(90deg, currentColor 0 2px, transparent 2px 6px)' },
  { lineStyle: LineStyle.Solid, lineWidth: 1, css: 'linear-gradient(currentColor, currentColor) center / 100% 2px no-repeat' },
] as const

function benchmarkPattern(index: number) {
  return BENCHMARK_PATTERNS[index % BENCHMARK_PATTERNS.length]!
}

/** The profit pane: about a quarter of the chart, never smaller than 130px. */
function profitHeight(chartHeight: number): number {
  return Math.max(130, Math.round(chartHeight * 0.28))
}

/** Element full screen where the browser has it (not on iPhone); otherwise the chart fills the window. */
function canFullscreen(element: HTMLElement | null): boolean {
  return Boolean(element?.requestFullscreen && document.fullscreenEnabled)
}

/**
 * The value of a CSS color variable such as `--series-2` as the chart sees it (with the palette of
 * its block); lightweight-charts needs the color itself.
 */
function cssColor(variable: string | undefined, element: Element | null): string {
  return variable ? fullHex(getComputedStyle(element ?? document.documentElement).getPropertyValue(variable).trim()) || '#888' : '#888'
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
  const wrapper = useRef<HTMLDivElement>(null)
  const palette = usePalette()
  const colors = useThemeColors(wrapper, palette)
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
  const [expanded, setExpanded] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  // The bar above the chart moves it down: the divider over the panes moves along.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening the style bar moves the panes, so they are measured again; measurePanes only reads refs
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chart is created once; measurePanes only reads refs
  useEffect(() => {
    if (!container.current) return
    const chart = createChart(container.current, {
      autoSize: true,
      // The app is in English, whatever the browser language.
      localization: { locale: locale() },
      // Only the vertical line: the values stand next to the points, a horizontal line and price box would repeat them.
      crosshair: { mode: CrosshairMode.Magnet, horzLine: { visible: false, labelVisible: false } },
      layout: { fontSize: 13, panes: { enableResize: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, ...ZOOM_TIME_SCALE },
      ...ZOOM_OPTIONS,
    })
    // No labels of the last value on the axis: the point labels next to the lines show the selected day.
    const main = chart.addSeries(AreaSeries, { lineWidth: 3, priceLineVisible: false, lastValueVisible: false })
    // Room under the value for the divider label.
    main.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.12 } })
    const secondary = chart.addSeries(LineSeries, { lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
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
            requestAnimationFrame(() => placeLabels.current())
          })
    resize?.observe(container.current)

    const handleMove = (param: MouseEventParams<Time>) => {
      if (param.time === undefined || param.logical === undefined) return
      hoverRef.current(fromRef.current + Math.round(param.logical))
    }
    chart.subscribeCrosshairMove(handleMove)
    // Zoomed in when fewer days show than there are: then a button brings everything back.
    const handleRange = (range: LogicalRange | null) => {
      const days = refs.current?.main.data().length ?? 0
      setZoomed(range !== null && days > 1 && (range.from > 0.5 || range.to < days - 1.5))
      requestAnimationFrame(() => placeLabels.current())
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRange)
    return () => {
      resize?.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRange)
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
      crosshair: { vertLine: { color: colors.textMuted, labelBackgroundColor: colors.chart.value } },
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: colors restyle the series, which is redone here; measurePanes only reads refs
  useEffect(() => {
    const r = refs.current
    if (!r) return
    const percent = mode === 'percent'
    const format = percent ? (v: number) => `${v.toFixed(1)}%` : (v: number) => formatEur(v, true)
    r.chart.applyOptions({ localization: { locale: locale(), priceFormatter: format } })
    r.main.setData(data.main)
    r.secondary.setData(data.secondary)
    r.secondary.applyOptions({ visible: chartStyle.invested })
    // Log only for values: a return in percent goes through 0 and below.
    r.main.priceScale().applyOptions({ mode: chartStyle.log && !percent ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
    // One line per benchmark, in the pane of the value.
    while (r.benchmarks.length > data.benchmarks.length) r.chart.removeSeries(r.benchmarks.pop() as ISeriesApi<'Line'>)
    while (r.benchmarks.length < data.benchmarks.length) {
      const { lineStyle, lineWidth } = benchmarkPattern(r.benchmarks.length)
      r.benchmarks.push(r.chart.addSeries(LineSeries, { lineWidth, lineStyle, priceLineVisible: false, lastValueVisible: false }, 0))
    }
    r.benchmarks.forEach((line, i) => {
      line.applyOptions({ color: cssColor(benchmarksRef.current[i]?.color, wrapper.current) })
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
          lastValueVisible: false,
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

  // Next to each line, at the day under the pointer (the last day without one): its name and value, so the
  // figures move along with the point. Placed from the chart's own coordinates, again whenever they change.
  const [pointLabels, setPointLabels] = useState<PointLabel[]>([])
  const placeLabels = useRef<() => void>(() => {})
  placeLabels.current = () => {
    const r = refs.current
    const element = container.current
    const time = data.main[selected - from]?.time
    const x = r && element && time !== undefined ? r.chart.timeScale().timeToCoordinate(time) : null
    if (!r || !element || x === null) {
      setPointLabels([])
      return
    }
    const i = selected - from
    const format = mode === 'percent' ? (v: number) => `${v.toFixed(1)}%` : (v: number) => formatEur(v, true)
    // The profit pane sits under the value pane and the 1px separator between them.
    const profitTop = (r.chart.panes()[0]?.getHeight() ?? 0) + 1
    const labels: PointLabel[] = []
    const add = (series: ISeriesApi<'Area'> | ISeriesApi<'Line'> | ISeriesApi<'Baseline'>, value: number | undefined, color: string, name: string, pane: 0 | 1) => {
      if (value === undefined) return
      const y = series.priceToCoordinate(value)
      if (y === null) return
      labels.push({ key: `${pane}:${name}`, y: (pane === 1 ? profitTop : 0) + y, pane, color, text: `${name} ${format(value)}` })
    }
    add(r.main, data.main[i]?.value, colors.chart.value, t('Value'), 0)
    if (chartStyle.invested && mode === 'eur') add(r.secondary, data.secondary[i]?.value, colors.chart.invested, t('Invested'), 0)
    r.benchmarks.forEach((line, k) => {
      add(line, data.benchmarks[k]?.[i]?.value, cssColor(benchmarksRef.current[k]?.color, wrapper.current), benchmarksRef.current[k]?.label ?? '', 0)
    })
    if (r.pnl) {
      const profit = data.pnl[i]?.value
      add(r.pnl, profit, (profit ?? 0) < 0 ? colors.chart.negative : colors.chart.positive, t('Profit'), 1)
    }
    setPointLabels(spreadLabels(labels, x > element.clientWidth * 0.62).map((l) => ({ ...l, x, left: element.offsetLeft, top: element.offsetTop })))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed again when anything that moves the lines changes
  useEffect(() => {
    // After the chart has drawn the new data: its coordinates are ready on the next frame.
    const frame = requestAnimationFrame(() => placeLabels.current())
    return () => cancelAnimationFrame(frame)
  }, [data, selected, from, mode, colors, chartStyle.invested, chartStyle.profitPane, chartStyle.log, expanded])

  const point = points[selected]
  const benchmarkLegend = benchmarks.map((b, i) => ({
    label: b.label,
    color: b.color,
    pattern: benchmarkPattern(i).css,
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
                  <i className="swatch main" /> {t('Value')} {formatEur(point.value)}
                </span>
                {chartStyle.invested && (
                  <span>
                    <i className="swatch secondary" /> {t('Invested')} {formatEur(point.invested)}
                  </span>
                )}
                {benchmarkLegend.map((b) => (
                  <span key={b.label}>
                    <i className="swatch" style={{ color: `var(${b.color})`, background: b.pattern }} /> {b.label} {b.text}
                  </span>
                ))}
                {chartStyle.profitPane && (
                  <span>
                    <i className="swatch pnl" /> {t('Profit')} {formatEur(point.pnl)}
                  </span>
                )}
              </>
            ) : (
              <>
                <span>
                  <i className="swatch main" /> {t('Time-weighted')} {formatPercent((data.main[selected - from]?.value ?? 0) / 100)}
                </span>
                {benchmarkLegend.map((b) => (
                  <span key={b.label}>
                    <i className="swatch" style={{ color: `var(${b.color})`, background: b.pattern }} /> {b.label} {b.text}
                  </span>
                ))}
              </>
            )}
          </div>
        )}
        {zoomed && (
          <button type="button" className="chart-zoom-reset" onClick={() => refs.current?.chart.timeScale().fitContent()}>
            {t('Show everything')}
          </button>
        )}
        {onStyleChange && (
          <button
            type="button"
            className="chart-expand chart-style-button"
            aria-expanded={styleOpen}
            aria-label={t('Chart style')}
            title={t('Chart style and colors')}
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
          aria-label={expanded ? t('Exit full screen') : t('Full screen')}
          title={expanded ? t('Exit full screen (F)') : t('Full screen (F)')}
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
          <span className="pane-label">{t('Profit / loss')}</span>
        </div>
      )}
      <div ref={container} className="chart" data-testid="portfolio-chart" />
      {pointLabels.map((label) => (
        <span
          key={label.key}
          className={`point-label${label.flip ? ' flip' : ''}`}
          style={{ left: (label.left ?? 0) + (label.x ?? 0), top: (label.top ?? 0) + label.y, background: label.color }}
          aria-hidden="true"
        >
          {label.text}
        </span>
      ))}
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
  const palette = usePalette()
  const option = (key: keyof ChartStyle, label: string, eurOnly = false) => (
    <button
      type="button"
      className="chip"
      aria-pressed={chartStyle[key]}
      disabled={eurOnly && percent}
      title={eurOnly && percent ? t('Only in {currency}', { currency: displayCurrency() }) : undefined}
      onClick={() => onChange({ [key]: !chartStyle[key] })}
    >
      {label}
    </button>
  )
  return (
    <div className="chart-style-panel" role="group" aria-label={t('Chart style')}>
      <div className="chart-style-row">
        <span className="label-caps">{t('Show')}</span>
        <div className="chips">
          {option('fill', t('Fill under the value'))}
          {option('invested', t('Invested capital'), true)}
          {option('profitPane', t('Profit / loss pane'), true)}
          {option('log', t('Logarithmic scale'), true)}
        </div>
      </div>
      <div className="chart-style-row">
        <span className="label-caps">{t('Colors')}</span>
        <div className="chips" role="radiogroup" aria-label={t('Colors')}>
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              className="chip"
              aria-checked={palette === p.id}
              aria-pressed={palette === p.id}
              title={t(p.description)}
              onClick={() => {
                storePalette(p.id)
              }}
            >
              <span className="palette-swatches" aria-hidden="true">
                {p.swatches.slice(0, 3).map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
              {t(p.label)}
            </button>
          ))}
        </div>
      </div>
      <button type="button" className="chart-style-close" onClick={onClose}>
        {t('Done')}
      </button>
    </div>
  )
}
