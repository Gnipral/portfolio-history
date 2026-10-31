import type { AnalysisLevel } from '../../../settings/settings.ts'
import { t } from '../../../i18n/i18n.ts'
import { daysBetween } from '../../../market/dates.ts'
import { RANGES, rangeDescription } from '../../dashboard/timeRange.ts'
import type { ResolvedPeriod } from '../../period/PeriodProvider.tsx'

export const LEVELS: { id: AnalysisLevel; label: string }[] = [
  { id: 'basic', label: t('Basic') },
  { id: 'advanced', label: t('Advanced') },
  { id: 'expert', label: t('Expert') },
]

interface Props {
  level: AnalysisLevel
  onLevel: (level: AnalysisLevel) => void
  period: ResolvedPeriod
  dates: string[]
}

/** The level switch on the left; the period, shared with the Dashboard, on the right. */
export function PerformanceControls({ level, onLevel, period, dates }: Props) {
  const from = dates[period.visible.from] ?? ''
  const to = dates[period.visible.to] ?? ''
  const range = period.selection.kind === 'range' ? period.selection.range : null
  const first = dates[0] ?? ''
  const last = dates.at(-1) ?? ''
  return (
    <div className="perf-controls">
      <div className="perf-controls-group">
        <span className="label-caps">{t('Level')}</span>
        <div className="segmented" role="group" aria-label={t('Level')}>
          {LEVELS.map((l) => (
            <button key={l.id} type="button" aria-pressed={level === l.id} onClick={() => onLevel(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="perf-controls-group">
        <label className="perf-date">
          <span className="visually-hidden">{t('From')}</span>
          <input
            type="date"
            aria-label={t('From')}
            min={first}
            max={to}
            value={from}
            onChange={(e) => e.target.value && period.setWindow(e.target.value, to === last ? null : to)}
          />
        </label>
        <span aria-hidden="true">→</span>
        <label className="perf-date">
          <span className="visually-hidden">{t('To')}</span>
          <input
            type="date"
            aria-label={t('To')}
            min={from}
            max={last}
            value={to}
            onChange={(e) => e.target.value && period.setWindow(from, e.target.value === last ? null : e.target.value)}
          />
        </label>
        <span className="muted small figure">{t('{days} days', { days: from && to ? daysBetween(from, to) + 1 : 0 })}</span>
        <div className="segmented" role="group" aria-label={t('Period')}>
          {RANGES.map((key) => (
            <button key={key} type="button" aria-pressed={key === range} title={rangeDescription(key)} onClick={() => period.setRange(key)}>
              {key === 'ALL' ? t('All') : key}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
