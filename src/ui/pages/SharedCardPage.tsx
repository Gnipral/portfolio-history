import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { DemoButton } from '../components/DemoBanner.tsx'
import { formatDate, formatPercent } from '../format.ts'
import { drawShareCard, loadCardFonts } from '../share/drawShareCard.ts'
import type { ShareCard } from '../share/shareCard.ts'
import { readShareLink } from '../share/shareLink.ts'

/** A card someone shared as a link: shown read-only, with the way to try the app. */
export function SharedCardPage() {
  const { data = '' } = useParams()
  const [card, setCard] = useState<ShareCard | null | undefined>(undefined)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    void readShareLink(data).then((read) => {
      if (!cancelled) setCard(read)
    })
    return () => {
      cancelled = true
    }
  }, [data])

  useEffect(() => {
    if (!card) return
    const draw = () => {
      if (canvas.current) drawShareCard(canvas.current, card, 'wide', { allocation: card.allocation.length > 0, positions: card.positions.length > 0 })
    }
    draw()
    void loadCardFonts().then(draw)
  }, [card])

  if (card === undefined) return <p role="status">Opening the shared card…</p>
  if (card === null) {
    return (
      <section className="stack">
        <h2>Shared portfolio</h2>
        <p className="callout warning">This link is not valid: it may have been cut off when it was copied.</p>
        <DemoButton />
      </section>
    )
  }

  return (
    <section className="stack shared-card">
      <h2>A shared portfolio</h2>
      <p className="muted">
        {formatDate(card.from)} – {formatDate(card.to)}: {formatPercent(card.twr)} time-weighted
        {card.benchmark ? `, ${card.benchmark.label} ${formatPercent(card.benchmark.twr)}` : ''}. Only percentages are shared, never
        amounts.
      </p>
      <canvas ref={canvas} className="share-preview wide" role="img" aria-label={`Return ${formatPercent(card.twr)}`} />
      <div className="callout info">
        <p>
          <strong>See your own portfolio like this.</strong> Free, no account needed, and your data stays on your device.
        </p>
        <div className="actions">
          <DemoButton className="primary" />
          <Link to="/import">Import your own export</Link>
        </div>
      </div>
    </section>
  )
}
