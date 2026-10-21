import type { EngineOptions, ToggleKey, Toggles } from '../../engine/options.ts'
import type { Capabilities, CapabilityReasons } from '../../import/types.ts'
import type { Settings } from '../../settings/settings.ts'

export type ToggleGroup = 'Costs' | 'Income' | 'Cash'

export interface ToggleInfo {
  key: ToggleKey
  label: string
  group: ToggleGroup
  /** What the option does when it is on. */
  description: string
  capability: keyof Capabilities
}

export const TOGGLE_GROUPS: ToggleGroup[] = ['Costs', 'Income', 'Cash']

export const TOGGLES: ToggleInfo[] = [
  {
    key: 'includeCosts',
    label: 'Transaction costs',
    group: 'Costs',
    description: 'Broker fees on buys and sells, and other fees.',
    capability: 'transactionCosts',
  },
  {
    key: 'includeTaxes',
    label: 'Taxes',
    group: 'Costs',
    description: 'Stock exchange tax (TOB) and withholding tax on dividends.',
    capability: 'taxes',
  },
  {
    key: 'includeFxCosts',
    label: 'Currency conversion costs',
    group: 'Costs',
    description: 'Costs of converting to another currency, e.g. DEGIRO AutoFX.',
    capability: 'fxCosts',
  },
  {
    key: 'includeDividends',
    label: 'Dividends',
    group: 'Income',
    description: 'Payouts count as profit.',
    capability: 'dividends',
  },
  {
    key: 'includeDeposits',
    label: 'Deposits and withdrawals',
    group: 'Cash',
    description:
      'The value includes your cash, and only deposits and withdrawals count as money in or out. Off: securities only, every buy and sale is money in or out.',
    capability: 'deposits',
  },
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
