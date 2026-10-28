import { nl } from './nl.ts'

/**
 * Translation: the English text is the key, a dictionary per language gives the translation. A text
 * without one stays English. The language is fixed for the page; changing it reloads the app.
 */
export type Language = 'en' | 'nl'

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'nl', label: 'Nederlands' },
]

const KEY = 'portfolio-history:language'
const DICTIONARIES: Record<Language, Record<string, string>> = { en: {}, nl }

function stored(): Language | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'en' || value === 'nl' ? value : null
  } catch {
    return null
  }
}

/** The language chosen in Settings, else Dutch: the app is made for Dutch-speaking investors first. */
export function detectLanguage(chosen = stored()): Language {
  return chosen ?? 'nl'
}

let current: Language = detectLanguage()

export function language(): Language {
  return current
}

/** Locale for dates and numbers: Belgian Dutch or British English (day before month, as on the continent). */
export function locale(): string {
  return current === 'nl' ? 'nl-BE' : 'en-GB'
}

/** Stores the choice and restarts the app in that language. */
export function setLanguage(next: Language): void {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    return
  }
  window.location.reload()
}

/** For tests: switch without storing or reloading. */
export function setLanguageForTests(next: Language): void {
  current = next
}

/** The text in the current language, with `{name}` filled in from `values`. */
export function t(text: string, values?: Record<string, string | number>): string {
  const translated = DICTIONARIES[current][text] ?? text
  return values ? translated.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match)) : translated
}

/** Plural: `one` when count is 1, else `other`; both are keys of their own. */
export function tn(count: number, one: string, other: string, values?: Record<string, string | number>): string {
  return t(count === 1 ? one : other, { count, ...values })
}

/** Marks a text that is translated later with t(), e.g. a label in a list of options, so the dictionary test finds it. */
export function msg(text: string): string {
  return text
}
