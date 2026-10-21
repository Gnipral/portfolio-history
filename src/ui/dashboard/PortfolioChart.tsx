import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BenchmarkLine } from './benchmarkLines.ts'
import type { DailyPoint } from '../../engine/series.ts'
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
}

interface ChartRefs {
  chart: IChartApi
  main: ISeriesApi<'Area'>
  secondary: ISeriesApi<'Line'>
  benchmarks: ISeriesApi<'Line'>[]
  /** Only in EUR mode; removing it also removes its pane. */
  pnl: ISeriesApi<'Baseline'> | null
  /** The 0 line: on the profit in EUR, on the return in percent. */
  zero: IPriceLine | null
}

/** Space between the top of the chart wrapper and the chart itself (its padding). */
const WRAPPER_PADDING = 12

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
  return { price: 0, color: chart.zero, lineWidth: 1 as const, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }
}

/** The value of a CSS color variable such as `--series-2`; lightweight-charts needs the color itself. */
function cssColor(variable: string | undefined): string {
  return variable ? getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || '#888' : '#888'
}

/** Value and profit over time with a crosshair that follows, and drives, the selected day. */
export function PortfolioChart({ points, from, to, selected, mode, onHover, benchmarks = [] }: Props) {
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
  // Where the profit pane starts, for its label; null without that pane.
  const [profitTop, setProfitTop] = useState<number | null>(null)

  function measurePanes() {
    const r = refs.current
    const top = r?.pnl ? r.chart.panes()[0]?.getHeight() : undefined
    setProfitTop(top === undefined ? null : WRAPPER_PADDING + top + 6)
  }

  // Create the chart once.
  useEffect(() => {
    if (!container.current) return
    const chart = createChart(container.current, {
      autoSize: true,
      // The app is in English, whatever the browser language.
      localization: { locale: 'en-GB' },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
    })
    const main = chart.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false })
    const secondary = chart.addSeries(LineSeries, { lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false })
    refs.current = { chart, main, secondary, benchmarks: [], pnl: null, zero: null }
    // Pane heights follow the size of the chart.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measurePanes())
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
        panes: { separatorColor: colors.chart.separator, separatorHoverColor: colors.chart.separator },
      },
      grid: { vertLines: { visible: false }, horzLines: { color: colors.chart.grid } },
    })
    r.main.applyOptions({ lineColor: colors.chart.value, topColor: `${colors.chart.value}40`, bottomColor: `${colors.chart.value}04` })
    r.secondary.applyOptions({ color: colors.chart.invested })
    r.pnl?.applyOptions(pnlColors(colors))
    r.zero?.applyOptions(zeroLine(colors))
  }, [colors])

  // Data and mode.
  useEffect(() => {
    const r = refs.current
    if (!r) return
    const percent = mode === 'percent'
    const format = percent ? (v: number) => `${v.toFixed(1)}%` : (v: number) => formatEur(v, true)
    r.chart.applyOptions({ localization: { locale: 'en-GB', priceFormatter: format } })
    r.main.setData(data.main)
    r.secondary.setData(data.secondary)
    // One line per benchmark, in the pane of the value.
    while (r.benchmarks.length > data.benchmarks.length) r.chart.removeSeries(r.benchmarks.pop() as ISeriesApi<'Line'>)
    while (r.benchmarks.length < data.benchmarks.length) {
      r.benchmarks.push(r.chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 0))
    }
    r.benchmarks.forEach((line, i) => {
      line.applyOptions({ color: cssColor(benchmarksRef.current[i]?.color) })
      line.setData(data.benchmarks[i] ?? [])
    })
    if (percent && r.pnl) {
      r.chart.removeSeries(r.pnl)
      r.pnl = null
      r.zero = r.main.createPriceLine(zeroLine(colorsRef.current))
    } else if (!percent) {
      if (!r.pnl) {
        if (r.zero) r.main.removePriceLine(r.zero)
        const options = { baseValue: { type: 'price' as const, price: 0 }, lineWidth: 2 as const, priceLineVisible: false, ...pnlColors(colorsRef.current) }
        r.pnl = r.chart.addSeries(BaselineSeries, options, 1)
        r.chart.panes()[1]?.setHeight(120)
        // Room above the curve for the pane label, and the 0 line clear of the time axis.
        r.pnl.priceScale().applyOptions({ scaleMargins: { top: 0.25, bottom: 0.1 } })
        r.zero = r.pnl.createPriceLine(zeroLine(colorsRef.current))
      }
      r.pnl.setData(data.pnl)
    }
    if (percent && !r.zero) r.zero = r.main.createPriceLine(zeroLine(colorsRef.current))
    r.chart.timeScale().fitContent()
    requestAnimationFrame(measurePanes)
  }, [data, mode, colors])

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
    <div className="chart-wrapper">
      {point && (
        <div className="chart-legend" aria-live="polite">
          <strong>{formatDate(point.date)}</strong>
          {mode === 'eur' ? (
            <>
              <span>
                <i className="swatch main" /> Value {formatEur(point.value)}
              </span>
              <span>
                <i className="swatch secondary" /> Invested {formatEur(point.invested)}
              </span>
              {benchmarkLegend.map((b) => (
                <span key={b.label}>
                  <i className="swatch" style={{ background: `var(${b.color})` }} /> {b.label} {b.text}
                </span>
              ))}
              <span>
                <i className="swatch pnl" /> Profit {formatEur(point.pnl)}
              </span>
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
              {from === 0 && (
                <span>
                  <i className="swatch secondary" /> Simple {formatPercent(point.simpleReturn)}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {mode === 'eur' && profitTop !== null && (
        <span className="pane-label" style={{ top: profitTop }}>
          Profit / loss
        </span>
      )}
      <div ref={container} className="chart" data-testid="portfolio-chart" />
    </div>
  )
}
