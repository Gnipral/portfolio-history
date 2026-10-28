import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router'
import { db } from '../../data/db.ts'
import { CostsSection } from '../analysis/CostsSection.tsx'
import { DividendsSection } from '../analysis/DividendsSection.tsx'
import { PlanningSection } from '../analysis/PlanningSection.tsx'
import { RealizedSection } from '../analysis/RealizedSection.tsx'
import { RiskSection } from '../analysis/RiskSection.tsx'
import { TaxesSection } from '../analysis/TaxesSection.tsx'
import { engineOptions } from '../dashboard/toggles.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { DEFAULT_SETTINGS, saveSettings, useSettings } from '../../settings/settings.ts'

const TABS = [
  { key: 'taxes', label: 'Taxes' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'realized', label: 'Realized' },
  { key: 'costs', label: 'Costs' },
  { key: 'risk', label: 'Risk' },
  { key: 'planning', label: 'Planning' },
] as const

type Tab = (typeof TABS)[number]['key']

/** Yearly overviews and risk figures of the imported portfolio. */
export function AnalysisPage() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const importRecord = useLiveQuery(() => db.imports.get('current'))
  const options = engineOptions(settings, importRecord?.capabilities)
  const { transactionCount, inputs, series } = usePortfolio(options)
  const [tab, setTab] = useState<Tab>('taxes')

  if (transactionCount === undefined) return null
  if (transactionCount === 0) {
    return (
      <section>
        <h2>Analysis</h2>
        <p>
          No portfolio loaded yet. <Link to="/import">Import a broker export</Link> first.
        </p>
      </section>
    )
  }

  return (
    <section className="stack">
      <div className="dashboard-header">
        <h2>Analysis</h2>
        <div className="segmented" role="tablist" aria-label="Analysis">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {!inputs || !series ? (
        <p role="status">Calculating…</p>
      ) : (
        <div role="tabpanel" className="stack">
          {tab === 'taxes' && (
            <TaxesSection inputs={inputs} rules={settings.taxRules} onRulesChange={(taxRules) => void saveSettings({ taxRules })} />
          )}
          {tab === 'dividends' && <DividendsSection inputs={inputs} options={options} />}
          {tab === 'realized' && <RealizedSection inputs={inputs} options={options} />}
          {tab === 'costs' && <CostsSection inputs={inputs} options={options} series={series} />}
          {tab === 'risk' && <RiskSection series={series} />}
          {tab === 'planning' && <PlanningSection inputs={inputs} options={options} series={series} planning={settings.planning} otherAssets={settings.otherAssets} />}
        </div>
      )}
    </section>
  )
}
