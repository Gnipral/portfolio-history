import { describe, expect, it } from 'vitest'
import { assetValueOn, otherAssetsOn, withValue, type OtherAsset } from './otherAssets.ts'

const savings: OtherAsset = { id: 's', name: 'Savings', kind: 'savings', values: [{ date: '2026-01-01', value: 5000 }] }
const mortgage: OtherAsset = { id: 'm', name: 'Mortgage', kind: 'property', debt: true, values: [{ date: '2026-03-01', value: 100000 }] }

describe('other assets', () => {
  it('values an asset at its last value on or before a date', () => {
    const updated = withValue(withValue(savings, '2026-06-01', 6000), '2026-06-01', 6500)
    expect(updated.values).toEqual([
      { date: '2026-01-01', value: 5000 },
      { date: '2026-06-01', value: 6500 },
    ])
    expect(assetValueOn(updated, '2025-12-31')).toBeUndefined()
    expect(assetValueOn(updated, '2026-05-31')).toBe(5000)
    expect(assetValueOn(updated, '2026-10-28')).toBe(6500)
  })

  it('subtracts debts and counts only assets with a value', () => {
    expect(otherAssetsOn([savings, mortgage], '2026-02-01')).toEqual({ total: 5000, count: 1 })
    expect(otherAssetsOn([savings, mortgage], '2026-04-01')).toEqual({ total: -95000, count: 2 })
  })
})
