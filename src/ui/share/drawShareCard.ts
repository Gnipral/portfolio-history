import { formatDate, formatPercent } from '../format.ts'
import type { ShareCard } from './shareCard.ts'

export type ShareFormat = 'wide' | 'story'

export const SIZES: Record<ShareFormat, { width: number; height: number }> = {
  wide: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
}

/**
 * The card always uses the dark palette of the app, whatever the theme of the person sharing it:
 * it is a picture of the brand, and dark images stand out in most feeds.
 */
const INK = {
  bg: '#0b0e12',
  surface: '#14181d',
  border: '#252b33',
  text: '#dfe2eb',
  muted: '#8d9a93',
  accent: '#00f59b',
  positive: '#3ddc97',
  negative: '#ff7b7b',
  value: '#5cc8f0',
  benchmark: '#ffb95f',
  zero: '#4a5561',
  // Allocation slots: no amber, which is the benchmark line.
  series: ['#5b6670', '#00d68f', '#8b8dff', '#f472b6', '#a3e635', '#c084fc', '#22d3ee', '#e6eaef'],
}

const DISPLAY = "'Space Grotesk', 'Manrope', system-ui, sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace"

/** Loads the web fonts the card uses, so the first drawing does not fall back to system fonts. */
export async function loadCardFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`700 40px ${DISPLAY}`), document.fonts.load(`500 20px ${MONO}`)])
  } catch {
    // Offline or blocked: the system fonts are fine.
  }
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function trend(value: number): string {
  return value > 0 ? INK.positive : value < 0 ? INK.negative : INK.text
}

function scaleFor(box: Box, values: number[], min: number, max: number) {
  const y = (v: number) => box.y + box.height - ((v - min) / (max - min || 1)) * box.height
  const x = (i: number) => box.x + (values.length > 1 ? (i / (values.length - 1)) * box.width : box.width)
  return { x, y }
}

function drawCurve(ctx: CanvasRenderingContext2D, card: ShareCard, box: Box) {
  const all = [...card.curve, ...(card.benchmark?.curve ?? []), 0]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const pad = (max - min) * 0.08 || 1
  const scale = scaleFor(box, card.curve, min - pad, max + pad)

  // The 0 % line: above it is gain, below it loss.
  ctx.strokeStyle = INK.zero
  ctx.lineWidth = 2
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(box.x, scale.y(0))
  ctx.lineTo(box.x + box.width, scale.y(0))
  ctx.stroke()

  // Soft fill under the portfolio line, towards the 0 % line.
  const gradient = ctx.createLinearGradient(0, box.y, 0, box.y + box.height)
  gradient.addColorStop(0, 'rgba(92, 200, 240, 0.28)')
  gradient.addColorStop(1, 'rgba(92, 200, 240, 0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.moveTo(scale.x(0), scale.y(0))
  card.curve.forEach((v, i) => ctx.lineTo(scale.x(i), scale.y(v)))
  ctx.lineTo(scale.x(card.curve.length - 1), scale.y(0))
  ctx.closePath()
  ctx.fill()

  const line = (values: number[], color: string, width: number, dash: number[]) => {
    const s = scaleFor(box, values, min - pad, max + pad)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash(dash)
    ctx.beginPath()
    values.forEach((v, i) => (i === 0 ? ctx.moveTo(s.x(i), s.y(v)) : ctx.lineTo(s.x(i), s.y(v))))
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (card.benchmark) line(card.benchmark.curve, INK.benchmark, 4, [12, 10])
  line(card.curve, INK.value, 6, [])

  const last = card.curve.at(-1) ?? 0
  ctx.fillStyle = INK.value
  ctx.beginPath()
  ctx.arc(scale.x(card.curve.length - 1), scale.y(last), 9, 0, Math.PI * 2)
  ctx.fill()
}

function drawAllocation(ctx: CanvasRenderingContext2D, card: ShareCard, box: Box, fontSize: number) {
  let x = box.x
  const total = card.allocation.reduce((sum, s) => sum + s.percent, 0) || 1
  card.allocation.forEach((s) => {
    const width = (s.percent / total) * box.width
    ctx.fillStyle = INK.series[s.slot] ?? INK.series[0]!
    ctx.fillRect(x, box.y, Math.max(width - 4, 2), 14)
    x += width
  })
  ctx.font = `500 ${fontSize}px ${MONO}`
  ctx.textBaseline = 'top'
  let labelX = box.x
  let labelY = box.y + 30
  for (const s of card.allocation) {
    const text = `${s.label} ${s.percent}%`
    const width = ctx.measureText(text).width + 22 + 28
    if (labelX + width > box.x + box.width) {
      labelX = box.x
      labelY += fontSize + 14
    }
    ctx.fillStyle = INK.series[s.slot] ?? INK.series[0]!
    ctx.fillRect(labelX, labelY + fontSize * 0.25, 14, 14)
    ctx.fillStyle = INK.text
    ctx.fillText(text, labelX + 22, labelY)
    labelX += width
  }
}

/** Rows of positions: name, weight and return; the rest summed up as "+ n more". */
function drawPositions(ctx: CanvasRenderingContext2D, card: ShareCard, box: Box, rows: number, fontSize: number) {
  const rowHeight = fontSize * 1.75
  const shown = card.positions.slice(0, card.positions.length > rows ? rows - 1 : rows)
  const weightX = box.x + box.width * 0.62
  const returnX = box.x + box.width
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${Math.round(fontSize * 0.75)}px ${MONO}`
  ctx.fillStyle = INK.muted
  let y = box.y + fontSize * 0.5
  ctx.fillText('POSITION', box.x, y)
  ctx.textAlign = 'right'
  ctx.fillText('WEIGHT', weightX, y)
  ctx.fillText('RETURN', returnX, y)
  ctx.textAlign = 'left'
  y += fontSize * 0.9
  for (const position of shown) {
    ctx.strokeStyle = INK.border
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(box.x, y)
    ctx.lineTo(returnX, y)
    ctx.stroke()
    const middle = y + rowHeight / 2
    ctx.font = `600 ${fontSize}px ${DISPLAY}`
    ctx.fillStyle = INK.text
    let name = position.name
    while (name.length > 4 && ctx.measureText(name).width > weightX - box.x - fontSize * 4) name = `${name.slice(0, -2)}…`
    ctx.fillText(name, box.x, middle)
    ctx.textAlign = 'right'
    ctx.font = `500 ${fontSize}px ${MONO}`
    ctx.fillStyle = INK.muted
    ctx.fillText(`${position.weight}%`, weightX, middle)
    ctx.fillStyle = trend(position.return)
    ctx.fillText(`${position.return > 0 ? '+' : ''}${(position.return * 100).toFixed(1)}%`, returnX, middle)
    ctx.textAlign = 'left'
    y += rowHeight
  }
  const rest = card.positions.length - shown.length
  if (rest > 0) {
    ctx.font = `500 ${Math.round(fontSize * 0.8)}px ${MONO}`
    ctx.fillStyle = INK.muted
    ctx.fillText(`+ ${rest} more`, box.x, y + rowHeight / 2)
  }
}

export interface CardOptions {
  allocation: boolean
  positions: boolean
}

/** Height of a block of position rows, header included. */
function positionsHeight(rows: number, fontSize: number): number {
  return fontSize * 1.4 + rows * fontSize * 1.75
}

/** Draws the card on a canvas of the size of its format. */
export function drawShareCard(canvas: HTMLCanvasElement, card: ShareCard, format: ShareFormat, options: CardOptions): void {
  const showAllocation = options.allocation
  const { width, height } = SIZES[format]
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const story = format === 'story'
  const pad = story ? 88 : 64
  const inner = width - pad * 2

  ctx.fillStyle = INK.bg
  ctx.fillRect(0, 0, width, height)
  const glow = ctx.createRadialGradient(width, 0, 0, width, 0, width * 0.9)
  glow.addColorStop(0, 'rgba(0, 245, 155, 0.10)')
  glow.addColorStop(1, 'rgba(0, 245, 155, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, width, height)

  // Header: brand and period.
  let y = pad
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = INK.accent
  ctx.font = `600 ${story ? 30 : 22}px ${MONO}`
  ctx.fillText('PORTFOLIO HISTORY', pad, y)
  ctx.fillStyle = INK.muted
  const period = `${formatDate(card.from)} – ${formatDate(card.to)}`
  if (story) {
    ctx.font = `500 30px ${MONO}`
    ctx.fillText(period, pad, y + 52)
    y += 160
  } else {
    ctx.font = `500 22px ${MONO}`
    ctx.textAlign = 'right'
    ctx.fillText(period, width - pad, y)
    ctx.textAlign = 'left'
    y += 64
  }

  // The headline number.
  const big = story ? 180 : 112
  ctx.fillStyle = trend(card.twr)
  ctx.font = `700 ${big}px ${DISPLAY}`
  ctx.fillText(formatPercent(card.twr), pad - 4, y)
  y += big + (story ? 24 : 10)
  ctx.fillStyle = INK.muted
  ctx.font = `500 ${story ? 32 : 22}px ${MONO}`
  ctx.fillText('TIME-WEIGHTED RETURN', pad, y)
  y += story ? 72 : 44

  if (card.benchmark) {
    const difference = card.twr - card.benchmark.twr
    ctx.font = `600 ${story ? 40 : 28}px ${DISPLAY}`
    ctx.fillStyle = INK.benchmark
    const vs = `vs ${card.benchmark.label} ${formatPercent(card.benchmark.twr)}`
    ctx.fillText(vs, pad, y)
    const gap = ctx.measureText(vs).width + 24
    ctx.fillStyle = trend(difference)
    const lead = `${difference >= 0 ? '+' : '−'}${Math.abs(difference * 100).toFixed(1)} pts`
    ctx.fillText(lead, pad + gap, y)
    y += story ? 90 : 56
  }

  const footer = story ? 120 : 64
  const allocationHeight = showAllocation && card.allocation.length > 0 ? (story ? 190 : 0) : 0
  const rows = options.positions ? Math.min(card.positions.length, story ? 8 : 5) : 0
  if (story) {
    const listFont = 34
    const listHeight = rows ? positionsHeight(rows, listFont) + 40 : 0
    drawCurve(ctx, card, { x: pad, y: y + 40, width: inner, height: height - y - 40 - footer - allocationHeight - listHeight - 80 })
    if (rows) drawPositions(ctx, card, { x: pad, y: height - footer - allocationHeight - listHeight - 20, width: inner, height: listHeight }, rows, listFont)
    if (allocationHeight) drawAllocation(ctx, card, { x: pad, y: height - footer - allocationHeight, width: inner, height: allocationHeight }, 28)
  } else {
    // Wide: the curve on the right half with the positions under it, the allocation under the numbers.
    const listFont = 20
    const listHeight = rows ? positionsHeight(rows, listFont) + 24 : 0
    const chart = { x: width * 0.5, y: pad + 64, width: width * 0.5 - pad, height: height - pad - 64 - footer - 16 - listHeight }
    drawCurve(ctx, card, chart)
    if (rows) drawPositions(ctx, card, { x: chart.x, y: chart.y + chart.height + 24, width: chart.width, height: listHeight }, rows, listFont)
    if (showAllocation && card.allocation.length > 0) {
      drawAllocation(ctx, card, { x: pad, y: Math.max(y, height - footer - 130), width: width * 0.5 - pad - 48, height: 100 }, 18)
    }
  }

  // Footer: where to try it.
  ctx.strokeStyle = INK.border
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pad, height - footer)
  ctx.lineTo(width - pad, height - footer)
  ctx.stroke()
  ctx.textBaseline = 'middle'
  ctx.font = `500 ${story ? 24 : 20}px ${MONO}`
  ctx.fillStyle = INK.text
  ctx.fillText('gnipral.github.io/portfolio-history', pad, height - footer / 2)
  ctx.textAlign = 'right'
  ctx.fillStyle = INK.muted
  ctx.fillText('free · no account', width - pad, height - footer / 2)
  ctx.textAlign = 'left'
}

/** The drawn card as a PNG file. */
export function cardFile(canvas: HTMLCanvasElement, card: ShareCard): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? new File([blob], `portfolio-${card.from}-${card.to}.png`, { type: 'image/png' }) : null), 'image/png')
  })
}
