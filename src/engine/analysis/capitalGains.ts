import type { Transaction } from '../../model/transaction.ts'
import { Ledger, sortTransactions, type Holding, type Sale } from '../ledger.ts'
import type { CostBasisMethod, EngineOptions } from '../options.ts'

/**
 * The rules of a tax on realized capital gains, simple enough to fit most countries: a flat rate on
 * the net gains of a calendar year above a yearly exemption. Every field can be changed by the user,
 * so the presets below are only a starting point.
 */
export interface CapitalGainsRules {
  /** Preset the rules started from (see TAX_PRESETS), or `custom`. */
  country: string
  /** Tax rate as a fraction, e.g. 0.1 for 10%. */
  rate: number
  /** Net gains of a year that are not taxed. */
  yearlyExemption: number
  /** Part of an unused yearly exemption that carries over to the next year. */
  exemptionCarryOver: number
  /** Highest exemption of a year, carried-over part included. */
  maxExemption: number
  /** Years a net loss can offset later gains: 0 = only within its own year, 99 = without limit. */
  lossCarryForwardYears: number
  /** How the units sold are matched with their purchases. */
  costBasis: CostBasisMethod
  /** First year whose sales are taxed; null = every year. */
  firstTaxedYear: number | null
  /** What was held on this date counts at its market value of that day as cost basis; null = no step-up. */
  referenceDate: string | null
  /** With a reference date: its value always (`value`), or only when higher than the purchase price (`higher`). */
  stepUp: 'value' | 'higher'
  /** Whether commissions and taxes on trades lower the gain. */
  deductCharges: boolean
}

export interface TaxPreset {
  id: string
  label: string
  rules: CapitalGainsRules
  /** What the simple rules leave out, shown under the result. */
  notes: string[]
}

/**
 * Presets as the rules stood in 2026, for an individual investor. They are estimates: check the
 * rates and exemptions of your own situation and change them where needed.
 */
export const TAX_PRESETS: TaxPreset[] = [
  {
    id: 'BE',
    label: 'Belgium',
    rules: {
      country: 'BE',
      rate: 0.1,
      yearlyExemption: 10_000,
      exemptionCarryOver: 1_000,
      maxExemption: 15_000,
      lossCarryForwardYears: 0,
      costBasis: 'average',
      firstTaxedYear: 2026,
      referenceDate: '2025-12-31',
      stepUp: 'higher',
      deductCharges: true,
    },
    notes: [
      'Solidarity contribution on gains from 2026. What you held on 31 December 2025 counts at its value of that day, or at its purchase price when that is higher (allowed for sales until 2030).',
      'The exemption is indexed every year. Higher rates apply to gains on a substantial shareholding.',
    ],
  },
  {
    id: 'DE',
    label: 'Germany',
    rules: {
      country: 'DE',
      // 25% Abgeltungsteuer plus 5.5% solidarity surcharge on it, without church tax.
      rate: 0.26375,
      yearlyExemption: 1_000,
      exemptionCarryOver: 0,
      maxExemption: 1_000,
      lossCarryForwardYears: 99,
      costBasis: 'fifo',
      firstTaxedYear: null,
      referenceDate: null,
      stepUp: 'value',
      deductCharges: true,
    },
    notes: [
      'The Sparer-Pauschbetrag (1,000 per person, 2,000 for a couple) also covers dividends and interest. Church tax is not included.',
      'Shares bought before 2009 are exempt, equity funds get a partial exemption (Teilfreistellung), and losses on shares only offset gains on shares: not modelled.',
    ],
  },
  {
    id: 'FR',
    label: 'France',
    rules: {
      country: 'FR',
      // Prélèvement forfaitaire unique: 12.8% income tax and 17.2% social charges.
      rate: 0.3,
      yearlyExemption: 0,
      exemptionCarryOver: 0,
      maxExemption: 0,
      lossCarryForwardYears: 10,
      costBasis: 'average',
      firstTaxedYear: null,
      referenceDate: null,
      stepUp: 'value',
      deductCharges: true,
    },
    notes: [
      'Flat tax (PFU); check the current rate of the social charges. A PEA and the option for the progressive scale are not modelled.',
    ],
  },
  {
    id: 'NL',
    label: 'Netherlands',
    rules: {
      country: 'NL',
      rate: 0,
      yearlyExemption: 0,
      exemptionCarryOver: 0,
      maxExemption: 0,
      lossCarryForwardYears: 0,
      costBasis: 'average',
      firstTaxedYear: null,
      referenceDate: null,
      stepUp: 'value',
      deductCharges: true,
    },
    notes: ['Box 3 taxes an assumed return on your wealth, not realized gains, so there is no tax on the sales themselves.'],
  },
  {
    id: 'custom',
    label: 'Other country (own rules)',
    rules: {
      country: 'custom',
      rate: 0,
      yearlyExemption: 0,
      exemptionCarryOver: 0,
      maxExemption: 0,
      lossCarryForwardYears: 0,
      costBasis: 'average',
      firstTaxedYear: null,
      referenceDate: null,
      stepUp: 'value',
      deductCharges: true,
    },
    notes: ['Fill in the rate, exemption and loss rules of your country.'],
  },
]

export const DEFAULT_TAX_RULES: CapitalGainsRules = (TAX_PRESETS[0] as TaxPreset).rules

export function presetOf(rules: CapitalGainsRules): TaxPreset {
  return TAX_PRESETS.find((p) => p.id === rules.country) ?? (TAX_PRESETS.at(-1) as TaxPreset)
}

/** True when the rules differ from the preset they started from. */
export function isAdjusted(rules: CapitalGainsRules): boolean {
  const preset = presetOf(rules).rules
  return (Object.keys(preset) as (keyof CapitalGainsRules)[]).some((key) => preset[key] !== rules[key])
}

export interface CapitalGainsYear {
  year: string
  gains: number
  losses: number
  /** Gains minus losses of the year. */
  net: number
  /** Earlier losses used against this year's gains. */
  lossesCarriedIn: number
  /** Exemption available this year, including what was carried over. */
  exemption: number
  taxable: number
  tax: number
}

export interface CapitalGainsResult {
  years: CapitalGainsYear[]
  /** Taxed sales, with the cost basis the rules give them. */
  sales: Sale[]
  /** Products held on the reference date without a market price: their purchase price is used. */
  withoutReference: string[]
}

/**
 * Tax per year on the sales of `transactions` under `rules`, until `today`. `priceOf` gives the EUR
 * market price per unit of a holding on a date (the dashboard's price book), for the step-up.
 */
export function capitalGainsTax(
  transactions: Transaction[],
  rules: CapitalGainsRules,
  priceOf: (holding: Holding, date: string) => number | undefined,
  today: string,
): CapitalGainsResult {
  const ordered = sortTransactions(transactions)
  const options: EngineOptions = {
    costBasis: rules.costBasis,
    includeDividends: true,
    includeCosts: rules.deductCharges,
    includeTaxes: rules.deductCharges,
    includeFxCosts: rules.deductCharges,
    includeDeposits: false,
  }
  const ledger = new Ledger(options, false, { transactions: ordered })
  const withoutReference: string[] = []
  const referenceDate = rules.referenceDate
  let steppedUp = referenceDate === null
  const stepUp = () => {
    steppedUp = true
    ledger.stepUp((holding) => {
      const price = priceOf(holding, referenceDate as string)
      if (price === undefined) withoutReference.push(holding.product)
      return price
    }, rules.stepUp)
  }
  for (const t of ordered) {
    if (!steppedUp && t.date > (referenceDate as string)) stepUp()
    ledger.apply(t)
  }
  if (!steppedUp && today > (referenceDate as string)) stepUp()

  const taxedYear = (date: string) => rules.firstTaxedYear === null || Number(date.slice(0, 4)) >= rules.firstTaxedYear
  const sales = ledger.sales.filter((s) => taxedYear(s.date))
  const first = rules.firstTaxedYear ?? Number((sales[0]?.date ?? today).slice(0, 4))
  const years: CapitalGainsYear[] = []
  let carried = 0
  // Net losses still to be used, with the year they were made.
  const lossPool: { year: number; amount: number }[] = []
  for (let year = first; year <= Number(today.slice(0, 4)); year++) {
    const ofYear = sales.filter((s) => s.date.startsWith(String(year)))
    const gains = ofYear.reduce((sum, s) => sum + Math.max(s.gain, 0), 0)
    const losses = ofYear.reduce((sum, s) => sum + Math.max(-s.gain, 0), 0)
    const net = gains - losses
    // Losses older than the carry-forward period expire.
    while (lossPool.length && (lossPool[0] as { year: number }).year < year - rules.lossCarryForwardYears) lossPool.shift()
    let lossesCarriedIn = 0
    let remaining = net
    while (remaining > 0 && lossPool.length) {
      const oldest = lossPool[0] as { year: number; amount: number }
      const use = Math.min(oldest.amount, remaining)
      oldest.amount -= use
      remaining -= use
      lossesCarriedIn += use
      if (oldest.amount <= 1e-9) lossPool.shift()
    }
    if (net < 0 && rules.lossCarryForwardYears > 0) lossPool.push({ year, amount: -net })

    const exemption = Math.min(rules.yearlyExemption + carried, Math.max(rules.maxExemption, rules.yearlyExemption))
    const taxable = Math.max(0, remaining - exemption)
    years.push({ year: String(year), gains, losses, net, lossesCarriedIn, exemption, taxable, tax: taxable * rules.rate })
    // Gains above the yearly exemption use up what was carried over; part of an unused yearly exemption carries over.
    const used = Math.min(Math.max(remaining, 0), exemption)
    carried += Math.min(Math.max(0, rules.yearlyExemption - used), rules.exemptionCarryOver) - Math.max(0, used - rules.yearlyExemption)
    carried = Math.max(0, Math.min(carried, rules.maxExemption - rules.yearlyExemption))
  }
  return { years, sales, withoutReference: [...new Set(withoutReference)] }
}
