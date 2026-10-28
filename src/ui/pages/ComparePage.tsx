import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { db } from '../../data/db.ts'
import { DEFAULT_SETTINGS, useSettings } from '../../settings/settings.ts'
import { DemoButton } from '../components/DemoBanner.tsx'
import { engineOptions } from '../dashboard/toggles.ts'
import { usePortfolio } from '../dashboard/usePortfolio.ts'
import { formatDate, formatPercent, trendClass } from '../format.ts'
import { annualized, compareLink, comparePath, curvePoints, linkData, MAX_COMPARED, splitCompare, type ComparePoint } from '../share/compare.ts'
import { shareCard, type ShareCard } from '../share/shareCard.ts'
import { readShareLink } from '../share/shareLink.ts'

interface Line {
  label: string
  card: ShareCard
  own?: boolean
}

/** Several shared cards in one chart, in percent only; the own portfolio can join without being shared. */
export function ComparePage() {
  const { data = '' } = useParams()
  const navigate = useNavigate()
  const datas = useMemo(() => splitCompare(data), [data])
  const [cards, setCards] = useState<(ShareCard | null)[] | undefined>()
  const [withOwn, setWithOwn] = useState(false)
  const [own, setOwn] = useState<ShareCard | null>(null)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState('')
  const [copied, setCopied] = useState(false)
  const hasOwn = (useLiveQuery(() => db.transactions.count()) ?? 0) > 0

  useEffect(() => {
    let cancelled = false
    void Promise.all(datas.map(readShareLink)).then((read) => {
      if (!cancelled) setCards(read)
    })
    return () => {
      cancelled = true
    }
  }, [datas])

  const valid = (cards ?? []).flatMap((card, i) => (card ? [{ label: `Portfolio ${i + 1}`, card }] : []))
  const lines: Line[] = [...valid, ...(withOwn && own ? [{ label: 'Yours', card: own, own: true }] : [])]
  const invalid = (cards ?? []).filter((c) => c === null).length

  function add(event: FormEvent) {
    event.preventDefault()
    const more = linkData(pasted)
    if (more.length === 0) return setPasteError('That is not a Portfolio History share link.')
    setPasteError('')
    setPasted('')
    void navigate(comparePath([...datas, ...more]))
  }

  async function copy() {
    await navigator.clipboard.writeText(compareLink(datas))
    setCopied(true)
  }

  if (cards === undefined) return <p role="status">Opening the shared portfolios…</p>
  const from = valid[0]?.card.from

  return (
    <section className="stack">
      <h2>Compare portfolios</h2>
      <p className="muted">
        Time-weighted returns of shared portfolios side by side. Only percentages are in the links, never amounts.
        {valid.some((l) => l.card.from !== from) && ' The periods differ: every line starts at 0% on its own first day.'}
      </p>
      {invalid > 0 && <p className="callout warning small">{invalid === 1 ? 'One link is' : `${invalid} links are`} not valid and left out.</p>}

      {lines.length > 0 && <CompareChart lines={lines} />}

      {lines.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Portfolio</th>
                <th>Period</th>
                <th className="num">Return</th>
                <th className="num">Per year</th>
                <th>Benchmark in the card</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const yearly = annualized(line.card.twr, line.card.from, line.card.to)
                return (
                  <tr key={line.label}>
                    <td>
                      <span className={`legend-dot series-${(i % 7) + 1}`} /> {line.label}
                    </td>
                    <td>
                      {formatDate(line.card.from)} – {formatDate(line.card.to)}
                    </td>
                    <td className={`num ${trendClass(line.card.twr)}`}>{formatPercent(line.card.twr)}</td>
                    <td className="num">{yearly === undefined ? '–' : formatPercent(yearly)}</td>
                    <td className="muted small">{line.card.benchmark ? `${line.card.benchmark.label} ${formatPercent(line.card.benchmark.twr)}` : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions">
        {hasOwn && from && (
          <button type="button" aria-pressed={withOwn} onClick={() => setWithOwn(!withOwn)}>
            {withOwn ? 'Hide my portfolio' : 'Compare with my portfolio'}
          </button>
        )}
        {datas.length > 1 && (
          <button type="button" onClick={() => void copy()}>
            {copied ? 'Link copied' : 'Copy this comparison'}
          </button>
        )}
      </div>
      {withOwn && from && <OwnCard from={from} to={valid[0]?.card.to ?? from} onCard={setOwn} />}
      {withOwn && <p className="muted small">Your portfolio is only shown here; nothing of it goes into a link.</p>}

      {datas.length < MAX_COMPARED && (
        <form className="actions" onSubmit={add}>
          <input
            className="compare-input"
            aria-label="Share link to add"
            placeholder="Paste another share link"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button type="submit">Add</button>
          {pasteError && (
            <span className="negative small" role="alert">
              {pasteError}
            </span>
          )}
        </form>
      )}

      {!hasOwn && (
        <div className="callout info">
          <p>
            <strong>Add your own portfolio to the comparison.</strong> Free, no account needed, and your data stays on your device.
          </p>
          <div className="actions">
            <DemoButton className="primary" />
          </div>
        </div>
      )}
    </section>
  )
}

/** Builds a card of the own portfolio for the period of the first shared card; nothing leaves the device. */
function OwnCard({ from, to, onCard }: { from: string; to: string; onCard: (card: ShareCard | null) => void }) {
  const settings = useSettings() ?? DEFAULT_SETTINGS
  const importRecord = useLiveQuery(() => db.imports.get('current'))
  const options = useMemo(() => engineOptions(settings, importRecord?.capabilities), [settings, importRecord])
  const { series } = usePortfolio(options)

  useEffect(() => {
    const points = series?.points ?? []
    const start = points.findIndex((p) => p.date >= from)
    let end = points.findLastIndex((p) => p.date <= to)
    if (end < 0) end = points.length - 1
    onCard(start >= 0 && end > start ? shareCard(points, start, end, undefined, []) : null)
  }, [series, from, to, onCard])

  if (!series) return <p role="status">Calculating your portfolio…</p>
  const covers = series.points.some((p) => p.date <= from)
  return covers ? null : <p className="muted small">Your history starts after {formatDate(from)}: your line starts later.</p>
}

/** One line per portfolio on a shared date axis, in percent. */
function CompareChart({ lines }: { lines: Line[] }) {
  const width = 900
  const height = 300
  const pad = { left: 48, right: 12, top: 12, bottom: 24 }
  const series = lines.map((line) => curvePoints(line.card))
  const all = series.flat()
  const dates = all.map((p) => p.date).sort()
  const first = Date.parse(dates[0] as string)
  const last = Math.max(Date.parse(dates.at(-1) as string), first + 86_400_000)
  const values = [0, ...all.map((p) => p.percent)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (date: string) => pad.left + ((Date.parse(date) - first) / (last - first)) * (width - pad.left - pad.right)
  const y = (percent: number) => pad.top + ((max - percent) / span) * (height - pad.top - pad.bottom)
  const path = (points: ComparePoint[]) => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.percent).toFixed(1)}`).join('')
  const step = niceStep(span / 4)
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(Math.round(v * 10) / 10)

  return (
    <figure className="compare-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={lines.map((l) => `${l.label} ${formatPercent(l.card.twr)}`).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'compare-zero' : 'compare-grid'} />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="projection-tick">
              {t}%
            </text>
          </g>
        ))}
        <text x={pad.left} y={height - 6} className="projection-tick">
          {formatDate(dates[0] as string)}
        </text>
        <text x={width - pad.right} y={height - 6} textAnchor="end" className="projection-tick">
          {formatDate(dates.at(-1) as string)}
        </text>
        {series.map((points, i) => (
          <path key={lines[i]?.label} d={path(points)} className={`compare-line series-${(i % 7) + 1}${lines[i]?.own ? ' own' : ''}`} />
        ))}
      </svg>
    </figure>
  )
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}
