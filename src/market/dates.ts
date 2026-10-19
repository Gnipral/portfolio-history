/** Calendar helpers on ISO `YYYY-MM-DD` strings, computed in UTC so time zones never shift a date. */

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Today's date in the user's local calendar. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Index of the last element whose date is on or before `date`, or -1. `dates` must be sorted. */
export function lastIndexOnOrBefore(dates: readonly string[], date: string): number {
  let low = 0
  let high = dates.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((dates[mid] as string) <= date) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
