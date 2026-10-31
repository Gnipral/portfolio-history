import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays } from '../../market/dates.ts'
import { grabAt, indexAtRatio, PLAYHEAD_REACH, stepPlayhead, trimEnd, trimStart, windowFromRange } from './timeline.ts'
import { Timeline } from './Timeline.tsx'

afterEach(cleanup)

// One point per day from 1 Jan 2026: 100 days.
const points = Array.from({ length: 100 }, (_, i) => ({ date: addDays('2026-01-01', i), value: 1000 + i }))
const dates = points.map((p) => p.date)

describe('timeline moves', () => {
  it('trims either end, never past the other', () => {
    expect(trimStart({ from: 10, to: 50 }, 30)).toEqual({ from: 30, to: 50 })
    expect(trimStart({ from: 10, to: 50 }, 80)).toEqual({ from: 49, to: 50 })
    expect(trimEnd({ from: 10, to: 50 }, 70, 100)).toEqual({ from: 10, to: 70 })
    expect(trimEnd({ from: 10, to: 50 }, 2, 100)).toEqual({ from: 10, to: 11 })
    expect(trimEnd({ from: 10, to: 50 }, 500, 100)).toEqual({ from: 10, to: 99 })
  })

  it('takes hold of the playhead within its reach, also when it stands on an end of the window', () => {
    // A strip of 990px over 100 days: day i is at 10·i px. Window 20–80, playhead on its end.
    const grab = (x: number, playhead = 80) => grabAt(x, 990, 100, { from: 20, to: 80 }, playhead)
    expect(grab(800)).toBe('playhead')
    expect(grab(800 - PLAYHEAD_REACH)).toBe('playhead')
    // The handles sit outside the window.
    expect(grab(805)).toBe('end')
    expect(grab(195)).toBe('start')
    // Far from the playhead inside the window: the playhead, which then comes there.
    expect(grab(500)).toBe('playhead')
    // Right at an edge, away from the playhead: the handle.
    expect(grab(203, 50)).toBe('start')
    expect(grab(797, 50)).toBe('end')
  })

  it('maps a point of the strip and a zoom of the chart to whole days', () => {
    expect(indexAtRatio(0.5, 101)).toBe(50)
    expect(indexAtRatio(-1, 101)).toBe(0)
    expect(windowFromRange(-3.4, 40.6, 100)).toEqual({ from: 0, to: 41 })
  })

  it('steps the playhead a day or a month, inside the window', () => {
    const window = { from: 0, to: 99 }
    expect(stepPlayhead(dates, 40, 1, false, window)).toBe(41)
    // 10 Feb 2026 (index 40) a month back is 10 Jan (index 9), forward is 10 Mar (index 68).
    expect(stepPlayhead(dates, 40, -1, true, window)).toBe(9)
    expect(stepPlayhead(dates, 40, 1, true, window)).toBe(68)
    // 31 Jan (index 30) a month on is 28 Feb (index 58).
    expect(stepPlayhead(dates, 30, 1, true, window)).toBe(58)
    expect(stepPlayhead(dates, 40, -1, true, { from: 20, to: 99 })).toBe(20)
  })
})

describe('Timeline', () => {
  const setup = (props: Partial<Parameters<typeof Timeline>[0]> = {}) => {
    const handlers = { onWindow: vi.fn(), onPlayhead: vi.fn(), onRange: vi.fn() }
    render(<Timeline points={points} window={{ from: 20, to: 80 }} playhead={80} range={null} {...handlers} {...props} />)
    const strip = screen.getByRole('slider', { name: 'Playhead' })
    // jsdom has no layout: the strip is 990px wide, so day i is at 10·i px.
    strip.getBoundingClientRect = () => ({ left: 0, width: 990, top: 0, height: 40, right: 990, bottom: 40, x: 0, y: 0, toJSON: () => ({}) })
    return { ...handlers, strip }
  }

  it('trims the start and the end with their handles, outside the window', () => {
    const { onWindow, strip } = setup()
    fireEvent.pointerDown(strip, { clientX: 196, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 100, pointerId: 1 })
    expect(onWindow).toHaveBeenLastCalledWith({ from: 10, to: 80 })
    fireEvent.pointerUp(strip, { clientX: 100, pointerId: 1 })

    fireEvent.pointerDown(strip, { clientX: 805, pointerId: 2 })
    fireEvent.pointerMove(strip, { clientX: 900, pointerId: 2 })
    expect(onWindow).toHaveBeenLastCalledWith({ from: 20, to: 90 })
  })

  it('never moves the window as a whole', () => {
    const { onWindow, onPlayhead, strip } = setup()
    fireEvent.pointerDown(strip, { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(strip, { clientX: 450, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 450, pointerId: 1 })
    expect(onWindow).not.toHaveBeenCalled()
    expect(onPlayhead).toHaveBeenLastCalledWith(45)
  })

  it('takes the playhead a little next to it and drags it, even on the end of the window', () => {
    const { onWindow, onPlayhead, strip } = setup()
    // 8px left of the playhead on day 80: within reach, so it does not jump.
    fireEvent.pointerDown(strip, { clientX: 792, pointerId: 1 })
    expect(onPlayhead).not.toHaveBeenCalled()
    fireEvent.pointerMove(strip, { clientX: 600, pointerId: 1 })
    expect(onPlayhead).toHaveBeenLastCalledWith(60)
    expect(onWindow).not.toHaveBeenCalled()
  })

  it('moves the playhead with a click in the window, and with the arrow keys', () => {
    const { onPlayhead, strip } = setup()
    fireEvent.pointerDown(strip, { clientX: 500, pointerId: 1 })
    fireEvent.pointerUp(strip, { clientX: 500, pointerId: 1 })
    expect(onPlayhead).toHaveBeenLastCalledWith(50)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(onPlayhead).toHaveBeenLastCalledWith(79)
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', shiftKey: true })
    // 22 Mar (index 80) a month back is 22 Feb (index 52).
    expect(onPlayhead).toHaveBeenLastCalledWith(52)
  })

  it('sets the window with the dates and a quick range', () => {
    const { onWindow, onRange } = setup({ range: '3M' })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: dates[5] } })
    expect(onWindow).toHaveBeenLastCalledWith({ from: 5, to: 80 })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: dates[90] } })
    expect(onWindow).toHaveBeenLastCalledWith({ from: 20, to: 90 })
    expect(screen.getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '1Y' }))
    expect(onRange).toHaveBeenCalledWith('1Y')
  })
})
