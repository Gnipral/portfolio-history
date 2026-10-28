/**
 * The texts of the app. The app is in English only; texts stay wrapped in t() so they can be filled in
 * with values, and so a translation can be added again without touching every component.
 */
export type Language = 'en'

export function language(): Language {
  return 'en'
}

/** Locale for dates and numbers: British English, with the day before the month as on the continent. */
export function locale(): string {
  return 'en-GB'
}

/** The text with `{name}` filled in from `values`. */
export function t(text: string, values?: Record<string, string | number>): string {
  return values ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match)) : text
}

/** Plural: `one` when count is 1, else `other`. */
export function tn(count: number, one: string, other: string, values?: Record<string, string | number>): string {
  return t(count === 1 ? one : other, { count, ...values })
}

/** Marks a text shown later through t(), e.g. a label in a list of options. */
export function msg(text: string): string {
  return text
}
