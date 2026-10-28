import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PortfolioDatabase } from '../data/db.ts'
import { DEFAULT_TAX_RULES, type CapitalGainsRules } from '../engine/analysis/capitalGains.ts'
import type { BaseCurrency } from '../engine/baseCurrency.ts'
import { DEFAULT_OPTIONS, type CostBasisMethod, type Toggles } from '../engine/options.ts'
import type { OtherAsset } from '../engine/otherAssets.ts'
import { DEFAULT_BENCHMARK_ID } from '../market/benchmarks.ts'

/** How the dashboard chart is drawn; switched in its own menu. */
export interface ChartStyle {
  /** A soft fill under the value line, or the line alone. */
  fill: boolean
  /** The dashed line of the invested capital (simple return in percent). */
  invested: boolean
  /** The profit / loss pane under the value, in EUR. */
  profitPane: boolean
  /** A logarithmic value scale, in EUR: equal steps are equal percentages. */
  log: boolean
}

/** A period of the history saved under a name, to open again later. */
export interface NamedPeriod {
  id: string
  name: string
  /** First day, `YYYY-MM-DD`. */
  from: string
  /** Last day; null: up to today, so the period grows along. */
  to: string | null
}

/** The inputs of Analysis > Planning. Percentages are stored as numbers such as 6 for 6%. */
export interface PlanningSettings {
  /** Wanted share in percent per instrument key. */
  targets: Record<string, number>
  /** Money to spread over the positions now. */
  deposit: number
  monthly: number
  yearlyReturn: number
  years: number
  inflation: number
  /** Spending per year to live from the portfolio; 0: no FIRE target. */
  yearlySpending: number
}

export const DEFAULT_PLANNING: PlanningSettings = { targets: {}, deposit: 500, monthly: 500, yearlyReturn: 6, years: 20, inflation: 2, yearlySpending: 0 }

export const DEFAULT_CHART_STYLE: ChartStyle = { fill: true, invested: true, profitPane: true, log: false }

/** Stored only in this browser's IndexedDB. */
export interface Settings {
  /** URL of the deployed workers/price-proxy, without trailing slash. */
  proxyUrl: string
  twelveDataKey: string
  alphaVantageKey: string
  /** Id from BENCHMARKS, compared with the portfolio on the dashboard; empty: no benchmark. */
  benchmarkId: string
  /** Other benchmarks shown next to the main one. */
  extraBenchmarkIds: string[]
  /** Percent per benchmark id of a mix shown as one more benchmark; empty or not 100 in total: no mix. */
  benchmarkMix: Record<string, number>
  /** Whether the mix is drawn; switched on the dashboard without losing its percentages. */
  benchmarkMixShown: boolean
  costBasis: CostBasisMethod
  /** Dashboard checkboxes; remembered between visits. */
  toggles: Toggles
  /** Rules of the capital gains tax estimate: a country's preset, possibly adjusted. */
  taxRules: CapitalGainsRules
  chartStyle: ChartStyle
  /** Saved periods, oldest saved first. */
  periods: NamedPeriod[]
  planning: PlanningSettings
  /** Currency in which every amount is shown and calculated, converted at the ECB rate of each day. */
  baseCurrency: BaseCurrency
  /** Savings, pension savings, real estate and debts outside the brokers, for the net worth. */
  otherAssets: OtherAsset[]
}

/** Settings edited as text in the settings form. */
export type TextSetting = 'proxyUrl' | 'twelveDataKey' | 'alphaVantageKey' | 'benchmarkId'

const { costBasis: defaultCostBasis, ...defaultToggles } = DEFAULT_OPTIONS

/** The project's own deployment of workers/price-proxy (Cloudflare Workers Builds from main). */
export const DEFAULT_PROXY_URL = 'https://portfolio-history-price-proxy.tibo-dhave.workers.dev'

export const DEFAULT_SETTINGS: Settings = {
  proxyUrl: DEFAULT_PROXY_URL,
  twelveDataKey: '',
  alphaVantageKey: '',
  benchmarkId: DEFAULT_BENCHMARK_ID,
  extraBenchmarkIds: [],
  benchmarkMix: {},
  benchmarkMixShown: true,
  costBasis: defaultCostBasis,
  toggles: defaultToggles,
  taxRules: DEFAULT_TAX_RULES,
  chartStyle: DEFAULT_CHART_STYLE,
  periods: [],
  planning: DEFAULT_PLANNING,
  baseCurrency: 'EUR',
  otherAssets: [],
}

const SETTINGS_KEY = 'settings'

export async function loadSettings(database: PortfolioDatabase = db): Promise<Settings> {
  const stored = (await database.kv.get(SETTINGS_KEY))?.value
  if (!stored) return DEFAULT_SETTINGS
  try {
    const parsed = JSON.parse(stored) as Partial<Settings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      toggles: { ...DEFAULT_SETTINGS.toggles, ...parsed.toggles },
      taxRules: { ...DEFAULT_SETTINGS.taxRules, ...parsed.taxRules },
      chartStyle: { ...DEFAULT_CHART_STYLE, ...parsed.chartStyle },
      planning: { ...DEFAULT_PLANNING, ...parsed.planning },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(changes: Partial<Settings>, database: PortfolioDatabase = db): Promise<Settings> {
  const next = { ...(await loadSettings(database)), ...changes }
  next.proxyUrl = next.proxyUrl.trim().replace(/\/+$/, '')
  next.twelveDataKey = next.twelveDataKey.trim()
  next.alphaVantageKey = next.alphaVantageKey.trim()
  await database.kv.put({ key: SETTINGS_KEY, value: JSON.stringify(next) })
  return next
}

let updates: Promise<unknown> = Promise.resolve()

/**
 * Changes settings based on what is stored at that moment, one update after the other: two quick
 * clicks then both count, where two saves from the same rendered settings would lose the first.
 */
export function updateSettings(change: (current: Settings) => Partial<Settings>, database: PortfolioDatabase = db): Promise<Settings> {
  const next = updates.then(async () => saveSettings(change(await loadSettings(database)), database))
  updates = next.catch(() => undefined)
  return next
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => loadSettings())
}
