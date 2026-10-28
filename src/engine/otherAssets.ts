/** Something owned outside the broker accounts, valued by hand now and then. */
export interface OtherAsset {
  id: string
  name: string
  kind: OtherAssetKind
  /** Values entered by hand, oldest first; one per date. */
  values: { date: string; value: number }[]
  /** Owed rather than owned, such as a mortgage: counts negative. */
  debt?: boolean
}

export type OtherAssetKind = 'savings' | 'pension' | 'property' | 'other'

export const OTHER_ASSET_KINDS: { key: OtherAssetKind; label: string }[] = [
  { key: 'savings', label: 'Savings account' },
  { key: 'pension', label: 'Pension savings' },
  { key: 'property', label: 'Real estate' },
  { key: 'other', label: 'Other' },
]

/** The last value entered on or before `date`; undefined before the first one. */
export function assetValueOn(asset: OtherAsset, date: string): number | undefined {
  let value: number | undefined
  for (const v of asset.values) if (v.date <= date) value = v.value
  return value === undefined ? undefined : asset.debt ? -value : value
}

/** The sum of the other assets on `date`, debts subtracted, and how many had a value then. */
export function otherAssetsOn(assets: OtherAsset[], date: string): { total: number; count: number } {
  let total = 0
  let count = 0
  for (const asset of assets) {
    const value = assetValueOn(asset, date)
    if (value === undefined) continue
    total += value
    count++
  }
  return { total, count }
}

/** Sets the value of `date`, replacing a value entered for that same date. */
export function withValue(asset: OtherAsset, date: string, value: number): OtherAsset {
  const values = [...asset.values.filter((v) => v.date !== date), { date, value }].sort((a, b) => a.date.localeCompare(b.date))
  return { ...asset, values }
}
