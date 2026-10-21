import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { PortfolioDatabase } from '../data/db.ts'
import { DEFAULT_PROXY_URL, loadSettings, saveSettings, updateSettings } from './settings.ts'

const database = new PortfolioDatabase('test-settings')
afterEach(async () => {
  await database.delete()
  await database.open()
})

describe('settings', () => {
  it('uses the project proxy by default', async () => {
    expect((await loadSettings(database)).proxyUrl).toBe(DEFAULT_PROXY_URL)
  })

  it('trims input and keeps an explicitly cleared proxy URL', async () => {
    await saveSettings({ proxyUrl: ' https://my-proxy.example.dev/ ', twelveDataKey: ' key ' }, database)
    expect(await loadSettings(database)).toMatchObject({ proxyUrl: 'https://my-proxy.example.dev', twelveDataKey: 'key' })

    await saveSettings({ proxyUrl: '' }, database)
    expect((await loadSettings(database)).proxyUrl).toBe('')
  })

  it('applies quick updates one after the other, each on the stored settings', async () => {
    const add = (id: string) => (current: { extraBenchmarkIds: string[] }) => ({ extraBenchmarkIds: [...current.extraBenchmarkIds, id] })
    await Promise.all([updateSettings(add('vwce'), database), updateSettings(add('sxr8'), database)])
    expect((await loadSettings(database)).extraBenchmarkIds).toEqual(['vwce', 'sxr8'])
  })
})
