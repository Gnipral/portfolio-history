import type { DeepPartial, HorzScaleOptions, TimeChartOptions } from 'lightweight-charts'

/**
 * Zoom with the mouse wheel or two fingers, drag sideways to move through time, double-click the date axis
 * to see everything again. A vertical swipe on a phone still scrolls the page.
 */
export const ZOOM_OPTIONS: DeepPartial<TimeChartOptions> = {
  handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: { time: true, price: true } },
  handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
}

/** No scrolling past the first or the last day into empty space. */
export const ZOOM_TIME_SCALE: DeepPartial<HorzScaleOptions> = { fixLeftEdge: true, fixRightEdge: true }
