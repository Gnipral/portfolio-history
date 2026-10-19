import { describe, expect, it } from 'vitest'
import { HttpError } from './http.ts'
import { RequestQueue } from './queue.ts'

/** Fake clock: sleeping advances time instantly. */
function fakeClock() {
  let time = 0
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms
    },
  }
}

describe('RequestQueue', () => {
  it('spaces request starts by the minimum interval', async () => {
    const queue = new RequestQueue({ concurrency: 3, minIntervalMs: 30 })
    const begin = performance.now()
    const starts: number[] = []
    await Promise.all([1, 2, 3].map(() => queue.run(async () => starts.push(performance.now()))))
    // Starts are scheduled at 0, 30 and 60 ms; timers may fire a little early, never much.
    expect((starts.at(-1) as number) - begin).toBeGreaterThanOrEqual(55)
  })

  it('limits concurrency', async () => {
    const queue = new RequestQueue({ concurrency: 2 })
    let active = 0
    let peak = 0
    const task = async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    }
    await Promise.all(Array.from({ length: 6 }, () => queue.run(task)))
    expect(peak).toBe(2)
  })

  it('retries rate limits and server errors with backoff', async () => {
    const clock = fakeClock()
    const queue = new RequestQueue({ retryDelayMs: 100, ...clock })
    let calls = 0
    const result = await queue.run(async () => {
      calls++
      if (calls === 1) throw new HttpError(429, 'x')
      if (calls === 2) throw new HttpError(503, 'x')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(clock.now()).toBe(300) // 100 + 200
  })

  it('does not retry client errors', async () => {
    const queue = new RequestQueue({ ...fakeClock() })
    let calls = 0
    await expect(
      queue.run(async () => {
        calls++
        throw new HttpError(404, 'x')
      }),
    ).rejects.toThrow('HTTP 404')
    expect(calls).toBe(1)
  })

  it('gives up after the maximum number of retries', async () => {
    const queue = new RequestQueue({ maxRetries: 2, ...fakeClock() })
    let calls = 0
    await expect(
      queue.run(async () => {
        calls++
        throw new TypeError('Failed to fetch')
      }),
    ).rejects.toThrow('Failed to fetch')
    expect(calls).toBe(3)
  })
})
