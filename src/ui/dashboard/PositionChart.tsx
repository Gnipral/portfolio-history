import { AreaSeries, ColorType, CrosshairMode, LineSeries, LineStyle, createChart, createSeriesMarkers, type SeriesMarker, type Time } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { PositionPoint, PositionTrade } from '../../engine/analysis/positionSeries.ts'
import { locale, t } from '../../i18n/i18n.ts'
import { formatEur } from '../format.ts'
import { useThemeColors } from './useThemeColors.ts'

const MARKERS: Partial<Record<PositionTrade['type'], { shape: SeriesMarker<Time>['shape']; position: 'belowBar' | 'aboveBar'; text: string }>> = {
  buy: { shape: 'arrowUp', position: 'belowBar', text: t('B') },
  transferIn: { shape: 'arrowUp', position: 'belowBar', text: t('In') },
  sell: { shape: 'arrowDown', position: 'aboveBar', text: t('S') },
  transferOut: { shape: 'arrowDown', position: 'aboveBar', text: t('Out') },
  dividend: { shape: 'circle', position: 'aboveBar', text: t('D') },
  split: { shape: 'square', position: 'aboveBar', text: t('Split') },
}

/** Value and cost basis of one position over time, with its trades as markers. */
export function PositionChart({ points, trades }: { points: PositionPoint[]; trades: PositionTrade[] }) {
  const container = useRef<HTMLDivElement>(null)
  const colors = useThemeColors()

  useEffect(() => {
    if (!container.current || points.length === 0) return
    const chart = createChart(container.current, {
      autoSize: true,
      localization: { locale: locale(), priceFormatter: (v: number) => formatEur(v, true) },
      crosshair: { mode: CrosshairMode.Magnet },
      layout: { background: { type: ColorType.Solid, color: colors.surface }, textColor: colors.textMuted },
      grid: { vertLines: { color: colors.border }, horzLines: { color: colors.border } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
    })
    const value = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lineColor: colors.accent,
      topColor: `${colors.accent}55`,
      bottomColor: `${colors.accent}05`,
    })
    const cost = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, color: colors.textMuted })
    value.setData(points.map((p) => ({ time: p.date, value: Math.round(p.value * 100) / 100 })))
    cost.setData(points.map((p) => ({ time: p.date, value: Math.round(p.cost * 100) / 100 })))
    const markers = trades.flatMap((t): SeriesMarker<Time>[] => {
      const style = MARKERS[t.type]
      if (!style) return []
      const color = t.type === 'sell' || t.type === 'transferOut' ? colors.negative : t.type === 'dividend' ? colors.positive : colors.accent
      return [{ time: t.date, position: style.position, shape: style.shape, color, text: style.text }]
    })
    // Several trades on one day show as one marker.
    createSeriesMarkers(value, markers.filter((m, i) => markers.findIndex((o) => o.time === m.time && o.text === m.text) === i))
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [points, trades, colors])

  return (
    <div className="chart-wrapper">
      <div className="chart-legend">
        <span>
          <i className="swatch main" /> {t('Value')}
        </span>
        <span>
          <i className="swatch secondary" /> {t('Cost basis')}
        </span>
        <span className="muted small">{t('B buy · S sell · D dividend')}</span>
      </div>
      <div ref={container} className="chart position-chart" data-testid="position-chart" />
    </div>
  )
}
