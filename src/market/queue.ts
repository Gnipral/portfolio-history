import { isRetryable } from './http.ts'

export interface QueueOptions {
  /** Requests running at the same time. */
  concurrency?: number
  /** Minimum time between the starts of two requests, e.g. 7500 for 8 requests per minute. */
  minIntervalMs?: number
  /** Attempts after the first one for retryable errors. */
  maxRetries?: number
  /** First retry delay; doubles on every further attempt. */
  retryDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Runs requests for one API within its rate limit and retries temporary failures. */
export class RequestQueue {
  private readonly concurrency: number
  private readonly minIntervalMs: number
  private readonly maxRetries: number
  private readonly retryDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private running = 0
  private nextStart = 0
  private readonly waiting: (() => void)[] = []

  constructor(options: QueueOptions = {}) {
    this.concurrency = options.concurrency ?? 2
    this.minIntervalMs = options.minIntervalMs ?? 0
    this.maxRetries = options.maxRetries ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 1000
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? Date.now
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      for (let attempt = 0; ; attempt++) {
        await this.waitForSlot()
        try {
          return await task()
        } catch (error) {
          if (attempt >= this.maxRetries || !isRetryable(error)) throw error
          await this.sleep(this.retryDelayMs * 2 ** attempt)
        }
      }
    } finally {
      this.release()
    }
  }

  private async acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  private release(): void {
    const next = this.waiting.shift()
    if (next) next()
    else this.running--
  }

  /** Reserves the next start time, so concurrent tasks stay `minIntervalMs` apart. */
  private async waitForSlot(): Promise<void> {
    const now = this.now()
    const start = Math.max(now, this.nextStart)
    this.nextStart = start + this.minIntervalMs
    if (start > now) await this.sleep(start - now)
  }
}
