import { describe, expect, it } from 'vitest'
import type { ShareCard } from './shareCard.ts'
import { readShareLink, shareLink, SHARE_ROUTE } from './shareLink.ts'

const card: ShareCard = {
  from: '2025-01-01',
  to: '2026-02-04',
  twr: 0.399,
  curve: Array.from({ length: 120 }, (_, i) => Math.round(i * 3.3) / 10),
  benchmark: { label: 'VWCE', twr: 0.1995, curve: [0, 5, 10, 20] },
  allocation: [{ label: 'ETFs', percent: 72, slot: 1 }],
  positions: [
    { name: 'VWCE', weight: 69, return: 0.339 },
    { name: 'Other 3', weight: 14, return: 0.05, others: 3 },
  ],
}

const dataOf = (link: string) => link.split(`#${SHARE_ROUTE}`)[1]!

describe('share links', () => {
  it('hold the whole card, compressed, after the #', async () => {
    const link = await shareLink(card)
    expect(link.startsWith('https://gnipral.github.io/portfolio-history/#/s/')).toBe(true)
    expect(link.length).toBeLessThan(2000)
    expect(await readShareLink(dataOf(link))).toEqual(card)
  })

  it('refuse a cut-off or made-up link', async () => {
    const data = dataOf(await shareLink(card))
    expect(await readShareLink(data.slice(0, 40))).toBeNull()
    expect(await readShareLink('not-a-card')).toBeNull()
    expect(await readShareLink('')).toBeNull()
  })

  it('refuse a card with wrong types or sizes', async () => {
    const bad = async (change: Record<string, unknown>) => readShareLink(dataOf(await shareLink({ ...card, ...change } as ShareCard)))
    expect(await bad({ twr: 'a lot' })).toBeNull()
    expect(await bad({ from: '<script>' })).toBeNull()
    expect(await bad({ curve: Array.from({ length: 5000 }, () => 1) })).toBeNull()
    expect(await bad({ positions: [{ name: 'x'.repeat(500), weight: 1, return: 0 }] })).toBeNull()
  })
})
