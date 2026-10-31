import { useMemo, type ReactNode } from 'react'
import { riskChecks, THRESHOLDS, type RuleStatus, type Share } from '../../engine/analysis/riskChecks.ts'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import type { EngineOptions } from '../../engine/options.ts'
import type { OtherAsset } from '../../engine/otherAssets.ts'
import { positionsOn } from '../../engine/positions.ts'
import type { SeriesResult } from '../../engine/series.ts'
import { locale, t } from '../../i18n/i18n.ts'
import { formatEur, formatPercent } from '../format.ts'

interface Rule {
  id: string
  status: RuleStatus
  title: string
  /** What was found, in numbers. */
  finding: ReactNode
  /** Why it matters, shown when the rule warns or cannot be checked. */
  advice?: string
}

const whole = new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat(locale(), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** A threshold, e.g. 10%. */
const limit = (share: number) => whole.format(share)
/** A share found in the portfolio, e.g. 12.3%. */
const pct = (share: number) => oneDecimal.format(share)
const shares = (list: Share[]) => list.map((s) => `${s.label} ${pct(s.share)}`).join(', ')

interface Props {
  inputs: EngineInputs
  options: EngineOptions
  series: SeriesResult
  otherAssets: OtherAsset[]
  yearlySpending: number
  /** With what was found and why it matters; the short list shows only the rules and whether they pass. */
  detail?: boolean
}

/** Rules of thumb on how the portfolio is spread today, after Ghostfolio's X-ray, as a pass/look list. */
export function RiskChecksPanel({ inputs, options, series, otherAssets, yearlySpending, detail = true }: Props) {
  const last = series.points.at(-1)
  const checks = useMemo(() => {
    if (!last) return null
    return riskChecks({
      transactions: inputs.transactions,
      positions: positionsOn(inputs.transactions, inputs.prices, options, last.date),
      portfolioValue: last.value,
      cashMode: series.cashMode,
      baseCurrency: inputs.currency,
      otherAssets,
      yearlySpending,
      date: last.date,
    })
  }, [inputs, options, series, last, otherAssets, yearlySpending])
  if (!checks) return null

  const { singleStock, spread, crypto, currency, fees, cash, emergency } = checks
  const rules: Rule[] = [
    {
      id: 'single-stock',
      status: singleStock.status,
      title: t('No single stock above {limit}', { limit: limit(THRESHOLDS.singleStock) }),
      finding: singleStock.heavy.length > 0 ? shares(singleStock.heavy) : t('Every stock is below {limit} of the portfolio.', { limit: limit(THRESHOLDS.singleStock) }),
      advice: t('When one company has a bad year, it weighs on the whole portfolio. Funds and ETFs do not count here: they are spread by themselves.'),
    },
    {
      id: 'spread',
      status: spread.status,
      title: t('Spread over enough companies'),
      finding:
        spread.funds > 0
          ? t('{funds} funds or ETFs, {stocks} stocks.', { funds: spread.funds, stocks: spread.stocks })
          : t('{stocks} stocks and no fund or ETF.', { stocks: spread.stocks }),
      advice: t('With fewer than {count} stocks and no fund, a few companies decide the result. A broad ETF spreads it over hundreds.', { count: THRESHOLDS.fewStocks }),
    },
    {
      id: 'crypto',
      status: crypto.status,
      title: t('Crypto at most {limit}', { limit: limit(THRESHOLDS.crypto) }),
      finding: t('{share} of the securities is crypto.', { share: pct(crypto.share) }),
      advice: t('Crypto can lose half its value in a few months. Many investors keep it to a small part they can afford to lose.'),
    },
    {
      id: 'currency',
      status: currency.status,
      title: t('Mostly in {currency}', { currency: inputs.currency }),
      finding:
        currency.currencies.length > 0
          ? t('{share} is listed in other currencies: {list}.', { share: pct(currency.share), list: shares(currency.currencies) })
          : t('Everything is listed in {currency}.', { currency: inputs.currency }),
      advice: t('Above {limit}, exchange rates move your result noticeably. This looks at the currency a security is listed in, not at what a fund holds inside.', {
        limit: limit(THRESHOLDS.otherCurrencies),
      }),
    },
    {
      id: 'fees',
      status: fees.status,
      title: t('Costs below {limit} of what you trade', { limit: limit(THRESHOLDS.fees) }),
      finding: t('{fees} in transaction and currency costs on {volume} bought and sold: {ratio}.', {
        fees: formatEur(fees.fees),
        volume: formatEur(fees.volume),
        ratio: formatPercent(fees.ratio, false),
      }),
      advice: t('Small, frequent orders make the fixed fee per order weigh more. Fewer, larger orders, or a broker with lower fees, keep more of the return.'),
    },
    {
      id: 'cash',
      status: cash.status,
      title: t('Cash at most {limit}', { limit: limit(THRESHOLDS.cash) }),
      finding: cash.held
        ? t('{cash} in cash: {share} of the portfolio.', { cash: formatEur(cash.cash), share: pct(cash.share) })
        : t('Your export has no deposits, so the cash at the broker is not known.'),
      ...(cash.held ? { advice: t('Cash at the broker earns little and loses value to inflation. Keep what you need for the coming years elsewhere.') } : {}),
    },
    {
      id: 'emergency',
      status: emergency.status,
      title: t('An emergency fund of {months} months', { months: THRESHOLDS.emergencyMonths }),
      finding: !emergency.hasSavings
        ? t('No savings account entered under Planning > Other assets.')
        : !emergency.hasSpending
          ? t('{savings} in savings; fill in your spending per year under Planning to check it.', { savings: formatEur(emergency.savings) })
          : t('{savings} in savings: {months} months of spending.', { savings: formatEur(emergency.savings), months: (emergency.months ?? 0).toFixed(1) }),
      advice: t('Money set aside for the unexpected means you never have to sell at a bad moment.'),
    },
  ]
  const warnings = rules.filter((r) => r.status === 'warn').length

  return (
    <div className="rc">
      <p className="muted small">
        {warnings === 0 ? t('Every rule of thumb passes.') : t('{count} of {total} rules of thumb ask for a look.', { count: warnings, total: rules.length })}{' '}
        {t('They describe the portfolio today and are no advice: a choice can be right for you anyway.')}
      </p>
      <ul className="rc-list">
        {rules.map((rule) => (
          <li key={rule.id} className={`rc-row rc-${rule.status}`}>
            <span className="rc-status">{rule.status === 'pass' ? t('Pass') : rule.status === 'warn' ? t('Look') : t('Unknown')}</span>
            <div className="rc-body">
              <strong>{rule.title}</strong>
              {detail && <p className="small">{rule.finding}</p>}
              {detail && rule.status !== 'pass' && rule.advice && <p className="muted small">{rule.advice}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
