import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../settings/settings.ts'
import { engineOptions, toggleStates } from './toggles.ts'

const degiro = { transactionCosts: true, fxCosts: true, taxes: false, dividends: false, deposits: false }

describe('toggles', () => {
  it('disables toggles for data the export does not contain, with the reason', () => {
    const states = toggleStates(DEFAULT_SETTINGS.toggles, degiro, { dividends: 'No dividends in this export.' })
    const byKey = Object.fromEntries(states.map((s) => [s.key, s]))
    expect(byKey.includeCosts).toMatchObject({ checked: true })
    expect(byKey.includeCosts?.disabledReason).toBeUndefined()
    expect(byKey.includeDividends).toMatchObject({ checked: false, disabledReason: 'No dividends in this export.' })
    expect(byKey.includeTaxes?.disabledReason).toBe('Not in this export.')
  })

  it('keeps everything available before an import is known', () => {
    expect(toggleStates(DEFAULT_SETTINGS.toggles, undefined).every((s) => s.checked && !s.disabledReason)).toBe(true)
  })

  it('builds engine options from the settings, switching off what is not in the export', () => {
    const settings = { ...DEFAULT_SETTINGS, costBasis: 'fifo' as const, toggles: { ...DEFAULT_SETTINGS.toggles, includeCosts: false } }
    expect(engineOptions(settings, degiro)).toEqual({
      costBasis: 'fifo',
      includeDividends: false,
      includeCosts: false,
      includeTaxes: false,
      includeFxCosts: true,
      includeDeposits: false,
    })
  })
})
