import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { t } from '../../i18n/i18n.ts'
import { formatEur, formatPercent } from '../format.ts'
import type { Slice } from './allocation.ts'

const color = (slot: number) => (slot === 0 ? 'var(--series-other)' : `var(--series-${slot})`)

function SliceTooltip({ active, payload }: { active?: boolean; payload?: { payload?: Slice }[] }) {
  const slice = payload?.[0]?.payload
  if (!active || !slice) return null
  return (
    <div className="chart-tooltip">
      <strong>{t(slice.label)}</strong>
      <span>
        {formatEur(slice.value)} · {formatPercent(slice.share, false)}
      </span>
    </div>
  )
}

/** Donut of the open positions on the selected day, with a legend that names every slice. */
export function AllocationChart({ slices }: { slices: Slice[] }) {
  if (slices.length === 0) return null
  return (
    <div className="allocation">
      <div className="allocation-chart" role="img" aria-label={t('Allocation of the portfolio by position')}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="95%"
              startAngle={90}
              endAngle={-270}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={color(slice.slot)} />
              ))}
            </Pie>
            <Tooltip content={<SliceTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="allocation-legend">
        {/* Largest first; "Other" stays last. The colors stay those of the slices. */}
        {[...slices].sort((a, b) => (a.slot === 0 ? 1 : b.slot === 0 ? -1 : b.share - a.share)).map((slice) => (
          <li key={slice.key}>
            <i className="legend-dot" style={{ background: color(slice.slot) }} />
            <span className="legend-label">{t(slice.label)}</span>
            <span className="legend-value">{formatPercent(slice.share, false)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
