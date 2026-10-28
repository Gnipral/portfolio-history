import { useState, type FormEvent } from 'react'
import { assetValueOn, OTHER_ASSET_KINDS, otherAssetsOn, withValue, type OtherAsset, type OtherAssetKind } from '../../engine/otherAssets.ts'
import { localToday } from '../../market/dates.ts'
import { updateSettings } from '../../settings/settings.ts'
import { displayCurrency, formatDate, formatEur } from '../format.ts'

function save(change: (assets: OtherAsset[]) => OtherAsset[]) {
  return updateSettings((current) => ({ otherAssets: change(current.otherAssets) }))
}

const kindLabel = (kind: OtherAssetKind) => OTHER_ASSET_KINDS.find((k) => k.key === kind)?.label ?? kind

/** The portfolio plus what is owned (or owed) outside the brokers, entered by hand. */
export function NetWorthPanel({ portfolioValue, assets }: { portfolioValue: number; assets: OtherAsset[] }) {
  const today = localToday()
  const others = otherAssetsOn(assets, today)
  const [adding, setAdding] = useState(false)

  return (
    <div className="panel">
      <h3>Net worth</h3>
      <p className="muted small">
        Add savings, pension savings, real estate or a mortgage to see everything together. They do not change the returns of the
        portfolio.
      </p>
      <div className="cards">
        <div className="card hero">
          <span className="card-label">Net worth</span>
          <span className="card-value">{formatEur(portfolioValue + others.total, true)}</span>
        </div>
        <div className="card">
          <span className="card-label">Portfolio</span>
          <span className="card-value">{formatEur(portfolioValue, true)}</span>
        </div>
        {assets.length > 0 && (
          <div className="card">
            <span className="card-label">Other assets</span>
            <span className="card-value">{formatEur(others.total, true)}</span>
          </div>
        )}
      </div>
      {assets.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th className="num">Value</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <AssetRow key={asset.id} asset={asset} today={today} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <AddAsset today={today} onDone={() => setAdding(false)} />
      ) : (
        <div className="actions">
          <button type="button" onClick={() => setAdding(true)}>
            Add savings or another asset
          </button>
        </div>
      )}
    </div>
  )
}

function AssetRow({ asset, today }: { asset: OtherAsset; today: string }) {
  const [editing, setEditing] = useState(false)
  const value = assetValueOn(asset, today) ?? 0
  const [draft, setDraft] = useState(Math.abs(value))
  const last = asset.values.at(-1)

  function update(event: FormEvent) {
    event.preventDefault()
    void save((assets) => assets.map((a) => (a.id === asset.id ? withValue(a, today, Math.max(draft, 0)) : a)))
    setEditing(false)
  }

  return (
    <tr>
      <td>{asset.name}</td>
      <td className="muted">{asset.debt ? 'Debt' : kindLabel(asset.kind)}</td>
      <td className="num">
        {editing ? (
          <form onSubmit={update} className="inline-form">
            <input type="number" min={0} step="any" inputMode="decimal" aria-label={`New value of ${asset.name}`} value={draft} onChange={(e) => setDraft(Number(e.target.value) || 0)} autoFocus />
            <button type="submit" className="link-button">
              Save
            </button>
          </form>
        ) : (
          <span className={value < 0 ? 'negative' : ''}>{formatEur(value, true)}</span>
        )}
      </td>
      <td className="muted small">{last ? formatDate(last.date) : ''}</td>
      <td className="row-actions">
        {!editing && (
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Update value
          </button>
        )}
        <button type="button" className="link-button" aria-label={`Remove ${asset.name}`} onClick={() => void save((assets) => assets.filter((a) => a.id !== asset.id))}>
          Remove
        </button>
      </td>
    </tr>
  )
}

function AddAsset({ today, onDone }: { today: string; onDone: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<OtherAssetKind>('savings')
  const [debt, setDebt] = useState(false)
  const [value, setValue] = useState(0)

  function add(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const asset: OtherAsset = { id: crypto.randomUUID(), name: name.trim(), kind, values: [{ date: today, value: Math.max(value, 0) }], ...(debt ? { debt } : {}) }
    void save((assets) => [...assets, asset])
    onDone()
  }

  return (
    <form className="settings-form" onSubmit={add} aria-label="Add an asset">
      <div className="form-grid">
        <label>
          Name
          <input value={name} required placeholder="e.g. Savings account" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as OtherAssetKind)}>
            {OTHER_ASSET_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Value today ({displayCurrency()})
          <input type="number" min={0} step="any" inputMode="decimal" value={value || ''} onChange={(e) => setValue(Number(e.target.value) || 0)} />
        </label>
        <label className="radio">
          <input type="checkbox" checked={debt} onChange={(e) => setDebt(e.target.checked)} />
          It is a debt, such as a mortgage
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="primary">
          Add
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}
