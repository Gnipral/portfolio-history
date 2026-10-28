import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const STRING = String.raw`'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"`
const CALL = new RegExp(String.raw`\b(?:t|msg)\(\s*(?:${STRING})`, 'g')
const PLURAL = new RegExp(String.raw`\btn\([^,]+,\s*(?:${STRING})\s*,\s*(?:${STRING})`, 'g')

function unescapeQuotes(text: string): string {
  return text.replace(/\\(.)/g, '$1')
}

/** Every text the app passes to t(), tn() or msg(), read from the source files under `dir`. */
export function sourceKeys(dir: string): Set<string> {
  const keys = new Set<string>()
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/i18n[\\/]nl/.test(path)) {
        const source = readFileSync(path, 'utf8')
        for (const m of source.matchAll(CALL)) keys.add(unescapeQuotes(m[1] ?? m[2] ?? ''))
        for (const m of source.matchAll(PLURAL)) {
          keys.add(unescapeQuotes(m[1] ?? m[2] ?? ''))
          keys.add(unescapeQuotes(m[3] ?? m[4] ?? ''))
        }
      }
    }
  }
  walk(dir)
  keys.delete('')
  return keys
}
