import type { EngineOptions, ToggleKey, Toggles } from '../../engine/options.ts'
import type { Capabilities, CapabilityReasons } from '../../import/types.ts'
import type { Settings } from '../../settings/settings.ts'

export interface ToggleInfo {
  key: ToggleKey
  label: string
  capability: keyof Capabilities
}

export const TOGGLES: ToggleInfo[] = [
  { key: 'includeDividends', label: 'Dividends', capability: 'dividends' },
  { key: 'includeCosts', label: 'Transaction costs', capability: 'transactionCosts' },
  { key: 'includeTaxes', label: 'Taxes (TOB)', capability: 'taxes' },
  { key: 'includeFxCosts', label: 'FX costs', capability: 'fxCosts' },
  { key: 'includeDeposits', label: 'Deposits and withdrawals', capability: 'deposits' },
]

export interface ToggleState extends ToggleInfo {
  checked: boolean
  /** Why the toggle is unavailable; undefined when the export has this data. */
  disabledReason?: string
}

export function toggleStates(toggles: Toggles, capabilities: Capabilities | undefined, reasons: CapabilityReasons = {}): ToggleState[] {
  return TOGGLES.map((info) => {
    const available = capabilities ? capabilities[info.capability] : true
    return {
      ...info,
      checked: available && toggles[info.key],
      ...(available ? {} : { disabledReason: reasons[info.capability] ?? 'Not in this export.' }),
    }
  })
}

/** Engine options from the settings; a toggle without data in the export counts as off. */
export function engineOptions(settings: Settings, capabilities: Capabilities | undefined): EngineOptions {
  const options = { costBasis: settings.costBasis, ...settings.toggles }
  for (const toggle of TOGGLES) {
    if (capabilities && !capabilities[toggle.capability]) options[toggle.key] = false
  }
  return options
}
