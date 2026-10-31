import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { contributions, topAndBottom, type Contribution } from '../../../engine/analysis/contribution.ts'
import { chargesImpact, costWaterfall, seriesWithoutCharges, type WaterfallStep } from '../../../engine/analysis/costWaterfall.ts'
import { drawdownEpisodes, underwater } from '../../../engine/analysis/drawdowns.ts'
import {
  periodComparison,
  periodDays,
  performanceStats,
  rollingStats,
  timingEffect,
  type PerformanceOptions,
  type Window,
} from '../../../engine/analysis/performance.ts'
import { activeTilt, type Tilt } from '../../../engine/analysis/tilt.ts'
import type { EngineInputs } from '../../../engine/loadInputs.ts'
import type { EngineOptions } from '../../../engine/options.ts'
import type { OtherAsset } from '../../../engine/otherAssets.ts'
import { irrBetween } from '../../../engine/returns.ts'
import { computeDailySeries, type DailyPoint, type SeriesResult } from '../../../engine/series.ts'
import { t } from '../../../i18n/i18n.ts'
import { localToday } from '../../../market/dates.ts'
import { loadIndexWeights, type IndexWeights } from '../../../market/indexWeights.ts'
import type { AnalysisLevel, Settings } from '../../../settings/settings.ts'
import { Figure, Section } from '../../components/Section.tsx'
import { benchmarkLines, type BenchmarkLine } from '../../dashboard/benchmarkLines.ts'
import { rangeChange } from '../../dashboard/timeRange.ts'
import { TOGGLES } from '../../dashboard/toggles.ts'
import { formatDate, formatEur, formatPercent, formatSignedEur } from '../../format.ts'
import { usePeriod } from '../../period/PeriodProvider.tsx'
import { RiskChecksPanel } from '../RiskChecksPanel.tsx'
import { LineChart, Waterfall } from './charts.tsx'
import { Heatmap } from './Heatmap.tsx'
import { PerformanceControls } from './PerformanceControls.tsx'

const RANK: Record<AnalysisLevel, number> = { basic: 0, advanced: 1, expert: 2 }

const pct = (value: number | undefined) => (value === undefined ? '–' : formatPercent(value))
const plainPct = (value: number | undefined) => (value === undefined ? '–' : formatPercent(value, false))
const ratio = (value: number | undefined) => (value === undefined ? '–' : value.toFixed(2))
const bps = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.round(Math.abs(value)).toLocaleString('en')} bps`
const axisPct = (value: number) => `${(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%`

const STEP_LABELS: Record<WaterfallStep, string> = {
  priceGains: t('Price gains'),
  dividends: t('Dividends and interest'),
  brokerFees: t('Broker fees'),
  tradeTaxes: t('Taxes on trades (TOB)'),
  fxCosts: t('Currency conversion costs'),
  withholdingTax: t('Withholding tax'),
  otherTaxes: t('Other taxes'),
}

/** Which dashboard toggle leaves a charge out: for the "cost in TWR" of each charge. */
const STEP_TOGGLE: Partial<Record<WaterfallStep, keyof EngineOptions>> = {
  brokerFees: 'includeCosts',
  tradeTaxes: 'includeTaxes',
  withholdingTax: 'includeTaxes',
  otherTaxes: 'includeTaxes',
  fxCosts: 'includeFxCosts',
}

interface Props {
  inputs: EngineInputs
  options: EngineOptions
  series: SeriesResult
  settings: Settings
  level: AnalysisLevel
  onLevel: (level: AnalysisLevel) => void
}

/** The line of one benchmark, as the dashboard draws it, or none. */
function lineOf(points: DailyPoint[], inputs: EngineInputs, id: string): BenchmarkLine | undefined {
  if (!id) return undefined
  return benchmarkLines(points, inputs.benchmarks, { benchmarkId: id, extraBenchmarkIds: [], benchmarkMix: {}, benchmarkMixShown: false })[0]
}

function nameOf(inputs: EngineInputs, id: string, fallback: string): string {
  return inputs.benchmarks.find((b) => b.info.id === id)?.info.name ?? fallback
}

/**
 * Analysis > Performance: return, risk, costs and contributions over the period shared with the Dashboard.
 * Basic in plain words; Advanced and Expert add sections, columns and detail, keeping the order.
 */
export function PerformanceView({ inputs, options, series, settings, level, onLevel }: Props) {
  const points = series.points
  const period = usePeriod(points)
  const window: Window = useMemo(() => ({ from: period.visible.from, to: period.visible.to }), [period.visible.from, period.visible.to])
  const at = (n: number) => RANK[level] >= n
  const advanced = RANK[level] >= 1
  const expert = RANK[level] >= 2
  const dates = useMemo(() => points.map((p) => p.date), [points])

  const main = useMemo(() => lineOf(points, inputs, settings.benchmarkId), [points, inputs, settings.benchmarkId])
  const second = useMemo(
    () => (settings.secondBenchmarkId && settings.secondBenchmarkId !== settings.benchmarkId ? lineOf(points, inputs, settings.secondBenchmarkId) : undefined),
    [points, inputs, settings.secondBenchmarkId, settings.benchmarkId],
  )
  const perfOptions: PerformanceOptions = { riskFree: settings.riskFreeRate / 100, alphaMethod: settings.alphaMethod }
  const optionsKey = `${perfOptions.riskFree}:${perfOptions.alphaMethod}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: perfOptions is rebuilt every render; optionsKey stands for it
  const stats = useMemo(() => performanceStats(points, main?.points, window, perfOptions), [points, main, window, optionsKey])
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above
  const stats2 = useMemo(() => (second ? performanceStats(points, second.points, window, perfOptions) : undefined), [points, second, window, optionsKey])
  const comparison = useMemo(() => periodComparison(points, main?.points, window), [points, main, window])
  const comparison2 = useMemo(() => (second ? periodComparison(points, second.points, window) : undefined), [points, second, window])
  const episodes = useMemo(() => drawdownEpisodes(points, window, main?.points), [points, window, main])
  const episodes2 = useMemo(() => (second ? drawdownEpisodes(points, window, second.points) : undefined), [points, window, second])
  const waterfall = useMemo(() => costWaterfall(inputs.transactions, points, window, options), [inputs, points, window, options])
  const contribution = useMemo(() => contributions(inputs.transactions, inputs.prices, options, points, window, localToday()), [inputs, options, points, window])
  const timing = useMemo(() => (advanced ? timingEffect(points, window) : undefined), [points, window, advanced])
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above
  const rolling = useMemo(() => (expert ? rollingStats(points, main?.points, window, perfOptions) : []), [points, main, window, optionsKey, expert])
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above
  const rollingBench = useMemo(() => (expert && main ? rollingStats(main.points, undefined, window, perfOptions) : []), [main, window, optionsKey, expert])
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above
  const rollingSecond = useMemo(() => (expert && second ? rollingStats(second.points, undefined, window, perfOptions) : []), [second, window, optionsKey, expert])
  const costInTwr = useMemo(() => (expert ? costsInTwr(inputs, options, points, window) : undefined), [inputs, options, points, window, expert])
  const [weights, setWeights] = useState<IndexWeights | null | undefined>(undefined)
  useEffect(() => {
    if (!expert || weights !== undefined) return
    let cancelled = false
    void loadIndexWeights().then((loaded) => {
      if (!cancelled) setWeights(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [expert, weights])
  const tilts = useMemo(() => {
    if (!expert || !weights) return null
    const list = activeTilt(
      contribution.positions.map((p) => ({
        key: p.key,
        ...(p.isin ? { isin: p.isin } : {}),
        ...(inputs.prices.symbolOf(p.key) ? { symbol: inputs.prices.symbolOf(p.key) as string } : {}),
        assetClass: p.assetClass,
        weight: p.weight,
      })),
      weights,
    )
    return list ? new Map(list.map((tilt) => [tilt.key, tilt])) : null
  }, [contribution, weights, inputs, expert])

  const first = points[window.from]
  const last = points[window.to]
  if (!first || !last) return <p role="status">{t('Calculating…')}</p>
  const before = window.from > 0 ? points[window.from - 1] : undefined
  const change = rangeChange(points, window.from, window.to)
  const days = periodDays(points, window)
  const xirrYearly = irrBetween(points, window.from, window.to)
  // Within a year a yearly rate from a few weeks says little: then the money-weighted return over the period.
  const xirrShown = xirrYearly === undefined ? undefined : days >= 365 ? xirrYearly : (1 + xirrYearly) ** (days / 365) - 1
  const realized = last.realized - (before?.realized ?? 0)
  const unrealized = last.unrealized - (before?.unrealized ?? 0)
  const mainName = main ? nameOf(inputs, settings.benchmarkId, main.label) : ''
  const secondName = second ? nameOf(inputs, settings.secondBenchmarkId, second.label) : ''

  const sections: { key: string; title: string; aside?: ReactNode; body: ReactNode }[] = []

  // 01 Key figures
  sections.push({
    key: 'figures',
    title: t('Key figures'),
    aside: `${formatDate(first.date)} – ${formatDate(last.date)}`,
    body: (
      <>
        <div className="figures">
          <Figure label={t('Portfolio value')} value={formatEur(last.value)} note={t('on {date}', { date: formatDate(last.date) })} />
          <Figure label={t('Invested')} value={formatEur(last.invested)} note={series.cashMode ? t('Deposits minus withdrawals') : t('Bought minus sold')} />
          <Figure label={t('Profit')} value={formatSignedEur(change.pnl)} note={t('{return} time-weighted', { return: pct(change.twr) })} />
          <Figure
            label={at(1) ? t('Money-weighted (XIRR)') : t('Your return per year')}
            value={pct(xirrShown)}
            note={days >= 365 ? t('per year') : t('over {days} days, not per year', { days })}
          />
          <Figure label={t('Realized profit')} value={formatSignedEur(realized)} note={t('sold and paid out')} />
          <Figure label={t('Unrealized profit')} value={formatSignedEur(unrealized)} note={t('on what you still hold')} />
        </div>
        {at(1) && (
          <div className="figures">
            <Figure label={t('TWR, cumulative')} value={pct(stats.portfolio.twr)} note={t('time-weighted, over the period')} />
            <Figure label={t('TWR per year')} value={pct(stats.portfolio.annualTwr)} note={t('annualised')} />
            <Figure label={t('XIRR per year')} value={pct(xirrYearly)} note={t('money-weighted')} />
            <Figure label={t('Timing effect')} value={pct(timing?.total?.effect)} note={t('XIRR − TWR, per year')} />
          </div>
        )}
        {at(1) && timing?.total && (
          <p className="perf-note">
            {timing.total.effect >= 0
              ? t('Your deposit timing added {effect} per year: money came in before the better days.', { effect: plainPct(Math.abs(timing.total.effect)) })
              : t('Your deposit timing cost {effect} per year: money came in before the weaker days.', { effect: plainPct(Math.abs(timing.total.effect)) })}{' '}
            <span className="muted">{t('Both are yearly rates over the same days.')}</span>
          </p>
        )}
        {at(1) && timing && timing.years.length > 1 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Year')}</th>
                  <th className="num">{t('TWR per year')}</th>
                  <th className="num">{t('XIRR')}</th>
                  <th className="num">{t('Timing effect')}</th>
                </tr>
              </thead>
              <tbody>
                {timing.years.map((y) => (
                  <tr key={y.period}>
                    <td>{y.period}</td>
                    <td className="num">{pct(y.annualTwr)}</td>
                    <td className="num">{pct(y.xirr)}</td>
                    <td className="num">{pct(y.effect)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    ),
  })

  // 02 The same money in the benchmark
  if (main) {
    const benchChange = rangeChange(main.points, window.from, window.to)
    const benchEnd = main.points[window.to]
    const secondChange = second ? rangeChange(second.points, window.from, window.to) : undefined
    const secondEnd = second?.points[window.to]
    sections.push({
      key: 'benchmark',
      title: t('The same money in {name}', { name: main.label }),
      aside: <span className="benchmark">{main.label}</span>,
      body: (
        <>
          <p className="perf-sentence">
            {t('If every deposit had gone into {name} on the same day, the portfolio would be worth {value} on {date}: a profit of {profit} in the period, against your {own}.', {
              name: mainName,
              value: formatEur(benchEnd?.value ?? 0),
              date: formatDate(last.date),
              profit: formatSignedEur(benchChange.pnl),
              own: formatSignedEur(change.pnl),
            })}
          </p>
          <div className="figures">
            <Figure benchmark label={t('{name}, simulated value', { name: main.label })} value={formatEur(benchEnd?.value ?? 0)} note={t('{profit} profit', { profit: formatSignedEur(benchChange.pnl) })} />
            <Figure label={t('Your advantage')} value={formatSignedEur(change.pnl - benchChange.pnl)} note={t('more or less profit than {name}', { name: main.label })} />
            {second && secondEnd && secondChange && (
              <Figure label={t('{name}, simulated value', { name: second.label })} value={formatEur(secondEnd.value)} note={t('your advantage {gap}', { gap: formatSignedEur(change.pnl - secondChange.pnl) })} />
            )}
            {at(1) && <Figure label={t('Your TWR per year')} value={pct(stats.portfolio.annualTwr)} />}
            {at(1) && <Figure benchmark label={t('{name} TWR per year', { name: main.label })} value={pct(stats.benchmark?.annualTwr)} />}
            {at(1) && (
              <Figure
                label={t('Alpha per year')}
                value={pct(stats.alpha)}
                note={settings.alphaMethod === 'arithmetic' ? t('difference of the yearly TWRs') : t('ratio of the yearly TWRs')}
              />
            )}
            {at(1) && stats2 && <Figure label={t('Alpha vs {name}', { name: second?.label ?? '' })} value={pct(stats2.alpha)} />}
          </div>
        </>
      ),
    })
  }

  // 03 Monthly returns
  sections.push({
    key: 'heatmap',
    title: t('Monthly returns'),
    aside: t('time-weighted, in %'),
    body: (
      <Heatmap
        months={comparison.months}
        years={comparison.years}
        vsBenchmark={at(1) && main ? { label: main.label } : undefined}
        vsSecond={at(1) && second && comparison2 ? { label: second.label, byYear: new Map(comparison2.years.map((y) => [y.period, y.delta])) } : undefined}
      />
    ),
  })

  // 04 Falls
  const deepest = episodes[0]
  sections.push({
    key: 'drops',
    title: at(1) ? t('Drawdowns and risk') : t('Biggest drop'),
    aside: at(1) ? t('below the previous high') : undefined,
    body: (
      <>
        <div className="perf-split">
          <div className="perf-block">
            <span className="label-caps">{t('Biggest drop')}</span>
            <span className="perf-big figure">{deepest ? plainPct(deepest.depth) : '–'}</span>
            {deepest ? (
              <dl className="kv">
                <dt>{t('Highest point')}</dt>
                <dd>{formatDate(deepest.peak)}</dd>
                <dt>{t('Lowest point')}</dt>
                <dd>{formatDate(deepest.trough)}</dd>
                <dt>{t('Back at the high')}</dt>
                <dd>{deepest.recovered ? formatDate(deepest.recovered) : t('not yet')}</dd>
              </dl>
            ) : (
              <p className="muted small">{t('No drop in this period.')}</p>
            )}
          </div>
          {at(1) && (
            <div className="perf-block">
              <span className="label-caps">{t('Risk')}</span>
              <dl className="kv">
                <dt>{t('Volatility per year')}</dt>
                <dd>
                  {plainPct(stats.portfolio.volatility)} {main && <span className="benchmark">{plainPct(stats.benchmark?.volatility)}</span>}
                </dd>
                <dt>{t('Sharpe ratio')}</dt>
                <dd>
                  {ratio(stats.portfolio.sharpe)} {main && <span className="benchmark">{ratio(stats.benchmark?.sharpe)}</span>}
                </dd>
                {at(2) && (
                  <>
                    <dt>{t('Sortino ratio')}</dt>
                    <dd>
                      {ratio(stats.portfolio.sortino)} {main && <span className="benchmark">{ratio(stats.benchmark?.sortino)}</span>}
                    </dd>
                    <dt>{t('Omega ratio (0%)')}</dt>
                    <dd>
                      {ratio(stats.portfolio.omega)} {main && <span className="benchmark">{ratio(stats.benchmark?.omega)}</span>}
                    </dd>
                    <dt>{t('Beta vs {name}', { name: main?.label ?? '–' })}</dt>
                    <dd>{ratio(stats.beta)}</dd>
                    <dt>{t('Correlation with {name}', { name: main?.label ?? '–' })}</dt>
                    <dd>{ratio(stats.correlation)}</dd>
                  </>
                )}
              </dl>
              <p className="muted small">
                {t('From the daily returns on trading days; risk-free rate {rate} a year.', { rate: plainPct(perfOptions.riskFree) })}
                {main && ` ${t('In red: {name}.', { name: main.label })}`}
              </p>
            </div>
          )}
        </div>
        {at(1) && (
          <LineChart
            label={t('Below the previous high')}
            format={axisPct}
            fillFirst
            series={[
              { label: t('Portfolio'), points: underwater(points, window).map((p) => ({ date: p.date, value: p.drawdown })), color: 'var(--chart-value)' },
              ...(main ? [{ label: main.label, points: underwater(main.points, window).map((p) => ({ date: p.date, value: p.drawdown })), color: 'var(--benchmark)' }] : []),
              ...(second ? [{ label: second.label, points: underwater(second.points, window).map((p) => ({ date: p.date, value: p.drawdown })), color: 'var(--text-muted)', dashed: true }] : []),
            ]}
          />
        )}
        {at(1) && episodes.length > 0 && (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Highest point')}</th>
                  <th>{t('Lowest point')}</th>
                  <th>{t('Recovered')}</th>
                  <th className="num">{t('Max loss')}</th>
                  {main && <th className="num benchmark">{t('{name} max loss', { name: main.label })}</th>}
                  {second && <th className="num">{t('{name} max loss', { name: second.label })}</th>}
                  <th className="num">{t('Duration')}</th>
                </tr>
              </thead>
              <tbody>
                {episodes.slice(0, 8).map((e) => (
                  <tr key={e.peak}>
                    <td className="num">{formatDate(e.peak)}</td>
                    <td className="num">{formatDate(e.trough)}</td>
                    <td className="num">{e.recovered ? formatDate(e.recovered) : t('open')}</td>
                    <td className="num">{plainPct(e.depth)}</td>
                    {main && <td className="num benchmark">{plainPct(e.benchmarkDepth)}</td>}
                    {second && <td className="num">{plainPct(episodes2?.find((other) => other.peak === e.peak)?.benchmarkDepth)}</td>}
                    <td className="num">{t('{days} days', { days: e.days })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    ),
  })

  // 05 Rolling 12 months (Expert)
  if (at(2)) {
    const line = (pick: (p: { volatility: number; sharpe?: number; alpha?: number }) => number | undefined, list: typeof rolling) =>
      list.flatMap((p) => {
        const value = pick(p)
        return value === undefined ? [] : [{ date: p.date, value }]
      })
    sections.push({
      key: 'rolling',
      title: t('Rolling 12 months'),
      aside: t('252 trading days'),
      body:
        rolling.length < 2 ? (
          <p className="muted small">{t('The period or the history is shorter than a year of trading days.')}</p>
        ) : (
          <div className="perf-grid-3">
            <div>
              <span className="label-caps">{t('Alpha vs {name}', { name: main?.label ?? '–' })}</span>
              <LineChart label={t('Rolling alpha')} format={axisPct} series={[{ label: t('Alpha'), points: line((p) => p.alpha, rolling), color: 'var(--chart-value)' }]} />
            </div>
            <div>
              <span className="label-caps">{t('Volatility')}</span>
              <LineChart
                label={t('Rolling volatility')}
                format={axisPct}
                zeroLine={false}
                series={[
                  { label: t('Portfolio'), points: line((p) => p.volatility, rolling), color: 'var(--chart-value)' },
                  ...(main ? [{ label: main.label, points: line((p) => p.volatility, rollingBench), color: 'var(--benchmark)' }] : []),
                  ...(second ? [{ label: second.label, points: line((p) => p.volatility, rollingSecond), color: 'var(--text-muted)', dashed: true }] : []),
                ]}
              />
            </div>
            <div>
              <span className="label-caps">{t('Sharpe ratio')}</span>
              <LineChart
                label={t('Rolling Sharpe ratio')}
                format={(v) => v.toFixed(1)}
                series={[
                  { label: t('Portfolio'), points: line((p) => p.sharpe, rolling), color: 'var(--chart-value)' },
                  ...(main ? [{ label: main.label, points: line((p) => p.sharpe, rollingBench), color: 'var(--benchmark)' }] : []),
                  ...(second ? [{ label: second.label, points: line((p) => p.sharpe, rollingSecond), color: 'var(--text-muted)', dashed: true }] : []),
                ]}
              />
            </div>
          </div>
        ),
    })
  }

  // 06 Costs
  const charges = waterfall.rows.filter((r) => r.step === 'brokerFees' || r.step === 'tradeTaxes' || r.step === 'fxCosts')
  const totalCosts = -charges.reduce((sum, r) => sum + r.amount, 0)
  sections.push({
    key: 'costs',
    title: at(1) ? t('From price gains to profit') : t('Costs'),
    aside: at(1) ? t('the steps of the period') : undefined,
    body: (
      <>
        <div className="figures">
          <Figure label={t('Total costs')} value={formatEur(totalCosts)} note={t('in the period')} />
          {charges.map((r) => (
            <Figure key={r.step} label={STEP_LABELS[r.step]} value={formatEur(-r.amount)} note={r.counted ? undefined : t('left out on the dashboard')} />
          ))}
        </div>
        {at(1) && waterfall.rows.length > 0 && (
          <>
            <Waterfall
              format={formatSignedEur}
              bars={[
                ...waterfall.rows.map((r) => ({ label: STEP_LABELS[r.step], amount: r.amount, muted: !r.counted })),
                { label: t('Profit'), amount: waterfall.net, total: true },
              ]}
            />
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Step')}</th>
                    <th className="num">{t('Amount')}</th>
                    <th className="num">{t('% of invested')}</th>
                    {at(2) && <th className="num">{t('Cost in TWR')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {waterfall.rows.map((r) => (
                    <tr key={r.step} className={r.counted ? undefined : 'muted'}>
                      <td>
                        {STEP_LABELS[r.step]}
                        {!r.counted && <span className="small"> · {t('not counted')}</span>}
                      </td>
                      <td className="num">{formatSignedEur(r.amount)}</td>
                      <td className="num">{pct(r.ofInvested)}</td>
                      {at(2) && <td className="num">{costInTwr?.byStep.get(r.step) === undefined ? '–' : pct(-(costInTwr.byStep.get(r.step) as number))}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>{t('Profit')}</td>
                    <td className="num">{formatSignedEur(waterfall.net)}</td>
                    <td className="num">{pct(waterfall.netOfInvested)}</td>
                    {at(2) && <td className="num">{costInTwr?.total === undefined ? '–' : pct(-costInTwr.total)}</td>}
                  </tr>
                </tfoot>
              </table>
            </div>
            {at(2) && (
              <p className="muted small">
                {t('Cost in TWR: how much higher the time-weighted return would have been without that charge. Taxes share one switch, so their part is split by amount.')}
              </p>
            )}
          </>
        )}
      </>
    ),
  })

  // 07 Contributors
  const { top, bottom } = topAndBottom(contribution.positions)
  const contributorTable = (title: string, list: Contribution[]) => (
    <div>
      <span className="label-caps">{title}</span>
      <table className="table">
        <thead>
          <tr>
            <th>{t('Position')}</th>
            <th className="num">{t('Profit')}</th>
            <th className="num">{t('Return')}</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">
                {t('None')}
              </td>
            </tr>
          ) : (
            list.map((p, i) => (
              <tr key={p.key}>
                <td>
                  <span className="muted figure">{String(i + 1).padStart(2, '0')}</span> {p.product}
                </td>
                <td className="num">{formatSignedEur(p.pnl)}</td>
                <td className="num">{pct(p.return)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
  sections.push({
    key: 'contributors',
    title: at(1) ? t('Contribution per position') : t('Best and worst positions'),
    aside: t('by profit in the period'),
    body: (
      <>
        <div className="perf-split">
          {contributorTable(t('Added most'), top)}
          {contributorTable(t('Added least'), bottom)}
        </div>
        {at(1) && (
          <>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('ISIN')}</th>
                    <th>{t('Position')}</th>
                    <th className="num">{t('Weight')}</th>
                    <th className="num">{t('Return')}</th>
                    <th className="num">{t('Contributed profit')}</th>
                    <th className="num">{t('Contributed return')}</th>
                    {tilts && <th className="num">{t('vs MSCI World')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {contribution.positions.map((p) => (
                    <tr key={p.key}>
                      <td className="num muted">{p.isin ?? '–'}</td>
                      <td>{p.product}</td>
                      <td className="num">{plainPct(p.weight)}</td>
                      <td className="num">{pct(p.return)}</td>
                      <td className="num">{formatSignedEur(p.pnl)}</td>
                      <td className="num">{bps(p.contributionBps)}</td>
                      {tilts && <td className="num">{tiltLabel(tilts.get(p.key))}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>{t('Total')}</td>
                    <td className="num">{plainPct(1)}</td>
                    <td className="num">{pct(change.twr)}</td>
                    <td className="num">{formatSignedEur(contribution.positions.reduce((sum, p) => sum + p.pnl, 0))}</td>
                    <td className="num">{bps(contribution.totalBps)}</td>
                    {tilts && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted small">
              {t('Contributed return adds each day the weight of the evening before times the return of that day. The parts can differ slightly from the total TWR ({twr}): returns are added, not compounded, and interest or fees of the account belong to no position.', {
                twr: bps(contribution.twrBps),
              })}
              {tilts && ` ${t('vs MSCI World: the weight of a stock minus its weight in the index; funds and ETFs are spread by themselves.')}`}
            </p>
          </>
        )}
      </>
    ),
  })

  // 08 Checks
  sections.push({
    key: 'checks',
    title: t('Checks'),
    aside: at(1) ? t('rules of thumb, with their thresholds') : t('rules of thumb'),
    body: (
      <RiskChecksPanel
        inputs={inputs}
        options={options}
        series={series}
        otherAssets={settings.otherAssets as OtherAsset[]}
        yearlySpending={settings.planning.yearlySpending}
        detail={at(1)}
      />
    ),
  })

  // 09 Methodology (Expert)
  if (at(2)) {
    sections.push({
      key: 'method',
      title: t('Methodology'),
      aside: <Link to="/settings">{t('Change in Settings')}</Link>,
      body: (
        <div className="perf-method">
          <div>
            <span className="label-caps">{t('What counts')}</span>
            <ul>
              {TOGGLES.map((toggle) => (
                <li key={toggle.key}>
                  {t(toggle.label)}: {options[toggle.key] ? t('counted') : t('left out')}
                </li>
              ))}
            </ul>
            <p className="muted small">{t('As switched on the Dashboard under "What counts in the result".')}</p>
          </div>
          <div>
            <span className="label-caps">{t('Return calculation')}</span>
            <p className="small">
              {t('Time-weighted return (TWR): daily returns chained, so deposits and withdrawals do not move it. Money-weighted return (XIRR): the yearly rate at which all flows and the value net to zero. Cost basis: {method}.', {
                method: options.costBasis === 'fifo' ? t('first in, first out') : t('average cost'),
              })}
            </p>
          </div>
          <div>
            <span className="label-caps">{t('Risk-free rate')}</span>
            <p className="small">{t('{rate} a year, for the Sharpe and Sortino ratios. Volatility from trading-day returns × √252.', { rate: plainPct(perfOptions.riskFree) })}</p>
          </div>
          <div>
            <span className="label-caps">{t('Alpha')}</span>
            <p className="small">
              {settings.alphaMethod === 'arithmetic'
                ? t('Arithmetic: your yearly TWR minus the yearly TWR of {name}, bought with the same money on the same days.', { name: mainName || '–' })
                : t('Geometric: (1 + your yearly TWR) / (1 + the yearly TWR of {name}) − 1, bought with the same money on the same days.', { name: mainName || '–' })}
            </p>
          </div>
        </div>
      ),
    })
  }

  return (
    <div className="perf">
      <PerformanceControls level={level} onLevel={onLevel} period={period} dates={dates} />
      {sections.map((s, i) => (
        <Section key={s.key} number={i + 1} title={s.title} aside={s.aside} id={`perf-${s.key}`}>
          {s.body}
        </Section>
      ))}
      {secondName && <p className="muted small">{t('Second benchmark: {name}.', { name: secondName })}</p>}
    </div>
  )
}

function tiltLabel(tilt: Tilt | undefined): string {
  if (!tilt) return '–'
  if (tilt.kind === 'fund') return t('fund')
  if (tilt.kind === 'other') return '–'
  return formatPercent(tilt.tilt)
}

/**
 * What each kind of charge cost in time-weighted return: the period's TWR without it minus the real one.
 * Costs, taxes and currency costs each have their own switch; the tax rows share one, split by amount.
 */
function costsInTwr(inputs: EngineInputs, options: EngineOptions, points: DailyPoint[], window: Window): { total?: number; byStep: Map<WaterfallStep, number> } {
  const today = localToday()
  const total = chargesImpact(points, seriesWithoutCharges(inputs.transactions, inputs.prices, options, today), window)?.twrLost
  const waterfall = costWaterfall(inputs.transactions, points, window, options)
  const byStep = new Map<WaterfallStep, number>()
  const lost = new Map<keyof EngineOptions, number>()
  for (const key of ['includeCosts', 'includeTaxes', 'includeFxCosts'] as const) {
    if (!options[key]) continue
    const without = computeDailySeries(inputs.transactions, inputs.prices, { ...options, [key]: false }, today).points
    const impact = chargesImpact(points, without, window)
    if (impact) lost.set(key, impact.twrLost)
  }
  const taxRows = waterfall.rows.filter((r) => STEP_TOGGLE[r.step] === 'includeTaxes' && r.counted)
  const taxTotal = taxRows.reduce((sum, r) => sum + Math.abs(r.amount), 0)
  for (const row of waterfall.rows) {
    const toggle = STEP_TOGGLE[row.step]
    if (!toggle || !row.counted) continue
    const value = lost.get(toggle)
    if (value === undefined) continue
    byStep.set(row.step, toggle === 'includeTaxes' ? (taxTotal > 0 ? (value * Math.abs(row.amount)) / taxTotal : 0) : value)
  }
  return { ...(total === undefined ? {} : { total }), byStep }
}
