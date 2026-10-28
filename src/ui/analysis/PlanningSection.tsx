import { useMemo } from 'react'
import type { EngineInputs } from '../../engine/loadInputs.ts'
import type { OtherAsset } from '../../engine/otherAssets.ts'
import type { EngineOptions } from '../../engine/options.ts'
import { fireTarget, project, rebalance, type ProjectionYear } from '../../engine/planning.ts'
import { positionsOn } from '../../engine/positions.ts'
import type { SeriesResult } from '../../engine/series.ts'
import { localToday } from '../../market/dates.ts'
import { DEFAULT_PLANNING, updateSettings, type PlanningSettings } from '../../settings/settings.ts'
import { formatEur, formatPercent } from '../format.ts'
import { NetWorthPanel } from './NetWorthPanel.tsx'

interface Props {
  inputs: EngineInputs
  options: EngineOptions
  series: SeriesResult
  planning: PlanningSettings
  otherAssets: OtherAsset[]
}

function save(changes: Partial<PlanningSettings>) {
  return updateSettings((current) => ({ planning: { ...DEFAULT_PLANNING, ...current.planning, ...changes } }))
}

function NumberField({ label, value, step, suffix, onChange }: { label: string; value: number; step: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <label>
      {label}
      <span className="input-suffix">
        <input type="number" min={0} step={step} inputMode="decimal" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
        {suffix && <span className="muted">{suffix}</span>}
      </span>
    </label>
  )
}

/** Where the next deposit should go to reach a target mix, and what the portfolio can grow to. */
export function PlanningSection({ inputs, options, series, planning, otherAssets }: Props) {
  const today = localToday()
  const positions = useMemo(() => positionsOn(inputs.transactions, inputs.prices, options, today), [inputs, options, today])
  const holdings = useMemo(
    () => positions.filter((p) => p.value > 0).map((p) => ({ key: p.key, label: p.product, value: p.value })).sort((a, b) => b.value - a.value),
    [positions],
  )
  const targets = Object.fromEntries(Object.entries(planning.targets).map(([key, percent]) => [key, percent / 100]))
  const rows = rebalance(holdings, targets, planning.deposit)
  const targetTotal = holdings.reduce((sum, h) => sum + (planning.targets[h.key] ?? 0), 0)
  const hasTargets = targetTotal > 0

  const last = series.points.at(-1)
  const start = last?.value ?? 0
  const projection = useMemo(
    () => project({ start, monthly: planning.monthly, yearlyReturn: planning.yearlyReturn / 100, years: planning.years, inflation: planning.inflation / 100 }),
    [start, planning.monthly, planning.yearlyReturn, planning.years, planning.inflation],
  )
  const end = projection.at(-1) as ProjectionYear
  const fire = planning.yearlySpending > 0 ? fireTarget(projection, planning.yearlySpending) : undefined
  const ownReturn = last?.irr

  const setTarget = (key: string, percent: number) => void save({ targets: { ...planning.targets, [key]: percent } })

  return (
    <>
      <NetWorthPanel portfolioValue={start} assets={otherAssets} />
      <div className="panel">
        <h3>Rebalance with your next deposit</h3>
        <p className="muted small">
          Fill in the share you want per position. The deposit goes to the positions furthest below their target, so you
          get closer without selling anything.
        </p>
        <div className="actions">
          <NumberField label="Deposit" value={planning.deposit} step={50} suffix="EUR" onChange={(deposit) => void save({ deposit })} />
          <button
            type="button"
            onClick={() =>
              void save({ targets: Object.fromEntries(rows.map((r) => [r.key, Math.round(r.share * 1000) / 10])) })
            }
          >
            Use the current mix
          </button>
          {hasTargets && (
            <button type="button" onClick={() => void save({ targets: {} })}>
              Clear targets
            </button>
          )}
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Position</th>
                <th className="num">Value</th>
                <th className="num">Now</th>
                <th className="num">Target</th>
                <th className="num">Buy</th>
                <th className="num">After</th>
                <th className="num">To reach the target exactly</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num">{formatEur(r.value, true)}</td>
                  <td className="num">{formatPercent(r.share, false)}</td>
                  <td className="num">
                    <input
                      className="percent-input"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      inputMode="decimal"
                      aria-label={`Target for ${r.label} (%)`}
                      value={planning.targets[r.key] ?? ''}
                      placeholder="0"
                      onChange={(e) => setTarget(r.key, Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
                    />
                  </td>
                  <td className="num">
                    <strong>{hasTargets && r.buy >= 0.5 ? formatEur(r.buy, true) : '–'}</strong>
                  </td>
                  <td className="num">{hasTargets ? formatPercent(r.shareAfter, false) : '–'}</td>
                  <td className="num muted">{hasTargets ? `${r.difference > 0 ? 'buy' : 'sell'} ${formatEur(Math.abs(r.difference), true)}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasTargets && Math.abs(targetTotal - 100) > 0.05 && (
          <p className="callout warning small" role="status">
            The targets add up to {Math.round(targetTotal * 10) / 10}%, not 100%.
          </p>
        )}
      </div>

      <div className="panel">
        <h3>Projection</h3>
        <p className="muted small">
          What today's {formatEur(start, true)} can grow to with a monthly amount and a steady return. Real returns go up
          and down; this only shows the effect of time and saving.
        </p>
        <div className="form-grid settings-form">
          <NumberField label="Every month" value={planning.monthly} step={50} suffix="EUR" onChange={(monthly) => void save({ monthly })} />
          <div className="field-with-action">
            <NumberField label="Return per year" value={planning.yearlyReturn} step={0.5} suffix="%" onChange={(yearlyReturn) => void save({ yearlyReturn })} />
            {ownReturn !== undefined && (
              <button type="button" className="link-button small" onClick={() => void save({ yearlyReturn: Math.round(ownReturn * 1000) / 10 })}>
                Use my return so far ({formatPercent(ownReturn)})
              </button>
            )}
          </div>
          <NumberField label="Years" value={planning.years} step={1} onChange={(years) => void save({ years: Math.min(60, Math.round(years)) })} />
          <NumberField label="Inflation per year" value={planning.inflation} step={0.5} suffix="%" onChange={(inflation) => void save({ inflation })} />
          <NumberField
            label="Spending per year to live from it"
            value={planning.yearlySpending}
            step={1000}
            suffix="EUR"
            onChange={(yearlySpending) => void save({ yearlySpending })}
          />
        </div>
        <div className="cards">
          <div className="card">
            <span className="card-label">In {planning.years} years</span>
            <span className="card-value">{formatEur(end.value, true)}</span>
            <span className="muted small">{formatEur(end.realValue, true)} in today's money</span>
          </div>
          <div className="card">
            <span className="card-label">You put in</span>
            <span className="card-value">{formatEur(end.contributed, true)}</span>
            <span className="muted small">today's value plus every monthly amount</span>
          </div>
          <div className="card">
            <span className="card-label">Growth</span>
            <span className="card-value positive">{formatEur(end.value - end.contributed, true)}</span>
          </div>
          {fire && (
            <div className="card">
              <span className="card-label">Financial independence</span>
              <span className="card-value">{fire.year === undefined ? `not in ${planning.years} years` : fire.year === 0 ? 'already' : `in ${fire.year} years`}</span>
              <span className="muted small">At {formatEur(fire.target, true)} in today's money (25 × your spending, the 4% rule)</span>
            </div>
          )}
        </div>
        <ProjectionChart rows={projection} target={fire?.target} />
      </div>
    </>
  )
}

/** Value and contributions per year, with the FIRE target as a line. */
function ProjectionChart({ rows, target }: { rows: ProjectionYear[]; target?: number | undefined }) {
  const width = 900
  const height = 240
  const pad = { left: 8, right: 8, top: 12, bottom: 22 }
  const max = Math.max(...rows.map((r) => r.value), target ?? 0, 1)
  const last = Math.max(rows.length - 1, 1)
  const x = (year: number) => pad.left + (year / last) * (width - pad.left - pad.right)
  const y = (value: number) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom)
  const line = (value: (r: ProjectionYear) => number) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.year).toFixed(1)},${y(value(r)).toFixed(1)}`).join('')
  const area = (value: (r: ProjectionYear) => number) => `${line(value)}L${x(last).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`
  const ticks = rows.filter((r) => r.year % Math.max(1, Math.round(last / 5)) === 0)

  return (
    <figure className="projection-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Projected value after ${last} years: ${formatEur(rows.at(-1)?.value ?? 0, true)}`}>
        <path d={area((r) => r.value)} className="projection-fill projection-value" />
        <path d={area((r) => r.contributed)} className="projection-fill projection-contributed" />
        <path d={line((r) => r.value)} className="projection-value" />
        <path d={line((r) => r.contributed)} className="projection-contributed" />
        <path d={line((r) => r.realValue)} className="projection-real" />
        {target !== undefined && target <= max && <line x1={pad.left} x2={width - pad.right} y1={y(target)} y2={y(target)} className="projection-target" />}
        {ticks.map((r) => (
          <text key={r.year} x={x(r.year)} y={height - 6} textAnchor={r.year === 0 ? 'start' : r.year === last ? 'end' : 'middle'} className="projection-tick">
            {r.year === 0 ? 'now' : `+${r.year}y`}
          </text>
        ))}
      </svg>
      <figcaption className="muted small">
        <span className="legend-swatch projection-value" /> value <span className="legend-swatch projection-contributed" /> put in{' '}
        <span className="legend-swatch projection-real" /> value in today's money
        {target !== undefined && (
          <>
            {' '}
            <span className="legend-swatch projection-target" /> independence target
          </>
        )}
      </figcaption>
    </figure>
  )
}
