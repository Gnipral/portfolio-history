import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { degiroAdapter } from '../import/adapters/degiro/index.ts'
import { SAMPLE_ROWS, table } from '../import/adapters/degiro/fixtures.ts'
import { loadSettings, saveSettings } from '../settings/settings.ts'
import { backupFileName, backupNeedsPassword, backupText, collectBackup, readBackup, restoreBackup } from './backup.ts'
import { PortfolioDatabase } from './db.ts'
import { replacePortfolio } from './portfolio.ts'

const source = new PortfolioDatabase('test-backup-source')
const target = new PortfolioDatabase('test-backup-target')

async function fill() {
  await replacePortfolio(degiroAdapter.parse([table(SAMPLE_ROWS)]), ['a.csv'], source)
  await source.symbols.put({ key: 'IE00B4L5Y983', symbol: 'IWDA.AS', kind: 'security', source: 'manual', resolvedAt: '2026-01-01T00:00:00Z' })
  await saveSettings({ costBasis: 'fifo', twelveDataKey: 'secret-key' }, source)
}

afterEach(async () => {
  for (const database of [source, target]) {
    await database.delete()
    await database.open()
  }
})

describe('backup', () => {
  it('restores the portfolio, ticker choices and settings in another browser', async () => {
    await fill()
    const text = await backupText(await collectBackup(source))
    expect(backupNeedsPassword(text)).toBe(false)

    await target.prices.put({ symbol: 'X', date: '2026-01-02', close: 1 })
    await restoreBackup(await readBackup(text), target)
    expect(await target.transactions.count()).toBe(await source.transactions.count())
    expect((await target.imports.get('current'))?.broker).toBe('DEGIRO')
    expect((await target.symbols.get('IE00B4L5Y983'))?.symbol).toBe('IWDA.AS')
    expect(await loadSettings(target)).toMatchObject({ costBasis: 'fifo', twelveDataKey: 'secret-key' })
    expect(await target.prices.count()).toBe(1)
  })

  it('encrypts with a password', async () => {
    await fill()
    const text = await backupText(await collectBackup(source), 'hunter2')
    expect(text).not.toContain('secret-key')
    expect(text).not.toContain('DEGIRO')
    expect(backupNeedsPassword(text)).toBe(true)
    await expect(readBackup(text)).rejects.toThrow('protected with a password')
    await expect(readBackup(text, 'wrong')).rejects.toThrow('Wrong password')
    expect((await readBackup(text, 'hunter2')).settings.twelveDataKey).toBe('secret-key')
  })

  it('refuses other files', async () => {
    await expect(readBackup('{"hello":1}')).rejects.toThrow('not a Portfolio History backup')
    await expect(readBackup('Date,Product')).rejects.toThrow('not a Portfolio History backup')
    await expect(readBackup('{"app":"portfolio-history","v":2}')).rejects.toThrow('newer version')
  })

  it('names the file after the day', () => {
    expect(backupFileName(new Date('2026-10-28T12:00:00Z'))).toBe('portfolio-history-backup-2026-10-28.json')
  })
})
