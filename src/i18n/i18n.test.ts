import { describe, expect, it } from 'vitest'
import { detectLanguage, setLanguageForTests, t, tn } from './i18n.ts'
import { sourceKeys } from './keys.ts'
import { nl } from './nl.ts'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const tags = (text: string) => [...text.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort()

describe('Dutch dictionary', () => {
  const keys = sourceKeys('src')

  it('translates every text of the app', () => {
    expect([...keys].filter((key) => !(key in nl))).toEqual([])
  })

  it('keeps the placeholders and tags of every text', () => {
    const broken = Object.entries(nl).filter(
      ([en, text]) => placeholders(en).join() !== placeholders(text).join() || tags(en).join() !== tags(text).join(),
    )
    expect(broken).toEqual([])
  })

  it('has no texts the app no longer uses', () => {
    const extra = Object.keys(nl).filter((key) => !keys.has(key) && !['1M', '3M', '1Y'].includes(key))
    expect(extra).toEqual([])
  })
})

describe('t', () => {
  it('fills in values and falls back to English', () => {
    setLanguageForTests('nl')
    expect(t('Imported {count} transactions.', { count: 3 })).toBe('3 transacties geïmporteerd.')
    expect(tn(1, '{count} product has no price yet', '{count} products have no price yet')).toBe('1 product heeft nog geen koers')
    expect(t('Not a key')).toBe('Not a key')
    setLanguageForTests('en')
    expect(t('Imported {count} transactions.', { count: 3 })).toBe('Imported 3 transactions.')
  })

  it('follows the choice, else a Dutch browser', () => {
    expect(detectLanguage('en', ['nl-BE'])).toBe('en')
    expect(detectLanguage(null, ['nl-BE', 'en'])).toBe('nl')
    expect(detectLanguage(null, ['fr-BE', 'nl'])).toBe('nl')
    expect(detectLanguage(null, ['en-US'])).toBe('en')
  })
})
