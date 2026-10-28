import { locale } from '../i18n/i18n.ts'

const dateFormat = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Formats an ISO `YYYY-MM-DD` date, e.g. `5 Jan 2026`. */
export function formatDate(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`))
}

let currency = 'EUR'
let eur = new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 2 })
let eurCompact = new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 })

/** The currency amounts are shown in: the base currency of the settings. */
export function displayCurrency(): string {
  return currency
}

/** Switches every formatted amount to another currency; called by the app when the base currency changes. */
export function setDisplayCurrency(code: string): void {
  if (code === currency) return
  currency = code
  eur = new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 2 })
  eurCompact = new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 })
}
const percent = new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `€1,234.56` in the display currency; whole units with `compact`. */
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
