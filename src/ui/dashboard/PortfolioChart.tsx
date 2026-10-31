import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BenchmarkLine } from './benchmarkLines.ts'
import type { DailyPoint } from '../../engine/series.ts'
import { DEFAULT_CHART_STYLE, type ChartStyle } from '../../settings/settings.ts'
import { usePalette } from '../usePalette.ts'
import { locale, t } from '../../i18n/i18n.ts'
import { formatEur } from '../format.ts'
import { chartData, type ChartMode } from './chartData.ts'
import { ZOOM_OPTIONS, ZOOM_TIME_SCALE } from './chartZoom.ts'
import { benchmarkPattern } from './benchmarkPatterns.ts'
import type { DayMarker, MarkerKind } from './markers.ts'
import { windowFromRange, type DayWindow } from './timeline.ts'
import { fullHex, useThemeColors, type ThemeColors } from './useThemeColors.ts'

interface Props {
  points: DailyPoint[]
  /** The days of the period: what the chart shows, as indices into `points`. */
  window: DayWindow
  /** The day the labels and the crosshair are on: under the pointer, or the playhead. */
  inspected: number
  mode: ChartMode
  benchmarks?: BenchmarkLine[]
  chartStyle?: ChartStyle
  markers?: DayMarker[]
  /** The day under the pointer; null when the pointer leaves the chart. */
  onHover: (index: number | null) => void
  /** A click on the chart or one of its markers: that day becomes the playhead. */
  onPick?: (index: number) => void
  /** Zoomed or moved with the wheel, two fingers or a drag: the new window. */
  onZoom?: (window: DayWindow) => void
}

/** A name and value next to a line, at the inspected day. */
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

/** About the width of a label in the small monospace font, with its padding and gap to the point. */
function labelWidth(text: string): number {
  return text.length * 7.5 + 24
}

/**
 * Keeps every label at the height of its own point. Labels go right of the point (left near the right edge);
 * one that would cover another on that side goes to the other side, and only when both sides are taken is it
 * moved down, as little as needed.
 */
export function spreadLabels(labels: PointLabel[], preferLeft = false, room?: { left: number; right: number }): PointLabel[] {
  const out: PointLabel[] = []
  for (const pane of [0, 1] as const) {
    const placed: { y: number; flip: boolean }[] = []
    const free = (y: number, flip: boolean) => placed.every((p) => p.flip !== flip || Math.abs(p.y - y) >= LABEL_HEIGHT)
    for (const label of labels.filter((l) => l.pane === pane).sort((a, b) => a.y - b.y)) {
      let y = label.y
      let flip = preferLeft
      // The other side only when the label fits there; on a narrow chart it would stick out of it.
      const fits = (side: boolean) => !room || (side ? room.left : room.right) >= labelWidth(label.text)
      if (!free(y, flip) && fits(!flip)) flip = !flip
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
  markers: ISeriesMarkersPluginApi<Time> | null
  /** Only in EUR mode; removing it also removes its pane. */
  pnl: ISeriesApi<'Baseline'> | null
  /** The 0 line: on the profit in EUR, on the return in percent; none in EUR without the profit pane. */
  zero: { line: IPriceLine; on: ISeriesApi<'Area'> | ISeriesApi<'Baseline'> } | null
}

function pnlColors({ chart }: ThemeColors) {
  return {
    topLineColor: chart.positive,
    topFillColor1: `${chart.positive}40`,
    topFillColor2: `${chart.positive}08`,
    bottomLineColor: chart.negative,
    bottomFillColor1: `${chart.negative}08`,
    bottomFillColor2: `${chart.negative}40`,
  }
}

/** The 0 line, without a box on the axis: a dark "0" there moved with the scale and looked like a stray label. */
function zeroLine({ chart }: ThemeColors) {
  return { price: 0, color: chart.zero, lineWidth: 1 as const, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: '' }
}

/** Keeps 0 in view on the profit scale, so the 0 line never sits on the edge or out of sight. */
function withZero(base: () => AutoscaleInfo | null): AutoscaleInfo | null {
  const info = base()
  if (!info?.priceRange) return info
  const { minValue, maxValue } = info.priceRange
  return { ...info, priceRange: { minValue: Math.min(0, minValue), maxValue: Math.max(0, maxValue) } }
}

/** The profit pane: about a quarter of the chart, never smaller than 110px. */
function profitHeight(chartHeight: number): number {
  return Math.max(110, Math.round(chartHeight * 0.26))
}

/**
 * The value of a CSS colour variable such as `--series-2` as the chart sees it (with the palette of
 * its block); lightweight-charts needs the colour itself.
 */
function cssColor(variable: string | undefined, element: Element | null): string {
  return variable ? fullHex(getComputedStyle(element ?? document.documentElement).getPropertyValue(variable).trim()) || '#888' : '#888'
}

/** How each kind of day is marked: deposits and sales in the text colour, buys and dividends muted. */
const MARKER_STYLE: Record<MarkerKind, { shape: SeriesMarker<Time>['shape']; position: 'belowBar' | 'aboveBar'; muted: boolean }> = {
  deposit: { shape: 'square', position: 'belowBar', muted: false },
  buy: { shape: 'arrowUp', position: 'belowBar', muted: true },
  sell: { shape: 'arrowDown', position: 'aboveBar', muted: false },
  dividend: { shape: 'circle', position: 'aboveBar', muted: true },
}

function seriesMarkers(markers: DayMarker[], colors: ThemeColors): SeriesMarker<Time>[] {
  return markers.flatMap((day) =>
    day.kinds.map((kind) => {
      const style = MARKER_STYLE[kind]
      return { time: day.date, position: style.position, shape: style.shape, color: style.muted ? colors.textMuted : colors.text, size: 0.4, id: `${day.date}:${kind}` }
    }),
  )
}

/** Value and profit over the period, with markers for the transactions; hover inspects a day, a click pins it. */
export function PortfolioChart({ points, window, inspected, mode, benchmarks = [], chartStyle = DEFAULT_CHART_STYLE, markers = [], onHover, onPick, onZoom }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const refs = useRef<ChartRefs | null>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const palette = usePalette()
  const colors = useThemeColors(wrapper, palette)
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const count = points.length
  const benchmarkPoints = useMemo(() => benchmarks.map((b) => b.points), [benchmarks])
  // In percent the lines start at 0 on the first day of the window; in the currency they do not depend on it.
  const base = mode === 'percent' ? window.from : 0
  const data = useMemo(() => chartData(points, 0, count - 1, mode, benchmarkPoints, base), [points, count, mode, benchmarkPoints, base])
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const zoomRef = useRef(onZoom)
  zoomRef.current = onZoom
  const countRef = useRef(count)
  countRef.current = count
  const benchmarksRef = useRef(benchmarks)
  benchmarksRef.current = benchmarks
  // The window last set from outside: a range change that matches it is ours, not a zoom by the user.
  const requested = useRef<DayWindow | null>(null)
  // The divider between the value and the profit pane: over the plot area only, never over the
  // price axis and its labels. Null without the profit pane.
  const [divider, setDivider] = useState<{ top: number; left: number; width: number } | null>(null)

  function measurePanes() {
    const r = refs.current
    const top = r?.pnl ? r.chart.panes()[0]?.getHeight() : undefined
    const element = container.current
    if (!r?.pnl || top === undefined || !element) {
      setDivider(null)
      return
    }
    // Relative to the wrapper: anything above the chart is part of the offset.
    const width = Math.max(0, element.clientWidth - r.pnl.priceScale().width())
    setDivider({ top: element.offsetTop + top, left: element.offsetLeft, width })
  }

  function showWindow() {
    const r = refs.current
    const w = requested.current
    if (!r || !w) return
    r.chart.timeScale().setVisibleLogicalRange({ from: w.from, to: w.to })
  }

  // Create the chart once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chart is created once; measurePanes and showWindow only read refs
  useEffect(() => {
    if (!container.current) return
    const chart = createChart(container.current, {
      autoSize: true,
      // The app is in English, whatever the browser language.
      localization: { locale: locale() },
      // Only the vertical line, with the date on the time axis: the values stand next to the points.
      crosshair: { mode: CrosshairMode.Magnet, horzLine: { visible: false, labelVisible: false } },
      // The TradingView credit is at the bottom of Settings; in the chart it sat over the profit line.
      layout: { fontSize: 11, attributionLogo: false, panes: { enableResize: false } },
      rightPriceScale: { borderVisible: false },
      // A small least bar spacing, so years of days still fit the width in one window.
      timeScale: { borderVisible: false, minBarSpacing: 0.05, ...ZOOM_TIME_SCALE },
      ...ZOOM_OPTIONS,
    })
    // No labels of the last value on the axis: the point labels next to the lines show the inspected day.
    const main = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
    main.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.12 } })
    const secondary = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
    refs.current = { chart, main, secondary, benchmarks: [], markers: null, pnl: null, zero: null }
    // A new size (full screen, the side panel): keep the window and grow the profit pane along.
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const r = refs.current
            if (r?.pnl) r.chart.panes()[1]?.setHeight(profitHeight(container.current?.clientHeight ?? 0))
            showWindow()
            requestAnimationFrame(measurePanes)
            requestAnimationFrame(() => placeLabels.current())
          })
    resize?.observe(container.current)

    const last = () => Math.max(0, countRef.current - 1)
    const handleMove = (param: MouseEventParams<Time>) => {
      // Setting the crosshair to the playhead also reports a move to a point, without a pointer behind it:
      // that is not a hover, or the inspected day would stick there and stop following the timeline.
      // Leaving the chart comes without a point, and does clear the hover.
      if (param.point && !param.sourceEvent) return
      if (!param.point || param.logical === undefined) {
        hoverRef.current(null)
        return
      }
      hoverRef.current(Math.min(last(), Math.max(0, Math.round(param.logical))))
    }
    chart.subscribeCrosshairMove(handleMove)
    const handleClick = (param: MouseEventParams<Time>) => {
      if (param.logical === undefined) return
      pickRef.current?.(Math.min(last(), Math.max(0, Math.round(param.logical))))
    }
    chart.subscribeClick(handleClick)
    // A zoom or drag by the user moves the window of the period. Only right after a wheel, a drag or a touch:
    // the chart also moves its range by itself, when it gets new data or a new size.
    let gestureAt = 0
    const gesture = (event: Event) => {
      if (event.type !== 'pointermove' || (event as PointerEvent).buttons > 0) gestureAt = Date.now()
    }
    const element = container.current
    for (const type of ['wheel', 'pointerdown', 'pointermove', 'touchmove'] as const) element.addEventListener(type, gesture, { capture: true, passive: true })
    let zoomTimer: ReturnType<typeof setTimeout> | undefined
    const handleRange = (range: LogicalRange | null) => {
      requestAnimationFrame(() => placeLabels.current())
      const w = requested.current
      if (!range || !w || Date.now() - gestureAt > 400) return
      if (Math.abs(range.from - w.from) < 0.75 && Math.abs(range.to - w.to) < 0.75) return
      clearTimeout(zoomTimer)
      zoomTimer = setTimeout(() => {
        const next = windowFromRange(range.from, range.to, countRef.current)
        requested.current = next
        zoomRef.current?.(next)
      }, 150)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRange)
    return () => {
      clearTimeout(zoomTimer)
      for (const type of ['wheel', 'pointerdown', 'pointermove', 'touchmove'] as const) element.removeEventListener(type, gesture, { capture: true })
      resize?.disconnect()
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRange)
      chart.unsubscribeClick(handleClick)
      chart.unsubscribeCrosshairMove(handleMove)
      chart.remove()
      refs.current = null
    }
  }, [])

  // Theme colours.
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
      crosshair: { vertLine: { color: colors.textMuted, labelBackgroundColor: colors.text, style: LineStyle.Dashed, width: 1 } },
    })
    const fill = chartStyle.fill
    r.main.applyOptions({
      lineColor: colors.chart.value,
      topColor: fill ? `${colors.chart.value}26` : 'transparent',
      bottomColor: fill ? `${colors.chart.value}03` : 'transparent',
    })
    r.secondary.applyOptions({ color: colors.chart.invested })
    r.pnl?.applyOptions(pnlColors(colors))
    r.zero?.line.applyOptions(zeroLine(colors))
  }, [colors, chartStyle.fill])

  // Data and mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: colours restyle the series, which is redone here; measurePanes and showWindow only read refs
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
          lineWidth: 2 as const,
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
    showWindow()
    requestAnimationFrame(measurePanes)
  }, [data, mode, colors, chartStyle.invested, chartStyle.log, chartStyle.profitPane])

  // The markers of the transactions, on the value line.
  useEffect(() => {
    const r = refs.current
    if (!r) return
    const list = seriesMarkers(markers, colors)
    if (r.markers) r.markers.setMarkers(list)
    else r.markers = createSeriesMarkers(r.main, list)
  }, [markers, colors])

  // The window of the period, set with the timeline or a quick range.
  // biome-ignore lint/correctness/useExhaustiveDependencies: showWindow only reads refs
  useEffect(() => {
    requested.current = { from: window.from, to: window.to }
    showWindow()
  }, [window.from, window.to])

  // The crosshair on the inspected day when it is chosen with the timeline or the keyboard.
  useEffect(() => {
    const r = refs.current
    const point = data.main[inspected]
    if (r && point) r.chart.setCrosshairPosition(point.value, point.time, r.main)
  }, [data, inspected])

  // Next to each line, at the inspected day: its name and value, so the figures move along with the point.
  // Placed from the chart's own coordinates, again whenever they change.
  const [pointLabels, setPointLabels] = useState<PointLabel[]>([])
  const placeLabels = useRef<() => void>(() => {})
  placeLabels.current = () => {
    const r = refs.current
    const element = container.current
    const time = data.main[inspected]?.time
    const x = r && element && time !== undefined ? r.chart.timeScale().timeToCoordinate(time) : null
    if (!r || !element || x === null) {
      setPointLabels([])
      return
    }
    const i = inspected
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
    const plot = element.clientWidth - r.main.priceScale().width()
    if (x < 0 || x > plot) {
      setPointLabels([])
      return
    }
    setPointLabels(spreadLabels(labels, x > plot * 0.62, { left: x, right: plot - x }).map((l) => ({ ...l, x, left: element.offsetLeft, top: element.offsetTop })))
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed again when anything that moves the lines changes
  useEffect(() => {
    // After the chart has drawn the new data: its coordinates are ready on the next frame.
    const frame = requestAnimationFrame(() => placeLabels.current())
    return () => cancelAnimationFrame(frame)
  }, [data, inspected, window.from, window.to, mode, colors, chartStyle.invested, chartStyle.profitPane, chartStyle.log])

  return (
    <div ref={wrapper} className="chart-wrapper">
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
