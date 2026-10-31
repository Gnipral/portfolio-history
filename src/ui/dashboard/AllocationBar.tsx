import { t } from '../../i18n/i18n.ts'
import { formatEur, formatPercent } from '../format.ts'
import type { AllocationDimension, Slice } from './allocation.ts'

const color = (slot: number) => (slot === 0 ? 'var(--series-other)' : `var(--series-${slot})`)

/** The switch in the order of the brief: type first. */
const DIMENSIONS: { key: AllocationDimension; label: string }[] = [
  { key: 'assetClass', label: t('Type') },
  { key: 'position', label: t('Position') },
  { key: 'currency', label: t('Currency') },
  { key: 'country', label: t('Country') },
]

interface Props {
  slices: Slice[]
  dimension: AllocationDimension
  onDimension: (dimension: AllocationDimension) => void
}

/** The mix of the portfolio on the inspected day, as one thin horizontal bar with a legend. */
export function AllocationBar({ slices, dimension, onDimension }: Props) {
  // Largest first; "Other" stays last. The colours stay those of the slices.
  const ordered = [...slices].sort((a, b) => (a.slot === 0 ? 1 : b.slot === 0 ? -1 : b.share - a.share))
  return (
    <section className="allocation-bar" aria-labelledby="allocation-title">
      <div className="allocation-head">
        <h3 id="allocation-title" className="label-caps">
          {t('Allocation')}
        </h3>
        <div className="segmented segmented-small" role="group" aria-label={t('Group the allocation by')}>
          {DIMENSIONS.map((d) => (
            <button key={d.key} type="button" aria-pressed={dimension === d.key} onClick={() => onDimension(d.key)}>
              {d.label}
            </button>
          ))}
        </div>
        <ul className="allocation-legend">
          {ordered.map((slice) => (
            <li key={slice.key}>
              <i style={{ background: color(slice.slot) }} aria-hidden="true" />
              <span className="legend-name">{t(slice.label)}</span>
              <span className="figure">
                {formatPercent(slice.share, false)} ({formatEur(slice.value, true)})
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="allocation-track" role="img" aria-label={ordered.map((s) => `${t(s.label)} ${formatPercent(s.share, false)}`).join(', ')}>
        {ordered.map((slice) => (
          <span key={slice.key} style={{ width: `${slice.share * 100}%`, background: color(slice.slot) }} title={`${t(slice.label)} ${formatPercent(slice.share, false)}`} />
        ))}
      </div>
    </section>
  )
}
