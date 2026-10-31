import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../../i18n/i18n.ts'
import type { ChartStyle } from '../../settings/settings.ts'
import { PALETTES, storePalette } from '../../theme/theme.ts'
import { displayCurrency } from '../format.ts'
import { usePalette } from '../usePalette.ts'
import type { BenchmarkLine } from './benchmarkLines.ts'
import type { ChartMode } from './chartData.ts'
import type { MarkerKind } from './markers.ts'
import { benchmarkPattern } from './benchmarkPatterns.ts'

/** A button that opens a small panel under it; a click elsewhere or Esc closes it. */
function Menu({ label, title, children, align = 'left', className }: { label: ReactNode; title: string; children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className={`menu${className ? ` ${className}` : ''}`} ref={root}>
      <button type="button" className="menu-button" aria-expanded={open} aria-haspopup="true" title={title} onClick={() => setOpen(!open)}>
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={`menu-panel menu-${align}`} role="group" aria-label={title}>
          {children}
        </div>
      )}
    </div>
  )
}

const MARKER_LABELS: Record<MarkerKind, string> = {
  deposit: t('Deposit'),
  buy: t('Buy'),
  sell: t('Sell'),
  dividend: t('Dividend'),
}

interface Props {
  mode: ChartMode
  onMode: (mode: ChartMode) => void
  benchmarks: BenchmarkLine[]
  /** The benchmark choice: the picker of the chart, in the menu of the benchmark. */
  benchmarkPicker: ReactNode
  chartStyle: ChartStyle
  onStyleChange: (change: Partial<ChartStyle>) => void
  panelOpen: boolean
  onPanel: (open: boolean) => void
  expanded: boolean
  onExpand: () => void
  /** With the side panel closed, the legend shows the values of the inspected day. */
  values?: { portfolio: string; invested?: string; benchmarks: string[] } | undefined
}

/** Above the chart: what the lines are on the left, how the chart is drawn on the right. */
export function ChartToolbar({ mode, onMode, benchmarks, benchmarkPicker, chartStyle, onStyleChange, panelOpen, onPanel, expanded, onExpand, values }: Props) {
  const palette = usePalette()
  const percent = mode === 'percent'
  const main = benchmarks[0]
  const option = (key: keyof ChartStyle, label: string, eurOnly = false) => (
    <label className={`menu-check${eurOnly && percent ? ' disabled' : ''}`} title={eurOnly && percent ? t('Only in {currency}', { currency: displayCurrency() }) : undefined}>
      <input type="checkbox" checked={chartStyle[key]} disabled={eurOnly && percent} onChange={(e) => onStyleChange({ [key]: e.target.checked })} />
      {label}
    </label>
  )

  return (
    <div className="chart-toolbar">
      <div className="chart-legend" aria-live="polite">
        <span className="legend-item">
          <i className="swatch main" aria-hidden="true" />
          {t('Portfolio')}
          {values && <span className="legend-value">{values.portfolio}</span>}
        </span>
        <Menu
          className="legend-benchmark"
          title={t('Compare with')}
          label={
            <span className="legend-item benchmark">
              <i className="swatch" style={{ background: benchmarkPattern(0).css }} aria-hidden="true" />
              {main ? `${t('Benchmark')} (${main.label})` : t('Benchmark')}
              {values?.benchmarks[0] && <span className="legend-value">{values.benchmarks[0]}</span>}
            </span>
          }
        >
          {benchmarkPicker}
        </Menu>
        {benchmarks.slice(1).map((line, i) => (
          <span key={line.id} className="legend-item" style={{ color: `var(${line.color})` }}>
            <i className="swatch" style={{ background: benchmarkPattern(i + 1).css }} aria-hidden="true" />
            <span className="legend-name">{line.label}</span>
            {values?.benchmarks[i + 1] && <span className="legend-value">{values.benchmarks[i + 1]}</span>}
          </span>
        ))}
        {!percent && chartStyle.invested && (
          <span className="legend-item">
            <i className="swatch secondary" aria-hidden="true" />
            {t('Net invested')}
            {values?.invested && <span className="legend-value">{values.invested}</span>}
          </span>
        )}
        <span className="legend-markers">
          {(Object.keys(MARKER_LABELS) as MarkerKind[]).map((kind) => (
            <span key={kind} className="legend-item">
              <i className={`marker-swatch marker-${kind}`} aria-hidden="true" />
              {MARKER_LABELS[kind]}
            </span>
          ))}
        </span>
      </div>
      <div className="chart-controls">
        <div className="segmented segmented-small" role="group" aria-label={t('Chart unit')}>
          <button type="button" aria-pressed={!percent} onClick={() => onMode('eur')}>
            {displayCurrency()}
          </button>
          <button type="button" aria-pressed={percent} onClick={() => onMode('percent')}>
            {t('% TWR')}
          </button>
        </div>
        <Menu label={t('View')} title={t('Chart style')} align="right">
          {option('fill', t('Fill under the value'))}
          {option('invested', t('Invested capital'), true)}
          {option('log', t('Logarithmic scale'), true)}
          <span className="label-caps">{t('Colors')}</span>
          <div className="menu-radios" role="radiogroup" aria-label={t('Colors')}>
            {PALETTES.map((p) => (
              <label key={p.id} className="menu-check" title={t(p.description)}>
                <input type="radio" name="chart-palette" checked={palette === p.id} onChange={() => storePalette(p.id)} />
                {t(p.label)}
              </label>
            ))}
          </div>
        </Menu>
        <button
          type="button"
          aria-pressed={chartStyle.profitPane && !percent}
          disabled={percent}
          title={percent ? t('Only in {currency}', { currency: displayCurrency() }) : t('The profit or loss under the chart')}
          onClick={() => onStyleChange({ profitPane: !chartStyle.profitPane })}
        >
          {t('Profit/Loss')}
        </button>
        <button type="button" aria-pressed={panelOpen} onClick={() => onPanel(!panelOpen)} title={t('The state of the portfolio on the inspected day')}>
          {t('Side panel')}
        </button>
        <button
          type="button"
          className="chart-expand"
          onClick={onExpand}
          aria-pressed={expanded}
          aria-label={expanded ? t('Exit full screen') : t('Full screen')}
          title={expanded ? t('Exit full screen (F)') : t('Full screen (F)')}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square" aria-hidden="true">
            <path d={expanded ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
          </svg>
        </button>
      </div>
    </div>
  )
}
