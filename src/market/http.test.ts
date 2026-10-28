import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, HttpError, isNetworkError, isRetryable, TimeoutError } from './http.ts'

/** A fetch that never answers, like a train connection that barely moves, but stops when aborted. */
function hanging(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })
}

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('gives up on a connection that does not answer in time', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(hanging))
    const request = fetchJson('https://example.test/slow', {}, 5_000)
    const check = expect(request).rejects.toBeInstanceOf(TimeoutError)
    await vi.advanceTimersByTimeAsync(5_000)
    await check
  })

  it('answers as before on a good connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: 1 }))))
    await expect(fetchJson('https://example.test/fast')).resolves.toEqual({ ok: 1 })
  })

  it('keeps an abort from the caller an abort', async () => {
    vi.stubGlobal('fetch', vi.fn(hanging))
    const controller = new AbortController()
    const request = fetchJson('https://example.test/slow', { signal: controller.signal })
    controller.abort()
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not retry a timeout, and counts it as a network problem', () => {
    const timeout = new TimeoutError('https://example.test')
    expect(isRetryable(timeout)).toBe(false)
    expect(isNetworkError(timeout)).toBe(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new HttpError(404, 'https://example.test'))).toBe(false)
  })
})
