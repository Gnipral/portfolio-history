import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef } from 'react'
import type { BenchmarkPoint } from '../../engine/benchmark.ts'
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
  benchmark?: { label: string; points: BenchmarkPoint[] }
}

interface ChartRefs {
  chart: IChartApi
  main: ISeriesApi<'Area'>
  secondary: ISeriesApi<'Line'>
  benchmark: ISeriesApi<'Line'>
  /** Only in EUR mode; removing it also removes its pane. */
  pnl: ISeriesApi<'Baseline'> | null
}

function pnlColors(colors: ReturnType<typeof useThemeColors>) {
  return {
    topLineColor: colors.positive,
    topFillColor1: `${colors.positive}44`,
    topFillColor2: `${colors.positive}05`,
    bottomLineColor: colors.negative,
    bottomFillColor1: `${colors.negative}05`,
    bottomFillColor2: `${colors.negative}44`,
  }
}

/** Value and profit over time with a crosshair that follows, and drives, the selected day. */
export function PortfolioChart({ points, from, to, selected, mode, onHover, benchmark }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const refs = useRef<ChartRefs | null>(null)
  const colors = useThemeColors()
  const colorsRef = useRef(colors)
  colorsRef.current = colors
  const benchmarkPoints = benchmark?.points
  const data = useMemo(() => chartData(points, from, to, mode, benchmarkPoints), [points, from, to, mode, benchmarkPoints])
  const hoverRef = useRef(onHover)
  hoverRef.current = onHover
  const fromRef = useRef(from)
  fromRef.current = from

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
    const secondary = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false })
    const benchmarkLine = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false })
    refs.current = { chart, main, secondary, benchmark: benchmarkLine, pnl: null }

    const handleMove = (param: MouseEventParams<Time>) => {
      if (param.time === undefined || param.logical === undefined) return
      hoverRef.current(fromRef.current + Math.round(param.logical))
    }
    chart.subscribeCrosshairMove(handleMove)
    return () => {
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
      layout: { background: { type: ColorType.Solid, color: colors.surface }, textColor: colors.textMuted },
      grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
    })
    r.main.applyOptions({ lineColor: colors.accent, topColor: `${colors.accent}55`, bottomColor: `${colors.accent}05` })
    r.secondary.applyOptions({ color: colors.textMuted })
    r.benchmark.applyOptions({ color: colors.benchmark })
    r.pnl?.applyOptions(pnlColors(colors))
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
    r.benchmark.setData(data.benchmark)
    if (percent && r.pnl) {
      r.chart.removeSeries(r.pnl)
      r.pnl = null
    } else if (!percent) {
      if (!r.pnl) {
        const options = { baseValue: { type: 'price' as const, price: 0 }, priceLineVisible: false, ...pnlColors(colorsRef.current) }
        r.pnl = r.chart.addSeries(BaselineSeries, options, 1)
        r.chart.panes()[1]?.setHeight(110)
      }
      r.pnl.setData(data.pnl)
    }
    r.chart.timeScale().fitContent()
  }, [data, mode])

  // Show the crosshair on the selected day when it is chosen with the slider or date picker.
  useEffect(() => {
    const r = refs.current
    const point = data.main[selected - from]
    if (r && point) r.chart.setCrosshairPosition(point.value, point.time, r.main)
  }, [data, selected, from])

  const point = points[selected]
  const benchmarkValue = mode === 'eur' ? benchmarkPoints?.[selected]?.value : undefined
  const benchmarkReturn = mode === 'percent' ? data.benchmark[selected - from]?.value : undefined
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
              {benchmarkValue !== undefined && (
                <span>
                  <i className="swatch benchmark" /> {benchmark?.label} {formatEur(benchmarkValue)}
                </span>
              )}
              <span>
                <i className="swatch pnl" /> Profit {formatEur(point.pnl)}
              </span>
            </>
          ) : (
            <>
              <span>
                <i className="swatch main" /> Time-weighted {formatPercent((data.main[selected - from]?.value ?? 0) / 100)}
              </span>
              {benchmarkReturn !== undefined && (
                <span>
                  <i className="swatch benchmark" /> {benchmark?.label} {formatPercent(benchmarkReturn / 100)}
                </span>
              )}
              {from === 0 && (
                <span>
                  <i className="swatch secondary" /> Simple {formatPercent(point.simpleReturn)}
                </span>
              )}
            </>
          )}
        </div>
      )}
      <div ref={container} className="chart" data-testid="portfolio-chart" />
    </div>
  )
}
