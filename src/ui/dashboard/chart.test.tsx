import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DailyPoint } from '../../engine/series.ts'
import { chartData } from './chartData.ts'
import { storePalette } from '../../theme/theme.ts'
import { ChartToolbar } from './ChartToolbar.tsx'
import { PortfolioChart, spreadLabels } from './PortfolioChart.tsx'

function point(date: string, value: number, extra: Partial<DailyPoint> = {}): DailyPoint {
  return {
    date,
    value,
    invested: 1000,
    capitalBase: 1000,
    pnl: value - 1000,
    realized: 0,
    unrealized: value - 1000,
    simpleReturn: (value - 1000) / 1000,
    inflow: 0,
    outflow: 0,
    estimated: 0,
    twr: value / 1000 - 1,
    days: 0,
    ...extra,
  }
}

const points = [point('2026-10-15', 1000), point('2026-10-16', 1100), point('2026-10-17', 1210)]

describe('chartData', () => {
  it('gives value, invested and profit lines in EUR', () => {
    const data = chartData(points, 1, 2, 'eur')
    expect(data.main).toEqual([
      { time: '2026-10-16', value: 1100 },
      { time: '2026-10-17', value: 1210 },
    ])
    expect(data.secondary[0]).toEqual({ time: '2026-10-16', value: 1000 })
    expect(data.pnl[1]).toEqual({ time: '2026-10-17', value: 210 })
  })

  it('rebases the time-weighted return to the first visible day in percent', () => {
    const data = chartData(points, 1, 2, 'percent')
    // From 1000 at the end of 10-15: +10% and +21%
    expect(data.main.map((p) => p.value)).toEqual([10, 21])
    expect(data.secondary).toEqual([])
    expect(data.pnl).toEqual([])
  })

  it('adds the benchmark: value in EUR, return from the first visible day in percent', () => {
    const benchmark = [
      { date: '2026-10-15', value: 1000, pnl: 0, twr: 0 },
      { date: '2026-10-16', value: 1050, pnl: 50, twr: 0.05 },
      { date: '2026-10-17', value: 1155, pnl: 155, twr: 0.155 },
    ]
    expect(chartData(points, 1, 2, 'eur', [benchmark]).benchmarks[0]?.map((p) => p.value)).toEqual([1050, 1155])
    expect(chartData(points, 1, 2, 'percent', [benchmark]).benchmarks[0]?.map((p) => p.value)).toEqual([5, 15.5])
    expect(chartData(points, 0, 2, 'eur').benchmarks).toEqual([])
  })

  it('draws no simple return in percent, since deposits move it', () => {
    expect(chartData(points, 0, 2, 'percent').secondary).toEqual([])
  })
})

// Minimal stand-in for lightweight-charts: records calls and lets the test move the crosshair and click.
const chartMock = vi.hoisted(() => {
  type Handler = (param: { time?: string; logical?: number; point?: { x: number; y: number } }) => void
  const state: { move: Handler | undefined; click: Handler | undefined; crosshair: unknown[][]; data: unknown[][]; ranges: unknown[]; markers: unknown[][] } = {
    move: undefined,
    click: undefined,
    crosshair: [],
    data: [],
    ranges: [],
    markers: [],
  }
  const series = () => ({
    setData: (d: unknown[]) => state.data.push(d),
    applyOptions: () => {},
    createPriceLine: () => ({ applyOptions: () => {} }),
    priceToCoordinate: (price: number) => 300 - price,
    removePriceLine: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 60 }),
  })
  const chart = {
    addSeries: series,
    removeSeries: () => {},
    applyOptions: () => {},
    panes: () => [
      { setHeight: () => {}, getHeight: () => 300 },
      { setHeight: () => {}, getHeight: () => 120 },
    ],
    timeScale: () => ({
      fitContent: () => {},
      timeToCoordinate: () => 100,
      setVisibleLogicalRange: (range: unknown) => state.ranges.push(range),
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
    }),
    subscribeCrosshairMove: (handler: Handler) => {
      state.move = handler
    },
    unsubscribeCrosshairMove: () => {},
    subscribeClick: (handler: Handler) => {
      state.click = handler
    },
    unsubscribeClick: () => {},
    setCrosshairPosition: (...args: unknown[]) => state.crosshair.push(args),
    remove: () => {},
  }
  return { state, chart }
})

vi.mock('lightweight-charts', () => ({
  createChart: () => chartMock.chart,
  createSeriesMarkers: (_series: unknown, markers: unknown[]) => {
    chartMock.state.markers.push(markers)
    return { setMarkers: (next: unknown[]) => chartMock.state.markers.push(next) }
  },
  AreaSeries: {},
  LineSeries: {},
  BaselineSeries: {},
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Magnet: 1 },
  LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
  PriceScaleMode: { Normal: 0, Logarithmic: 1 },
}))

afterEach(cleanup)

const all = { from: 0, to: 2 }

describe('PortfolioChart', () => {
  it('reports the day under the pointer, and null when the pointer leaves', () => {
    const onHover = vi.fn()
    render(<PortfolioChart points={points} window={all} inspected={2} mode="eur" onHover={onHover} />)
    act(() => chartMock.state.move?.({ time: '2026-10-16', logical: 1, point: { x: 10, y: 10 } }))
    expect(onHover).toHaveBeenLastCalledWith(1)
    act(() => chartMock.state.move?.({}))
    expect(onHover).toHaveBeenLastCalledWith(null)
  })

  it('pins the clicked day', () => {
    const onPick = vi.fn()
    render(<PortfolioChart points={points} window={all} inspected={2} mode="eur" onHover={() => {}} onPick={onPick} />)
    act(() => chartMock.state.click?.({ time: '2026-10-15', logical: 0, point: { x: 1, y: 1 } }))
    expect(onPick).toHaveBeenCalledWith(0)
  })

  it('shows the window of the period, and moves the crosshair to the inspected day', () => {
    const { rerender } = render(<PortfolioChart points={points} window={{ from: 1, to: 2 }} inspected={2} mode="eur" onHover={() => {}} />)
    expect(chartMock.state.ranges.at(-1)).toEqual({ from: 1, to: 2 })
    rerender(<PortfolioChart points={points} window={{ from: 1, to: 2 }} inspected={1} mode="eur" onHover={() => {}} />)
    expect(chartMock.state.crosshair.at(-1)?.slice(0, 2)).toEqual([1100, '2026-10-16'])
  })

  it('marks deposits, buys, sells and dividends on the value line', () => {
    render(
      <PortfolioChart
        points={points}
        window={all}
        inspected={2}
        mode="eur"
        onHover={() => {}}
        markers={[{ date: '2026-10-16', kinds: ['deposit', 'buy'] }]}
      />,
    )
    expect((chartMock.state.markers.at(-1) as { id: string }[]).map((m) => m.id)).toEqual(['2026-10-16:deposit', '2026-10-16:buy'])
  })

  it('names the profit pane in EUR only', async () => {
    const style = { fill: true, invested: true, profitPane: true, log: false }
    const { rerender } = render(<PortfolioChart points={points} window={all} inspected={2} mode="eur" onHover={() => {}} chartStyle={style} />)
    expect(await screen.findByText('Profit / loss')).toBeTruthy()
    rerender(<PortfolioChart points={points} window={all} inspected={2} mode="percent" onHover={() => {}} chartStyle={style} />)
    expect(screen.queryByText('Profit / loss')).toBeNull()
  })
})

describe('ChartToolbar', () => {
  const style = { fill: true, invested: true, profitPane: false, log: false }
  const toolbar = (props: Partial<Parameters<typeof ChartToolbar>[0]> = {}) => (
    <ChartToolbar
      mode="eur"
      onMode={() => {}}
      benchmarks={[]}
      benchmarkPicker={<p>Picker</p>}
      chartStyle={style}
      onStyleChange={() => {}}
      panelOpen
      onPanel={() => {}}
      expanded={false}
      onExpand={() => {}}
      {...props}
    />
  )

  it('changes the style from the View menu, with the colours stored as in Settings', () => {
    const onStyleChange = vi.fn()
    render(toolbar({ onStyleChange }))
    fireEvent.click(screen.getByRole('button', { name: /View/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Logarithmic scale' }))
    expect(onStyleChange).toHaveBeenCalledWith({ log: true })
    fireEvent.click(screen.getByRole('radio', { name: 'Colour-blind friendly' }))
    expect(localStorage.getItem('palette')).toBe('colorblind')
    act(() => storePalette('standard'))
  })

  it('keeps the options of the currency for the currency', () => {
    render(toolbar({ mode: 'percent' }))
    expect((screen.getByRole('button', { name: 'Profit/Loss' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /View/ }))
    expect((screen.getByRole('checkbox', { name: 'Logarithmic scale' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('opens the benchmark choice from the legend, and toggles the profit pane and the side panel', () => {
    const onStyleChange = vi.fn()
    const onPanel = vi.fn()
    render(toolbar({ onStyleChange, onPanel }))
    fireEvent.click(screen.getByRole('button', { name: /Benchmark/ }))
    expect(screen.getByText('Picker')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Profit/Loss' }))
    expect(onStyleChange).toHaveBeenCalledWith({ profitPane: true })
    fireEvent.click(screen.getByRole('button', { name: 'Side panel' }))
    expect(onPanel).toHaveBeenCalledWith(false)
  })
})

describe('spreadLabels', () => {
  const label = (key: string, y: number, pane: 0 | 1 = 0) => ({ key, y, pane, color: '#000', text: key })

  it('keeps each label at its point, and puts one that would cover another on the other side', () => {
    const spread = spreadLabels([label('IWDA', 105), label('Value', 100), label('Invested', 200), label('Profit', 102, 1)])
    expect(spread.map((l) => [l.key, l.y, l.flip])).toEqual([
      ['Value', 100, false],
      ['IWDA', 105, true],
      ['Invested', 200, false],
      ['Profit', 102, false],
    ])
  })

  it('stays on its side and moves down when the other side has no room, as on a phone', () => {
    const spread = spreadLabels([label('IWDA', 100), label('Value', 104)], true, { left: 300, right: 20 })
    expect(spread.map((l) => [l.key, l.y, l.flip])).toEqual([
      ['IWDA', 100, true],
      ['Value', 120, true],
    ])
  })

  it('moves a label down only when both sides are taken, and starts left near the right edge', () => {
    const spread = spreadLabels([label('A', 100), label('B', 104), label('C', 108)], true)
    expect(spread.map((l) => [l.key, l.y, l.flip])).toEqual([
      ['A', 100, true],
      ['B', 104, false],
      ['C', 120, true],
    ])
  })
})
