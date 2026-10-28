import { PUBLIC_URL, type ShareCard, type SharedPosition } from './shareCard.ts'

/** The route of a shared card: everything is in the link, no server sees it. */
export const SHARE_ROUTE = '/s/'

const VERSION = 1
const MAX_CURVE = 400
const MAX_ROWS = 20

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** A card unpacks to a few kilobytes; a link that unpacks to more is no card (or a bomb that would hang the tab). */
const MAX_UNPACKED_BYTES = 100_000

async function transform(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = (new Response(bytes).body as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** Unpacks a link, stopping as soon as it grows past MAX_UNPACKED_BYTES. */
async function unpack(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = (new Response(bytes).body as ReadableStream<Uint8Array<ArrayBuffer>>).pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_UNPACKED_BYTES) {
      await reader.cancel()
      throw new Error('Too large for a card')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** A link that opens the card read-only: the card itself, compressed, in the part after #. */
export async function shareLink(card: ShareCard): Promise<string> {
  const json = JSON.stringify({ v: VERSION, ...card })
  const packed = await transform(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  return `${PUBLIC_URL}#${SHARE_ROUTE}${toBase64Url(packed)}`
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const isCurve = (value: unknown): value is number[] => Array.isArray(value) && value.length <= MAX_CURVE && value.every(isNumber)

/**
 * Reads a card from a link. A link is written by anyone, so everything is checked: only the fields
 * of a card, with the right types and sane sizes; anything else makes the link invalid.
 */
export async function readShareLink(data: string): Promise<ShareCard | null> {
  try {
    const json = new TextDecoder().decode(await unpack(fromBase64Url(data)))
    const raw = JSON.parse(json) as Record<string, unknown>
    if (raw.v !== VERSION || !isDate(raw.from) || !isDate(raw.to) || !isNumber(raw.twr) || !isCurve(raw.curve)) return null
    const benchmark = raw.benchmark as Record<string, unknown> | undefined
    if (benchmark !== undefined && !(isText(benchmark.label, 40) && isNumber(benchmark.twr) && isCurve(benchmark.curve))) return null
    const allocation = Array.isArray(raw.allocation) ? raw.allocation.slice(0, MAX_ROWS) : []
    const positions = Array.isArray(raw.positions) ? raw.positions.slice(0, MAX_ROWS) : []
    if (!allocation.every((a: Record<string, unknown>) => isText(a.label, 40) && isNumber(a.percent) && isNumber(a.slot))) return null
    if (!positions.every((p: Record<string, unknown>) => isText(p.name, 40) && isNumber(p.weight) && isNumber(p.return))) return null
    return {
      from: raw.from,
      to: raw.to,
      twr: raw.twr,
      curve: raw.curve,
      ...(benchmark ? { benchmark: { label: benchmark.label as string, twr: benchmark.twr as number, curve: benchmark.curve as number[] } } : {}),
      allocation: allocation.map((a: Record<string, unknown>) => ({ label: a.label as string, percent: a.percent as number, slot: a.slot as number })),
      positions: positions.map((p: Record<string, unknown>): SharedPosition => ({
        name: p.name as string,
        weight: p.weight as number,
        return: p.return as number,
        ...(isNumber(p.others) ? { others: p.others } : {}),
      })),
    }
  } catch {
    return null
  }
}
