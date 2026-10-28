import { useEffect, useMemo, useRef, useState } from 'react'
import type { Position } from '../../engine/positions.ts'
import type { DailyPoint } from '../../engine/series.ts'
import type { Slice } from '../dashboard/allocation.ts'
import type { BenchmarkLine } from '../dashboard/benchmarkLines.ts'
import { cardFile, drawShareCard, loadCardFonts, POSITION_ROWS, type ShareFormat } from './drawShareCard.ts'
import { shareCard, shareText, type PositionOrder } from './shareCard.ts'
import { shareLink } from './shareLink.ts'
import { t } from '../../i18n/i18n.ts'

interface Props {
  points: DailyPoint[]
  from: number
  to: number
  benchmarks: BenchmarkLine[]
  /** The value per type of asset on the last day. */
  slices: Slice[]
  /** The open positions on the last day. */
  positions: Position[]
  onClose: () => void
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Makes a picture of the return in percent to post or send, with a text to go with it. */
export function ShareDialog({ points, from, to, benchmarks, slices, positions, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [format, setFormat] = useState<ShareFormat>('wide')
  const [compare, setCompare] = useState(true)
  const [showAllocation, setShowAllocation] = useState(true)
  // Off at first: names say more about someone than percentages.
  const [positionOrder, setPositionOrder] = useState<PositionOrder | 'off'>('off')
  const showPositions = positionOrder !== 'off'
  const limit = POSITION_ROWS[format]
  const [fontsReady, setFontsReady] = useState(false)
  const [status, setStatus] = useState('')
  const benchmark = compare ? benchmarks[0] : undefined
  const card = useMemo(
    () =>
      shareCard(points, from, to, benchmark, slices, showPositions ? positions : [], {
        order: positionOrder === 'return' ? 'return' : 'weight',
        limit,
      }),
    [points, from, to, benchmark, slices, positions, showPositions, positionOrder, limit],
  )
  const text = shareText(card)

  useEffect(() => {
    void loadCardFonts().then(() => setFontsReady(true))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: the card is drawn again once the fonts are loaded
  useEffect(() => {
    if (canvas.current) drawShareCard(canvas.current, card, format, { allocation: showAllocation, positions: showPositions })
  }, [card, format, showAllocation, showPositions, fontsReady])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const file = () => (canvas.current ? cardFile(canvas.current, card) : Promise.resolve(null))

  // The text goes to the clipboard on every share or download: most apps drop it next to an image.
  const share = async () => {
    const copied = await copy(text)
    const image = await file()
    if (image && navigator.canShare?.({ files: [image] })) {
      try {
        await navigator.share({ files: [image], text })
        setStatus(copied ? t('Shared. The text is on your clipboard too.') : t('Shared.'))
      } catch {
        // Closed the share sheet: nothing to report.
      }
      return
    }
    await download(copied)
  }

  const download = async (copied?: boolean) => {
    const image = await file()
    if (!image) return
    const url = URL.createObjectURL(image)
    const link = document.createElement('a')
    link.href = url
    link.download = image.name
    link.click()
    URL.revokeObjectURL(url)
    const textCopied = copied ?? (await copy(text))
    setStatus(textCopied ? t('Image saved. The text is on your clipboard: paste it with the image.') : t('Image saved.'))
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes the dialog, like the close button
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog through the window listener above
    <div className="share-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="panel-header">
          <h3 id="share-title">{t('Share your return')}</h3>
          <button type="button" className="share-close" onClick={onClose} aria-label={t('Close')}>
            ✕
          </button>
        </div>
        <p className="muted small">
          {showPositions
            ? t('Percentages, dates and the names of your positions: no amounts or quantities.')
            : t('Only percentages and dates: no amounts, quantities or product names.')}
        </p>
        <canvas ref={canvas} className={`share-preview ${format}`} role="img" aria-label={text} />
        <div className="share-options">
          <div className="segmented" role="group" aria-label={t('Format')}>
            <button type="button" aria-pressed={format === 'wide'} onClick={() => setFormat('wide')}>
              {t('Post')}
            </button>
            <button type="button" aria-pressed={format === 'story'} onClick={() => setFormat('story')}>
              {t('Story')}
            </button>
          </div>
          {benchmarks[0] && (
            <label>
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> {t('Compare with {name}', { name: benchmarks[0].label })}
            </label>
          )}
          {slices.length > 0 && (
            <label>
              <input type="checkbox" checked={showAllocation} onChange={(e) => setShowAllocation(e.target.checked)} /> {t('Show the mix by type')}
            </label>
          )}
        </div>
        {positions.length > 0 && (
          <div className="share-positions">
            <span>{t('My positions')}</span>
            <div className="segmented" role="group" aria-label={t('My positions')}>
              <button type="button" aria-pressed={positionOrder === 'off'} onClick={() => setPositionOrder('off')}>
                {t('Hide')}
              </button>
              <button type="button" aria-pressed={positionOrder === 'weight'} onClick={() => setPositionOrder('weight')}>
                {t('Largest')}
              </button>
              <button type="button" aria-pressed={positionOrder === 'return'} onClick={() => setPositionOrder('return')}>
                {t('Best return')}
              </button>
            </div>
            <span className="muted small">
              {!showPositions
                ? t('Show each position with its weight and its return, never the amounts.')
                : positions.length > limit
                  ? t('You have {count} positions: the card shows {shown} and the other {rest} together in one row.', { count: positions.length, shown: limit - 1, rest: positions.length - limit + 1 }) +
                    (format === 'wide' ? ` ${t('A story has room for more.')}` : '')
                  : t('Each position with its weight and its return, never the amounts.')}
            </span>
          </div>
        )}
        <textarea className="share-text" readOnly value={text} rows={3} aria-label={t('Text to go with it')} />
        <div className="share-actions">
          <button type="button" className="primary" onClick={() => void share()}>
            {t('Share')}
          </button>
          <button type="button" onClick={() => void download()}>
            {t('Download image')}
          </button>
          <button type="button" onClick={() => void copy(text).then((ok) => setStatus(ok ? t('Text copied.') : t('Copying is not allowed here.')))}>
            {t('Copy text')}
          </button>
          <button
            type="button"
            onClick={() =>
              void shareLink(card)
                .then(copy)
                .then((ok) => setStatus(ok ? t('Link copied: it opens this card, read-only. Everything is in the link itself.') : t('Copying is not allowed here.')))
            }
          >
            {t('Copy link')}
          </button>
        </div>
        <p className="small" role="status">
          {status}
        </p>
      </div>
    </div>
  )
}
