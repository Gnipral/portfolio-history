import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DailyPoint } from '../../engine/series.ts'
import { chartData } from './chartData.ts'
import { PortfolioChart } from './PortfolioChart.tsx'

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

  it('shows the simple return only for the full history', () => {
    expect(chartData(points, 0, 2, 'percent').secondary.map((p) => p.value)).toEqual([0, 10, 21])
  })
})

// Minimal stand-in for lightweight-charts: records calls and lets the test move the crosshair.
const chartMock = vi.hoisted(() => {
  type Move = (param: { time?: string; logical?: number }) => void
  const state: { move: Move | undefined; crosshair: unknown[][]; data: unknown[][] } = {
    move: undefined,
    crosshair: [],
    data: [],
  }
  const series = () => ({
    setData: (d: unknown[]) => state.data.push(d),
    applyOptions: () => {},
    createPriceLine: () => ({ applyOptions: () => {} }),
    removePriceLine: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
  })
  const chart = {
    addSeries: series,
    removeSeries: () => {},
    applyOptions: () => {},
    panes: () => [
      { setHeight: () => {}, getHeight: () => 300 },
      { setHeight: () => {}, getHeight: () => 120 },
    ],
    timeScale: () => ({ fitContent: () => {} }),
    subscribeCrosshairMove: (handler: Move) => {
      state.move = handler
    },
    unsubscribeCrosshairMove: () => {},
    setCrosshairPosition: (...args: unknown[]) => state.crosshair.push(args),
    remove: () => {},
  }
  return { state, chart }
})

vi.mock('lightweight-charts', () => ({
  createChart: () => chartMock.chart,
  AreaSeries: {},
  LineSeries: {},
  BaselineSeries: {},
  ColorType: { Solid: 'solid' },
  CrosshairMode: { Magnet: 1 },
  LineStyle: { Solid: 0, Dashed: 2 },
}))

afterEach(cleanup)

describe('PortfolioChart', () => {
  it('reports the hovered day and shows its values in the legend', () => {
    const onHover = vi.fn()
    render(<PortfolioChart points={points} from={1} to={2} selected={2} mode="eur" onHover={onHover} />)

    act(() => chartMock.state.move?.({ time: '2026-10-16', logical: 0 }))
    expect(onHover).toHaveBeenCalledWith(1)
    act(() => chartMock.state.move?.({}))
    expect(onHover).toHaveBeenCalledTimes(1)

    expect(screen.getByText(/Value €1,210.00/)).toBeTruthy()
  })

  it('moves the crosshair to a day chosen elsewhere', () => {
    const { rerender } = render(
      <PortfolioChart points={points} from={0} to={2} selected={2} mode="eur" onHover={() => {}} />,
    )
    rerender(<PortfolioChart points={points} from={0} to={2} selected={0} mode="eur" onHover={() => {}} />)
    expect(chartMock.state.crosshair.at(-1)?.slice(0, 2)).toEqual([1000, '2026-10-15'])
  })

  it('fills the window with the button or F, and leaves it with Esc', () => {
    render(<PortfolioChart points={points} from={0} to={2} selected={2} mode="eur" onHover={() => {}} />)
    const wrapper = () => screen.getByTestId('portfolio-chart').parentElement as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(wrapper().classList.contains('expanded')).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(wrapper().classList.contains('expanded')).toBe(false)
    fireEvent.keyDown(document, { key: 'f' })
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy()
  })

  it('names the profit pane in EUR only', async () => {
    const { rerender } = render(<PortfolioChart points={points} from={0} to={2} selected={2} mode="eur" onHover={() => {}} />)
    expect(await screen.findByText('Profit / loss')).toBeTruthy()
    rerender(<PortfolioChart points={points} from={0} to={2} selected={2} mode="percent" onHover={() => {}} />)
    expect(screen.queryByText('Profit / loss')).toBeNull()
  })
})
