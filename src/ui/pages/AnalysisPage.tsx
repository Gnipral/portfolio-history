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
import { CurrencyNotice } from '../dashboard/CurrencyNotice.tsx'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { ErrorBoundary } from '../errors/ErrorBoundary.tsx'
import { t } from '../../i18n/i18n.ts'
import { Rich } from '../../i18n/Rich.tsx'
import { DEFAULT_SETTINGS, saveSettings, useSettings } from '../../settings/settings.ts'

const TABS = [
  { key: 'taxes', label: t('Taxes') },
  { key: 'dividends', label: t('Dividends') },
  { key: 'realized', label: t('Realized') },
  { key: 'costs', label: t('Costs') },
  { key: 'risk', label: t('Risk') },
  { key: 'planning', label: t('Planning') },
] as const

type Tab = (typeof TABS)[number]['key']

/** Yearly overviews and risk figures of the imported portfolio. */
export function AnalysisPage() {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const importRecord = useLiveQuery(() => db.imports.get('current'))
  const options = engineOptions(settings, importRecord?.capabilities)
  const { transactionCount, inputs, series, currencyFallback } = usePortfolio(options)
  const [tab, setTab] = useState<Tab>('taxes')

  if (transactionCount === undefined) return null
  if (transactionCount === 0) {
    return (
      <section>
        <h2>{t('Analysis')}</h2>
        <p>
          <Rich text={t('No portfolio loaded yet. <link>Import a broker export</link> first.')} tags={{ link: (s) => <Link to="/import">{s}</Link> }} />
        </p>
      </section>
    )
  }

  return (
    <section className="stack">
      <div className="dashboard-header">
        <h2>{t('Analysis')}</h2>
        <div className="segmented" role="tablist" aria-label={t('Analysis')}>
          {TABS.map((tab_) => (
            <button key={tab_.key} type="button" role="tab" aria-selected={tab === tab_.key} aria-pressed={tab === tab_.key} onClick={() => setTab(tab_.key)}>
              {t(tab_.label)}
            </button>
          ))}
        </div>
      </div>
      <CurrencyNotice currency={currencyFallback} />
      {!inputs || !series ? (
        <p role="status">{t('Calculating…')}</p>
      ) : (
        <div role="tabpanel" className="stack">
          <ErrorBoundary label={t('This analysis')} resetKey={tab}>
            {tab === 'taxes' && (
              <TaxesSection inputs={inputs} rules={settings.taxRules} onRulesChange={(taxRules) => void saveSettings({ taxRules })} />
            )}
            {tab === 'dividends' && <DividendsSection inputs={inputs} options={options} />}
            {tab === 'realized' && <RealizedSection inputs={inputs} options={options} />}
            {tab === 'costs' && <CostsSection inputs={inputs} options={options} series={series} />}
            {tab === 'risk' && <RiskSection series={series} />}
            {tab === 'planning' && <PlanningSection inputs={inputs} options={options} series={series} planning={settings.planning} otherAssets={settings.otherAssets} />}
          </ErrorBoundary>
        </div>
      )}
    </section>
  )
}
