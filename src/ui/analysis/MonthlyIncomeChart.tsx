import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatEur } from '../format.ts'

const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })

function label(month: string): string {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`))
}

function IncomeTooltip({ active, payload }: { active?: boolean; payload?: { payload?: { month: string; net: number } }[] }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="chart-tooltip">
      <strong>{label(point.month)}</strong>
      <span>{formatEur(point.net)}</span>
    </div>
  )
}

/** Bars of the net income of each month. */
export function MonthlyIncomeChart({
  data,
  label: ariaLabel = 'Net dividends and interest per month',
}: {
  data: { month: string; net: number }[]
  label?: string
}) {
  return (
    <div className="income-chart" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={label} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis tickFormatter={(v: number) => formatEur(v, true)} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} width={64} />
          <Tooltip content={<IncomeTooltip />} cursor={{ fill: 'var(--border)' }} />
          <Bar dataKey="net" fill="var(--series-3)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
