export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message = `HTTP ${status}`,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * A request gives up after this long. On a train the connection is often there but barely moves:
 * the browser says online, and without a limit a request can hang for minutes while the app waits.
 */
export const REQUEST_TIMEOUT_MS = 10_000

/** No answer in time: the connection is too slow, so the stored data is used for now. */
export class TimeoutError extends Error {
  constructor(readonly url: string) {
    super('The connection is too slow: no answer in time')
    this.name = 'TimeoutError'
  }
}

/** Failures of the connection itself, not of the request: worth trying again later. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TimeoutError || error instanceof TypeError
}

/** Rate limits, server errors and network failures are worth retrying; other client errors and timeouts are not. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500
  if (error instanceof DOMException && error.name === 'AbortError') return false
  // A slow connection stays slow for a while: retrying would only make the wait longer.
  if (error instanceof TimeoutError) return false
  return error instanceof TypeError
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const outer = init.signal
  const forward = () => controller.abort()
  outer?.addEventListener('abort', forward)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new HttpError(response.status, url)
    return (await response.json()) as T
  } catch (error) {
    if (timedOut) throw new TimeoutError(url)
    throw error
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', forward)
  }
}
