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

/** Rate limits, server errors and network failures are worth retrying; other client errors are not. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500
  if (error instanceof DOMException && error.name === 'AbortError') return false
  return error instanceof TypeError
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) throw new HttpError(response.status, url)
  return (await response.json()) as T
}
