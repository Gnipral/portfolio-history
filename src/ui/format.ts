const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Formats an ISO `YYYY-MM-DD` date, e.g. `5 Jan 2026`. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`))
}

const eur = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const eurCompact = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const percent = new Intl.NumberFormat('en-GB', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `€1,234.56`; whole euros with `compact`. */
export function formatEur(value: number, compact = false): string {
  return (compact ? eurCompact : eur).format(value)
}

/** Like formatEur, with an explicit + for gains. */
export function formatSignedEur(value: number): string {
  return value > 0 ? `+${formatEur(value)}` : formatEur(value)
}

/** `+12.34%` from a fraction (0.1234). */
export function formatPercent(fraction: number, signed = true): string {
  const text = percent.format(fraction)
  return signed && fraction > 0 ? `+${text}` : text
}

/** CSS class for a gain or a loss. */
export function trendClass(value: number): string {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : ''
}
